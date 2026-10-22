"""Frases corregidas con la voz clonada (video/phrase_fix.py), con ffmpeg real.

Lo que se cuida:
- El audio parchado mide lo mismo que el original (el video no se corre) y fuera de las ventanas no cambia ni una muestra.
- Dentro de la ventana suena la voz nueva (no la vieja), al volumen de la voz original y sobre el ambiente de la sala
  (no un hueco de silencio digital); se respeta el recorte a lo hablado y la aceleración pedida.
- Los labios sincronizados quedan encima del mezzanine solo en su tramo, con el mismo tamaño y la misma cantidad de cuadros.
- El hash de las correcciones cambia si cambia algo (los tramos del render no se mezclan).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from video import phrase_fix
from video.studio import read_audio, write_wav

SR = 48000


def tone(freq: float, seconds: float, level: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (np.sin(2 * np.pi * freq * t) * level).astype(np.float32)


def original_audio() -> np.ndarray:
    """10 s: ruido de sala suave todo el tiempo y "voz" (tono de 200 Hz) entre 1–4 s y 5–9 s."""
    rng = np.random.default_rng(1)
    x = (rng.standard_normal(10 * SR) * 0.003).astype(np.float32)
    x[1 * SR : 4 * SR] += tone(200, 3, 0.3)
    x[5 * SR : 9 * SR] += tone(200, 4, 0.3)
    return x


def write_voice(path: Path, seconds: float, freq: float = 700, level: float = 0.05, lead: float = 0.3) -> None:
    """Voz nueva (tono de 700 Hz, más baja que la original) con silencio antes y después, como la da un TTS."""
    x = np.concatenate([np.zeros(int(lead * SR), np.float32), tone(freq, seconds, level), np.zeros(int(0.3 * SR), np.float32)])
    tmp = path.with_suffix(".f32.wav")
    write_wav(tmp, x)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-c:a", "libmp3lame", "-b:a", "128k", str(path)], check=True)


def band_energy(x: np.ndarray, freq: float) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    return float(spec[(freqs > freq - 30) & (freqs < freq + 30)].sum())


def test_patch_replaces_only_the_window(tmp_path: Path) -> None:
    x = original_audio()
    voice = tmp_path / "voz.mp3"
    write_voice(voice, 1.8)
    fix = {"id": "f1", "start": 5.5, "end": 7.8, "speechStart": 0.3, "speechEnd": 2.1, "tempo": 1.0}
    out = phrase_fix.patch_audio(x, [fix], {"f1": voice})

    assert out.shape == x.shape
    a, b = int(5.5 * SR), int(7.8 * SR)
    fade = int(SR * phrase_fix.FADE)
    assert np.array_equal(out[: a], x[: a])
    assert np.array_equal(out[b:], x[b:])
    inner = out[a + fade : b - fade]
    # La voz nueva suena y la vieja ya no.
    assert band_energy(inner, 700) > 20 * band_energy(inner, 200)
    # Volumen igualado al de la voz original de la ventana (±1,5 dB).
    ratio = phrase_fix.voice_level(inner) / phrase_fix.voice_level(x[a:b])
    assert 0.84 < ratio < 1.19
    # Después de lo hablado queda el ambiente de la sala, no silencio digital.
    tail = out[int(7.5 * SR) : b - fade]
    level = float(np.sqrt(np.mean(tail.astype(np.float64) ** 2)))
    assert 0.0005 < level < 0.02


def test_tempo_shortens_speech(tmp_path: Path) -> None:
    voice = tmp_path / "voz.mp3"
    write_voice(voice, 2.4)
    plain = phrase_fix.decode_speech(voice, 0.3, 2.7, 1.0)
    fast = phrase_fix.decode_speech(voice, 0.3, 2.7, 1.2)
    assert abs(plain.size / SR - 2.4) < 0.08
    assert abs(fast.size / SR - 2.0) < 0.08
    # El tope de velocidad se respeta aunque se pida más.
    capped = phrase_fix.decode_speech(voice, 0.3, 2.7, 3.0)
    assert abs(capped.size / SR - 2.4 / phrase_fix.MAX_TEMPO) < 0.08


def test_too_long_speech_is_cut_with_fade(tmp_path: Path) -> None:
    x = original_audio()
    voice = tmp_path / "voz.mp3"
    write_voice(voice, 3.0)
    fix = {"id": "f1", "start": 1.0, "end": 2.0, "speechStart": 0.3, "speechEnd": 3.3, "tempo": 1.0}
    out = phrase_fix.patch_audio(x, [fix], {"f1": voice})
    assert out.shape == x.shape
    assert np.array_equal(out[int(2.0 * SR) :], x[int(2.0 * SR) :])


def test_hash_changes_with_fixes() -> None:
    a = [{"id": "f1", "start": 1, "end": 2, "audioKey": "k", "speechStart": 0, "speechEnd": 1, "tempo": 1}]
    b = [{**a[0], "tempo": 1.1}]
    c = [{**a[0], "lipsync": {"key": "x", "start": 0.6, "end": 2.4}}]
    assert phrase_fix.fixes_hash(a) == phrase_fix.fixes_hash([dict(a[0])])
    assert len({phrase_fix.fixes_hash(a), phrase_fix.fixes_hash(b), phrase_fix.fixes_hash(c)}) == 3


def _video(path: Path, color: str, seconds: float, size: str = "320x568") -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s={size}:r=30:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )


def _frame_mean(path: Path, at: float) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).mean(axis=0)


def _frames(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def test_patch_video_overlays_only_the_clip(tmp_path: Path) -> None:
    mezz, lips, out = tmp_path / "mezz.mp4", tmp_path / "labios.mp4", tmp_path / "out.mp4"
    _video(mezz, "blue", 6)
    # Los labios llegan a otro tamaño (HeyGen puede devolverlo distinto): se escalan al del mezzanine.
    _video(lips, "red", 1.6, "160x284")
    phrase_fix.patch_video(mezz, [{"path": lips, "start": 2.0, "end": 3.6}], out, (320, 568))
    assert _frames(out) == _frames(mezz)
    before, during, after = _frame_mean(out, 1.0), _frame_mean(out, 2.8), _frame_mean(out, 4.5)
    assert before[2] > 150 and before[0] < 60
    assert during[0] > 150 and during[2] < 60
    assert after[2] > 150 and after[0] < 60


def test_read_write_roundtrip(tmp_path: Path) -> None:
    x = original_audio()
    path = tmp_path / "a.wav"
    write_wav(path, x)
    assert np.allclose(read_audio(path), x, atol=1e-6)
