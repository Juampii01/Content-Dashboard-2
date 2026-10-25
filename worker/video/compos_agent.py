"""Agente de animaciones con la suscripción de Claude del cliente (paso «compos-agent» del taller, lib/video/compos/work.ts).

En lugar de pedirle a la API el módulo entero de una vez, un agente de Claude (SDK de agentes, con el token de
`claude setup-token` que el cliente guardó en Ajustes) escribe la animación por pasos con cuatro herramientas que corren
aquí mismo, en el proceso del worker:

- probar(code): la misma validación que hace la app antes de guardar (motion/compos-check.mjs).
- mirar(code, times?): la animación dibujada sobre el video real (el mismo motor del render) en una hoja de cuadros.
- ver_referencia(): las hojas de la referencia cuando copia una edición.
- entregar(...): la versión final (se valida otra vez).

Así no hay tope de largo de una sola respuesta ni de tiempo de una función de Vercel, y el consumo sale del uso
semanal del plan del cliente, no de la API. Si no hay cupo o el token venció, se avisa a la app y esa animación sigue
por la API. Nada de esto guarda ni loguea el token.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import shutil
import subprocess
import tempfile
import time
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from comunes.errors import Cancelled, JobError
from comunes.ia_server import cli_env, redact
from comunes.runner import JobContext

from . import fx, motion, render

log = logging.getLogger("worker.compos.agente")

CHECK_SCRIPT = motion.MOTION_DIR / "compos-check.mjs"
MODEL = "opus"
MAX_TURNS = 60
# Tope de tiempo del agente por animación (el trabajo tiene su propio arrendamiento de 2 h).
TIMEOUT_S = 40 * 60
MAX_LOOKS = 4
SHEET_WIDTH = 1400


class Workshop:
    """Las herramientas del agente sobre una tarea: el spec de la animación, el video base y lo entregado."""

    def __init__(self, ctx: JobContext, project: dict[str, Any], nxt: dict[str, Any], heavy: Any = None) -> None:
        self.ctx = ctx
        self.project = project
        self.pid = str(project["id"])
        self.item = dict(nxt.get("item") or {})
        self.spec = dict(self.item.get("spec") or {})
        self.render_input = dict(nxt.get("render") or {})
        self.ref_sheets = [r for r in nxt.get("refSheets") or [] if isinstance(r, dict) and isinstance(r.get("key"), str)]
        self.lock = heavy if heavy is not None else nullcontext()
        self.dir = Path(tempfile.mkdtemp(prefix="agente-", dir=str(ctx.config.work_dir)))
        self.built: dict[str, Any] | None = None
        self.looks = 0
        self.delivered: dict[str, Any] | None = None
        self.tries = 0

    def cleanup(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    @property
    def duration(self) -> float:
        return float(self.spec.get("duration") or 1.0)

    def _spec_with(self, code: str) -> dict[str, Any]:
        compos = dict(self.spec.get("compos") or {})
        compos["code"] = code
        return {**self.spec, "compos": compos}

    # ─── probar ───────────────────────────────────────────────────────────

    def check(self, code: str) -> dict[str, Any]:
        """validateComposition de la app, en el sandbox de Node del worker."""
        self.tries += 1
        env = (self.spec.get("compos") or {}).get("env")
        if not isinstance(code, str) or not code.strip():
            return {"ok": False, "error": "El código está vacío.", "line": None}
        if len(code) > fx.COMPOS_MAX_CODE:
            return {"ok": False, "error": f"El código es demasiado largo ({len(code)} caracteres; máximo {fx.COMPOS_MAX_CODE}). Hazlo más compacto: funciones auxiliares, sin comentarios.", "line": None}
        try:
            out = subprocess.run([motion.node_bin() or "node", str(CHECK_SCRIPT)], input=json.dumps({"code": code, "env": env}), capture_output=True, text=True, timeout=120, check=False)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "La prueba tardó demasiado: dibuja menos cosas por cuadro.", "line": None}
        try:
            return json.loads(out.stdout.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            log.warning("compos-check sin respuesta: %s", (out.stderr or "")[-400:])
            return {"ok": False, "error": "No pudimos probar el código (el validador no respondió).", "line": None}

    @staticmethod
    def check_text(result: dict[str, Any]) -> str:
        if result.get("ok"):
            stats = result.get("stats") or {}
            return f"ok: pasa la validación ({stats.get('frames', '?')} instantes, {stats.get('avgMs', '?')} ms por cuadro en promedio, hasta {stats.get('maxOps', '?')} operaciones)."
        line = result.get("line")
        return f"falla: {result.get('error') or 'error sin detalle'}{f' (línea {line})' if line else ''}"

    # ─── mirar ────────────────────────────────────────────────────────────

    def _base(self) -> dict[str, Any]:
        if self.built is None:
            from .pipeline import compose  # noqa: PLC0415 — evita el import circular

            self.built = compose(self.ctx, self.project, self.render_input, preview=True)
        return self.built

    def look(self, code: str, times: list[float] | None) -> Path | None:
        """La animación sobre el video real en una hoja de cuadros (el mismo motor del render)."""
        import cv2  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415

        from . import director  # noqa: PLC0415
        from .pipeline import fx_image_hosts  # noqa: PLC0415

        d = self.duration
        picks = [round(min(d - 0.04, max(0.0, float(t))), 3) for t in (times or [])][:8]
        if not picks:
            picks = [round(min(d - 0.04, d * p), 3) for p in (0.1, 0.28, 0.46, 0.64, 0.82, 0.96)]
        with self.lock:
            built = self._base()
            media = self.project.get("media") or {}
            workdir = self.ctx.workdir(self.pid)
            fmt = built["fmt"]
            out_w, out_h = render.OUTPUT_SIZE[fmt]
            self.looks += 1
            out_dir = self.dir / f"mirar-{self.looks}"
            paths = fx.render_stills(
                self.ctx,
                {"spec": self._spec_with(code), "sourceFrames": self.item.get("sourceFrames") or [], "imageKeys": self.item.get("imageKeys") or {}, "projectId": self.item.get("projectId")},
                picks,
                joined=Path(built["joined"]),
                mezz=workdir / "mezz.mp4",
                src_size=(int(media.get("width") or 1080), int(media.get("height") or 1920)),
                total_frames=int(round(float(media.get("duration") or 0) * render.FPS)) or 1,
                fmt=fmt,
                offset_x=float((self.render_input.get("framing") or {}).get("offsetX", 0)),
                workdir=workdir,
                fonts_dir=self.ctx.config.fonts_dir,
                image_hosts=fx_image_hosts(self.ctx.config.app_url),
                out_dir=out_dir,
            )
        frames = [cv2.imread(str(p)) if p and p.exists() else np.zeros((out_h // 2, out_w // 2, 3), np.uint8) for p in paths]
        sheets = director._sheets_from_frames(frames, picks, (out_w, out_h), out_dir / "hoja", self.ctx.config.fonts_dir, "mirar")  # noqa: SLF001
        return sheets[0][0] if sheets else None

    # ─── referencia ──────────────────────────────────────────────────────

    def references(self) -> list[Path]:
        out = []
        for n, ref in enumerate(self.ref_sheets[:4]):
            dest = self.dir / f"referencia-{n + 1}.jpg"
            if not dest.exists():
                self.ctx.app.download(self.pid, ref["key"], dest)
            out.append(dest)
        return out


def _image_block(path: Path) -> dict[str, Any]:
    """Una hoja como imagen para el agente (JPEG, achicada si es muy ancha)."""
    from PIL import Image  # noqa: PLC0415

    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.width > SHEET_WIDTH:
            im = im.resize((SHEET_WIDTH, round(im.height * SHEET_WIDTH / im.width)))
        small = path.with_name(f"{path.stem}-agente.jpg")
        im.save(small, "JPEG", quality=82)
    return {"type": "image", "data": base64.b64encode(small.read_bytes()).decode(), "mimeType": "image/jpeg"}


def _text(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


def classify(text: str, status: int | None = None) -> str:
    """Por qué no pudo: "quota" (sin uso de la semana), "auth" (token) u "other"."""
    t = (text or "").lower()
    if status == 429 or any(k in t for k in ("usage limit", "rate limit", "rate_limit", "limit reached", "weekly limit", "out of extra usage", "quota")):
        return "quota"
    if status in (401, 403) or any(k in t for k in ("oauth", "invalid api key", "invalid x-api-key", "authentication", "unauthorized", "token has expired", "please run /login", "not logged in")):
        return "auth"
    return "other"


async def _agent(shop: Workshop, token: str, nxt: dict[str, Any]) -> dict[str, Any]:
    from claude_agent_sdk import (  # noqa: PLC0415
        AssistantMessage,
        ClaudeAgentOptions,
        ClaudeSDKClient,
        RateLimitEvent,
        ResultMessage,
        create_sdk_mcp_server,
        tool,
    )

    code_schema = {"type": "object", "properties": {"code": {"type": "string", "description": "El módulo completo: export default { … }."}}, "required": ["code"]}

    @tool("probar", "Valida el módulo en el mismo sandbox del render (18 instantes). Devuelve ok con estadísticas o el error con su línea.", code_schema)
    async def probar(args: dict[str, Any]) -> dict[str, Any]:
        result = await asyncio.to_thread(shop.check, str(args.get("code") or ""))
        return _text(Workshop.check_text(result))

    @tool(
        "mirar",
        "Dibuja la animación sobre el video real y devuelve una hoja de cuadros. times: segundos dentro de la animación (opcional, hasta 8).",
        {"type": "object", "properties": {"code": {"type": "string"}, "times": {"type": "array", "items": {"type": "number"}}}, "required": ["code"]},
    )
    async def mirar(args: dict[str, Any]) -> dict[str, Any]:
        if shop.looks >= MAX_LOOKS:
            return _text("Ya miraste suficientes veces: entrega la mejor versión.")
        code = str(args.get("code") or "")
        result = await asyncio.to_thread(shop.check, code)
        if not result.get("ok"):
            return _text(f"Antes de mirar tiene que pasar la prueba. {Workshop.check_text(result)}")
        try:
            sheet = await asyncio.to_thread(shop.look, code, [float(t) for t in args.get("times") or [] if isinstance(t, (int, float))])
        except fx.ComposFailed as e:
            return _text(f"No se pudo dibujar: {e.detail}")
        if not sheet:
            return _text("No se pudo armar la hoja de cuadros. Revisa que la animación dibuje algo.")
        return {"content": [_image_block(sheet), {"type": "text", "text": f"Hoja {shop.looks} de {MAX_LOOKS}: tu animación sobre el video real (el número de cada cuadro y su segundo van arriba)."}]}

    @tool("ver_referencia", "Las hojas con los cuadros de la referencia que copias (R#n). Solo si copias una edición.", {"type": "object", "properties": {}})
    async def ver_referencia(_args: dict[str, Any]) -> dict[str, Any]:
        if not shop.ref_sheets:
            return _text("No hay referencia en este pedido.")
        paths = await asyncio.to_thread(shop.references)
        return {"content": [*[_image_block(p) for p in paths], {"type": "text", "text": f"{len(paths)} hoja(s) de la referencia."}]}

    deliver_schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Nombre corto para la línea de tiempo (3 a 6 palabras)."},
            "why": {"type": "string", "description": "Por qué esta animación aquí, en una frase para la persona."},
            "code": {"type": "string"},
            "params": {"type": "array", "items": {"type": "object", "properties": {"key": {"type": "string"}, "label": {"type": "string"}, "value": {"type": "string"}}, "required": ["key", "label", "value"]}},
            "sounds": {"type": "array", "items": {"type": "object", "properties": {"at": {"type": "number"}, "name": {"type": "string"}, "gain": {"type": "number"}}, "required": ["at", "name", "gain"]}},
            "hide_captions": {"type": "boolean"},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name", "why", "code", "params", "sounds", "hide_captions", "tags"],
    }

    @tool("entregar", "Entrega la versión final (se valida otra vez). Una sola vez, al final.", deliver_schema)
    async def entregar(args: dict[str, Any]) -> dict[str, Any]:
        code = str(args.get("code") or "")
        result = await asyncio.to_thread(shop.check, code)
        if not result.get("ok"):
            return _text(f"No se puede entregar todavía. {Workshop.check_text(result)}")
        shop.delivered = {
            "name": str(args.get("name") or "Animación")[:60],
            "why": str(args.get("why") or "")[:300],
            "code": code,
            "params": [p for p in args.get("params") or [] if isinstance(p, dict)][:12],
            "sounds": [x for x in args.get("sounds") or [] if isinstance(x, dict)][:8],
            "hide_captions": bool(args.get("hide_captions")),
            "tags": [str(t) for t in args.get("tags") or []][:6],
        }
        return _text("Entregada. Termina aquí sin escribir nada más.")

    server = create_sdk_mcp_server("taller", tools=[probar, mirar, ver_referencia, entregar])
    home = shop.dir / "home"
    home.mkdir(exist_ok=True)
    options = ClaudeAgentOptions(
        system_prompt=str(nxt.get("system") or ""),
        tools=[],
        allowed_tools=["mcp__taller__probar", "mcp__taller__mirar", "mcp__taller__ver_referencia", "mcp__taller__entregar"],
        mcp_servers={"taller": server},
        model=MODEL,
        max_turns=MAX_TURNS,
        setting_sources=[],
        cwd=str(shop.dir),
        env=cli_env(token, home),
        stderr=lambda line: log.debug("cli: %s", line[:300]),
    )
    usage: dict[str, Any] = {}
    error = ""
    status: int | None = None
    started = time.monotonic()
    async with ClaudeSDKClient(options=options) as client:
        await client.query(str(nxt.get("prompt") or ""))
        async for msg in client.receive_response():
            if time.monotonic() - started > TIMEOUT_S:
                error = "tardó demasiado"
                break
            shop.ctx.check()
            if isinstance(msg, RateLimitEvent):
                info = msg.rate_limit_info
                usage["utilization"] = getattr(info, "utilization", None)
                usage["limitType"] = str(getattr(info, "rate_limit_type", "") or "")
                if getattr(info, "status", "") == "rejected":
                    error = "usage limit reached"
                    status = 429
            elif isinstance(msg, AssistantMessage) and getattr(msg, "error", None):
                error = str(msg.error)
            elif isinstance(msg, ResultMessage):
                u = msg.usage or {}
                usage.update(
                    {
                        "inputTokens": int(u.get("input_tokens") or 0),
                        "outputTokens": int(u.get("output_tokens") or 0),
                        "cacheReadTokens": int(u.get("cache_read_input_tokens") or 0),
                        "cacheWriteTokens": int(u.get("cache_creation_input_tokens") or 0),
                        "apiEquivalentUsd": float(msg.total_cost_usd or 0),
                        "turns": int(msg.num_turns or 0),
                        "ms": int(msg.duration_ms or 0),
                        "model": ",".join((msg.model_usage or {}).keys())[:80] or MODEL,
                    }
                )
                if msg.is_error and not shop.delivered:
                    error = "; ".join(msg.errors or []) or str(msg.result or msg.subtype)
                    status = msg.api_error_status
    return {"usage": usage, "error": error, "status": status}


def run(ctx: JobContext, project: dict[str, Any], nxt: dict[str, Any], heavy: Any = None) -> dict[str, Any]:
    """Corre el agente para una tarea y devuelve lo que se manda a la app (paso «compos-agent-done»)."""
    pid = str(project["id"])
    task_id = str(nxt.get("taskId") or "")
    try:
        token = str(ctx.app._post(f"/api/worker/projects/{pid}/imagenes", {"op": "claude"}, timeout=60).get("token") or "")  # noqa: SLF001
    except JobError as e:
        return {"taskId": task_id, "ok": False, "kind": "auth", "error": e.user_message[:500]}
    if not token:
        return {"taskId": task_id, "ok": False, "kind": "auth", "error": "Sin token de Claude."}
    shop = Workshop(ctx, project, nxt, heavy)
    try:
        try:
            out = asyncio.run(_agent(shop, token, nxt))
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001 — el agente no puede tumbar el pedido: sigue por la API
            text = redact(f"{e.__class__.__name__}: {e}")
            log.warning("agente de %s: %s", task_id, text[:400])
            return {"taskId": task_id, "ok": False, "kind": classify(text), "error": f"El agente de Claude se detuvo: {text[:300]}"}
        usage = {k: v for k, v in out["usage"].items() if v is not None}
        log.info(
            "agente %s: %s · %s vueltas · %s s · equivalente API USD %.2f · %s pruebas · %s miradas · uso de la ventana %s",
            task_id,
            "entregó" if shop.delivered else f"sin entrega ({out['error'][:120]})",
            usage.get("turns"),
            round((usage.get("ms") or 0) / 1000),
            usage.get("apiEquivalentUsd") or 0,
            shop.tries,
            shop.looks,
            usage.get("utilization"),
        )
        clean_usage = {k: usage[k] for k in ("inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "apiEquivalentUsd", "turns", "ms", "model") if k in usage}
        if shop.delivered:
            return {"taskId": task_id, "ok": True, "wire": shop.delivered, "usage": clean_usage}
        kind = classify(out["error"], out.get("status"))
        message = {"quota": "Se te acabó el uso de Claude de esta semana.", "auth": "La conexión con Claude venció o no es válida."}.get(kind, f"Claude terminó sin entregar la animación{(': ' + out['error'][:200]) if out['error'] else ''}.")
        return {"taskId": task_id, "ok": False, "kind": kind, "error": message[:500], "usage": clean_usage}
    finally:
        shop.cleanup()
