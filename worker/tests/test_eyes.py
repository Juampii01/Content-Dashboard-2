"""Ojos del director de edición (video/eyes.py): muestreo, medidas por cuadro, tramos y hojas de contacto.

Las medidas se prueban con imágenes armadas a mano (nitidez, luz, texto) y el análisis completo con un video corto
generado con ffmpeg: una escena nítida con un rótulo, una borrosa y otra escena distinta.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import eyes

cv2 = pytest.importorskip("cv2")
FONTS = Path(__file__).resolve().parent.parent / "fonts"


def test_muestreo_parejo_con_inicios_de_escena_y_tope():
    picks = eyes.sample_times(60.0, [10.0, 30.5], max_frames=40)
    times = [t for t, _ in picks]
    assert len(picks) <= 40
    assert any(s and abs(t - 10.35) < 0.01 for t, s in picks), "toma un cuadro al empezar cada escena"
    assert all(b - a >= eyes.MIN_GAP - 1e-6 for a, b in zip(times, times[1:]))
    assert times == sorted(times)
    # Un video corto: un cuadro por segundo.
    assert 8 <= len(eyes.sample_times(10.0, [])) <= 11
    # Uno largo respeta el tope (y los inicios de escena siguen).
    long = eyes.sample_times(1200.0, [float(s) for s in range(30, 1200, 30)], max_frames=120)
    assert len(long) <= 120
    assert sum(1 for _, s in long if s) >= 30


def test_mira_a_camara_con_los_puntos_de_la_cara():
    # ojo derecho, ojo izquierdo, nariz, boca derecha, boca izquierda
    frente = [40, 50, 80, 50, 60, 75, 45, 95, 75, 95]
    girado = [40, 50, 80, 50, 79, 75, 45, 95, 75, 95]
    assert eyes.frontal_from_landmarks(frente)[0] is True
    ok, yaw = eyes.frontal_from_landmarks(girado)
    assert ok is False and yaw > 0.5


def test_nitidez_y_luz():
    rng = np.random.default_rng(1)
    sharp = (rng.random((400, 300)) * 255).astype(np.uint8)
    blurry = cv2.GaussianBlur(sharp, (0, 0), 8)
    assert eyes.sharpness(sharp) > 10 * eyes.sharpness(blurry)
    # Contraluz: la cara oscura sobre un fondo claro.
    img = np.full((400, 300), 230, np.uint8)
    img[100:200, 100:200] = 30
    expo = eyes.exposure(img, (100 / 300, 100 / 400, 100 / 300, 100 / 400))
    assert expo["backlit"] is True
    assert eyes.exposure(np.full((400, 300), 120, np.uint8), (0.3, 0.3, 0.3, 0.3))["backlit"] is False


def test_movimiento_de_camara():
    rng = np.random.default_rng(2)
    a = cv2.GaussianBlur((rng.random((72, 128)) * 255).astype(np.uint8), (0, 0), 2)
    b = np.roll(a, 6, axis=1)
    assert eyes.camera_shift(a, a) < 0.005
    assert eyes.camera_shift(a, b) > 0.03


def _sample(i, t, face=True, sharp=500.0, text=""):
    return {
        "i": i, "t": t, "scene": False, "face": {"x": 0.3, "y": 0.2, "w": 0.4, "h": 0.3, "score": 0.9, "frontal": True, "yaw": 0.0} if face else None,
        "faces": 1 if face else 0, "sharp": sharp, "luma": 0.4, "clipped": 0.0, "crushed": 0.0, "backlit": False, "shift": 0.0,
        "text": text, "textBand": [0.7, 0.8] if text else None, "energy": -20.0,
    }


def test_tramos_se_cortan_donde_cambia_lo_que_se_ve():
    samples = [_sample(1, 0.5), _sample(2, 1.5), _sample(3, 2.5, face=False, text="PANEL"), _sample(4, 3.5, face=False, text="PANEL"), _sample(5, 4.5, sharp=3.0), _sample(6, 5.5)]
    tramos = eyes.build_tramos(samples, [], 6.0)
    assert [t["faceRatio"] for t in tramos[:2]] == [1.0, 0.0]
    panel = tramos[1]
    assert panel["text"] == "PANEL" and panel["textBand"] == [0.7, 0.8]
    assert any(t["blurry"] for t in tramos), "la muestra borrosa queda en su propio tramo"
    assert not tramos[0]["blurry"]
    assert all(t["end"] - t["start"] <= eyes.TRAMO_MAX + 1e-6 for t in tramos)


def test_hojas_de_contacto(tmp_path):
    layout = eyes.layout_for(1080, 1920)
    assert (layout.cols, layout.rows) == (6, 3)
    assert max(layout.size) < 2000
    assert eyes.layout_for(1920, 1080).cols == 4
    frame = np.zeros((768, 432, 3), np.uint8)
    tiles = [(i + 1, i * 1.5, eyes.fit_tile(frame, layout)) for i in range(20)]
    sheets = eyes.save_sheets(tiles, layout, tmp_path, FONTS)
    assert len(sheets) == 2
    assert sheets[0][1] == list(range(1, 19)) and sheets[1][1] == [19, 20]
    from PIL import Image

    with Image.open(sheets[0][0]) as img:
        assert img.size == layout.size


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="sin Tesseract")
def test_lee_un_rotulo_sobre_una_foto(tmp_path):
    # Una "foto": degradado con formas (una cara, un objeto) y el rótulo amarillo abajo.
    yy = np.linspace(0, 1, 768, dtype=np.float32)[:, None, None]
    img = (np.array([90, 50, 20], np.float32) * (1 - yy) + np.array([160, 120, 80], np.float32) * yy).repeat(432, axis=1).astype(np.uint8)
    cv2.circle(img, (216, 260), 110, (140, 170, 220), -1)
    cv2.rectangle(img, (60, 400), (180, 520), (40, 40, 160), -1)
    cv2.rectangle(img, (40, 560), (392, 620), (0, 200, 255), -1)
    cv2.putText(img, "COMENTA PANEL", (60, 603), cv2.FONT_HERSHEY_DUPLEX, 1.0, (20, 20, 20), 2, cv2.LINE_AA)
    text, band = eyes.read_text(img, tmp_path / "ocr.png", "eng")
    assert "PANEL" in text.upper()
    assert band and 0.68 < band[0] < 0.75


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="sin ffmpeg")
def test_analisis_de_un_video_corto(tmp_path):
    """3 s nítidos con un rótulo, 2 s borrosos y 3 s de otra escena: escenas, tramos y hojas."""
    video = tmp_path / "v.mp4"
    src = "testsrc2=size=432x768:rate=30"
    graph = (
        "[0:v]trim=0:3,setpts=PTS-STARTPTS[a];"
        "[0:v]trim=3:5,setpts=PTS-STARTPTS,gblur=sigma=30[b];"
        "[1:v]trim=0:3,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1[v]"
    )
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{src}:duration=5", "-f", "lavfi", "-i", "smptebars=size=432x768:rate=30:duration=3",
         "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", str(video)],
        check=True,
    )
    result = eyes.analyze(video, 432, 768, 8.0, tmp_path / "ojos", models_dir=tmp_path, fonts_dir=FONTS)
    data = result.eyes
    assert data["version"] == 1
    assert 6 <= data["stats"]["frames"] <= 12
    assert any(abs(s - 5.0) < 0.3 for s in data["scenes"]), data["scenes"]
    assert any(t["blurry"] for t in data["tramos"]), "detecta el tramo borroso"
    assert result.sheets and result.sheets[0][0].exists()
    assert "Sin detector de caras" in " ".join(data["notes"])
