"""Mezcla de efectos de sonido y música bajo la voz (render.mix_audio) con ffmpeg real.

Lo que se cuida: la voz sigue a -14 LUFS, los efectos quedan por debajo de la voz (más en "Sutil" que en
"Marcado"), la música baja cuando hablas (ducking) y nada recorta. Las ganancias son las de lib/video/sfx.ts.
"""

import re
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

from comunes.errors import JobError
from video import render

RATE = 48000
SFX_GAINS = {"subtle": {"whoosh": -16}, "strong": {"whoosh": -10, "pop": -15, "riser": -13}}
# Habla de 2 s y pausa de 1 s, cuatro veces.
SPEECH = [(0.0, 2.0), (3.0, 5.0), (6.0, 8.0), (9.0, 11.0)]
DURATION = 12.0


def write_wav(path: Path, y: np.ndarray) -> Path:
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    return path


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").astype(np.float64) / 32768


def speech_like(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """Ruido con el espectro aproximado de una voz (200 Hz a 4 kHz) modulado en sílabas de 4 por segundo."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    spectrum = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= ((f > 150) & (f < 4500)) / np.sqrt(np.maximum(f, 150) / 150)
    y = np.fft.irfft(spectrum, n)
    syllables = 0.35 + 0.65 * np.abs(np.sin(np.pi * 4 * t)) ** 1.5
    env = np.zeros(n)
    for a, b in SPEECH:
        env[int(a * RATE) : int(b * RATE)] = 1
    return y / np.abs(y).max() * 0.5 * syllables * env


def loudness(path: Path) -> dict[str, float]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = out[out.rfind("Summary:") :]
    momentary = [float(m) for m in re.findall(r" M:\s*(-?[\d.]+)", out)]
    return {
        "I": float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1)),
        "peak": float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary).group(1)),
        "max_m": max(momentary) if momentary else -120.0,
    }


def rms_db(y: np.ndarray) -> float:
    return 20 * np.log10(max(1e-9, float(np.sqrt(np.mean(y**2)))))


@pytest.fixture(scope="module")
def voice(tmp_path_factory: pytest.TempPathFactory) -> Path:
    work = tmp_path_factory.mktemp("mix")
    raw = write_wav(work / "raw.wav", speech_like(DURATION, np.random.default_rng(3)))
    out = work / "voice.wav"
    render.process_audio(raw, out)
    return out


def test_sfx_files_exist_and_are_normalized() -> None:
    for name in render.SFX_NAMES:
        y = read_wav(render.SFX_DIR / f"{name}.wav")
        win = int(0.1 * RATE)
        loudest = 10 * np.log10(np.convolve(y**2, np.ones(win) / win, mode="valid").max()) if len(y) > win else rms_db(y)
        # -12 dBFS en la ventana más fuerte, salvo que el tope de pico (-1 dBFS) lo deje un poco más abajo (los muy
        # picudos que llegan a ese tope, como los clics o el tecleo, quedan más abajo).
        capped = 20 * np.log10(np.abs(y).max()) > -1.5
        assert (-24 if capped else -15.5) <= loudest <= -11.4, (name, loudest)
        assert 20 * np.log10(np.abs(y).max()) <= -0.9
        assert (render.SFX_DIR / f"{name}.wav").stat().st_size < 120_000


def test_voice_alone_is_untouched(voice: Path, tmp_path: Path) -> None:
    out = tmp_path / "mix.wav"
    info = render.mix_audio(voice, out, DURATION, sfx=[], music=None)
    assert info == {"sfx": 0, "music": None}
    assert loudness(out)["I"] == pytest.approx(loudness(voice)["I"], abs=0.1)


@pytest.mark.parametrize("level", ["subtle", "strong"])
def test_sfx_stay_under_the_voice(voice: Path, tmp_path: Path, level: str) -> None:
    gains = SFX_GAINS[level]
    # Los efectos caen en pausas (peor caso: nada los tapa) y uno en medio de la voz.
    cues = [{"name": "whoosh", "at": 2.2, "gain": gains["whoosh"]}, {"name": "whoosh", "at": 6.5, "gain": gains["whoosh"]}]
    if level == "strong":
        cues += [{"name": "riser", "at": 4.0, "gain": gains["riser"]}, {"name": "pop", "at": 8.3, "gain": gains["pop"]}]
    mixed = tmp_path / "mix.wav"
    render.mix_audio(voice, mixed, DURATION, sfx=cues)
    silence = write_wav(tmp_path / "silence.wav", np.zeros(int(DURATION * RATE)))
    only = tmp_path / "only.wav"
    render.mix_audio(silence, only, DURATION, sfx=cues)

    v, m, s = loudness(voice), loudness(mixed), loudness(only)
    # La voz sigue a -14 LUFS (los efectos suman menos de medio LU) y no hay recorte.
    assert m["I"] == pytest.approx(-14, abs=0.5), m
    assert m["I"] - v["I"] < 0.5
    assert m["peak"] <= -0.9, m
    # La voz no cambia: fuera de los efectos, la mezcla es la voz tal cual (sin limitador que la baje).
    mv, vv = read_wav(mixed), read_wav(voice)
    clean = slice(int(0.0 * RATE), int(2.0 * RATE))
    assert abs(rms_db(mv[clean]) - rms_db(vv[clean])) < 0.05
    # El momento más fuerte de los efectos (400 ms) queda por debajo del de la voz: bastante en "Sutil".
    margin = v["max_m"] - s["max_m"]
    assert margin >= (8 if level == "subtle" else 3), (level, v["max_m"], s["max_m"])
    # Y caen donde se pidió: el whoosh de 2,2 s tiene su punto fuerte cerca de 2,2 + 0,33 s.
    y = read_wav(only)
    win = int(0.05 * RATE)
    energy = np.convolve(y[: int(3 * RATE)] ** 2, np.ones(win) / win, mode="same")
    assert abs(np.argmax(energy) / RATE - 2.53) < 0.12


def test_music_is_ducked_under_the_voice(voice: Path, tmp_path: Path) -> None:
    # Música de prueba: acorde de 3 notas de 4 s (se repite sola hasta el final del video).
    t = np.arange(int(4 * RATE)) / RATE
    chord = sum(np.sin(2 * np.pi * f * t) for f in (220, 277.2, 329.6)) / 3 * 0.5
    music = write_wav(tmp_path / "music.wav", chord)
    mixed = tmp_path / "mix.wav"
    info = render.mix_audio(voice, mixed, DURATION, music=music, music_db=-16)
    assert info["music"] and info["music"]["db"] == -16
    v, m = loudness(voice), loudness(mixed)
    assert m["I"] == pytest.approx(-14, abs=0.6), m
    assert m["peak"] <= -0.9
    # La música es lo que queda al restar la voz (la voz no pasa por ningún proceso en la mezcla).
    rest = read_wav(mixed) - read_wav(voice)[: len(read_wav(mixed))]
    seg = lambda a, b: rest[int(a * RATE) : int(b * RATE)]  # noqa: E731
    talking = rms_db(np.concatenate([seg(a + 0.5, b - 0.1) for a, b in SPEECH[1:]]))
    pause = rms_db(np.concatenate([seg(b + 0.5, b + 0.95) for _, b in SPEECH[:3]]))
    assert pause - talking >= 5, (pause, talking)
    # En las pausas, la música suena cerca de 16 dB por debajo de la voz (medido en RMS).
    voice_rms = rms_db(np.concatenate([read_wav(voice)[int(a * RATE) : int(b * RATE)] for a, b in SPEECH]))
    assert 11 <= voice_rms - pause <= 21, (voice_rms, pause)
    # Fundido de salida: el último medio segundo casi en silencio.
    assert rms_db(rest[-int(0.2 * RATE) :]) < pause - 15


def test_silent_music_is_a_readable_error(voice: Path, tmp_path: Path) -> None:
    music = write_wav(tmp_path / "quiet.wav", np.zeros(RATE * 2))
    with pytest.raises(JobError) as exc:
        render.mix_audio(voice, tmp_path / "mix.wav", DURATION, music=music)
    assert "silencio" in exc.value.user_message and not exc.value.retry
    broken = tmp_path / "broken.mp3"
    broken.write_bytes(b"no es audio")
    with pytest.raises(JobError) as exc:
        render.mix_audio(voice, tmp_path / "mix2.wav", DURATION, music=broken)
    assert exc.value.user_message.startswith("No pudimos leer la música") and not exc.value.retry


def test_render_job_is_the_registered_handler() -> None:
    """La mezcla es una función auxiliar: el trabajo VIDEO_RENDER sigue siendo render_job."""
    from comunes import runner
    from video import pipeline

    assert runner._handlers["VIDEO_RENDER"] is pipeline.render_job


def test_voice_at_its_ceiling_is_not_limited(voice: Path, tmp_path: Path) -> None:
    """loudnorm deja la voz con picos de hasta -1 dBFS: la mezcla no la baja (antes un limitador a -1,5 la bajaba 0,3 dB)."""
    y = read_wav(voice)
    hot = write_wav(tmp_path / "hot.wav", y * (10 ** (-1.05 / 20) / np.abs(y).max()))
    out = tmp_path / "mix.wav"
    render.mix_audio(hot, out, DURATION, sfx=[{"name": "pop", "at": 11.6, "gain": -30}])
    a, b = read_wav(hot), read_wav(out)
    speech = slice(0, int(11 * RATE))
    assert abs(rms_db(b[speech]) - rms_db(a[speech])) < 0.02
