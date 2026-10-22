"""Gráficos con el motor de motion graphics (Node + skia-canvas, worker/motion): gráficos v1 y escenas v2, formatos
de salida, caché, y respaldo con Pillow cuando el motor no está o falla. Se saltean si falta Node, skia-canvas
(`cd worker/motion && npm ci`) o las fuentes.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from comunes.errors import JobError
from video import graphics, motion

FONTS = Path(__file__).resolve().parent.parent / "fonts"
pytestmark = [
    pytest.mark.skipif(not (FONTS / "Inter-Black.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)"),
    pytest.mark.skipif(not motion.enabled(), reason="falta Node o skia-canvas (cd worker/motion && npm ci)"),
]

THEME = {"bg": "#030a22", "surface": "#0b1d4a", "text": "#ffffff", "muted": "#a7b9d4", "accent": "#4da3ff", "accentText": "#030a22"}
V1 = {"v": 1, "theme": THEME, "font": "inter", "position": "top", "template": "number", "mode": "full", "value": "+40%", "label": "más citas agendadas"}
V2 = {
    "v": 2,
    "duration": 2,
    "format": "9:16",
    "mode": "overlay",
    "position": "bottom",
    "theme": {**THEME, "font": "montserrat"},
    "layers": [{"type": "component", "component": "checklist", "props": {"items": ["Gancho", "Subtítulos", "Llamada a la acción"]}}],
}
SIZE = (540, 960)


def probe(path: Path) -> dict[str, str]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_frames", "-of", "default=nw=1", str(path)], capture_output=True, text=True, check=True).stdout
    return dict(line.split("=", 1) for line in out.strip().splitlines())


def frame(path: Path, t: float, size: tuple[int, int]) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(size[1], size[0], 4)


def test_v1_full_renders_mp4_with_the_engine(tmp_path: Path) -> None:
    out = motion.render_graphic(V1, 1.5, SIZE, tmp_path, FONTS)
    assert out.name.startswith("motion-") and out.suffix == ".mp4"
    info = probe(out)
    assert info["codec_name"] == "h264" and info["width"] == "540" and info["height"] == "960"
    assert int(info["nb_frames"]) == 45
    mid = frame(out, 1.0, SIZE)
    assert mid[..., :3].std() > 10  # hay dibujo, no un cuadro liso


def test_v2_overlay_keeps_transparency(tmp_path: Path) -> None:
    out = motion.render_graphic(V2, 2.0, SIZE, tmp_path, FONTS)
    assert out.suffix == ".mov"
    info = probe(out)
    assert info["codec_name"] == "qtrle" and info["pix_fmt"] == "argb"
    img = frame(out, 1.5, SIZE)
    alpha = img[..., 3]
    assert alpha[: SIZE[1] // 3].mean() < 20, "arriba se ve el video (transparente)"
    assert alpha[int(SIZE[1] * 0.7) :].mean() > 150, "abajo está el velo y el gráfico"


def test_cache_reuses_the_file(tmp_path: Path) -> None:
    a = motion.render_graphic(V1, 1.2, SIZE, tmp_path, FONTS)
    mtime = a.stat().st_mtime_ns
    b = motion.render_graphic(V1, 1.2, SIZE, tmp_path, FONTS)
    assert a == b and b.stat().st_mtime_ns == mtime
    assert motion.cache_name(V1, SIZE, 1.2) != motion.cache_name({**V1, "value": "x2"}, SIZE, 1.2)


def test_flag_off_uses_pillow_for_v1_and_refuses_v2(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOTION_RENDER", "0")
    out = motion.render_graphic(V1, 1.0, SIZE, tmp_path, FONTS)
    assert out.name.startswith("graphic-")
    with pytest.raises(JobError):
        motion.render_graphic(V2, 1.0, SIZE, tmp_path, FONTS)


def test_engine_failure_falls_back_to_pillow_for_v1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_BIN", "/bin/false")
    out = motion.render_graphic(V1, 1.0, SIZE, tmp_path, FONTS)
    assert out.name.startswith("graphic-") and out.exists()
    with pytest.raises(JobError):
        motion.render_graphic(V2, 1.0, SIZE, tmp_path, FONTS)


def test_invalid_graphics_are_readable_errors(tmp_path: Path) -> None:
    for bad in (None, {"v": 2, "mode": "full", "layers": []}, {"v": 1, "template": "nada"}):
        with pytest.raises(JobError):
            motion.render_graphic(bad, 1.0, SIZE, tmp_path, FONTS)
    # Pasa el chequeo de Python pero el motor lo rechaza (componente desconocido).
    with pytest.raises(JobError):
        motion.render_graphic({**V2, "layers": [{"type": "component", "component": "torta"}]}, 1.0, SIZE, tmp_path, FONTS)
    assert graphics.TEMPLATES  # el respaldo sigue disponible
