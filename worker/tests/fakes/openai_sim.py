"""Simulador local de la API de imágenes de OpenAI (la red de pruebas no llega a OpenAI).

    python tests/fakes/openai_sim.py 8790      # servidor en http://127.0.0.1:8790/v1

- POST /v1/images/generations y /v1/images/edits → {"data": [{"b64_json": …}]} con un PNG hecho con Pillow.
- GET /v1/models → lista corta (la usa la app para validar la key).
- La key "sk-invalida" responde 401; "sk-sin-saldo", 429 insufficient_quota.
Guarda el último pedido (sin la key) en `last_request` para que los tests lo revisen.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

last_request: dict[str, Any] = {}


def _png(seed: str, w: int = 1088, h: int = 1360) -> bytes:
    from PIL import Image, ImageDraw

    n = sum(seed.encode()) % 255
    im = Image.new("RGB", (w, h), (n, 120, 255 - n))
    ImageDraw.Draw(im).ellipse([w // 4, h // 4, 3 * w // 4, 3 * h // 4], fill=(255 - n, n, 90))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:  # silencio
        pass

    def _send(self, code: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self) -> str | None:
        key = (self.headers.get("authorization") or "").removeprefix("Bearer ").strip()
        if not key or key.startswith("sk-invalida"):
            self._send(401, {"error": {"message": "Incorrect API key provided", "type": "invalid_request_error", "code": "invalid_api_key"}})
            return None
        if key.startswith("sk-sin-saldo"):
            self._send(429, {"error": {"message": "You exceeded your current quota", "type": "insufficient_quota", "code": "insufficient_quota"}})
            return None
        return key

    def do_GET(self) -> None:  # noqa: N802
        if not self._auth():
            return
        if self.path.rstrip("/").endswith("/models"):
            self._send(200, {"object": "list", "data": [{"id": "gpt-image-2.5-flare", "object": "model"}, {"id": "gpt-image-2", "object": "model"}]})
        else:
            self._send(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        if not self._auth():
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        last_request.clear()
        last_request.update({"path": self.path, "model": body.get("model"), "size": body.get("size"), "quality": body.get("quality"), "images": len(body.get("images") or []), "prompt": str(body.get("prompt", ""))[:300]})
        if not self.path.endswith(("/images/generations", "/images/edits")):
            self._send(404, {"error": {"message": "not found"}})
            return
        w, h = (int(v) for v in str(body.get("size") or "1088x1360").split("x"))
        self._send(200, {"created": 0, "data": [{"b64_json": base64.b64encode(_png(str(body.get("prompt")), w, h)).decode()}], "output_format": "png"})


def serve(port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/v1"


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8790), Handler)
    print(f"simulador de OpenAI en http://127.0.0.1:{srv.server_address[1]}/v1", flush=True)
    srv.serve_forever()
