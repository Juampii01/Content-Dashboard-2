"""Mezcla del Estudio en el render (render.mix_audio con `voice_db`, pistas silenciadas y fundidos), con ffmpeg real.

Lo que se cuida: lo mismo que la vista previa (lib/video/audio-mix.ts). La voz baja lo que dice su volumen, silenciada
no suena pero la música sigue bajando cuando hablas, los fundidos de la música y de cada sonido son los pedidos y el
recorte de un sonido deja sonar solo su tramo. Se mide con astats/volumedetect (ffmpeg) y con numpy.
"""

import re
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import pipeline, render

from .test_audio_mix import DURATION, RATE, SPEECH, read_wav, rms_db, speech_like, write_wav


@pytest.fixture(scope="module")
def voice(tmp_path_factory: pytest.TempPathFactory) -> Path:
    work = tmp_path_factory.mktemp("mixer")
    raw = write_wav(work / "raw.wav", speech_like(DURATION, np.random.default_rng(3)))
    out = work / "voice.wav"
    render.process_audio(raw, out)
    return out


@pytest.fixture(scope="module")
def music(tmp_path_factory: pytest.TempPathFactory) -> Path:
    t = np.arange(int(4 * RATE)) / RATE
    chord = sum(np.sin(2 * np.pi * f * t) for f in (220, 277.2, 329.6)) / 3 * 0.5
    return write_wav(tmp_path_factory.mktemp("musica") / "music.wav", chord)


def volumedetect(path: Path) -> float:
    """Nivel medio (dB) que mide ffmpeg con volumedetect."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(re.search(r"mean_volume:\s+(-?[\d.]+|-inf) dB", out).group(1))


def astats_rms(path: Path, start: float, end: float) -> float:
    """RMS (dB) de un tramo, medido con astats de ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-ss", f"{start}", "-t", f"{end - start}", "-i", str(path), "-af", "astats=measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    m = re.search(r"RMS level dB:\s+(-?[\d.]+|-inf)", out)
    return float(m.group(1)) if m and m.group(1) != "-inf" else -120.0


def test_voice_volume_lowers_the_voice_exactly(voice: Path, tmp_path: Path) -> None:
    out = tmp_path / "mix.wav"
    info = render.mix_audio(voice, out, DURATION, voice_db=-6)
    assert info["voiceDb"] == -6
    assert volumedetect(out) == pytest.approx(volumedetect(voice) - 6, abs=0.2)
    # Fuera de rango se acota (la voz no se sube: la vista previa no puede pasar de 1).
    render.mix_audio(voice, tmp_path / "loud.wav", DURATION, voice_db=+6)
    assert volumedetect(tmp_path / "loud.wav") == pytest.approx(volumedetect(voice), abs=0.2)


def test_muted_voice_keeps_ducking_the_music(voice: Path, music: Path, tmp_path: Path) -> None:
    both = tmp_path / "both.wav"
    render.mix_audio(voice, both, DURATION, music=music, music_db=-16)
    muted = tmp_path / "muted.wav"
    info = render.mix_audio(voice, muted, DURATION, music=music, music_db=-16, voice_db=None)
    assert info["voiceDb"] is None
    y = read_wav(muted)
    assert len(y) == int(DURATION * RATE)
    # Lo que queda es la música de la mezcla completa (la voz no está): restar la voz da lo mismo.
    rest = read_wav(both) - read_wav(voice)[: len(read_wav(both))]
    assert np.max(np.abs(y - rest)) < 0.01
    # Y sigue bajando cuando hablas.
    talking = astats_rms(muted, 3.5, 4.9)
    pause = astats_rms(muted, 5.5, 5.95)
    assert pause - talking >= 5, (pause, talking)


def test_everything_muted_is_silence_of_the_right_length(voice: Path, tmp_path: Path) -> None:
    out = tmp_path / "silence.wav"
    render.mix_audio(voice, out, DURATION, voice_db=None)
    y = read_wav(out)
    assert len(y) == int(DURATION * RATE)
    assert np.max(np.abs(y)) == 0


def test_music_fades_are_the_ones_asked(voice: Path, music: Path, tmp_path: Path) -> None:
    short = tmp_path / "short.wav"
    render.mix_audio(voice, short, DURATION, music=music, voice_db=None, music_fade=(0.1, 0.1))
    long = tmp_path / "long.wav"
    info = render.mix_audio(voice, long, DURATION, music=music, voice_db=None, music_fade=(4.0, 0.0))
    assert info["music"]["fade"] == [4.0, 0.0]
    # Con 4 s de entrada, al segundo 2,0-2,9 (pausa) la música está unos 3 a 6 dB más baja que sin fundido largo.
    diff = astats_rms(short, 2.1, 2.9) - astats_rms(long, 2.1, 2.9)
    assert 2.5 <= diff <= 7, diff
    # Sin fundido de salida, el final suena; con el de siempre (1,5 s), se apaga.
    default = tmp_path / "default.wav"
    render.mix_audio(voice, default, DURATION, music=music, voice_db=None)
    assert astats_rms(long, DURATION - 0.2, DURATION) > astats_rms(default, DURATION - 0.2, DURATION) + 10
    # Si no entran en el video, se achican en proporción.
    assert render.fit_fades(8, 8, 12) == (6.0, 6.0)


def test_sound_trim_and_fades(tmp_path: Path) -> None:
    silence = write_wav(tmp_path / "silence.wav", np.zeros(int(4 * RATE)))
    whole = tmp_path / "whole.wav"
    render.mix_audio(silence, whole, 4.0, sfx=[{"name": "impact", "at": 1.0, "gain": -6}])
    cut = tmp_path / "cut.wav"
    render.mix_audio(silence, cut, 4.0, sfx=[{"name": "impact", "at": 1.0, "gain": -6, "from": 0.1, "length": 0.2}])
    w, c = read_wav(whole), read_wav(cut)
    win = lambda y, a, b: y[int(a * RATE) : int(b * RATE)]  # noqa: E731
    # Antes de 1,1 s y después de 1,3 s no suena nada; dentro, es el mismo pedazo del archivo.
    assert np.max(np.abs(win(c, 0, 1.095))) < 1e-4
    assert np.max(np.abs(win(c, 1.305, 4))) < 1e-4
    assert np.max(np.abs(win(c, 1.11, 1.29) - win(w, 1.11, 1.29))) < 0.003
    # Fundido de entrada de 0,1 s: los primeros 20 ms casi en silencio, a los 0,15 s igual que sin fundido.
    faded = tmp_path / "faded.wav"
    render.mix_audio(silence, faded, 4.0, sfx=[{"name": "impact", "at": 1.0, "gain": -6, "from": 0.1, "length": 0.4, "fade_in": 0.1, "fade_out": 0.2}])
    f = read_wav(faded)
    assert rms_db(win(f, 1.1, 1.12)) < rms_db(win(w, 1.1, 1.12)) - 12
    assert abs(rms_db(win(f, 1.21, 1.29)) - rms_db(win(w, 1.21, 1.29))) < 0.5
    # Y el de salida: los últimos 20 ms casi en silencio.
    assert rms_db(win(f, 1.48, 1.5)) < rms_db(win(w, 1.48, 1.5)) - 12


def test_mix_settings_without_the_field_are_the_old_ones() -> None:
    assert pipeline.mix_settings({}) == {"voiceDb": 0.0, "music": True, "sfx": True, "musicFade": (render.MUSIC_FADE_IN, render.MUSIC_FADE_OUT)}
    s = pipeline.mix_settings({"mix": {"voiceDb": None, "music": False, "sfx": True, "musicFade": {"in": 2, "out": 0}}})
    assert s == {"voiceDb": None, "music": False, "sfx": True, "musicFade": (2.0, 0.0)}
    assert pipeline.mix_settings({"mix": {"voiceDb": -40}})["voiceDb"] == -30


def test_voice_untouched_without_mix(voice: Path, tmp_path: Path) -> None:
    """Sin efectos, sin música y sin mezcla: la voz pasa tal cual (no se recodifica)."""

    class Ctx:
        pass

    out = pipeline.mix_extras(Ctx(), "p", tmp_path, tmp_path, voice, {"sfx": [], "music": None}, DURATION, {})  # type: ignore[arg-type]
    assert out == voice
    out = pipeline.mix_extras(Ctx(), "p", tmp_path, tmp_path, voice, {"sfx": [], "music": None, "mix": {"voiceDb": -3, "music": True, "sfx": True}}, DURATION, {})  # type: ignore[arg-type]
    assert out != voice and volumedetect(out) == pytest.approx(volumedetect(voice) - 3, abs=0.2)
