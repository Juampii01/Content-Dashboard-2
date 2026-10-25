"""Agente de animaciones con la suscripción de Claude (video/compos_agent.py): sus herramientas (probar con el mismo
validador de la app, mirar sobre el video, entregar) y el flujo completo con un cliente del SDK simulado (sin gastar uso
real): entrega, sin cupo, token vencido."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from video import compos_agent, fx

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
FONTS = HERE.parent / "fonts"

pytestmark = pytest.mark.skipif(not (fx.enabled() and fx.COMPOS_ENGINE.exists() and compos_agent.CHECK_SCRIPT.exists()), reason="falta Node, skia-canvas o compos-engine.mjs")
needs_fonts = pytest.mark.skipif(not (FONTS / "Anton-Regular.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)")


def _specs() -> dict:
    return json.loads((FIXTURES / "compos-specs.json").read_text(encoding="utf-8"))


class _App:
    def __init__(self, token: str | None = "sk-ant-oat01-prueba") -> None:
        self.token = token
        self.posts: list[tuple[str, dict]] = []

    def _post(self, path: str, payload: dict, timeout: float) -> dict:
        self.posts.append((path, payload))
        return {"token": self.token} if self.token else {}

    def download(self, *_a: Any, **_k: Any) -> None:
        raise AssertionError("no debería bajar nada")


class _Ctx:
    def __init__(self, tmp: Path, app: _App | None = None) -> None:
        self.config = SimpleNamespace(work_dir=tmp, fonts_dir=FONTS, app_url="https://app.test")
        self.app = app or _App()
        self.tmp = tmp

    def check(self) -> None:
        return None

    def workdir(self, pid: str) -> Path:
        d = self.tmp / pid
        d.mkdir(exist_ok=True)
        return d


def _video(tmp: Path) -> Path:
    out = tmp / "base.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


PID = "11111111-2222-3333-4444-555555555555"


def _nxt(spec: dict) -> dict:
    return {"step": "compos-agent", "taskId": "t1", "system": "sistema", "prompt": "pedido", "item": {"taskId": "t1", "spec": spec, "sourceFrames": []}, "render": {}, "refSheets": [], "label": "x"}


def _shop(tmp: Path, spec: dict) -> compos_agent.Workshop:
    ctx = _Ctx(tmp)
    shop = compos_agent.Workshop(ctx, {"id": PID, "media": {"width": 1080, "height": 1920, "duration": 1}}, _nxt(spec))  # type: ignore[arg-type]
    video = _video(tmp)
    shop.built = {"joined": str(video), "fmt": "9:16"}
    (ctx.workdir(PID) / "mezz.mp4").write_bytes(video.read_bytes())
    return shop


def test_probar_uses_the_same_validation_as_the_app(tmp_path: Path) -> None:
    s = _specs()
    shop = _shop(tmp_path, s["card3d_stat"])
    good = shop.check(s["card3d_stat"]["compos"]["code"])
    assert good["ok"] is True and "hash" in good
    assert compos_agent.Workshop.check_text(good).startswith("ok")
    bad = shop.check(s["broken"]["compos"]["code"])
    assert bad["ok"] is False and bad["error"]
    assert compos_agent.Workshop.check_text(bad).startswith("falla")
    assert shop.check("")["ok"] is False


@needs_fonts
def test_mirar_draws_a_contact_sheet(tmp_path: Path) -> None:
    s = _specs()
    shop = _shop(tmp_path, s["card3d_stat"])
    sheet = shop.look(s["card3d_stat"]["compos"]["code"], [0.1, 0.4])
    assert sheet is not None and sheet.exists()
    block = compos_agent._image_block(sheet)  # noqa: SLF001
    assert block["type"] == "image" and block["mimeType"] == "image/jpeg" and len(block["data"]) > 1000


def test_classify() -> None:
    assert compos_agent.classify("Claude AI usage limit reached|1760000000") == "quota"
    assert compos_agent.classify("", 429) == "quota"
    assert compos_agent.classify("OAuth token has expired") == "auth"
    assert compos_agent.classify("algo raro") == "other"


# ─── Flujo completo con un cliente simulado ─────────────────────────────


def _fake_sdk(monkeypatch: pytest.MonkeyPatch, script: Any) -> dict:
    """Cambia ClaudeSDKClient por uno que corre `script(tools, options)` y devuelve sus mensajes."""
    import claude_agent_sdk as sdk

    seen: dict[str, Any] = {}

    def fake_server(name: str, version: str = "1.0.0", tools: list | None = None) -> dict:
        seen["tools"] = {t.name: t for t in tools or []}
        return {"type": "sdk", "name": name}

    class FakeClient:
        def __init__(self, options: Any) -> None:
            seen["options"] = options

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def query(self, prompt: str) -> None:
            seen["prompt"] = prompt

        async def receive_response(self):  # noqa: ANN202
            for msg in await script(seen["tools"], seen["options"]):
                yield msg

    monkeypatch.setattr(sdk, "create_sdk_mcp_server", fake_server)
    monkeypatch.setattr(sdk, "ClaudeSDKClient", FakeClient)
    return seen


def _result(**kw: Any) -> Any:
    import claude_agent_sdk as sdk

    base = {"subtype": "success", "duration_ms": 61000, "duration_api_ms": 50000, "is_error": False, "num_turns": 7, "session_id": "s", "total_cost_usd": 1.9, "usage": {"input_tokens": 1000, "output_tokens": 9000, "cache_read_input_tokens": 50000}}
    base.update(kw)
    return sdk.ResultMessage(**base)


@needs_fonts
def test_agent_delivers_after_testing_and_looking(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    s = _specs()
    code = s["card3d_stat"]["compos"]["code"]
    calls: list[str] = []

    async def script(tools: dict, options: Any) -> list:
        r = await tools["probar"].handler({"code": s["broken"]["compos"]["code"]})
        calls.append(r["content"][0]["text"])
        r = await tools["probar"].handler({"code": code})
        calls.append(r["content"][0]["text"])
        r = await tools["mirar"].handler({"code": code, "times": [0.2]})
        calls.append(r["content"][0]["type"])
        r = await tools["entregar"].handler({"name": "Tarjeta 3D", "why": "Para la cifra", "code": code, "params": [], "sounds": [{"at": 0, "name": "whoosh", "gain": -14}], "hide_captions": False, "tags": ["tarjeta-3d"]})
        calls.append(r["content"][0]["text"])
        return [_result()]

    seen = _fake_sdk(monkeypatch, script)
    shop_dir = tmp_path
    ctx = _Ctx(shop_dir)
    video = _video(tmp_path)
    (ctx.workdir(PID) / "mezz.mp4").write_bytes(video.read_bytes())
    monkeypatch.setattr(compos_agent.Workshop, "_base", lambda self: {"joined": str(video), "fmt": "9:16"})
    done = compos_agent.run(ctx, {"id": PID, "media": {"width": 1080, "height": 1920, "duration": 1}}, _nxt(s["card3d_stat"]))  # type: ignore[arg-type]
    assert calls[0].startswith("falla") and calls[1].startswith("ok") and calls[2] == "image" and calls[3].startswith("Entregada")
    assert done["ok"] is True and done["wire"]["code"] == code and done["wire"]["name"] == "Tarjeta 3D"
    assert done["usage"]["apiEquivalentUsd"] == 1.9 and done["usage"]["turns"] == 7
    # El token va al CLI por el entorno y nunca una API key; sin herramientas propias de Claude Code.
    opts = seen["options"]
    assert opts.env["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-prueba" and opts.env["ANTHROPIC_API_KEY"] == ""
    assert opts.tools == [] and set(opts.allowed_tools) == {"mcp__taller__probar", "mcp__taller__mirar", "mcp__taller__ver_referencia", "mcp__taller__entregar"}
    assert seen["prompt"] == "pedido" and opts.system_prompt == "sistema"
    # Limpió su carpeta temporal.
    assert not list(tmp_path.glob("agente-*"))


def test_agent_without_quota_falls_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import claude_agent_sdk as sdk

    async def script(_tools: dict, _options: Any) -> list:
        info = sdk.RateLimitInfo(status="rejected", resets_at=None, rate_limit_type="seven_day", utilization=1.0, overage_status=None, overage_resets_at=None, overage_disabled_reason=None, raw={})
        return [sdk.RateLimitEvent(rate_limit_info=info, uuid="u", session_id="s"), _result(is_error=True, subtype="error_during_execution", errors=["Claude AI usage limit reached"], api_error_status=429)]

    _fake_sdk(monkeypatch, script)
    s = _specs()
    done = compos_agent.run(_Ctx(tmp_path), {"id": PID, "media": {}}, _nxt(s["card3d_stat"]))  # type: ignore[arg-type]
    assert done["ok"] is False and done["kind"] == "quota" and "semana" in done["error"]


def test_agent_without_token_falls_back(tmp_path: Path) -> None:
    s = _specs()
    done = compos_agent.run(_Ctx(tmp_path, _App(token=None)), {"id": PID, "media": {}}, _nxt(s["card3d_stat"]))  # type: ignore[arg-type]
    assert done == {"taskId": "t1", "ok": False, "kind": "auth", "error": "Sin token de Claude."}
