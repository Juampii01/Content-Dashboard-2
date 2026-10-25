"""Puerta de IA con la suscripción de Claude (comunes/ia_server.py): autorización, llamada con salida estructurada
(con un SDK simulado: no gasta uso real), imágenes, sin cupo, y que el token nunca vaya al entorno como API key."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from comunes import ia_server

SECRET = "s" * 40


@pytest.fixture
def server(tmp_path: Path):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), ia_server.make_handler(SECRET, tmp_path))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _post(url: str, body: dict, secret: str = SECRET) -> tuple[int, Any]:
    req = urllib.request.Request(f"{url}/ia", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode().strip())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def _fake_query(monkeypatch: pytest.MonkeyPatch, messages: list, seen: dict) -> None:
    import claude_agent_sdk as sdk

    def fake(*, prompt: Any, options: Any):  # noqa: ANN202
        seen["options"] = options
        seen["prompt"] = prompt

        async def gen():  # noqa: ANN202
            if not isinstance(prompt, str):
                seen["streamed"] = [m async for m in prompt]
            for m in messages:
                yield m

        return gen()

    monkeypatch.setattr(sdk, "query", fake)


def _result(**kw: Any) -> Any:
    import claude_agent_sdk as sdk

    base = {"subtype": "success", "duration_ms": 4200, "duration_api_ms": 4000, "is_error": False, "num_turns": 2, "session_id": "s", "total_cost_usd": 0.031, "usage": {"input_tokens": 1200, "output_tokens": 300, "cache_read_input_tokens": 9000}}
    base.update(kw)
    return sdk.ResultMessage(**base)


BODY = {"token": "sk-ant-oat01-prueba", "feature": "guiones.puntaje", "model": "claude-sonnet-5-5", "system": "Eres…", "task": "Puntúa este gancho", "schema": {"type": "object", "properties": {"score": {"type": "number"}}, "required": ["score"]}}


def test_rejects_without_the_secret(server: str) -> None:
    status, body = _post(server, BODY, secret="otro")
    assert status == 401 and body["error"]


def test_structured_call_with_the_plan(server: str, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}
    _fake_query(monkeypatch, [_result(structured_output={"score": 87})], seen)
    status, body = _post(server, BODY)
    assert status == 200 and body["ok"] is True and body["data"] == {"score": 87}
    assert body["usage"]["apiEquivalentUsd"] == pytest.approx(0.031) and body["usage"]["outputTokens"] == 300
    opts = seen["options"]
    assert opts.env["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-prueba" and opts.env["ANTHROPIC_API_KEY"] == ""
    assert opts.tools == [] and opts.model == "claude-sonnet-5-5" and opts.system_prompt == "Eres…"
    assert opts.output_format == {"type": "json_schema", "schema": BODY["schema"]}
    assert seen["prompt"] == "Puntúa este gancho"


def test_images_go_in_the_user_message(server: str, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}
    _fake_query(monkeypatch, [_result(structured_output={"score": 1})], seen)
    status, body = _post(server, {**BODY, "images": [{"mediaType": "image/jpeg", "data": "QUJD"}], "effort": "medium"})
    assert status == 200 and body["ok"]
    content = seen["streamed"][0]["message"]["content"]
    assert content[0]["type"] == "image" and content[0]["source"]["data"] == "QUJD" and content[-1] == {"type": "text", "text": "Puntúa este gancho"}
    assert seen["options"].effort == "medium"


def test_without_quota(server: str, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict = {}
    _fake_query(monkeypatch, [_result(is_error=True, subtype="error_during_execution", errors=["Claude AI usage limit reached"], api_error_status=429)], seen)
    status, body = _post(server, BODY)
    assert status == 200 and body["ok"] is False and body["kind"] == "quota"


def test_activity_keeps_the_worker_awake() -> None:
    st = ia_server.State()
    assert st.idle_for() == float("inf")
    st.begin()
    assert st.idle_for() == 0.0
    st.end()
    assert st.idle_for() < 1
