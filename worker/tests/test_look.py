"""«Mira este video» (VIDEO_LOOK): mide la referencia, sube las hojas a su carpeta y avisa a la app; si no se pudo bajar,
avisa con un mensaje claro. Nunca deja la carpeta de trabajo."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from PIL import Image

from comunes.errors import JobError
from video import look, reference

PID = "11111111-2222-3333-4444-555555555555"
LID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class FakeConn:
    def __init__(self, status: str = "queued") -> None:
        self.status = status
        self.sql: list[str] = []

    def execute(self, sql: str, args: tuple = ()) -> Any:
        self.sql.append(sql)
        status = self.status
        return SimpleNamespace(fetchone=lambda: {"status": status, "source": {"kind": "link", "url": "https://www.instagram.com/reel/x/"}})


def make_ctx(tmp_path: Path, conn: FakeConn) -> Any:
    sent: dict[str, Any] = {}
    uploads: list[str] = []
    app = SimpleNamespace(upload=lambda pid, key, path, ct: uploads.append(key), look_result=lambda pid, payload: sent.update(payload))
    ctx = SimpleNamespace(
        input={"projectId": PID, "lookId": LID},
        conn=conn,
        app=app,
        config=SimpleNamespace(models_dir=tmp_path, fonts_dir=None, test_style_transcript=None),
        workdir=lambda pid: tmp_path / pid,
        stage=lambda *a: None,
        progress=lambda f: None,
        check=lambda: None,
    )
    return ctx, sent, uploads


def test_mide_sube_hojas_y_avisa(tmp_path, monkeypatch):
    sheet = tmp_path / "hoja.jpg"
    Image.new("RGB", (40, 30)).save(sheet)
    monkeypatch.setattr(reference, "fetch", lambda ctx, pid, src, dest: dest / "ref.mp4")
    monkeypatch.setattr(reference, "analyze", lambda *a, **k: ({"metrics": {"duration": 9}, "moments": [{"t": 0.1, "frame": 1, "cut": False, "face": True, "text": "", "said": ""}], "transcript": "hola"}, [(sheet, [1])]))
    ctx, sent, uploads = make_ctx(tmp_path, FakeConn())
    out = look.look(ctx)
    assert out["ok"] is True
    assert uploads == [f"editor/{PID}/mirar/{LID}/hoja-01.jpg"]
    assert sent["ok"] is True and sent["lookId"] == LID and sent["sheets"][0]["frames"] == [1]
    assert not (tmp_path / PID / f"mirar-{LID}").exists()


def test_link_que_no_baja_avisa_claro(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise JobError(look.LINK_ERROR, retry=False)

    monkeypatch.setattr(reference, "fetch", boom)
    ctx, sent, _ = make_ctx(tmp_path, FakeConn())
    look.look(ctx)
    assert sent["ok"] is False and "súbelo" in sent["error"]


def test_ya_terminada_no_hace_nada(tmp_path):
    ctx, sent, _ = make_ctx(tmp_path, FakeConn(status="ready"))
    assert look.look(ctx) == {"skipped": "ready"}
    assert sent == {}
