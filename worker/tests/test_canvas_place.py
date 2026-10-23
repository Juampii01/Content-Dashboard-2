"""Lienzo de la revisión en el render: lugar de los subtítulos (ASS), rampas de opacidad separadas de entrada y salida
y gráficos movidos con el motor. Los números salen de la app (`lib/video/canvas`), volcados en el fixture
`canvas-place.json` con:
    node --import tsx scripts/canvas-dump.mts worker/tests/fixtures/canvas-place.json
(tests/canvas-transform.test.mts revisa que esté al día). Así la vista previa y el render no se separan.
"""

import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import ass, broll_edit, motion, render

FIXTURES = Path(__file__).resolve().parent / "fixtures"
FONTS = Path(__file__).resolve().parent.parent / "fonts"
DUMP = json.loads((FIXTURES / "canvas-place.json").read_text(encoding="utf-8"))
CAPTIONS = json.loads((FIXTURES / "caption-styles.json").read_text(encoding="utf-8"))
needs_fonts = pytest.mark.skipif(not (FONTS / "Montserrat-Black.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)")
needs_engine = pytest.mark.skipif(not motion.enabled() or not (FONTS / "Inter-Black.ttf").exists(), reason="falta Node, skia-canvas o las fuentes")


# ─── Subtítulos ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", DUMP["captions"], ids=lambda c: f"{c['format']}-{c['style']}-{c['place']}")
def test_caption_anchor_is_the_apps(case: dict) -> None:
    cx, cy, em, max_w = ass.caption_anchor(case["look"], case["place"], case["width"], case["height"])
    a = case["anchor"]
    assert cx == pytest.approx(a["cx"], abs=1e-6)
    assert cy == pytest.approx(a["cy"], abs=1e-6)
    assert em == pytest.approx(a["em"], abs=1e-6)
    assert max_w == pytest.approx(a["maxW"], abs=1e-6)


def _positions(text: str) -> list[tuple[float, float]]:
    return [(float(x), float(y)) for x, y in re.findall(r"\\pos\(([\d.-]+),([\d.-]+)\)", text)]


def _sizes(text: str) -> list[float]:
    return [float(v) for v in re.findall(r"\\fs([\d.]+)", text)]


@needs_fonts
@pytest.mark.parametrize("style", ["hormozi", "caja", "karaoke"])
def test_placed_block_moves_and_grows_in_the_ass(style: str) -> None:
    cap = json.loads(json.dumps(CAPTIONS["styles"][style]))
    cap["blocks"] = cap["blocks"][:1]
    base, _ = ass.build_look_ass(cap, 1080, 1920, FONTS)
    moved = json.loads(json.dumps(cap))
    moved["blocks"][0]["place"] = {"x": 0.1, "y": -0.25, "scale": 1}
    text, _ = ass.build_look_ass(moved, 1080, 1920, FONTS)
    for (x0, y0), (x1, y1) in zip(_positions(base), _positions(text)):
        assert x1 - x0 == pytest.approx(108, abs=0.11)
        assert y1 - y0 == pytest.approx(-480, abs=0.11)
    grown = json.loads(json.dumps(cap))
    grown["blocks"][0]["place"] = {"x": 0, "y": 0, "scale": 1.3}
    big, _ = ass.build_look_ass(grown, 1080, 1920, FONTS)
    for a, b in zip(_sizes(base), _sizes(big)):
        assert b / a == pytest.approx(1.3, rel=0.01)
    # Sin `place`, el ASS es exactamente el de siempre.
    again, _ = ass.build_look_ass(json.loads(json.dumps(cap)), 1080, 1920, FONTS)
    assert again == base


# ─── Rampas de opacidad ────────────────────────────────────────────────────


@pytest.mark.parametrize("case", DUMP["fades"], ids=lambda c: f"{c['anim']['in']}-{c['anim']['out']}-{c['duration']}")
def test_fades_and_ramp_are_the_apps(case: dict) -> None:
    fi, fo = broll_edit.fades_of(case["edit"], case["duration"])
    assert fi == pytest.approx(case["fadeIn"], abs=1e-9)
    assert fo == pytest.approx(case["fadeOut"], abs=1e-9)
    for s in case["samples"]:
        assert broll_edit.ramp_alpha(fi, fo, s["t"], case["duration"]) == pytest.approx(s["alpha"], abs=1e-9)


def test_old_edit_keeps_the_symmetric_fade() -> None:
    assert broll_edit.fades_of({"fade": 0.2}, 3) == (0.2, 0.2)
    assert broll_edit.fades_of(None, 3) == (0.2, 0.2)
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0, None, Path("."), broll=[{"input": 1, "start": 1, "end": 3, "edit": {"fade": 0.2, "box": {"x": 0, "y": 0}}}])
    assert "fade=t=in:st=0:d=0.200:alpha=1,fade=t=out:st=1.800:d=0.200:alpha=1" in graph


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _gray(path: Path, t: float, size: tuple[int, int]) -> float:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return float(np.frombuffer(raw, dtype=np.uint8).reshape(size[1], size[0]).astype(np.float64).mean())


def test_separate_ramps_in_the_real_render(tmp_path: Path) -> None:
    """Capa blanca sobre negro con entrada de 0,6 s y salida de 0,3 s: el gris de cada cuadro sigue la rampa de la app."""
    size = (180, 320)
    base = tmp_path / "negro.mp4"
    layer = tmp_path / "blanco.mov"
    _ffmpeg("-f", "lavfi", "-i", f"color=c=black:s={size[0]}x{size[1]}:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "1", str(base))
    _ffmpeg("-f", "lavfi", "-i", f"color=c=white:s={size[0]}x{size[1]}:r=30:d=2", "-c:v", "qtrle", "-pix_fmt", "argb", str(layer))
    case = next(c for c in DUMP["fades"] if c["anim"] == {"in": "pop", "out": "aparecer", "inDur": 1.2, "outDur": 2} and c["duration"] == 2)
    edit = {**case["edit"], "box": {"x": 0, "y": 0, "w": size[0], "h": size[1]}}
    graph, _, _ = render.framing_graph(size[0], size[1], "9:16", 0, None, Path("."), broll=[{"input": 1, "start": 0.5, "end": 2.5, "edit": edit}])
    # El grafo arma el cuadro de 1080×1920: aquí se reemplaza la escala por la del lienzo chico de la prueba.
    graph = graph.replace("scale=1080:1920", f"scale={size[0]}:{size[1]}").replace("crop=1080:1920", f"crop={size[0]}:{size[1]}")
    out = tmp_path / "salida.mp4"
    _ffmpeg("-i", str(base), "-i", str(layer), "-filter_complex", graph, "-map", "[v]", "-t", "3", "-c:v", "libx264", "-crf", "1", "-pix_fmt", "yuv420p", str(out))
    fi, fo = broll_edit.fades_of(edit, 2)
    assert fi == pytest.approx(case["fadeIn"]) and fo == pytest.approx(case["fadeOut"])
    def ramp(t: float) -> float:
        return broll_edit.ramp_alpha(fi, fo, t - 0.5, 2) if 0.5 <= t < 2.5 else 0.0

    for frame_i in (18, 21, 24, 30, 45, 66, 70, 73):
        t = frame_i / 30
        got = _gray(out, t + 0.001, size) / 255
        # Gris de 0 a 1 (el negro y el blanco del video, ya en rango completo). ffmpeg toma la rampa en el cuadro o en
        # el vecino (medio cuadro de redondeo de tiempos): se acepta entre los dos, con un margen de compresión.
        lo, hi = sorted((ramp(t - 1 / 30), ramp(t + 1 / 30)))
        assert lo - 0.03 <= got <= hi + 0.03, (frame_i, got, ramp(t))


# ─── Gráfico movido con el motor del worker ────────────────────────────────

THEME = {"bg": "#030a22", "surface": "#0b1d4a", "text": "#ffffff", "muted": "#a7b9d4", "accent": "#4da3ff", "accentText": "#030a22"}
V1 = {"v": 1, "theme": THEME, "font": "inter", "position": "top", "template": "number", "mode": "overlay", "value": "+40%", "label": "más citas"}


def _alpha_frame(path: Path, t: float, size: tuple[int, int]) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(size[1], size[0], 4)


def _center(rgba: np.ndarray) -> tuple[float, float, int]:
    # Lo dibujado sin el velo: píxeles claros y opacos (el texto y la tarjeta).
    lum = rgba[..., :3].max(axis=2)
    ys, xs = np.nonzero((lum > 150) & (rgba[..., 3] > 200))
    return float(xs.mean()), float(ys.mean()), int(xs.size)


@needs_engine
def test_moved_graphic_is_drawn_moved_by_the_worker_engine(tmp_path: Path) -> None:
    size = (540, 960)
    plain = motion.render_graphic(V1, 2.0, size, tmp_path, FONTS)
    moved_spec = {**V1, "place": {"transform": {"x": 0.08, "y": 0.25, "scale": 1}}}
    moved = motion.render_graphic(moved_spec, 2.0, size, tmp_path, FONTS)
    assert moved != plain, "el lugar cambia la caché"
    ax, ay, an = _center(_alpha_frame(plain, 1.2, size))
    bx, by, bn = _center(_alpha_frame(moved, 1.2, size))
    assert an > 500 and bn > 500
    assert bx - ax == pytest.approx(0.08 * size[0], abs=3)
    assert by - ay == pytest.approx(0.25 * size[1], abs=3)
