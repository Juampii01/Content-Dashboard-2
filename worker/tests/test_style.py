"""Análisis de estilo ("Edita como este") con videos sintéticos de los que se sabe todo.

- Referencia completa (scripts/make_style_reference.py): cortes cada 2 s, un zoom suave, un punch-in, tomas
  con y sin cara, subtítulos amarillos abajo en mayúsculas de 3 palabras y música de fondo.
- Subtítulos con caja y una palabra resaltada, arriba y en minúsculas (otro estilo, para no calibrar a uno solo).
- Música, habla y zooms con datos armados a mano.

Necesita ffmpeg, Tesseract, las fuentes (scripts/fetch_fonts.sh) y el modelo YuNet en worker/models
(scripts/fetch_models.py worker/models --only yunet). Sin ellos, las pruebas que los usan se saltan.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from video import style

HERE = Path(__file__).resolve().parent.parent
MODELS = HERE / "models"
FONTS = HERE / "fonts"
sys.path.insert(0, str(HERE / "scripts"))

needs_tools = pytest.mark.skipif(
    not (shutil.which("tesseract") and shutil.which("espeak-ng") and (MODELS / style.YUNET_FILE).exists() and (FONTS / "Montserrat-ExtraBold.ttf").exists()),
    reason="faltan tesseract, espeak-ng, fuentes o el modelo YuNet",
)


@pytest.fixture(scope="module")
def reference(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict, dict]:
    from make_style_reference import build  # noqa: PLC0415

    out = tmp_path_factory.mktemp("ref")
    expected = build(out, 2.0, music=True)
    words = json.loads((out / "referencia.transcript.json").read_text())["words"]
    work = tmp_path_factory.mktemp("work")
    metrics = style.analyze(out / "referencia.mp4", work, models_dir=MODELS, transcribe_fn=lambda ogg, wav: words)
    return out, expected, metrics


@needs_tools
def test_cuts_rhythm(reference) -> None:
    _, expected, m = reference
    assert m["aspect"] == "9:16" and m["analyzedSeconds"] == pytest.approx(16, abs=0.1)
    found = m["cuts"]["times"]
    assert len(found) == len(expected["cuts"])
    for a, b in zip(found, expected["cuts"]):
        assert abs(a - b) <= 0.1
    assert m["cuts"]["avgShot"] == pytest.approx(2.0, abs=0.1)
    assert m["cuts"]["perMinute"] == pytest.approx(7 / (16 / 60), abs=0.5)


@needs_tools
def test_zoom_and_punch_in(reference) -> None:
    _, expected, m = reference
    z = m["zooms"]
    assert z["punchIns"] == expected["punchIns"] and z["smooth"] == expected["smoothZooms"]
    smooth = next(e for e in z["events"] if e["kind"] == "smooth")
    punch = next(e for e in z["events"] if e["kind"] == "punch")
    assert 4.0 <= smooth["t"] <= 4.4 and smooth["scale"] == pytest.approx(1.25, abs=0.05)
    assert punch["t"] == pytest.approx(10.0, abs=0.1) and punch["scale"] == pytest.approx(1.2, abs=0.03)


@needs_tools
def test_broll_from_faces(reference) -> None:
    _, expected, m = reference
    assert m["faces"]["detected"] and m["faces"]["ratio"] == pytest.approx(1 - expected["brollRatio"], abs=0.08)
    assert m["broll"]["reliable"]
    assert m["broll"]["ratio"] == pytest.approx(expected["brollRatio"], abs=0.05)
    assert len(m["broll"]["shots"]) == expected["brollShots"]
    assert m["broll"]["avgDuration"] == pytest.approx(2.0, abs=0.15)


@needs_tools
def test_caption_style_yellow_bottom(reference) -> None:
    _, expected, m = reference
    c, e = m["captions"], expected["caption"]
    assert c["detected"]
    assert c["position"] == pytest.approx(e["position"], abs=0.02)
    assert c["size"] == pytest.approx(e["size"], rel=0.2)
    assert c["uppercase"] is True and c["wordsPerBlock"] == e["wordsPerBlock"]
    assert c["box"] is False and c["outline"] is True and c["highlightColor"] is None
    rgb = [int(c["textColor"][i : i + 2], 16) for i in (1, 3, 5)]
    want = [int(e["color"][i : i + 2], 16) for i in (1, 3, 5)]
    assert max(abs(a - b) for a, b in zip(rgb, want)) <= 30, c["textColor"]


@needs_tools
def test_speech_and_music(reference) -> None:
    _, expected, m = reference
    s = m["speech"]
    assert s["words"] == expected["words"]
    assert 1.5 <= s["wps"] <= 4.0
    assert 1.5 <= s["hookSeconds"] <= 5.0
    assert m["audio"]["music"] is True
    assert m["audio"]["lufs"] is not None


def _caption_frame(path: Path, words: list[str], highlight: int, y: float) -> None:
    """Cuadro 720×1280 con un fondo con textura, el texto blanco en una caja negra y una palabra en amarillo."""
    font = FONTS / "Montserrat-ExtraBold.ttf"
    filters = ["drawbox=x=0:y=ih*(%.2f)-80:w=iw:h=160:color=black@1:t=fill" % y]
    # Se dibuja palabra por palabra para poder pintar una de otro color.
    x = 90
    for i, w in enumerate(words):
        color = "0xFFD400" if i == highlight else "white"
        filters.append(f"drawtext=fontfile={font}:text='{w}':fontsize=46:fontcolor={color}:x={x}:y=h*{y}-th/2")
        x += int(len(w) * 30 + 26)
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:d=1", "-vf", ",".join(filters), "-frames:v", "1", str(path)],
        check=True,
    )


@needs_tools
def test_caption_box_and_highlight_on_top(tmp_path: Path) -> None:
    import cv2  # noqa: PLC0415

    blocks = [["Hoy", "te", "cuento"], ["cómo", "editar", "rápido"], ["sin", "perder", "tiempo"], ["con", "tres", "trucos"], ["que", "nadie", "usa"], ["y", "funcionan", "siempre"]]
    samples = []
    for i, words in enumerate(blocks):
        p = tmp_path / f"f{i}.png"
        _caption_frame(p, words, highlight=i % 3, y=0.2)
        samples.append((cv2.imread(str(p)), style.ocr_words(p, style.tesseract_langs())))
    c = style.caption_style(samples)
    assert c["detected"]
    assert c["position"] == pytest.approx(0.2, abs=0.03)
    assert c["uppercase"] is False
    assert c["box"] is True and c["boxColor"] == "#000000"
    assert c["textColor"].upper() in ("#FFFFFF", "#FEFEFE", "#FDFDFD") or all(int(c["textColor"][i : i + 2], 16) > 225 for i in (1, 3, 5))
    assert c["highlightColor"] is not None
    hr, hg, hb = (int(c["highlightColor"][i : i + 2], 16) for i in (1, 3, 5))
    assert hr > 200 and hg > 170 and hb < 90, c["highlightColor"]


def test_music_detection_on_arrays() -> None:
    rate = 16000
    t = np.arange(rate * 6) / rate
    voice = np.zeros_like(t)
    words = []
    for k in range(6):
        a, b = k + 0.1, k + 0.6
        mask = (t >= a) & (t < b)
        voice[mask] = 0.3 * np.sin(2 * np.pi * 180 * t[mask])
        words.append({"text": "hola", "start": a, "end": b})
    noise = np.random.default_rng(1).normal(0, 0.001, len(t))
    dry = style.music_stats((voice + noise).astype(np.float32), rate, words)
    chord = 0.04 * sum(np.sin(2 * np.pi * f * t) for f in (220, 277, 330)) / 3
    wet = style.music_stats((voice + noise + chord).astype(np.float32), rate, words)
    assert dry["music"] is False
    assert wet["music"] is True and wet["musicDb"] < -10


def test_speech_stats() -> None:
    words = [
        {"text": "Esto", "start": 0.5, "end": 0.8},
        {"text": "es", "start": 0.85, "end": 1.0},
        {"text": "clave.", "start": 1.05, "end": 1.5},
        {"text": "Mira", "start": 2.5, "end": 2.8},
        {"text": "esto", "start": 2.85, "end": 3.1},
    ]
    s = style.speech_stats(words)
    assert s["hookSeconds"] == pytest.approx(1.0)
    assert s["maxPause"] == pytest.approx(1.0)
    assert s["wps"] == pytest.approx(5 / (2.6 - 1.0), rel=0.01)
    assert style.speech_stats(words[:2]) == {"words": 2, "detected": False}


def test_smooth_zoom_events_needs_sustained_motion() -> None:
    step = 0.2
    zoom = [(1.0 + i * step, math.log(1.03), 2) for i in range(6)]
    jitter = [(3.0 + i * step, (-1) ** i * 0.01, 2) for i in range(6)]
    events = style.smooth_zoom_events(zoom + jitter, step)
    assert len(events) == 1 and events[0]["scale"] == pytest.approx(1.03**6, rel=0.01)


def test_cut_stats_and_shots() -> None:
    assert style.merge_close([0.05, 1.0, 1.1, 2.0], 0.25) == [1.0, 2.0]
    stats = style.cut_stats([2.0, 4.0], 6.0)
    assert stats["count"] == 2 and stats["avgShot"] == 2.0 and stats["perMinute"] == 20.0


def test_broll_stats_without_faces_is_not_reliable() -> None:
    out = style.broll_stats([(t / 2, False) for t in range(20)], [(0, 5), (5, 10)], 10)
    assert out["reliable"] is False and out["ratio"] == 0.0
