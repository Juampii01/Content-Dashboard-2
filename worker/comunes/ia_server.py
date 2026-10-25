"""Puerta de IA con la suscripción de Claude del cliente: la app le manda cada llamada de IA (la misma que haría a la API
de Anthropic) y el worker la resuelve con el SDK de agentes de Claude, que gasta el uso semanal del plan del cliente.

Vercel no puede correr la CLI de Claude (pesa más que el límite de una función), por eso vive aquí. Corre en un hilo
aparte del worker, así una llamada de IA nunca espera a que termine un render.

    POST /ia      (Authorization: Bearer WORKER_SECRET)
      { token, system, task, images?: [{ mediaType, data }], schema, model, effort?, feature }
      → { ok: true, data, usage } | { ok: false, kind: "quota" | "auth" | "other", error }
    GET /salud    → { ok: true }

La respuesta se manda de a poco: espacios cada 10 s mientras Claude trabaja (para que el proxy no corte una llamada de
varios minutos) y al final el JSON. El token llega en cada pedido, no se guarda ni se loguea.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

log = logging.getLogger("worker.ia")

PORT = int(os.environ.get("IA_PORT", "8080"))
# Llamadas a la vez (cada una es un proceso de la CLI de ~200 MB); las demás esperan su turno.
PARALLEL = max(1, int(os.environ.get("IA_PARALLEL", "4") or 4))
MAX_BODY = 30 * 1024 * 1024
TIMEOUT_S = 14 * 60
KEEPALIVE_S = 10


class State:
    """Actividad de la puerta: el worker no se apaga mientras haya llamadas en curso o recientes."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active = 0
        self.last = 0.0
        self.slots = threading.BoundedSemaphore(PARALLEL)

    def begin(self) -> None:
        with self.lock:
            self.active += 1
            self.last = time.monotonic()

    def end(self) -> None:
        with self.lock:
            self.active -= 1
            self.last = time.monotonic()

    def idle_for(self) -> float:
        with self.lock:
            if self.active:
                return 0.0
            return time.monotonic() - self.last if self.last else float("inf")


STATE = State()


# Variables del worker que la CLI de Claude no tiene por qué ver (las hereda del proceso; aquí quedan vacías).
SECRET_ENV = ("DATABASE_URL", "DATABASE_URL_UNPOOLED", "WORKER_SECRET", "FLY_API_TOKEN", "DEEPGRAM_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "PEXELS_API_KEY", "PIXABAY_API_KEY", "BLOB_READ_WRITE_TOKEN", "VIDEO_BLOB_READ_WRITE_TOKEN")


def cli_env(token: str, home: Path) -> dict[str, str]:
    """El entorno de la CLI de Claude: el token del plan, un HOME propio y sin claves del worker ni una API key."""
    env = {k: "" for k in SECRET_ENV if k in os.environ}
    env.update(
        {
            "CLAUDE_CODE_OAUTH_TOKEN": token,
            # Nunca una API key del entorno: pagaría la API en vez del plan.
            "ANTHROPIC_API_KEY": "",
            "ANTHROPIC_AUTH_TOKEN": "",
            "HOME": str(home),
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
    )
    return env


def classify(text: str, status: int | None = None) -> str:
    t = (text or "").lower()
    if status == 429 or any(k in t for k in ("usage limit", "rate limit", "rate_limit", "limit reached", "weekly limit", "out of extra usage", "quota", "overloaded")):
        return "quota"
    if status in (401, 403) or any(k in t for k in ("oauth", "invalid api key", "invalid x-api-key", "authentication", "unauthorized", "token has expired", "please run /login", "not logged in")):
        return "auth"
    return "other"


async def _call(req: dict[str, Any], home: Path) -> dict[str, Any]:
    from claude_agent_sdk import ClaudeAgentOptions, RateLimitEvent, ResultMessage, query  # noqa: PLC0415

    images = [i for i in req.get("images") or [] if isinstance(i, dict) and i.get("data")]
    task = str(req.get("task") or "")
    options = ClaudeAgentOptions(
        system_prompt=str(req.get("system") or ""),
        tools=[],
        model=str(req.get("model") or "sonnet"),
        max_turns=4,
        setting_sources=[],
        output_format={"type": "json_schema", "schema": req.get("schema") or {"type": "object"}},
        **({"effort": req["effort"]} if req.get("effort") else {}),
        cwd=str(home),
        env=cli_env(str(req.get("token") or ""), home),
    )

    async def with_images():  # noqa: ANN202
        content = [{"type": "image", "source": {"type": "base64", "media_type": i.get("mediaType") or "image/jpeg", "data": i["data"]}} for i in images]
        content.append({"type": "text", "text": task})
        yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None, "session_id": "default"}

    usage: dict[str, Any] = {}
    data: Any = None
    error = ""
    status: int | None = None
    async for msg in query(prompt=with_images() if images else task, options=options):
        if isinstance(msg, RateLimitEvent):
            info = msg.rate_limit_info
            usage["utilization"] = getattr(info, "utilization", None)
            usage["limitType"] = str(getattr(info, "rate_limit_type", "") or "")
            if getattr(info, "status", "") == "rejected":
                error, status = "usage limit reached", 429
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
                    "model": ",".join((msg.model_usage or {}).keys())[:80],
                }
            )
            if msg.structured_output is not None and not msg.is_error:
                data = msg.structured_output
            elif msg.is_error:
                error = "; ".join(msg.errors or []) or str(msg.result or msg.subtype)
                status = msg.api_error_status
            elif msg.result:
                # Sin salida estructurada: el JSON puede venir en el texto.
                try:
                    text = msg.result
                    data = json.loads(text[text.index("{") : text.rindex("}") + 1])
                except (ValueError, json.JSONDecodeError):
                    error = "Claude no devolvió el formato pedido."
    clean = {k: v for k, v in usage.items() if v is not None}
    if data is not None:
        return {"ok": True, "data": data, "usage": clean}
    return {"ok": False, "kind": classify(error, status), "error": (error or "Claude no devolvió nada.")[:400], "usage": clean}


def run_call(req: dict[str, Any], work_dir: Path) -> dict[str, Any]:
    """Una llamada de punta a punta (en el hilo de su pedido)."""
    home = Path(tempfile.mkdtemp(prefix="ia-", dir=str(work_dir)))
    try:
        return asyncio.run(asyncio.wait_for(_call(req, home), timeout=TIMEOUT_S))
    except TimeoutError:
        return {"ok": False, "kind": "other", "error": "Claude tardó demasiado."}
    except Exception as e:  # noqa: BLE001 — siempre una respuesta legible para la app
        text = f"{e.__class__.__name__}: {e}"
        log.warning("llamada de IA falló: %s", text[:300])
        return {"ok": False, "kind": classify(text), "error": "La IA con tu suscripción no respondió."}
    finally:
        shutil.rmtree(home, ignore_errors=True)


def make_handler(secret: str, work_dir: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "content2-ia"

        def log_message(self, fmt: str, *args: Any) -> None:  # sin registrar cada pedido (y nunca su contenido)
            return

        def _json(self, code: int, body: dict[str, Any]) -> None:
            raw = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/salud":
                self._json(200, {"ok": True, "active": STATE.active})
            else:
                self._json(404, {"error": "No existe."})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/ia":
                self._json(404, {"error": "No existe."})
                return
            auth = self.headers.get("Authorization") or ""
            if not hmac.compare_digest(auth.encode(), f"Bearer {secret}".encode()):
                self._json(401, {"error": "No autorizado."})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                self._json(400, {"error": "Pedido no válido."})
                return
            try:
                req = json.loads(self.rfile.read(length))
            except json.JSONDecodeError:
                self._json(400, {"error": "Pedido no válido."})
                return
            if not isinstance(req, dict) or not req.get("token") or not isinstance(req.get("task"), str):
                self._json(400, {"error": "Pedido no válido."})
                return
            STATE.begin()
            try:
                # Respuesta de a poco: espacios mientras trabaja (el JSON los admite al principio) y al final el resultado.
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                box: dict[str, Any] = {}

                def work() -> None:
                    with STATE.slots:
                        box["res"] = run_call(req, work_dir)

                t = threading.Thread(target=work, daemon=True)
                t.start()
                started = time.monotonic()
                while t.is_alive():
                    t.join(KEEPALIVE_S)
                    if t.is_alive():
                        self.wfile.write(b" ")
                        self.wfile.flush()
                res = box.get("res") or {"ok": False, "kind": "other", "error": "Sin respuesta."}
                log.info(
                    "ia %s: %s · %s s · equivalente API USD %.3f · uso de la ventana %s",
                    str(req.get("feature") or "?")[:40],
                    "ok" if res.get("ok") else f"no ({res.get('kind')})",
                    round(time.monotonic() - started),
                    (res.get("usage") or {}).get("apiEquivalentUsd") or 0,
                    (res.get("usage") or {}).get("utilization"),
                )
                self.wfile.write(json.dumps(res).encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                log.warning("la app cortó la conexión antes de la respuesta")
            finally:
                STATE.end()

    return Handler


def start(secret: str, work_dir: Path) -> ThreadingHTTPServer | None:
    """Arranca la puerta en un hilo. Sin el SDK de Claude instalado no arranca (el worker sigue igual)."""
    try:
        import claude_agent_sdk  # noqa: F401, PLC0415
    except ImportError:
        log.info("puerta de IA apagada: falta claude-agent-sdk")
        return None
    server = ThreadingHTTPServer(("0.0.0.0", PORT), make_handler(secret, work_dir))  # noqa: S104 — detrás del proxy de Fly
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="ia", daemon=True).start()
    log.info("puerta de IA escuchando en :%s (%s a la vez)", PORT, PARALLEL)
    return server
