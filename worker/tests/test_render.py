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
