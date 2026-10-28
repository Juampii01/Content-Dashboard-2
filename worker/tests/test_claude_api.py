"""Llamadas largas a Claude desde el worker (video/claude_api.py): streaming, reintentos, cortes y la clave.

Sin red real: la API de Anthropic es un servidor local que responde por SSE. La clave es falsa y nunca sale del proceso.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from typing import Any

import pytest

from comunes.errors import JobError
from video import claude_api

FAKE_KEY = "sk-ant-api03-PRUEBA-falsa"


def ev(kind: str, data: dict[str, Any]) -> bytes:
    return f"event: {kind}\ndata: {json.dumps({'type': kind, **data})}\n\n".encode()


def sse(text: str, stop: str, *, output: int = 50_000, cut: bool = False) -> bytes:
    start = ev("message_start", {"message": {"id": "m", "model": "claude-opus-5-5", "content": [], "usage": {"input_tokens": 9000, "output_tokens": 1, "cache_read_input_tokens": 17000, "cache_creation_input_tokens": 0}}})
    body = start + ev("content_block_start", {"index": 0, "content_block": {"type": "thinking", "thinking": ""}})
    body += ev("content_block_delta", {"index": 0, "delta": {"type": "thinking_delta", "thinking": "pienso " * 50}})
    body += ev("content_block_start", {"index": 1, "content_block": {"type": "text", "text": ""}})
    half = len(text) // 2
    body += ev("content_block_delta", {"index": 1, "delta": {"type": "text_delta", "text": text[:half]}})
    if cut:
        return body
    body += ev("content_block_delta", {"index": 1, "delta": {"type": "text_delta", "text": text[half:]}})
    body += ev("message_delta", {"delta": {"stop_reason": stop}, "usage": {"output_tokens": output}})
    return body + ev("message_stop", {})


class Api:
    """Servidor local que hace de API: responde lo que diga `script` (uno por pedido) y guarda los pedidos."""

    def __init__(self) -> None:
        self.script: list[tuple[int, bytes, dict[str, str]]] = []
        self.requests: list[dict[str, Any]] = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:  # noqa: D401
                pass

            def do_POST(self) -> None:  # noqa: N802
                n = int(self.headers.get("content-length") or 0)
                api.requests.append({"path": self.path, "headers": dict(self.headers), "body": json.loads(self.rfile.read(n))})
                status, body, headers = api.script.pop(0)
                self.send_response(status)
                self.send_header("content-type", "text/event-stream" if status == 200 else "application/json")
                for k, v in headers.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"


@pytest.fixture()
def api() -> Any:
    a = Api()
    yield a
    a.server.shutdown()


BODY = {"model": "claude-opus-5-5", "max_tokens": 64000, "messages": [{"role": "user", "content": "hola"}]}
CODE = json.dumps({"name": "Pieza", "code": "export default { render(ctx, t, env) {} };"})


def test_respuesta_completa_por_streaming(api: Api) -> None:
    api.script.append((200, sse(CODE, "end_turn"), {}))
    seen: list[float] = []
    out = claude_api.stream_message(api.url, FAKE_KEY, BODY, expected_tokens=40_000, on_progress=seen.append, sleep=lambda s: None)
    res = out["result"]
    assert res["text"] == CODE
    assert res["stop_reason"] == "end_turn"
    assert res["usage"] == {"input_tokens": 9000, "output_tokens": 50_000, "cache_read_input_tokens": 17000, "cache_creation_input_tokens": 0}
    assert res["model"] == "claude-opus-5-5"
    assert seen and seen[-1] == 1.0
    sent = api.requests[0]
    assert sent["path"] == "/v1/messages"
    assert sent["body"]["stream"] is True and sent["body"]["max_tokens"] == 64000
    headers = {k.lower(): v for k, v in sent["headers"].items()}
    assert headers["x-api-key"] == FAKE_KEY
    assert headers["anthropic-version"] == claude_api.API_VERSION


def test_cortada_por_el_tope_se_devuelve_con_su_consumo(api: Api) -> None:
    api.script.append((200, sse('{"name": "Pie', "max_tokens", output=64000), {}))
    res = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=lambda s: None)["result"]
    assert res["stop_reason"] == "max_tokens"
    assert res["usage"]["output_tokens"] == 64000


def test_saturada_se_reintenta_antes_de_generar(api: Api) -> None:
    api.script += [(529, b'{"error":{"message":"Overloaded"}}', {"retry-after": "1"}), (429, b"{}", {}), (200, sse(CODE, "end_turn"), {})]
    waits: list[float] = []
    out = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=waits.append)
    assert out["result"]["text"] == CODE
    assert len(api.requests) == 3 and len(waits) == 2


def test_error_que_no_se_reintenta(api: Api) -> None:
    api.script.append((400, b'{"error":{"message":"grammar is too large"}}', {}))
    out = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=lambda s: None)
    assert out["error"] == {"source": "api", "status": 400, "message": "grammar is too large"}
    assert len(api.requests) == 1


def test_cortada_a_la_mitad_devuelve_lo_generado(api: Api) -> None:
    api.script.append((200, sse("x" * 32_000, "end_turn", cut=True), {}))
    out = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=lambda s: None)
    err = out["error"]
    assert err["source"] == "network"
    # Sin el evento final se estima lo generado por las letras que llegaron (razonamiento + texto).
    assert err["usage"]["input_tokens"] == 9000
    assert err["usage"]["output_tokens"] >= int(16_000 / claude_api.CHARS_PER_TOKEN)


def test_error_en_medio_del_streaming(api: Api) -> None:
    body = sse(CODE, "end_turn", cut=True) + ev("error", {"error": {"type": "overloaded_error", "message": "Overloaded"}})
    api.script.append((200, body, {}))
    err = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=lambda s: None)["error"]
    assert err["status"] == 529 and err["source"] == "api"


def test_solo_https_o_localhost() -> None:
    assert claude_api.base_allowed("https://api.anthropic.com")
    assert claude_api.base_allowed("http://127.0.0.1:9999")
    assert not claude_api.base_allowed("http://api.anthropic.com")
    assert not claude_api.base_allowed("https://usuario:clave@api.anthropic.com")
    out = claude_api.stream_message("http://ejemplo.com", FAKE_KEY, BODY)
    assert out["error"]["source"] == "app"


class FakeApp:
    def __init__(self, reply: dict[str, Any] | Exception) -> None:
        self.reply = reply
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def ai_call(self, pid: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((pid, payload))
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def test_run_call_pide_la_llamada_a_la_app_y_devuelve_el_resultado(api: Api, caplog: pytest.LogCaptureFixture) -> None:
    api.script.append((200, sse(CODE, "end_turn"), {}))
    app = FakeApp({"apiKey": FAKE_KEY, "baseUrl": api.url, "body": BODY, "expected": 40_000, "timeoutS": 60})
    ctx = SimpleNamespace(app=app, progress=lambda f: None)
    with caplog.at_level("INFO"):
        done = claude_api.run_call(ctx, "p1", {"taskId": "t1", "call": "kabc123"}, {"workId": "w1"})
    assert app.calls == [("p1", {"taskId": "t1", "call": "kabc123", "workId": "w1"})]
    assert done["taskId"] == "t1" and done["call"] == "kabc123"
    assert done["result"]["text"] == CODE
    # La clave nunca va en lo que vuelve a la app ni en el log.
    assert FAKE_KEY not in json.dumps(done)
    assert FAKE_KEY not in caplog.text


def test_run_call_sin_llamada_de_la_app_avisa_y_sigue() -> None:
    app = FakeApp(JobError("Llegaste al tope de créditos de IA de este mes.", retry=False))
    done = claude_api.run_call(SimpleNamespace(app=app, progress=lambda f: None), "p1", {"taskId": "t1", "call": "kabc123"}, {})
    assert done["error"] == {"source": "app", "message": "Llegaste al tope de créditos de IA de este mes."}
    with pytest.raises(JobError):
        claude_api.run_call(SimpleNamespace(app=FakeApp(JobError("La app no respondió.", retry=True)), progress=lambda f: None), "p1", {"taskId": "t1", "call": "k1234"}, {})


def test_el_director_hace_la_llamada_larga_y_devuelve_el_resultado(monkeypatch: pytest.MonkeyPatch) -> None:
    from video import director

    sent: list[dict[str, Any]] = []

    class App:
        def director(self, pid: str, payload: dict[str, Any]) -> dict[str, Any]:
            sent.append(payload)
            if payload["step"] == "compos":
                return {"next": {"step": "compos-ai", "taskId": "t1", "call": "kabc123", "label": "Programando la animación 1 de 1"}}
            return {"next": None, "status": "AWAITING_REVIEW"}

    monkeypatch.setattr(claude_api, "run_call", lambda ctx, pid, nxt, extra: {"taskId": nxt["taskId"], "call": nxt["call"], "result": {"stop_reason": "end_turn", "text": CODE, "usage": {}}})
    stages: list[str] = []
    ctx = SimpleNamespace(app=App(), check=lambda: None, stage=lambda name, a, b: stages.append(name))
    res = director.run(ctx, {"id": "p1"}, "compos", 0.0, 1.0, extra={"workId": "w1"})
    assert res["next"] is None
    assert sent[1]["step"] == "compos-ai-done" and sent[1]["workId"] == "w1"
    assert sent[1]["remote"]["result"]["text"] == CODE
    assert stages == ["Programando la animación 1 de 1"]


def test_cancelar_corta_la_respuesta_y_devuelve_lo_cobrado() -> None:
    """Si la persona cancela el pedido mientras la IA escribe, se corta la conexión (no se sigue pagando) y vuelve
    lo que se alcanzó a generar."""
    import time

    class Slow(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:  # noqa: D401
            pass

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("content-length") or 0))
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            start = ev("message_start", {"message": {"id": "m", "model": "claude-opus-5-5", "content": [], "usage": {"input_tokens": 9000, "output_tokens": 1}}})
            self.wfile.write(start + ev("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}}))
            try:
                for _ in range(60):  # ~18 s si nadie corta
                    self.wfile.write(ev("content_block_delta", {"index": 0, "delta": {"type": "text_delta", "text": "x" * 40}}))
                    self.wfile.flush()
                    time.sleep(0.3)
                self.wfile.write(ev("message_delta", {"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 999}}) + ev("message_stop", {}))
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    asked = []
    try:
        t0 = time.monotonic()
        out = claude_api.stream_message(f"http://127.0.0.1:{server.server_address[1]}", FAKE_KEY, BODY, sleep=lambda s: None, should_stop=lambda: asked.append(1) or True)
        took = time.monotonic() - t0
    finally:
        server.shutdown()
    assert asked, "se preguntó si seguía en pie"
    assert took < 8, f"cortó enseguida ({took:.1f} s)"
    err = out["error"]
    assert err["source"] == "canceled"
    assert err["usage"]["input_tokens"] == 9000, "vuelve lo que se cobró hasta el corte"


def test_sin_cancelar_termina_normal(api: Api) -> None:
    api.script.append((200, sse(CODE, "end_turn"), {}))
    out = claude_api.stream_message(api.url, FAKE_KEY, BODY, sleep=lambda s: None, should_stop=lambda: False)
    assert out["result"]["stop_reason"] == "end_turn"
