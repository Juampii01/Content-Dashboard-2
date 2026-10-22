"""Gráficos del b-roll "a medida": cada plantilla en los dos modos y los dos formatos, sin red ni base.

Verifica que el diseño entra en su zona (sin textos fuera del cuadro ni sobre los subtítulos), que la animación
entra y sale, que el contador termina en la cifra exacta, que el modo "overlay" sale con transparencia y que el
render final lo compone sobre el video sin tapar la cara.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from comunes import ffmpeg
from comunes.errors import JobError
from video import graphics, render

FONTS = Path(__file__).resolve().parent.parent / "fonts"
pytestmark = pytest.mark.skipif(not (FONTS / "Inter-Black.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)")

THEME = {"bg": "#030a22", "surface": "#0b1d4a", "text": "#ffffff", "muted": "#a7b9d4", "accent": "#4da3ff", "accentText": "#030a22"}
BASE = {"v": 1, "theme": THEME, "font": "inter", "position": "top"}
SPECS = {
    "number": {**BASE, "template": "number", "mode": "full", "value": "+40%", "label": "más citas agendadas en un mes"},
    "list": {**BASE, "template": "list", "mode": "full", "title": "Lo que revisa un buen anuncio", "items": ["Un gancho en 3 segundos", "Una oferta clara y concreta", "Una sola llamada a la acción", "Seguimiento el mismo día"]},
    "quote": {**BASE, "template": "quote", "mode": "overlay", "text": "El problema no es el anuncio, es lo que pasa después del clic", "highlight": "después del clic"},
    "keyword": {**BASE, "template": "keyword", "mode": "overlay", "text": "Seguimiento", "label": "La clave", "emphasis": "highlight"},
    "compare": {**BASE, "template": "compare", "mode": "full", "left": {"label": "Mito", "text": "Necesitas más seguidores para vender"}, "right": {"label": "Realidad", "text": "Necesitas un sistema que convierta"}},
    "flow": {**BASE, "template": "flow", "mode": "full", "title": "El sistema", "steps": ["Anuncio", "Llamada de venta", "Cliente"]},
}
SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080)}


@pytest.fixture(scope="module")
def fonts() -> graphics.Fonts:
    return graphics.Fonts(FONTS)


@pytest.mark.parametrize("name", SPECS)
@pytest.mark.parametrize("mode", ["full", "overlay"])
@pytest.mark.parametrize("fmt", SIZES)
def test_layout_fits_its_zone(fonts: graphics.Fonts, name: str, mode: str, fmt: str) -> None:
    w, h = SIZES[fmt]
    for position in ("top", "bottom"):
        scene = graphics.build_scene({**SPECS[name], "mode": mode, "position": position}, w, h, 3.0, fonts)
        box = scene.box
        assert scene.elements
        for e in scene.elements:
            if any(p["type"] == "glow" for p in e.paints):
                continue  # el resplandor puede pasarse de la zona (es luz, no contenido)
            assert e.x >= box["x"] - 2 and e.x + e.w <= box["x"] + box["w"] + 2, (name, mode, fmt, e.x, e.w, box)
            # Todo el contenido queda dentro de su zona (con 2 px de tolerancia por redondeos).
            assert e.y >= box["y"] - 2 and e.y + e.h <= box["y"] + box["h"] + 2, (name, mode, fmt, position, e.y, e.h, box)
        # Las entradas terminan antes de la salida.
        last = max(e.anim["start"] + e.anim["dur"] for e in scene.elements) * scene.time_scale
        assert last <= scene.duration - scene.exit


def test_full_mode_stays_above_captions(fonts: graphics.Fonts) -> None:
    """En 9:16 los subtítulos van desde el 62 % del alto: el gráfico de pantalla completa termina antes."""
    for spec in SPECS.values():
        scene = graphics.build_scene({**spec, "mode": "full"}, 1080, 1920, 4.0, fonts)
        bottom = max(e.y + e.h for e in scene.elements if not any(p["type"] == "glow" for p in e.paints))
        assert bottom <= 1920 * 0.6 + 2


def test_short_tramo_compresses_entries(fonts: graphics.Fonts) -> None:
    scene = graphics.build_scene(SPECS["list"], 1080, 1920, 1.5, fonts)
    assert scene.time_scale < 1
    last = max(e.anim["start"] + e.anim["dur"] for e in scene.elements) * scene.time_scale
    assert last <= 1.5 - scene.exit


def test_counter_counts_and_lands_on_the_exact_value(fonts: graphics.Fonts) -> None:
    for value, final in (("+40%", "40"), ("10K", "10"), ("1.500", "1.500"), ("2,5x", "2,5"), ("3/10", "3")):
        scene = graphics.build_scene({**SPECS["number"], "value": value}, 1080, 1920, 3.0, fonts)
        counter = next(p["counter"] for e in scene.elements for p in e.paints if p["type"] == "counter")
        assert graphics.counter_text(scene, counter, 0) in ("0", "0,0", "0.0")
        assert graphics.counter_text(scene, counter, 2.5) == final
        mid = graphics.counter_text(scene, counter, 0.4)
        assert mid != final or counter["to"] < 5
    assert graphics.split_value("+40%")["prefix"] == "+" and graphics.split_value("+40%")["suffix"] == "%"


def test_highlight_finds_the_phrase() -> None:
    words = "El problema no es el anuncio, es lo que pasa después del clic".split()
    assert graphics.highlight_indexes(words, "después del clic") == {10, 11, 12}
    assert graphics.highlight_indexes(words, "ANUNCIO") == {5}
    assert graphics.highlight_indexes(words, "") == set()


def test_frames_animate_in_and_out(fonts: graphics.Fonts) -> None:
    for name in ("number", "list", "keyword"):
        spec = {**SPECS[name], "mode": "overlay"}
        frames = [np.asarray(graphics.still(spec, t, 3.0, (1080, 1920), FONTS)) for t in (0.0, 1.6, 2.99)]
        alpha = [int((f[..., 3] > 250).sum()) for f in frames]
        # Al principio solo está el velo; a la mitad, el gráfico; al final se fue (vuelve a quedar casi solo el velo).
        assert alpha[1] > alpha[0] * 1.2, (name, alpha)
        assert alpha[2] < alpha[1], (name, alpha)


def test_render_is_fast_deterministic_and_cached(tmp_path: Path) -> None:
    spec = SPECS["quote"]
    a = graphics.cache_name(spec, (1080, 1920), 2.0)
    assert a == graphics.cache_name(dict(reversed(list(spec.items()))), (1080, 1920), 2.0)
    assert a != graphics.cache_name({**spec, "text": "Otra frase"}, (1080, 1920), 2.0)
    assert a.endswith(".mov") and graphics.cache_name(SPECS["number"], (1080, 1920), 2.0).endswith(".mp4")
    import time

    out = tmp_path / a
    t0 = time.time()
    graphics.render_graphic(spec, 2.0, (1080, 1920), out, FONTS)
    assert time.time() - t0 < 20
    mtime = out.stat().st_mtime_ns
    graphics.render_graphic(spec, 2.0, (1080, 1920), out, FONTS)
    assert out.stat().st_mtime_ns == mtime  # la segunda vez sale de la caché


@pytest.mark.parametrize("mode", ["full", "overlay"])
def test_render_output_format(tmp_path: Path, mode: str) -> None:
    spec = {**SPECS["flow"], "mode": mode}
    out = tmp_path / graphics.cache_name(spec, (1920, 1080), 1.8)
    graphics.render_graphic(spec, 1.8, (1920, 1080), out, FONTS)
    info = ffmpeg.probe(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (int(v["width"]), int(v["height"])) == (1920, 1080)
    frames = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout.strip())
    assert frames == 54
    if mode == "overlay":
        assert v["codec_name"] == "qtrle" and v["pix_fmt"] == "argb"
    else:
        assert v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p"


def test_invalid_spec_is_a_readable_error() -> None:
    with pytest.raises(JobError):
        graphics.validate_spec({**SPECS["number"], "template": "video"})
    with pytest.raises(JobError):
        graphics.validate_spec({**SPECS["number"], "theme": {**THEME, "accent": "red"}})


def test_overlay_graphic_composes_over_the_video(tmp_path: Path) -> None:
    """Render final 9:16 con un gráfico "overlay" arriba: se ve el gráfico, pero la cara (centro) sigue a la vista."""
    src = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x808080:s=1080x1920:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=3",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", str(src)],
        check=True,
    )
    spec = {**SPECS["keyword"], "mode": "overlay", "position": "top"}
    gfx = tmp_path / graphics.cache_name(spec, (1080, 1920), 2.0)
    graphics.render_graphic(spec, 2.0, (1080, 1920), gfx, FONTS)
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0, None, FONTS, broll=[{"input": 2, "start": 0.5, "end": 2.5}])
    out = tmp_path / "final.mp4"
    render.final_encode(src, src, graph, 3.0, out, "ultrafast", lambda f: None, extra_inputs=[gfx])

    def frame(t: float) -> np.ndarray:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t}", "-i", str(out), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype=np.uint8).reshape(1920, 1080, 3).astype(np.int32)

    before, during = frame(0.2), frame(1.8)
    # Arriba: el velo oscurece y aparece el acento (azul) del resaltado.
    assert during[60:300].mean() < before[60:300].mean() - 40
    band = during[150:650]
    blue = (band[..., 2] > 200) & (band[..., 0] < 120)
    assert blue.sum() > 3000, int(blue.sum())
    # Centro (la cara): igual que sin gráfico.
    assert abs(during[1000:1150].mean() - before[1000:1150].mean()) < 4
