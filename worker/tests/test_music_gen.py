"""Música generada (licencia propia): el worker la arma con el mismo generador que la vista previa (Node), en caché, y
se mezcla bajo la voz como cualquier pista."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pytest

from comunes.errors import JobError
from video import music_gen, render

needs_node = pytest.mark.skipif(not music_gen.enabled(), reason="falta Node o el generador empaquetado (pnpm motion:bundle)")


def _read(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768, w.getframerate()


@needs_node
@pytest.mark.parametrize("style", music_gen.STYLES)
def test_each_style_renders_at_a_steady_level(tmp_path: Path, style: str) -> None:
    out = music_gen.generate({"style": style, "seed": 11, "bpm": 96}, 6.0, tmp_path)
    y, sr = _read(out)
    assert sr == 48000 and abs(len(y) / sr - 6.0) < 0.01
    # Nivel del cuerpo (percentil 75 de ventanas de 1 s, como el master del generador).
    win = sr
    vals = sorted(float(np.mean(y[i : i + win] ** 2)) for i in range(0, len(y) - win + 1, win))
    rms = 10 * np.log10(vals[min(len(vals) - 1, int(len(vals) * 0.75))])
    assert -18 < rms < -14.5, (style, rms)
    assert np.abs(y).max() <= 0.9


@needs_node
def test_cache_and_determinism(tmp_path: Path) -> None:
    a = music_gen.generate({"style": "lofi", "seed": 3, "bpm": 80}, 4.0, tmp_path)
    mtime = a.stat().st_mtime
    b = music_gen.generate({"style": "lofi", "seed": 3, "bpm": 80}, 4.0, tmp_path)
    assert a == b and b.stat().st_mtime == mtime
    other = music_gen.generate({"style": "lofi", "seed": 3, "bpm": 80}, 4.0, tmp_path / "otra")
    assert _read(other)[0].tobytes() == _read(a)[0].tobytes()


def test_invalid_specs_are_refused(tmp_path: Path) -> None:
    for bad in ({"style": "rock", "seed": 1, "bpm": 90}, {"style": "lofi", "seed": -1, "bpm": 90}, {"style": "lofi", "seed": 1, "bpm": 400}, None):
        with pytest.raises(JobError):
            music_gen.generate(bad, 4.0, tmp_path)


@needs_node
def test_generated_music_goes_under_the_voice(tmp_path: Path) -> None:
    rate = render.SAMPLE_RATE
    t = np.arange(int(8 * rate)) / rate
    voice = (np.sin(2 * np.pi * 180 * t) * 0.3 * (np.sin(2 * np.pi * 3 * t) > 0)).astype(np.float32)
    vpath = tmp_path / "voz.wav"
    with wave.open(str(vpath), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((voice * 32767).astype("<i2").tobytes())
    music = music_gen.generate({"style": "corporativo", "seed": 5, "bpm": 110}, 8.0, tmp_path)
    info = render.mix_audio(vpath, tmp_path / "mix.wav", 8.0, music=music, music_db=-16)
    assert info["music"] and info["music"]["db"] == -16
