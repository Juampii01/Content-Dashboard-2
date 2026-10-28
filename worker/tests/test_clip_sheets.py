"""Videos dentro de una animación (paso compos-clips): los cuadros a 12 por segundo en hojas de 4×4."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from PIL import Image

from video import compos


class _App:
    def __init__(self, src: Path) -> None:
        self.src = src
        self.uploaded: dict[str, Path] = {}

    def download(self, project_id: Any, key: str, dest: Path, owner: Any = None, **_: Any) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.src.read_bytes())
        return dest

    def upload(self, pid: str, key: str, path: Path, content_type: str) -> None:
        keep = path.with_name("subida-" + path.name)
        keep.write_bytes(path.read_bytes())
        self.uploaded[key] = keep


class _Ctx:
    def __init__(self, app: _App) -> None:
        self.app = app

    def check(self) -> None:
        return None


def test_hojas_de_cuadros(tmp_path: Path) -> None:
    src = tmp_path / "web.mp4"
    # 2 s de un video de 904×744 que pasa de rojo a azul: 24 cuadros → 2 hojas (16 + 8).
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=904x744:rate=30:duration=1", "-f", "lavfi", "-i", "color=c=blue:size=904x744:rate=30:duration=1", "-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)],
        check=True,
    )
    app = _App(src)
    clip_id = "aaaaaaaa-1111-4222-8333-444444444444"
    out = compos.clip_sheets(_Ctx(app), "p1", [{"ref": "v1", "clipId": clip_id, "key": f"editor/biblioteca/{clip_id}/clip.mp4"}], tmp_path / "w")
    assert len(out) == 1 and "error" not in out[0], out
    r = out[0]
    assert (r["width"], r["height"]) == (904, 744)
    assert r["fps"] == 12 and 23 <= r["frames"] <= 25
    assert r["frameW"] == 640 and r["frameH"] == 526
    assert len(r["sheets"]) == 2
    assert all(s["key"].startswith("editor/p1/compos/clips/v1-") for s in r["sheets"])
    first = Image.open(app.uploaded[r["sheets"][0]["key"]]).convert("RGB")
    assert first.size == (640 * 4, 526 * 4)
    # El primer cuadro es rojo y el último de la primera hoja (cuadro 15, 1,25 s) ya es azul.
    red = first.getpixel((320, 263))
    blue = first.getpixel((3 * 640 + 320, 3 * 526 + 263))
    assert red[0] > 200 and red[2] < 60, red
    assert blue[2] > 200 and blue[0] < 60, blue


def test_clave_ajena_no_se_baja(tmp_path: Path) -> None:
    app = _App(tmp_path / "nada.mp4")
    out = compos.clip_sheets(_Ctx(app), "p1", [{"ref": "v1", "clipId": "aaaaaaaa-1111-4222-8333-444444444444", "key": "editor/otro-proyecto/original.mp4"}], tmp_path / "w")
    assert out[0].get("error")
    assert not app.uploaded
