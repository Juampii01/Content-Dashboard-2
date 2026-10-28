"""B-roll de stock: las redirecciones se revisan igual que la URL (nada de ir a la red interna ni a otro host)."""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from comunes.appclient import AppClient
from comunes.errors import JobError


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        port = self.server.server_address[1]
        if self.path == "/ok":
            body = b"clip"
            self.send_response(200)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        targets = {"/interna": "http://169.254.169.254/latest", "/otro": "https://ejemplo.com/clip.mp4", "/misma": f"http://127.0.0.1:{port}/ok"}
        self.send_response(302)
        self.send_header("location", targets[self.path])
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        pass


@pytest.fixture()
def server():
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def test_redireccion_a_la_red_interna(server: str, tmp_path: Path) -> None:
    with pytest.raises(JobError, match="169.254.169.254") as err:
        AppClient("http://x", "s").download_url(f"{server}/interna", tmp_path / "a.mp4", ("127.0.0.1",))
    assert "no permitida" in err.value.user_message
    assert not (tmp_path / "a.mp4").exists()


def test_redireccion_a_otro_host(server: str, tmp_path: Path) -> None:
    with pytest.raises(JobError, match="ejemplo.com") as err:
        AppClient("http://x", "s").download_url(f"{server}/otro", tmp_path / "b.mp4", ("127.0.0.1",))
    assert not err.value.retry


def test_redireccion_dentro_del_host_permitido(server: str, tmp_path: Path) -> None:
    out = AppClient("http://x", "s").download_url(f"{server}/misma", tmp_path / "c.mp4", ("127.0.0.1",))
    assert out.read_bytes() == b"clip"
