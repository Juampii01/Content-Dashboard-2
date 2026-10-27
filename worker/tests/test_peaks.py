"""Forma de onda de la voz (worker/video/peaks.py): ventanas de 20 ms, escala con raíz cuadrada y el JSON chico."""

import base64
from pathlib import Path

import numpy as np

from video import peaks

from .test_audio_mix import RATE, write_wav


def test_peaks_follow_the_voice(tmp_path: Path) -> None:
    # 1 s de silencio, 1 s de un tono a 0,5 de amplitud y 0,5 s a 0,1.
    t = np.arange(RATE) / RATE
    y = np.concatenate([np.zeros(RATE), 0.5 * np.sin(2 * np.pi * 300 * t), 0.1 * np.sin(2 * np.pi * 300 * t[: RATE // 2])])
    data = peaks.compute(write_wav(tmp_path / "v.wav", y))
    assert data["rate"] == 50 and data["count"] == 125 and abs(data["duration"] - 2.5) < 0.01
    peak = (np.frombuffer(base64.b64decode(data["peak"]), dtype=np.uint8) / 255) ** 2
    rms = (np.frombuffer(base64.b64decode(data["rms"]), dtype=np.uint8) / 255) ** 2
    assert peak[:48].max() < 0.01
    assert abs(np.median(peak[52:98]) - 0.5) < 0.03
    assert abs(np.median(rms[52:98]) - 0.5 / np.sqrt(2)) < 0.03
    assert abs(np.median(peak[102:123]) - 0.1) < 0.01


def test_peaks_json_is_small(tmp_path: Path) -> None:
    rng = np.random.default_rng(1)
    y = rng.standard_normal(RATE * 60) * 0.1
    data = peaks.compute(write_wav(tmp_path / "v.wav", y))
    # Un minuto: 3000 ventanas por arreglo, unos 8 KB en base64 los dos.
    assert data["count"] == 3000
    assert len(data["peak"]) + len(data["rms"]) < 9000
    assert peaks.peaks_key("abc") == "editor/abc/picos-v1.json"


def test_peaks_job_is_registered() -> None:
    from comunes import runner

    assert runner._handlers["VIDEO_PEAKS"] is peaks.peaks_job
