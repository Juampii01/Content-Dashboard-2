"""Render de punta a punta con ffmpeg real sobre un video sintético (sin red ni base).

Verifica lo que más importa: que los cortes caen en el cuadro exacto, que audio y video miden lo mismo
después de unir tramos, que el audio sale a -14 LUFS y que el reencuadre 16:9 → 9:16 da 1080×1920.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from comunes import ffmpeg
from video import ass, ingest, render

FONTS = Path(__file__).resolve().parent.parent / "fonts"


def make_source(path: Path, seconds: int = 7, size: str = "1920x1080", hdr: bool = False) -> None:
    font = FONTS / "Inter-Bold.ttf"
    draw = f",drawtext=fontfile={font}:text='%{{frame_num}}':fontsize=200:fontcolor=white:x=(w-tw)/2:y=(h-th)/2" if font.exists() else ""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=330:sample_rate=48000:duration={seconds}",
        "-vf", f"format=yuv420p{draw}",
        "-af", "volume=0.25",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(path),
    ]
    subprocess.run(cmd, check=True)


def gray_frame(path: Path, index: int, w: int = 64, h: int = 36) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-vf", f"select=eq(n\\,{index}),scale={w}:{h},format=gray", "-frames:v", "1", "-f", "rawvideo", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).astype(np.float32)


def stream_durations(path: Path) -> tuple[float, float, int]:
    """Duración real de cada stream, decodificando (en MKV las duraciones por stream no vienen en el encabezado)."""
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    a_dur = len(pcm) / 2 / 48000
    frames = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout.strip())
    return frames / 30, a_dur, frames


@pytest.fixture(scope="module")
def prepared(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, Path]:
    work = tmp_path_factory.mktemp("render")
    src = work / "src.mp4"
    make_source(src)
    info = ingest.analyze_probe(ffmpeg.probe(src))
    mezz, wav = work / "mezz.mp4", work / "audio.wav"
    ingest.build_mezzanine(src, info, mezz, lambda f: None)
    ingest.extract_audio(src, info, wav)
    return work, mezz, wav


def test_cuts_are_frame_exact_and_in_sync(prepared: tuple[Path, Path, Path]) -> None:
    work, mezz, wav = prepared
    clips = [{"start": 15, "end": 45}, {"start": 90, "end": 151}, {"start": 170, "end": 182}]
    segments = render.render_segments(mezz, wav, clips, work, lambda f: None)
    joined = work / "joined.mkv"
    render.concat(segments, joined)
    v_dur, a_dur, frames = stream_durations(joined)
    assert frames == 30 + 61 + 12
    assert abs(a_dur - frames / 30) < 0.002  # 1600 muestras por cuadro: audio y video iguales
    # El cuadro 30 del unido es el cuadro 90 del mezzanine (primer cuadro del segundo tramo).
    diff_same = np.abs(gray_frame(joined, 30) - gray_frame(mezz, 90)).mean()
    diff_prev = np.abs(gray_frame(joined, 30) - gray_frame(mezz, 89)).mean()
    assert diff_same < diff_prev and diff_same < 4


def test_full_render_9x16_from_16x9(prepared: tuple[Path, Path, Path]) -> None:
    work, mezz, wav = prepared
    clips = [{"start": 0, "end": 60}, {"start": 75, "end": 180}]
    segments = render.render_segments(mezz, wav, clips, work, lambda f: None)
    joined = work / "joined2.mkv"
    render.concat(segments, joined)
    voice = work / "voice.wav"
    audio = render.process_audio(joined, voice)
    assert audio["normalization"] == "linear"
    captions = {"preset": "clasico", "accent": "#00AAFF", "blocks": [{"start": 0.2, "end": 1.4, "words": [{"text": "Hola", "start": 0.2, "end": 0.6, "emphasis": False}, {"text": "mundo", "start": 0.7, "end": 1.4, "emphasis": True}]}]}
    ass_path = work / "c.ass"
    ass_path.write_text(ass.build_ass(captions, 1080, 1920, "9:16"), encoding="utf-8")
    graph, w, h = render.framing_graph(1920, 1080, "9:16", 0.5, ass_path, FONTS)
    assert (w, h) == (1080, 1920)
    out = work / "final.mp4"
    expected = 165 / 30
    render.final_encode(joined, voice, graph, expected, out, "veryfast", lambda f: None)
    qc = render.quality_check(out, expected, "9:16")
    failed = [c for c in qc["checks"] if not c["ok"]]
    assert not failed, failed
    assert abs(qc["lufs"] + 14) <= 1


def test_vertical_to_horizontal_uses_blurred_background() -> None:
    graph, w, h = render.framing_graph(1080, 1920, "16:9", 0, None, FONTS)
    assert (w, h) == (1920, 1080) and "boxblur" in graph


def test_zoom_expression_is_piecewise_and_capped() -> None:
    expr = render.zoom_expr([{"start": 1, "end": 2, "scale": 1.1}, {"start": 3, "end": 4, "scale": 2.0, "ramp": 0.25}, {"start": 3.5, "end": 5, "scale": 1.2}])
    assert expr is not None and expr.startswith("1+")
    assert "gte(it,1.000)*lt(it,2.000)*0.1000" in expr
    assert f"*{render.MAX_ZOOM - 1:.4f}*min(1,(it-3.000)/0.250)" in expr  # escala con tope y rampa
    assert "3.500" not in expr  # el tramo que se superpone se descarta
    assert render.zoom_expr([]) is None


def test_render_with_style_captions_zoom_and_broll(prepared: tuple[Path, Path, Path]) -> None:
    """Render 9:16 con subtítulos del estilo (amarillos, abajo), un punch-in y un b-roll a pantalla completa."""
    work, mezz, wav = prepared
    clips = [{"start": 0, "end": 180}]
    segments = render.render_segments(mezz, wav, clips, work, lambda f: None)
    joined = work / "joined3.mkv"
    render.concat(segments, joined)
    voice = work / "voice3.wav"
    render.process_audio(joined, voice)
    # B-roll: un clip verde de 2 s (horizontal, para probar el recorte al formato).
    green = work / "green.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x00FF00:s=1280x720:r=25:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(green)], check=True)
    ready = work / "green-ready.mp4"
    render.prepare_broll(green, ready, 1.5, (1080, 1920))
    captions = {
        "preset": "estilo",
        "style": {"size": 0.04, "position": 0.78, "uppercase": True, "textColor": "#FFE600", "highlightColor": None, "box": False, "outline": True},
        "blocks": [{"start": 0.0, "end": 6.0, "words": [{"text": "subtítulos", "start": 0.0, "end": 3.0, "emphasis": False}, {"text": "amarillos", "start": 3.0, "end": 6.0, "emphasis": False}]}],
    }
    ass_path = work / "estilo.ass"
    ass_path.write_text(ass.build_ass(captions, 1080, 1920, "9:16"), encoding="utf-8")
    assert "\\an5\\pos(540,1498)" in ass_path.read_text() and "SUBTÍTULOS AMARILLOS" in ass_path.read_text()
    graph, w, h = render.framing_graph(
        1920, 1080, "9:16", 0, ass_path, FONTS,
        zooms=[{"start": 1.0, "end": 2.5, "scale": 1.2, "ramp": 0}],
        broll=[{"input": 2, "start": 3.5, "end": 5.0}],
    )
    out = work / "final-estilo.mp4"
    render.final_encode(joined, voice, graph, 6.0, out, "veryfast", lambda f: None, extra_inputs=[ready])
    qc = render.quality_check(out, 6.0, "9:16")
    assert all(c["ok"] for c in qc["checks"] if c["name"] in ("Duración", "Tamaño", "Sincronía audio-video")), qc["checks"]

    def frame(t: float) -> np.ndarray:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{t}", "-i", str(out), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype=np.uint8).reshape(1920, 1080, 3).astype(np.int32)

    # B-roll: a pantalla completa (arriba del todo, verde puro) solo dentro de su tramo, con la voz siguiendo.
    top = frame(4.2)[100:400, 100:980].mean(axis=(0, 1))
    assert top[1] > 200 and top[0] < 60 and top[2] < 60, top
    assert frame(2.9)[100:400, 100:980].mean(axis=(0, 1))[1] < 200
    # Subtítulos: píxeles amarillos en la banda del 78 % (también sobre el b-roll, que va debajo del texto).
    for t in (0.5, 4.2):
        band = frame(t)[1440:1560]
        yellow = (band[..., 0] > 200) & (band[..., 1] > 190) & (band[..., 2] < 90)
        assert yellow.sum() > 2000, (t, int(yellow.sum()))

    # Punch-in: entre 0,9 s y 1,1 s la imagen pasa al 120 %. Se mide con el número blanco de testsrc2
    # (el contador de cuadros, siempre del mismo alto): su alto crece un 20 % y vuelve al terminar el tramo.
    def digits_height(t: float) -> int:
        f = frame(t)[300:1350]
        rows = np.where(((f[..., 0] > 235) & (f[..., 1] > 235) & (f[..., 2] > 235)).sum(axis=1) > 6)[0]
        return int(rows.max() - rows.min())

    before, during, after = digits_height(0.9), digits_height(1.1), digits_height(2.8)
    assert during / before == pytest.approx(1.2, abs=0.04), (before, during)
    assert after / before == pytest.approx(1.0, abs=0.04), (before, after)
