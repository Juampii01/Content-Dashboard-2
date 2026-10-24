"""Referencia de edición del director (video/reference.py) con un video sintético servido por HTTP local.

- Qué referencia hay que mirar (la del pedido en curso o el link del brief, sin repetir).
- Los instantes que se miran (después de cada corte y en las tomas largas, con tope).
- De punta a punta: se baja el link con yt-dlp desde un servidor local, se mide con "Edita como este", se arman las
  hojas "R#n" con lo que pasa en cada momento (corte, cara, texto, lo que se dice) y se entrega a la app.
- Un link que no se puede bajar: aviso claro para la persona (que lo suba).

Necesita ffmpeg, Tesseract, espeak-ng, las fuentes y el modelo YuNet (como test_style.py); si faltan, se salta.
"""

from __future__ import annotations

import functools
import http.server
import json
import shutil
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from video import reference, style

HERE = Path(__file__).resolve().parent.parent
MODELS = HERE / "models"
FONTS = HERE / "fonts"
sys.path.insert(0, str(HERE / "scripts"))

needs_tools = pytest.mark.skipif(
    not (shutil.which("tesseract") and shutil.which("espeak-ng") and (MODELS / style.YUNET_FILE).exists() and (FONTS / "Montserrat-ExtraBold.ttf").exists()),
    reason="faltan tesseract, espeak-ng, fuentes o el modelo YuNet",
)


def test_pending_reference_from_request_and_brief() -> None:
    pending = {"id": "rabc", "source": {"kind": "link", "url": "https://www.instagram.com/reel/x/"}}
    project = {"director": {"pending": {"instruction": "como este", "reference": pending}, "reference": {"id": "rabc", "status": "pending"}}}
    assert reference.pending_reference(project) == pending
    # Ya medida: no se repite.
    project["director"]["reference"]["status"] = "ready"
    assert reference.pending_reference(project) is None
    # Brief con link: se mide una vez.
    brief = {"brief": {"reference": "https://www.tiktok.com/@a/video/1"}, "director": {}}
    ref = reference.pending_reference(brief)
    assert ref and ref["source"]["url"].startswith("https://www.tiktok.com") and ref["id"].startswith("r")
    brief["director"] = {"reference": {"id": ref["id"], "status": "failed", "source": ref["source"]}}
    assert reference.pending_reference(brief) is None


def test_moment_times() -> None:
    times = reference.moment_times([2.0, 4.0, 10.0], 16.0)
    assert times[0] == pytest.approx(0.35)
    assert 2.35 in times and 4.35 in times and 10.35 in times
    assert any(6 < t < 9 for t in times), "una toma larga se mira también en el medio"
    many = reference.moment_times([i * 0.7 for i in range(1, 100)], 70.0, max_frames=24)
    assert len(many) <= 24
    assert all(b - a >= 0.6 for a, b in zip(many, many[1:]))


@pytest.fixture(scope="module")
def served(tmp_path_factory: pytest.TempPathFactory):
    from make_style_reference import build  # noqa: PLC0415

    out = tmp_path_factory.mktemp("ref")
    expected = build(out, 2.0, music=True)
    words = json.loads((out / "referencia.transcript.json").read_text())["words"]
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/referencia.mp4", expected, words
    server.shutdown()


class FakeApp:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, Path]] = []
        self.calls: list[dict] = []

    def upload(self, pid, key, path, content_type, owner=None):  # noqa: ANN001
        assert Path(path).exists() and content_type == "image/jpeg"
        self.uploads.append((key, Path(path)))

    def director(self, pid, payload):  # noqa: ANN001
        self.calls.append(payload)
        return {"ok": True, "next": None}

    def download(self, *a, **k):  # pragma: no cover - no se usa con links
        raise AssertionError("no debería bajar del almacenamiento")


def fake_ctx(tmp: Path, words: list[dict], extra_hosts: tuple[str, ...]) -> SimpleNamespace:
    stages: list[str] = []
    cfg = SimpleNamespace(models_dir=MODELS, fonts_dir=FONTS, broll_extra_hosts=extra_hosts, test_style_transcript=None)
    ctx = SimpleNamespace(
        app=FakeApp(),
        config=cfg,
        input={"language": "es"},
        stages=stages,
        stage=lambda name, a, b: stages.append(name),
        progress=lambda f: None,
        check=lambda: None,
        workdir=lambda pid: tmp / pid,
    )
    return ctx


@needs_tools
def test_link_end_to_end(served, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    url, expected, words = served
    monkeypatch.setattr(reference.transcribe, "transcribe", lambda *a, **k: ("prueba", words))
    ctx = fake_ctx(tmp_path, words, ("127.0.0.1",))
    project = {"id": "00000000-0000-4000-8000-000000000001", "director": {"pending": {"instruction": "como este video", "reference": {"id": "rtest01", "source": {"kind": "link", "url": url}}}, "reference": {"id": "rtest01", "status": "pending"}}}
    assert reference.ensure(ctx, project, 0.0, 0.3)
    assert ctx.stages[0] == "Bajando la referencia" and "Mirando la referencia" in ctx.stages
    payload = ctx.app.calls[-1]
    assert payload["step"] == "reference" and payload["ok"] is True and payload["id"] == "rtest01"
    m = payload["metrics"]
    assert len(m["cuts"]["times"]) == len(expected["cuts"])
    assert m["captions"]["detected"] and m["captions"]["position"] > 0.6
    moments = payload["moments"]
    assert 8 <= len(moments) <= reference.MAX_FRAMES
    assert sum(1 for x in moments if x["cut"]) >= len(expected["cuts"]) - 1, "un cuadro después de cada corte"
    assert any(x["face"] for x in moments) and any(not x["face"] for x in moments), "tomas con y sin la persona"
    assert any(x["said"] for x in moments), "lo que se dice en cada momento"
    assert payload["transcript"].lower().startswith("hoy te muestro")
    assert payload["sheets"] and all(s["key"].startswith(f"editor/{project['id']}/referencia/hoja-") for s in payload["sheets"])
    assert payload["sheets"][0]["frames"][0] == 1
    # La carpeta de trabajo (con la referencia) no queda.
    assert not (tmp_path / project["id"] / "referencia").exists()


def test_link_that_cannot_be_downloaded(tmp_path: Path) -> None:
    ctx = fake_ctx(tmp_path, [], ())
    project = {"id": "00000000-0000-4000-8000-000000000002", "director": {"pending": {"instruction": "x", "reference": {"id": "rtest02", "source": {"kind": "link", "url": "https://example.com/video.mp4"}}}, "reference": {"id": "rtest02", "status": "pending"}}}
    assert reference.ensure(ctx, project, 0.0, 0.3)
    payload = ctx.app.calls[-1]
    assert payload["ok"] is False
    assert "súbelo" in payload["error"].lower() or "sube" in payload["error"].lower()
