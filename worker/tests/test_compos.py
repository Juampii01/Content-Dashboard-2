"""Composiciones (animaciones escritas por Claude) en el render: el código corre en el sandbox de compos-engine.mjs y
la lista de dibujo la pinta el motor de efectos. Una composición rota se descarta con aviso y el render sigue."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from video import fx

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
FONTS = HERE.parent / "fonts"

pytestmark = [
    pytest.mark.skipif(not (FONTS / "Anton-Regular.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)"),
    pytest.mark.skipif(not (fx.enabled() and fx.COMPOS_ENGINE.exists()), reason="falta Node, skia-canvas o compos-engine.mjs"),
]


class _Ctx:
    def check(self) -> None:
        return None


def _video(tmp: Path) -> Path:
    out = tmp / "base.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def _specs() -> dict:
    return json.loads((FIXTURES / "compos-specs.json").read_text(encoding="utf-8"))


def _render(tmp: Path, specs: list[dict], warnings: list[str]) -> list[dict]:
    video = _video(tmp)
    items = [{"spec": s, "sourceFrames": []} for s in specs]
    return fx.render_effects(_Ctx(), items, joined=video, mezz=video, src_size=(1080, 1920), total_frames=30, fmt="9:16", offset_x=0.0, workdir=tmp, fonts_dir=FONTS, warnings=warnings)


def test_composition_is_drawn(tmp_path: Path) -> None:
    warnings: list[str] = []
    out = _render(tmp_path, [_specs()["card3d_stat"]], warnings)
    assert not warnings
    assert len(out) == 1 and out[0]["kind"] == "composition"
    cap = cv2.VideoCapture(str(out[0]["path"]))
    assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == 18
    cap.set(cv2.CAP_PROP_POS_FRAMES, 15)
    ok, img = cap.read()
    assert ok
    base = cv2.VideoCapture(str(tmp_path / "base.mp4"))
    base.set(cv2.CAP_PROP_POS_FRAMES, 15)
    _, orig = base.read()
    # La tarjeta cambió una parte grande del cuadro.
    changed = (np.abs(img.astype(int) - orig.astype(int)).sum(axis=2) > 60).mean()
    assert changed > 0.05


def test_broken_compositions_are_skipped_and_the_render_goes_on(tmp_path: Path) -> None:
    warnings: list[str] = []
    s = _specs()
    out = _render(tmp_path, [s["broken"], s["loop"], s["letter_glitch"]], warnings)
    # La que falla a mitad y la del bucle infinito se quitan; la buena se dibuja.
    assert [o["kind"] for o in out] == ["composition"]
    assert len(warnings) == 2 and all("animación" in w for w in warnings)


def test_invalid_composition_spec_is_refused() -> None:
    with pytest.raises(fx.ComposFailed):
        fx.validate({"spec": {"v": 1, "kind": "composition", "duration": 1, "compos": {"code": 3}}})
