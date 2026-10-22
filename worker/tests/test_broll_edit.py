"""Edición del b-roll en el render: encuadre, look (LUT 3D), tarjeta con alfa, pantalla dividida, a un lado,
opacidad y zoom de entrada. Con ffmpeg real sobre clips sintéticos (sin red ni base).

Los números de las cajas y la matriz de color salen de la app (`lib/video/broll-edit.ts`); aquí se usan los mismos
que prueban los tests de TypeScript, para que la vista previa y el render no se separen.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import broll_edit, render

W, H = 1080, 1920


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def color_clip(path: Path, color: str, size: str = "1280x720", seconds: float = 3) -> Path:
    ffmpeg("-f", "lavfi", "-i", f"color=c={color}:s={size}:r=30:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path))
    return path


def bands_clip(path: Path, size: str = "1920x1080", seconds: float = 3) -> Path:
    """Clip horizontal con tres franjas verticales: roja (izquierda), verde (centro) y azul (derecha)."""
    w, h = (int(v) for v in size.split("x"))
    third = w // 3
    ffmpeg(
        "-f", "lavfi", "-i", f"color=c=red:s={size}:r=30:d={seconds}",
        "-vf", f"drawbox=x={third}:y=0:w={third}:h={h}:color=lime:t=fill,drawbox=x={third * 2}:y=0:w={w - third * 2}:h={h}:color=blue:t=fill",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path),
    )
    return path


def base_video(path: Path, seconds: float = 4, size: str = f"{W}x{H}") -> Path:
    """La "persona": un degradado vertical (la altura se lee en el color) para comprobar qué parte se muestra."""
    ffmpeg("-f", "lavfi", "-i", f"gradients=s={size}:c0=black:c1=white:x0=0:y0=0:x1=0:y1={size.split('x')[1]}:r=30:d={seconds}:speed=0.00001", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10", str(path))
    return path


def frame(path: Path, t: float, size: tuple[int, int] = (W, H), pix: str = "rgb24", channels: int = 3) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pix, "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(size[1], size[0], channels).astype(np.int32)


def compose(base: Path, layers: list[tuple[Path, dict]], out: Path, fmt: str = "9:16", seconds: float = 4) -> Path:
    """Grafo del video final solo con b-roll (sin subtítulos), como lo arma el worker."""
    w, h = render.OUTPUT_SIZE[fmt]
    graph, _, _ = render.framing_graph(w, h, fmt, 0, None, Path("."), broll=[{"input": 1 + i, **spec} for i, (_, spec) in enumerate(layers)])
    graph = graph.replace("[0:v]", "[0:v]", 1)
    inputs = [arg for p, _ in layers for arg in ("-i", str(p))]
    ffmpeg("-i", str(base), *inputs, "-filter_complex", graph, "-map", "[v]", "-t", f"{seconds}", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", str(out))
    return out


@pytest.fixture(scope="module")
def work(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("broll-edit")


def test_frame_crop_matches_the_app() -> None:
    # Clip 1920×1080 en un marco vertical a pantalla completa: escala 1920/1080·(1920/1080) y recorte al centro.
    assert broll_edit.frame_crop(1920, 1080, 1080, 1920, None) == (3414, 1920, 1167, 0)
    # Corrido a la izquierda del todo y con zoom 1,5 corrido abajo.
    assert broll_edit.frame_crop(1920, 1080, 1080, 1920, {"x": -1, "y": 0, "zoom": 1})[2] == 0
    sw, sh, cx, cy = broll_edit.frame_crop(1920, 1080, 1080, 960, {"x": 0.5, "y": 1, "zoom": 1.5})
    assert (sw, sh) == (2560, 1440) and cx == round((2560 - 1080) / 2 * 1.5) and cy == 1440 - 960


def test_cube_is_the_affine_matrix(work: Path) -> None:
    m = [0.2126, 0.7152, 0.0722, 0, 0.2126, 0.7152, 0.0722, 0, 0.2126, 0.7152, 0.0722, 0]
    cube = broll_edit.write_cube(m, work / "bw.cube", size=3)
    rows = [tuple(float(v) for v in line.split()) for line in cube.read_text().splitlines() if line and line[0].isdigit()]
    assert len(rows) == 27
    assert rows[0] == (0, 0, 0) and rows[-1] == pytest.approx((1, 1, 1), abs=1e-5)
    assert rows[2] == pytest.approx((0.2126,) * 3, abs=1e-5)  # (r=1, g=0, b=0): rojo cambia más rápido


def test_card_layer_has_round_corners_shadow_and_size(work: Path) -> None:
    clip = color_clip(work / "white.mp4", "white")
    card = {"radius": 36, "shadowY": 18, "shadowBlur": 48, "shadowAlpha": 0.5, "border": 2, "borderAlpha": 0.22}
    edit = {"layout": "card", "box": {"x": 422, "y": 154, "w": 594, "h": 334}, "card": card, "frame": {"x": 0, "y": 0, "zoom": 1}}
    out = render.prepare_broll(clip, work / "card.mp4", 1.0, (W, H), 0, edit)
    assert out.suffix == ".mkv"
    pad = broll_edit.card_pad(card)
    lw, lh = 594 + pad * 2, 334 + pad * 2
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt,nb_read_frames", "-count_frames", "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout.strip()
    assert probe.split(",")[:3] == [str(lw), str(lh), "yuva420p"] and int(probe.split(",")[3]) == 30
    rgba = frame(out, 0.2, (lw, lh), "rgba", 4)
    assert rgba[pad + 167, pad + 297, 3] == 255  # centro: el clip opaco
    assert rgba[pad + 1, pad + 1, 3] < 40  # esquina redondeada: transparente
    assert rgba[2, 2, 3] == 0  # fuera de la sombra
    below = rgba[pad + 334 + 12, pad + 297]
    assert 30 < below[3] < 200 and below[0] < 20  # sombra negra translúcida debajo


def test_split_layout_moves_the_person_and_keeps_the_clip_on_top(work: Path) -> None:
    base = base_video(work / "persona.mp4")
    clip = bands_clip(work / "bands.mp4")
    edit = {
        "layout": "split",
        "box": {"x": 0, "y": 0, "w": 1080, "h": 960},
        "person": {"from": {"x": 0, "y": 326, "w": 1080, "h": 960}, "to": {"x": 0, "y": 960, "w": 1080, "h": 960}},
        "ground": "#030a22",
        "frame": {"x": -1, "y": 0, "zoom": 1},
        "fade": 0.2,
        "opacity": 1,
    }
    ready = render.prepare_broll(clip, work / "split.mp4", 2.0, (W, H), 0, edit)
    out = compose(base, [(ready, {"start": 1.0, "end": 3.0, "edit": edit})], work / "split-final.mp4")
    before, during = frame(out, 0.5), frame(out, 2.0)
    # Arriba, el clip corrido a la izquierda: se ve la franja roja (y no la verde del centro).
    top = during[100:860, 60:520].mean(axis=(0, 1))  # el tercio rojo mide 1920/3·0,889 = 569 px
    assert top[0] > 200 and top[1] < 60, top
    # Abajo, la persona: lo que antes estaba en y=326..1286 ahora está en y=960..1920.
    assert np.abs(during[960 + 200, 540] - before[326 + 200, 540]).max() <= 6
    assert np.abs(during[960 + 900, 540] - before[326 + 900, 540]).max() <= 6
    # Fuera del tramo, todo como antes.
    assert np.abs(frame(out, 3.5)[1500, 540] - frame(out, 0.5)[1500, 540]).max() <= 6


def test_side_layout_16x9_and_translucent_clip_over_brand_ground(work: Path) -> None:
    base = base_video(work / "persona-h.mp4", size="1920x1080")
    clip = color_clip(work / "white-v.mp4", "white", size="720x1280")
    edit = {
        "layout": "side",
        "box": {"x": 1152, "y": 0, "w": 768, "h": 1080},
        "person": {"from": {"x": 384, "y": 0, "w": 1152, "h": 1080}, "to": {"x": 0, "y": 0, "w": 1152, "h": 1080}},
        "ground": "#000000",
        "opacity": 0.5,
        "fade": 0,
        "frame": {"x": 0, "y": 0, "zoom": 1},
    }
    ready = render.prepare_broll(clip, work / "side.mp4", 2.0, (1920, 1080), 0, edit)
    out = compose(base, [(ready, {"start": 0.5, "end": 3.0, "edit": edit})], work / "side-final.mp4", fmt="16:9")
    f = frame(out, 1.5, (1920, 1080))
    # Clip blanco al 50 % sobre el fondo negro de la marca: gris medio (no se ve la persona debajo).
    assert 110 < f[540, 1500].mean() < 145, f[540, 1500]
    # La persona a la izquierda: el mismo degradado (depende solo de la altura).
    assert np.abs(f[300, 400] - frame(out, 0.2, (1920, 1080))[300, 400]).max() <= 6


def test_look_lut_matches_the_matrix(work: Path) -> None:
    clip = color_clip(work / "orange.mp4", "0xC86432")  # (200, 100, 50)
    accent_duotone = [0.08921, 0.3001, 0.0303, 0, 0.12839, 0.43192, 0.0436, 0.07059, 0.17592, 0.59179, 0.05974, 0.15686]
    edit = {"layout": "full", "box": {"x": 0, "y": 0, "w": W, "h": H}, "frame": {"x": 0, "y": 0, "zoom": 1}, "color": accent_duotone}
    ready = render.prepare_broll(clip, work / "duo.mp4", 1.0, (W, H), 0, edit)
    got = frame(ready, 0.5)[900:1000, 500:600].mean(axis=(0, 1))
    expected = np.array(broll_edit.apply_matrix(accent_duotone, (200 / 255, 100 / 255, 50 / 255))) * 255
    assert np.abs(got - expected).max() <= 8, (got, expected)


def test_zoom_entrance_scales_the_content(work: Path) -> None:
    clip = bands_clip(work / "bands2.mp4", size="1080x1920")
    edit = {"layout": "full", "box": {"x": 0, "y": 0, "w": W, "h": H}, "frame": {"x": 0, "y": 0, "zoom": 1}, "zoom": {"from": 1.15, "seconds": 0.5}}
    ready = render.prepare_broll(clip, work / "zoom.mp4", 1.5, (W, H), 0, edit)

    def green_width(t: float) -> int:
        row = frame(ready, t)[960]
        return int(((row[:, 1] > 180) & (row[:, 0] < 80)).sum())

    first, settled = green_width(0), green_width(1.0)
    assert settled == pytest.approx(360, abs=6)
    assert first / settled == pytest.approx(1.15, abs=0.03)


def test_graph_without_edit_is_the_old_one() -> None:
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0, None, Path("."), broll=[{"input": 2, "start": 1.0, "end": 3.0}])
    assert "fade=t=in:st=0:d=0.200:alpha=1" in graph and "overlay=x=0:y=0:eof_action=pass" in graph
    assert "split" not in graph and "lutyuv" not in graph
    cut, _, _ = render.framing_graph(1080, 1920, "9:16", 0, None, Path("."), broll=[{"input": 2, "start": 1.0, "end": 3.0, "edit": {"fade": 0, "opacity": 0.6}}])
    assert "fade=" not in cut and "lutyuv=a='val*0.600'" in cut
