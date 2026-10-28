"""Llamadas largas a Claude por la API de Anthropic (piezas largas de «Animar todo» y animaciones que se cortaron).

La IA vive en la app: ella arma el pedido (las mismas reglas, la tarea y las imágenes que usaría dentro), decide el
tope de salida (lo que pide la pieza y nunca más de lo que alcanza a pagar el tope del video), revisa los créditos del
mes y lee y registra la respuesta (api_usage). El worker solo hace la llamada, porque con hasta 128 mil tokens de salida
tarda más que los 13 minutos de una función de la app.

1. Pide la llamada a la app (`/api/worker/projects/<id>/ia`): la clave de API del cliente (o la del servidor), la
   dirección de la API y el cuerpo del pedido. Nunca la suscripción de Claude: los términos de Anthropic no permiten
   usar los planes Pro o Max desde un producto.
2. La hace por streaming (SSE) con `urllib`: sin dependencias nuevas, con reintentos solo antes de que empiece a
   generar (429, 529 y 5xx; esos no se cobran), cancelable y con progreso real (tokens que van llegando).
3. Devuelve el texto, el consumo y el motivo de fin, o el error con lo que alcanzó a generar (se cobra igual).

La clave viaja solo en la cabecera `x-api-key`; no se guarda, no se loguea y no va en ningún error.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from comunes.errors import Cancelled, JobError
from comunes.ffmpeg import stop_event

log = logging.getLogger("worker.claude_api")

API_VERSION = "2023-06-01"
# Reintentos antes de que la respuesta empiece (la API no cobra un pedido que rechazó por saturación).
RETRY_STATUS = (408, 429, 500, 502, 503, 504, 529)
MAX_TRIES = 4
# Lo más que se espera entre dos pedazos de la respuesta (el razonamiento puede tardar en mandar el primero).
READ_TIMEOUT_S = 300
# Letras por token (como lib/ai/pricing.ts) para estimar lo generado si la respuesta se corta antes del final.
CHARS_PER_TOKEN = 3.2
LOCAL_HOSTS = ("localhost", "127.0.0.1")


def base_allowed(base_url: str) -> bool:
    """Solo https (o http a localhost, para el simulador de las pruebas)."""
    parts = urllib.parse.urlsplit(base_url)
    host = (parts.hostname or "").lower()
    if parts.username or parts.password:
        return False
    return parts.scheme == "https" or (parts.scheme == "http" and host in LOCAL_HOSTS)


class _Stream:
    """Lo que va llegando: texto, razonamiento (solo para el progreso), consumo y motivo de fin."""

    def __init__(self) -> None:
        self.text: list[str] = []
        self.thinking_chars = 0
        self.usage: dict[str, int] = {}
        self.stop_reason: str | None = None
        self.model: str | None = None
        self.error: dict[str, Any] | None = None
        self.started = False

    def chars(self) -> int:
        return sum(len(t) for t in self.text) + self.thinking_chars

    def estimated_output(self) -> int:
        return max(int(self.usage.get("output_tokens") or 0), int(self.chars() / CHARS_PER_TOKEN))

    def on_event(self, event: str, data: dict[str, Any]) -> None:
        kind = data.get("type") or event
        if kind == "message_start":
            msg = data.get("message") or {}
            self.model = msg.get("model")
            self.usage.update({k: int(v) for k, v in (msg.get("usage") or {}).items() if isinstance(v, int)})
        elif kind == "content_block_delta":
            delta = data.get("delta") or {}
            if delta.get("type") == "text_delta":
                self.text.append(str(delta.get("text") or ""))
            elif delta.get("type") == "thinking_delta":
                self.thinking_chars += len(str(delta.get("thinking") or ""))
        elif kind == "message_delta":
            self.stop_reason = (data.get("delta") or {}).get("stop_reason") or self.stop_reason
            self.usage.update({k: int(v) for k, v in (data.get("usage") or {}).items() if isinstance(v, int)})
        elif kind == "error":
            err = data.get("error") or {}
            self.error = {"type": err.get("type"), "message": str(err.get("message") or "")[:500]}

    def usage_out(self) -> dict[str, int]:
        keys = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        out = {k: int(self.usage.get(k) or 0) for k in keys}
        out["output_tokens"] = self.estimated_output() if not self.stop_reason else out["output_tokens"]
        return out


class Stopped(Exception):
    """La persona canceló el pedido mientras la IA escribía: se corta la respuesta para no seguir pagando tokens."""


def _read_sse(res: Any, stream: _Stream, deadline: float, on_tick: Callable[[], None], should_stop: Callable[[], bool] | None = None) -> None:
    event = ""
    data: list[str] = []
    last_tick = 0.0
    while True:
        if stop_event.is_set():
            raise Cancelled()
        if time.monotonic() > deadline:
            raise TimeoutError("la llamada pasó su tiempo máximo")
        raw = res.readline()
        if not raw:
            return
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if line.startswith(":"):
            continue
        if line == "":
            if data:
                try:
                    stream.on_event(event, json.loads("\n".join(data)))
                except json.JSONDecodeError:
                    log.warning("evento de la API que no se pudo leer (%s)", event)
                if stream.error:
                    return
            event, data = "", []
            if time.monotonic() - last_tick > 2:
                on_tick()
                last_tick = time.monotonic()
                if should_stop is not None and should_stop():
                    raise Stopped()
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())


def stream_message(
    base_url: str,
    api_key: str,
    body: dict[str, Any],
    *,
    timeout_s: float = 3600,
    expected_tokens: int = 0,
    on_progress: Callable[[float], None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Hace la llamada por streaming. Devuelve {"result": {...}} o {"error": {...}} (nunca con la clave).

    `should_stop` se consulta cada ~2 s mientras llega la respuesta (quien llama lo espacia más si consulta la base):
    si devuelve True, se corta la conexión y vuelve un error "canceled" con lo que se alcanzó a generar (se cobra)."""
    if not base_allowed(base_url):
        return {"error": {"source": "app", "message": "La dirección de la API de Anthropic no es válida."}}
    url = f"{base_url.rstrip('/')}/v1/messages"
    payload = json.dumps({**body, "stream": True}).encode()
    headers = {"x-api-key": api_key, "anthropic-version": API_VERSION, "content-type": "application/json", "accept": "text/event-stream"}
    deadline = time.monotonic() + timeout_s
    stream = _Stream()

    def tick() -> None:
        if on_progress and expected_tokens > 0:
            on_progress(min(0.97, stream.estimated_output() / expected_tokens))

    for attempt in range(MAX_TRIES):
        if stop_event.is_set():
            raise Cancelled()
        req = urllib.request.Request(url, data=payload, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=READ_TIMEOUT_S) as res:
                stream.started = True
                _read_sse(res, stream, deadline, tick, should_stop)
            break
        except Stopped:
            log.info("pedido cancelado: se cortó la respuesta de la IA")
            return {"error": {"source": "canceled", "message": "Cancelaste esta animación.", "usage": stream.usage_out()}}
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                info = json.loads(exc.read() or b"{}")
            except (json.JSONDecodeError, OSError):
                info = {}
            message = str(((info.get("error") or {}).get("message")) or exc.reason or "")[:500]
            if status in RETRY_STATUS and attempt < MAX_TRIES - 1:
                wait = _retry_after(exc, attempt)
                log.warning("la API respondió %s; reintento en %.0f s", status, wait)
                sleep(wait)
                continue
            return {"error": {"source": "api", "status": status, "message": message}}
        except Cancelled:
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if stream.started:
                # Se cortó a la mitad: lo generado se cobra; la app lo registra y decide.
                log.warning("la respuesta de la API se cortó: %s", exc.__class__.__name__)
                return {"error": {"source": "network", "message": "La respuesta de la IA se cortó a la mitad.", "usage": stream.usage_out()}}
            if attempt < MAX_TRIES - 1:
                sleep(min(30.0, 3.0 * (attempt + 1)))
                continue
            return {"error": {"source": "network", "message": f"No pudimos conectar con la API de Anthropic ({exc.__class__.__name__})."}}
    if not stream.error and not stream.stop_reason:
        # La conexión terminó sin el evento final: la respuesta llegó cortada (lo generado se cobra igual).
        return {"error": {"source": "network", "message": "La respuesta de la IA se cortó a la mitad.", "usage": stream.usage_out()}}
    if stream.error:
        kind = stream.error.get("type") or ""
        status = 529 if kind == "overloaded_error" else 500
        return {"error": {"source": "api", "status": status, "message": stream.error.get("message") or kind, "usage": stream.usage_out()}}
    if on_progress:
        on_progress(1.0)
    return {"result": {"stop_reason": stream.stop_reason, "text": "".join(stream.text), "usage": stream.usage_out(), **({"model": stream.model} if stream.model else {})}}


def _retry_after(exc: urllib.error.HTTPError, attempt: int) -> float:
    try:
        value = float(exc.headers.get("retry-after") or 0)
    except (TypeError, ValueError):
        value = 0.0
    return max(2.0, min(60.0, value or 5.0 * (2**attempt)))


def run_call(ctx: Any, pid: str, nxt: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    """Un paso "compos-ai" del taller: pide la llamada a la app, la hace y devuelve lo que hay que mandarle de vuelta."""
    task_id = str(nxt.get("taskId") or "")
    call = str(nxt.get("call") or "")
    out: dict[str, Any] = {"taskId": task_id, "call": call}
    try:
        req = ctx.app.ai_call(pid, {"taskId": task_id, "call": call, **({"workId": extra["workId"]} if extra.get("workId") else {})})
    except JobError as exc:
        if exc.retry:
            raise
        # La app no da la llamada (créditos del mes, sin clave, ya no se espera): se le avisa y sigue.
        return {**out, "error": {"source": "app", "message": exc.user_message[:600]}}
    api_key = str(req.get("apiKey") or "")
    body = req.get("body")
    if not api_key or not isinstance(body, dict):
        return {**out, "error": {"source": "app", "message": "No pudimos preparar la llamada a la IA."}}
    started = time.monotonic()
    work_id = str(extra.get("workId") or "")
    checked = {"at": 0.0, "stop": False}

    def should_stop() -> bool:
        # ¿La persona canceló el pedido? Se mira la base cada 10 s como mucho (la llamada puede durar 10–15 min).
        if not work_id or checked["stop"]:
            return checked["stop"]
        now = time.monotonic()
        if now - checked["at"] < 10:
            return False
        checked["at"] = now
        try:
            from comunes import db  # noqa: PLC0415

            from .compos import DBLOCK  # noqa: PLC0415

            with DBLOCK:
                checked["stop"] = db.compos_request_status(ctx.conn, work_id) not in (None, "queued", "running")
        except Exception:  # noqa: BLE001 — si la base no responde, se sigue (mejor terminar que cortar de más)
            log.warning("no se pudo consultar si el pedido %s sigue en pie", work_id)
        return checked["stop"]

    done = stream_message(
        str(req.get("baseUrl") or "https://api.anthropic.com"),
        api_key,
        body,
        timeout_s=float(req.get("timeoutS") or 3600),
        expected_tokens=int(req.get("expected") or 0),
        on_progress=ctx.progress,
        should_stop=should_stop,
    )
    res = done.get("result") or {}
    log.info(
        "llamada larga %s: %s, %s tokens de salida, %.0f s",
        task_id,
        res.get("stop_reason") or (done.get("error") or {}).get("source"),
        (res.get("usage") or {}).get("output_tokens"),
        time.monotonic() - started,
    )
    return {**out, **done}
