"""Biblioteca (VIDEO_CLIP): el clip queda listo con su miniatura, después se arman las hojas de cuadros con su segundo y
se le entregan a la app para la ficha. Si las hojas o la app fallan, el clip sigue listo y la ficha queda para
reintentar. Las imágenes de la biblioteca se usan como b-roll fijo en el render."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from PIL import Image

from comunes.errors import JobError
from video import eyes, library, pipeline

CID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def test_cuadros_en_el_arranque_cada_escena_y_parejos():
    times = library.sheet_times(12.0, [4.0, 8.5], 18)
    assert times[0] == pytest.approx(0.15)
    assert 4.3 in times and 8.8 in times
    assert all(b - a >= library.MIN_GAP - 1e-9 for a, b in zip(times, times[1:]))
    assert times[-1] < 12.0 and len(times) <= 18


def test_un_clip_largo_no_pasa_del_tope():
    times = library.sheet_times(300.0, [float(s) for s in range(1, 300, 2)], 36)
    assert len(times) <= 36
    assert times == sorted(times) and times[-1] > 250


class FakeConn:
    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row
        self.sql: list[tuple[str, tuple]] = []

    def execute(self, sql: str, args: tuple = ()) -> Any:
        self.sql.append((sql, args))
        row = self.row
        return SimpleNamespace(fetchone=lambda: row)


def make_ctx(tmp_path: Path, row: dict[str, Any], *, fail_app: bool = False, ficha_only: bool = False):
    sent: dict[str, Any] = {}
    uploads: list[str] = []

    def library_ficha(clip_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if fail_app:
            raise JobError("La app no respondió.", detail="500")
        sent.update(payload)
        return {"ok": True}

    def download(pid, key, dest, progress=None, owner=None):
        dest.write_bytes(b"x")
        return dest

    app = SimpleNamespace(upload=lambda pid, key, path, ct, owner=None: uploads.append(key), library_ficha=library_ficha, download=download)
    conn = FakeConn(row)
    ctx = SimpleNamespace(
        input={"clipId": CID, **({"fichaOnly": True} if ficha_only else {})},
        conn=conn,
        app=app,
        config=SimpleNamespace(work_dir=tmp_path, fonts_dir=None),
        stage=lambda *a: None,
        progress=lambda f: None,
        check=lambda: None,
    )
    return ctx, conn, sent, uploads


def fake_media(monkeypatch, tmp_path: Path, sheets_ok: bool = True):
    monkeypatch.setattr(library, "probe_clip", lambda src: {"duration": 9.0, "width": 1080, "height": 1920})
    monkeypatch.setattr(library.ffmpeg, "run", lambda args, **k: Path(args[-1]).write_bytes(b"jpg"))
    sheet = tmp_path / "hoja.jpg"
    Image.new("RGB", (1296, 1218)).save(sheet)

    def sheets(src, workdir, meta, fonts):
        if not sheets_ok:
            raise RuntimeError("sin cuadros")
        return [{"path": sheet, "frames": [1, 2, 3], "times": [0.15, 3.0, 6.0]}]

    monkeypatch.setattr(library, "make_sheets", sheets)


def test_queda_listo_y_entrega_las_hojas(tmp_path, monkeypatch):
    fake_media(monkeypatch, tmp_path)
    ctx, conn, sent, uploads = make_ctx(tmp_path, {"status": "PROCESSING", "kind": "video", "file_key": f"editor/biblioteca/{CID}/clip.mp4", "ficha_status": "pending"})
    out = library.prepare_clip(ctx)
    assert out == {"duration": 9.0, "sheets": 1}
    assert uploads == [f"editor/biblioteca/{CID}/miniatura.jpg", f"editor/biblioteca/{CID}/hoja-01.jpg"]
    ready = [s for s, _ in conn.sql if "status = 'READY'" in s]
    assert ready, "el clip queda listo antes de la ficha"
    assert sent["ok"] is True
    assert sent["sheets"][0] == {"key": f"editor/biblioteca/{CID}/hoja-01.jpg", "width": 1296, "height": 1218, "frames": [1, 2, 3], "times": [0.15, 3.0, 6.0]}
    assert not (tmp_path / "biblioteca" / CID).exists()


def test_si_no_hay_cuadros_avisa_y_el_clip_sigue_listo(tmp_path, monkeypatch):
    fake_media(monkeypatch, tmp_path, sheets_ok=False)
    ctx, conn, sent, _ = make_ctx(tmp_path, {"status": "PROCESSING", "kind": "video", "file_key": f"editor/biblioteca/{CID}/clip.mp4", "ficha_status": "pending"})
    library.prepare_clip(ctx)
    assert sent["ok"] is False and "Reintenta" in sent["error"]
    assert any("status = 'READY'" in s for s, _ in conn.sql)


def test_si_la_app_no_responde_la_ficha_queda_para_reintentar(tmp_path, monkeypatch):
    fake_media(monkeypatch, tmp_path)
    ctx, conn, _, _ = make_ctx(tmp_path, {"status": "PROCESSING", "kind": "video", "file_key": f"editor/biblioteca/{CID}/clip.mp4", "ficha_status": "pending"}, fail_app=True)
    library.prepare_clip(ctx)
    assert any("ficha_status = 'failed'" in s for s, _ in conn.sql)


def test_solo_ficha_no_toca_la_miniatura(tmp_path, monkeypatch):
    fake_media(monkeypatch, tmp_path)
    ctx, conn, sent, uploads = make_ctx(tmp_path, {"status": "READY", "kind": "video", "file_key": f"editor/biblioteca/{CID}/clip.mp4", "ficha_status": "pending"}, ficha_only=True)
    library.prepare_clip(ctx)
    assert uploads == [f"editor/biblioteca/{CID}/hoja-01.jpg"]
    assert not any("status = 'READY'" in s for s, _ in conn.sql)
    assert sent["ok"] is True


def test_solo_ficha_de_un_clip_que_ya_tiene_ficha_no_hace_nada(tmp_path):
    ctx, _, sent, _ = make_ctx(tmp_path, {"status": "READY", "kind": "video", "file_key": "x", "ficha_status": "ready"}, ficha_only=True)
    assert library.prepare_clip(ctx) == {"skipped": "ready"}
    assert sent == {}


def test_hojas_reales_con_su_segundo(tmp_path):
    """Con un video de verdad (ffmpeg): una hoja con los cuadros y el segundo de cada uno."""
    video = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=6", "-pix_fmt", "yuv420p", str(video)], check=True)
    sheets = library.make_sheets(video, tmp_path, {"duration": 6.0, "width": 360, "height": 640}, None)
    assert len(sheets) == 1
    s = sheets[0]
    assert s["path"].exists() and len(s["frames"]) == len(s["times"]) >= 6
    assert s["times"] == sorted(s["times"]) and s["times"][-1] < 6.0
    with Image.open(s["path"]) as img:
        assert img.size == eyes.layout_for(360, 640).size


def test_una_imagen_de_la_biblioteca_es_un_clip_quieto(tmp_path):
    img = tmp_path / "foto.webp"
    Image.fromarray(np.full((400, 300, 3), 200, dtype=np.uint8)).save(img, "WEBP")
    out = pipeline.image_clip(img, tmp_path / "foto.mp4", 2.0)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True)
    assert float(probe.stdout.strip()) >= 2.0
