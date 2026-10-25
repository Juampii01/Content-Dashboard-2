"""Audio del original con tiempos irregulares: algunos teléfonos y apps que pegan tomas escriben paquetes de audio con
tiempos repetidos ("apretados"). Antes, la extracción con `aresample=async` descartaba ese pedazo de voz y todo lo que
seguía quedaba adelantado respecto de la imagen (en el video final se notaba después del primer corte). Ahora el audio
se decodifica seguido y solo los huecos de verdad se rellenan con silencio."""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from comunes import ffmpeg
from video import ingest


def _tone(path: Path, freq: int, seconds: float) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}:sample_rate=48000", "-c:a", "aac", str(path)], check=True)


def _source(tmp: Path, declared_first: float, video_seconds: float) -> Path:
    """Dos tonos pegados con el concat de ffmpeg: si el primero se declara más corto de lo que dura, los paquetes del
    segundo quedan apretados (tiempos repetidos); si se declara más largo, queda un hueco."""
    _tone(tmp / "a1.m4a", 300, 10)
    _tone(tmp / "a2.m4a", 600, 10)
    (tmp / "list.txt").write_text(f"file '{tmp / 'a1.m4a'}'\nduration {declared_first}\nfile '{tmp / 'a2.m4a'}'\n")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c", "copy", str(tmp / "a.mka")], check=True)
    src = tmp / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=720x1280:rate=30:duration={video_seconds}", "-i", str(tmp / "a.mka"), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "copy", str(src)], check=True)
    return src


def _freq_at(wav: Path, t: float) -> float:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(wav), "-t", "0.2", "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return float(np.fft.rfftfreq(len(x), 1 / 48000)[int(np.argmax(spec))])


def _duration(path: Path) -> float:
    return float(ffmpeg.probe(path)["format"]["duration"])


def test_audio_apretado_se_decodifica_seguido(tmp_path: Path) -> None:
    # El primer tono dura 10 s pero se declara de 9,19 s: 0,81 s del segundo quedan apretados (como en el original
    # del dueño, que perdía 0,81 s de voz en dos lugares).
    src = _source(tmp_path, 9.19, 20.0)
    timeline = ingest.audio_timeline(src)
    assert 0.7 <= timeline["squeezedSeconds"] <= 0.9, timeline
    assert timeline["gaps"] == []
    info = ingest.analyze_probe(ffmpeg.probe(src))
    wav = tmp_path / "audio.wav"
    meta = ingest.extract_audio(src, info, wav)
    assert meta["squeezedSeconds"] > 0.7
    # Nada se pierde: el segundo tono empieza a los 10 s del audio y el primero dura sus 10 s.
    assert abs(_freq_at(wav, 9.6) - 300) < 20
    assert abs(_freq_at(wav, 10.3) - 600) < 20
    assert abs(_duration(wav) - info["duration"]) < 0.03


def test_hueco_de_verdad_se_rellena_con_silencio(tmp_path: Path) -> None:
    # El primero se declara de 11 s (dura 10): falta 1 s de audio; lo que sigue tiene que quedar en su lugar.
    src = _source(tmp_path, 11.0, 21.0)
    timeline = ingest.audio_timeline(src)
    assert len(timeline["gaps"]) == 1 and 0.9 <= timeline["gapSeconds"] <= 1.1, timeline
    info = ingest.analyze_probe(ffmpeg.probe(src))
    wav = tmp_path / "audio.wav"
    ingest.extract_audio(src, info, wav)
    assert abs(_freq_at(wav, 9.6) - 300) < 20
    assert abs(_freq_at(wav, 11.3) - 600) < 20
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "10.2", "-i", str(wav), "-t", "0.6", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    assert float(np.abs(np.frombuffer(raw, dtype=np.float32)).max()) < 0.01, "el hueco queda en silencio"


def test_audio_normal_queda_igual(tmp_path: Path) -> None:
    src = _source(tmp_path, 10.0, 20.0)
    timeline = ingest.audio_timeline(src)
    assert timeline["gaps"] == [] and timeline["squeezedSeconds"] < 0.05, timeline
