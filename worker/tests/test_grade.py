"""Color del video principal (lib/video/grade.ts → `grade` del render): la matriz de la app se escribe como LUT 3D y va
en el grafo antes del zoom y del b-roll. Se prueba con ffmpeg real sobre un cuadro de color conocido."""

import subprocess
from pathlib import Path

import numpy as np

from video import broll_edit, render


def _frame(graph: str, src: Path, tmp: Path) -> np.ndarray:
    out = tmp / "f.rgb"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[v]", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", str(out)],
        check=True,
    )
    return np.frombuffer(out.read_bytes(), dtype=np.uint8).reshape(1920, 1080, 3)


def _source(tmp: Path) -> Path:
    src = tmp / "src.mp4"
    # Gris medio con un poco de rojo: así se ve si sube el contraste, la saturación o la temperatura.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x907060:size=1080x1920:rate=30:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(src)],
        check=True,
    )
    return src


def test_sin_color_no_hay_lut(tmp_path: Path) -> None:
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path)
    assert "lut3d" not in graph


def test_la_lut_va_antes_del_zoom_y_cambia_el_color(tmp_path: Path) -> None:
    src = _source(tmp_path)
    # Más rojo, menos azul (una temperatura cálida exagerada) y un poco más de brillo.
    warm = [1.25, 0, 0, 0.02, 0, 1.0, 0, 0.02, 0, 0, 0.7, 0.02]
    lut = broll_edit.write_cube(warm, tmp_path / "grade.cube")
    zooms = [{"start": 0.0, "end": 1.0, "scale": 1.1, "ramp": 0.1}]
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path, zooms=zooms, grade_lut=lut)
    assert "lut3d=file=" in graph
    assert graph.index("lut3d") < graph.index("zoompan"), "el color va antes del zoom"
    plain, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path, zooms=zooms)
    a = _frame(plain, src, tmp_path).reshape(-1, 3).mean(axis=0)
    b = _frame(graph, src, tmp_path).reshape(-1, 3).mean(axis=0)
    assert b[0] > a[0] + 15, f"más rojo: {a} → {b}"
    assert b[2] < a[2] - 15, f"menos azul: {a} → {b}"


def test_matriz_identidad_no_cambia_nada(tmp_path: Path) -> None:
    src = _source(tmp_path)
    lut = broll_edit.write_cube([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], tmp_path / "id.cube")
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path, grade_lut=lut)
    plain, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path)
    diff = np.abs(_frame(graph, src, tmp_path).astype(int) - _frame(plain, src, tmp_path).astype(int)).mean()
    # El paso YUV → RGB → YUV de lut3d redondea (~2 de 255, invisible). Sin ajustes la app manda null y no hay LUT.
    assert diff < 3, f"la identidad casi no cambia el cuadro (diferencia media {diff:.2f})"


def test_la_curva_de_sombras_aclara_lo_oscuro_y_deja_el_blanco(tmp_path: Path) -> None:
    """Luces y sombras (`gradeCurve`): la curva va después de la matriz, dentro de la misma LUT."""
    # Curva de 17 puntos que sube los tonos bajos (como «Sombras +1» de la app) y deja 0 y 1 en su lugar.
    curve = [i / 16 + 0.14 * (i / 16) * (1 - i / 16) ** 2 * 27 / 4 for i in range(17)]
    assert broll_edit.apply_curve(curve, 0.0) == 0.0
    assert abs(broll_edit.apply_curve(curve, 1.0) - 1.0) < 1e-9
    assert broll_edit.apply_curve(curve, 0.3) > 0.3 + 0.1
    # Entre dos puntos interpola en línea recta (igual que feComponentTransfer type="table").
    x = 5.5 / 16
    assert abs(broll_edit.apply_curve(curve, x) - (curve[5] + curve[6]) / 2) < 1e-9

    src = tmp_path / "dark.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:size=1080x1920:rate=30:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(src)],
        check=True,
    )
    lut = broll_edit.write_cube([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], tmp_path / "curve.cube", curve=curve)
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path, grade_lut=lut)
    plain, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, tmp_path)
    a = _frame(plain, src, tmp_path).mean()
    b = _frame(graph, src, tmp_path).mean()
    assert b > a + 15, f"las sombras se aclaran: {a:.1f} → {b:.1f}"
