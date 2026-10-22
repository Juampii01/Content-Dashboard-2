"""Galería de subtítulos animados: el ASS que arma el worker a partir de las pistas de la app.

El fixture `caption-styles.json` sale de `scripts/caption-dump.mts` (lo mismo que la app manda al worker):
    node --import tsx scripts/caption-dump.mts worker/tests/fixtures/caption-styles.json 9:16 '#0070F8'
"""

import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import ass, render
from video.pipeline import EMOJI_DIR

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "caption-styles.json"
FONTS = Path(__file__).resolve().parent.parent / "fonts"
DUMP = json.loads(FIXTURE.read_text(encoding="utf-8"))
STYLES = list(DUMP["styles"].keys())
needs_fonts = pytest.mark.skipif(not (FONTS / "Montserrat-Black.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)")


def dialogues(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.startswith("Dialogue:")]


def test_all_gallery_styles_are_in_the_fixture() -> None:
    assert STYLES == ["caja", "hormozi", "karaoke", "palabra", "minimal", "resaltador"]
    for cap in DUMP["styles"].values():
        assert ass.is_look(cap)
    # Un plan viejo (sin `look`) sigue por el camino de antes.
    assert not ass.is_look({"preset": "clasico", "blocks": [{"start": 0, "end": 1, "words": []}]})
    assert not ass.is_look({"preset": "caja", "look": {"style": "hormozi"}, "blocks": [{}]})


@needs_fonts
@pytest.mark.parametrize("style", STYLES)
def test_ass_per_style(style: str) -> None:
    cap = DUMP["styles"][style]
    text, stickers = ass.build_look_ass(cap, 1080, 1920, FONTS)
    assert "PlayResX: 1080" in text and "PlayResY: 1920" in text
    events = dialogues(text)
    words = sum(len(b["words"]) for b in cap["blocks"])
    # Una línea por palabra como mínimo (más la sombra, la caja y el resaltador cuando corresponden).
    assert len(events) >= words
    # Todo va con posición absoluta y anclado al centro (o a la izquierda, el resaltador que crece).
    assert all(re.search(r"\\an[45]\\pos\(", e) for e in events)
    # Las animaciones son \t lineales con tiempos dentro del evento.
    for e in events:
        start, end = e.split(",")[1:3]
        dur = ass_seconds(end) - ass_seconds(start)
        for a, b in re.findall(r"\\t\((\d+),(\d+),", e):
            assert 0 <= int(a) < int(b) <= dur * 1000 + 20, (e, a, b)
    # Posición segura de Reels: el texto queda entre el 55 % y el 75 % del alto (lejos de la interfaz de abajo).
    ys = [float(m) for m in re.findall(r"\\pos\([\d.]+,([\d.]+)\)", text)]
    assert ys and 0.55 * 1920 <= min(ys) and max(ys) <= 0.75 * 1920, (min(ys), max(ys))
    if style == "caja":
        assert "\\p1}m " in text and text.count("\\p1}") == words  # una píldora por palabra
    if style == "resaltador":
        assert "\\an4" in text and "\\fscx0.0" in text  # el marcador crece de izquierda a derecha
    if style == "hormozi":
        assert "\\bord" in text and "\\1c&H00F87000" in text  # contorno escalado y palabra clave en el acento (BGR)
    if style == "minimal":
        assert "\\blur" in text  # sombra suave
    if style in ("caja", "hormozi", "karaoke", "palabra", "minimal"):
        assert stickers and all((EMOJI_DIR / f"{s['name']}.png").exists() for s in stickers)
        for s in stickers:
            assert 0 <= s["x"] and s["x"] + s["size"] <= 1080 and s["y"] >= 0


@needs_fonts
def test_long_line_shrinks_to_fit() -> None:
    cap = json.loads(json.dumps(DUMP["styles"]["palabra"]))
    block = cap["blocks"][0]
    block["words"] = [{**block["words"][0], "text": "OTORRINOLARINGÓLOGO"}]
    cap["blocks"] = [block]
    text, _ = ass.build_look_ass(cap, 1080, 1920, FONTS)
    fs = float(re.search(r"\\fs([\d.]+)", dialogues(text)[-1]).group(1))
    natural = float(cap["look"]["size"]) * 1920 * ass.font_metrics(str(FONTS / "Montserrat-Black.ttf"))["scale"]
    assert fs < natural * 0.95
    width = ass.word_width(str(FONTS / "Montserrat-Black.ttf"), fs / ass.font_metrics(str(FONTS / "Montserrat-Black.ttf"))["scale"], "OTORRINOLARINGÓLOGO")
    assert width <= cap["look"]["maxWidth"] * 1080 + 1


def ass_seconds(stamp: str) -> float:
    h, m, s = stamp.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


@needs_fonts
@pytest.mark.parametrize("style", ["caja", "resaltador"])
def test_rendered_frame_shows_accent_and_text(tmp_path: Path, style: str) -> None:
    """Render real con libass: en el instante de "dinero" se ve la caja/marcador del acento y texto blanco."""
    cap = DUMP["styles"][style]
    text, stickers = ass.build_look_ass(cap, 1080, 1920, FONTS)
    ass_path = tmp_path / "c.ass"
    ass_path.write_text(text, encoding="utf-8")
    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0, ass_path, FONTS, stickers=[{**s, "input": 1 + i} for i, s in enumerate(stickers)])
    imgs = [a for s in stickers for a in ("-loop", "1", "-framerate", "30", "-i", str(EMOJI_DIR / f"{s['name']}.png"))]
    t = 2.95 if style == "caja" else 3.2
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x202020:s=1080x1920:r=30:d=4", *imgs, "-filter_complex", graph, "-map", "[v]",
         "-ss", f"{t}", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    frame = np.frombuffer(out, dtype=np.uint8).reshape(1920, 1080, 3).astype(np.int32)
    band = frame[1050:1450]
    accent = (band[..., 2] > 200) & (band[..., 0] < 60) & (band[..., 1] > 80) & (band[..., 1] < 150)
    white = (band > 235).all(axis=-1)
    assert accent.sum() > 3000, int(accent.sum())
    assert white.sum() > 3000, int(white.sum())
