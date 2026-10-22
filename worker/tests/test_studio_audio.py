"""Audio de estudio (video/studio.py) y su lugar en el procesado de voz (render.process_audio), con ffmpeg real.

Lo que se cuida:
- El STFT de libDF reconstruye la señal exacta (sin retraso) y las bandas ERB son las del modelo.
- La voz queda alineada con el video: ningún nivel corre el audio (antes, afftdn lo corría 25 ms y el limitador 5 ms).
- Con el modelo (si está en worker/models, como en la imagen): el ruido baja mucho y la voz casi no cambia de nivel,
  Fuerte limpia más que Suave, el resultado es determinista y el eco estimado sube con la reverberación.
- Sin el modelo, el render no falla: usa la cadena de siempre y lo anota.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pytest

from video import audio_preview, render, studio

RATE = 48000
MODELS = Path(__file__).resolve().parent.parent / "models"
needs_model = pytest.mark.skipif(not studio.model_available(MODELS), reason="falta el modelo (python scripts/fetch_models.py models --only deepfilternet)")
SPEECH = [(0.5, 2.5), (3.5, 5.5), (6.5, 8.5)]
DURATION = 9.5
FORMANTS = [(800, 1200, 2500), (450, 1900, 2600), (300, 2300, 3000), (500, 850, 2500), (330, 800, 2400)]


def vowels(seconds: float = DURATION, seed: int = 3) -> np.ndarray:
    """Voz sintética: sílabas de 220 ms con vocales (armónicos de una F0 de ~140 Hz con vibrato, pesados por tres
    formantes) en los tramos de SPEECH. Un ruido con forma de voz no sirve: el modelo lo quita, como debe."""
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    f0 = 140 + 20 * np.sin(2 * np.pi * 0.7 * t) + 6 * np.sin(2 * np.pi * 5.3 * t)
    phase = 2 * np.pi * np.cumsum(f0) / RATE
    out = np.zeros(n)
    syl = int(0.22 * RATE)
    for a in range(0, n, syl):
        b = min(n, a + syl)
        formants = FORMANTS[rng.integers(len(FORMANTS))]
        for k in range(1, 36):
            f = k * 140.0
            amp = sum(g / (1 + ((f - fc) / (60 + 0.06 * fc)) ** 2) for fc, g in zip(formants, (1.0, 0.6, 0.3))) / k**0.5
            out[a:b] += amp * np.sin(k * phase[a:b])
    env = np.zeros(n)
    for a, b in SPEECH:
        env[int(a * RATE) : int(b * RATE)] = 1
    env *= 0.3 + 0.7 * np.abs(np.sin(np.pi * t / 0.22)) ** 0.7
    env = np.convolve(env, np.ones(480) / 480, "same")
    y = out * env
    return y / np.abs(y).max() * 0.5


def write(path: Path, y: np.ndarray) -> Path:
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    return path


def db(y: np.ndarray, a: float, b: float) -> float:
    seg = y[int(a * RATE) : int(b * RATE)]
    return 20 * np.log10(float(np.sqrt(np.mean(seg**2))) + 1e-12)


def lag(a: np.ndarray, b: np.ndarray, max_s: float = 0.1) -> int:
    """Corrimiento (muestras) de b respecto de a: positivo = b llega tarde."""
    n = min(len(a), len(b))
    corr = np.fft.irfft(np.fft.rfft(b[:n], 2 * n) * np.conj(np.fft.rfft(a[:n], 2 * n)))
    m = int(max_s * RATE)
    window = np.concatenate([corr[: m + 1], corr[-m:]])
    i = int(np.argmax(np.abs(window)))
    return i if i <= m else i - len(window)


def reverberate(y: np.ndarray, t60: float, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(1.2 * RATE)
    tail = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / RATE / t60)
    tail[: int(0.005 * RATE)] = 0
    h = tail / np.sqrt(np.sum(tail**2)) * 0.8
    h[0] = 1.0
    out = np.fft.irfft(np.fft.rfft(y, len(y) + n) * np.fft.rfft(h, len(y) + n))[: len(y)]
    return out / np.abs(out).max() * 0.5


def hum(n: int) -> np.ndarray:
    t = np.arange(n) / RATE
    return 0.01 * np.sin(2 * np.pi * 50 * t) + 0.004 * np.sin(2 * np.pi * 100 * t) + 0.003 * np.sin(2 * np.pi * 150 * t)


@pytest.fixture(scope="module")
def noisy(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, np.ndarray]:
    """Voz + ruido blanco + zumbido de 50 Hz (con armónicos), grabada bajo."""
    work = tmp_path_factory.mktemp("estudio")
    clean = vowels()
    rng = np.random.default_rng(5)
    x = (clean + rng.standard_normal(len(clean)) * 0.02 + hum(len(clean))) * 0.5
    return write(work / "toma.wav", x), clean


@pytest.fixture(scope="module")
def hiss() -> np.ndarray:
    """Voz + ruido blanco, sin zumbido (lo que ve el modelo)."""
    clean = vowels()
    return ((clean + np.random.default_rng(5).standard_normal(len(clean)) * 0.02) * 0.5).astype(np.float32)


# ─── Sin modelo ────────────────────────────────────────────────────────────


def test_erb_bands_match_the_model() -> None:
    bands = studio.erb_bands()
    assert len(bands) == studio.NB_ERB
    assert bands.sum() == studio.N_FFT // 2 + 1
    assert bands.min() >= 2 and list(bands[:13]) == [2] * 13


def test_stft_round_trip_is_exact_and_aligned() -> None:
    x = np.random.default_rng(0).standard_normal(RATE * 3 + 123).astype(np.float32) * 0.1
    ola = studio.OverlapAdd(len(x))
    ola.add(0, studio.stft_frames(x, 0, studio.n_frames(len(x))))
    assert np.max(np.abs(ola.result() - x)) < 1e-5


def test_stft_by_chunks_equals_whole() -> None:
    x = np.random.default_rng(1).standard_normal(RATE).astype(np.float32)
    total = studio.n_frames(len(x))
    whole = studio.stft_frames(x, 0, total)
    parts = np.concatenate([studio.stft_frames(x, a, min(total, a + 17)) for a in range(0, total, 17)])
    assert np.allclose(whole, parts, atol=1e-6)


def test_level_of() -> None:
    assert studio.level_of("soft") == "soft"
    assert studio.level_of("strong") == "strong"
    assert studio.level_of(None) == "off"
    assert studio.level_of("ultra") == "off"


def test_float_wav_round_trip(tmp_path: Path) -> None:
    x = (np.random.default_rng(2).standard_normal(RATE // 2) * 0.3).astype(np.float32)
    studio.write_wav(tmp_path / "a.wav", x)
    assert np.array_equal(studio.read_audio(tmp_path / "a.wav"), x)


def test_chain_latency_is_measured_and_compensated() -> None:
    # afftdn agrega retraso (25 ms en ffmpeg 6.1); el ecualizador no.
    assert render.chain_latency(("afftdn=nr=10:nf=-30:tn=1",)) > 0
    assert render.chain_latency(("equalizer=f=4000:t=o:w=1:g=2",)) == 0


@pytest.mark.parametrize("level", ["off", "soft", "strong"])
def test_voice_stays_aligned_with_video(noisy: tuple[Path, np.ndarray], tmp_path: Path, level: str) -> None:
    if level != "off" and not studio.model_available(MODELS):
        pytest.skip("falta el modelo")
    src, _clean = noisy
    out = tmp_path / f"voz-{level}.wav"
    info = render.process_audio(src, out, studio_level=level, models_dir=MODELS)
    x, y = studio.read_audio(src), studio.read_audio(out)
    assert len(y) == len(x)
    # Hasta 5 muestras (0,1 ms): la fase de los filtros de graves, no un corrimiento (antes eran 1440: 30 ms).
    assert abs(lag(x, y)) <= 5, f"la voz se corrió {lag(x, y)} muestras"
    assert info.get("studio", {}).get("applied", level != "off") == (level != "off")
    assert not (tmp_path / f"voz-{level}-estudio.wav").exists()


def test_without_model_falls_back_to_the_usual_chain(noisy: tuple[Path, np.ndarray], tmp_path: Path) -> None:
    out = tmp_path / "voz.wav"
    info = render.process_audio(noisy[0], out, studio_level="soft", models_dir=tmp_path)
    assert info["studio"] == {"level": "soft", "applied": False, "reason": "sin modelo"}
    assert out.exists()


def test_preview_window_prefers_the_most_speech() -> None:
    words = [{"start": s, "end": s + 0.3} for s in (1.0, 1.4, 30.0, 30.4, 30.8, 31.2, 31.6, 32.0)]
    start, length = audio_preview.pick_window(words, 60.0)
    assert length == 10.0 and 20.0 < start <= 30.0
    assert audio_preview.pick_window(words, 6.0) == (0.0, 6.0)
    assert audio_preview.pick_window([{"start": 55.0, "end": 59.5}], 60.0) == (50.0, 10.0)


# ─── Con el modelo ─────────────────────────────────────────────────────────


@needs_model
def test_denoise_removes_noise_and_keeps_the_voice(hiss: np.ndarray) -> None:
    x = hiss
    y = studio.denoise(x, MODELS)
    assert len(y) == len(x)
    voice_in, voice_out = db(x, 4.0, 5.0), db(y, 4.0, 5.0)
    floor_in, floor_out = db(x, 2.8, 3.3), db(y, 2.8, 3.3)
    assert abs(voice_out - voice_in) < 3.0, (voice_in, voice_out)
    assert floor_out < floor_in - 25, (floor_in, floor_out)
    assert abs(lag(x, y)) <= 1
    # Determinista.
    assert np.array_equal(y, studio.denoise(x, MODELS))


@needs_model
def test_chunks_do_not_change_the_result(hiss: np.ndarray, monkeypatch: pytest.MonkeyPatch) -> None:
    x = hiss
    whole = studio.denoise(x, MODELS)
    # Tramos de 4 s con 6 s de contexto (en producción, 45 s y 15 s): las uniones no se notan.
    monkeypatch.setattr(studio, "CHUNK_FRAMES", 400)
    monkeypatch.setattr(studio, "CONTEXT_FRAMES", 600)
    chunked = studio.denoise(x, MODELS)
    err = 10 * np.log10(np.sum((chunked - whole) ** 2) / np.sum(whole**2))
    assert err < -25, err


@needs_model
def test_attenuation_limit_keeps_some_room(hiss: np.ndarray) -> None:
    x = hiss
    soft = studio.denoise(x, MODELS, atten_db=28)
    full = studio.denoise(x, MODELS)
    # Suave deja el ruido unos 28 dB más bajo, no lo borra: suena natural.
    assert db(soft, 2.8, 3.3) > db(full, 2.8, 3.3) + 6
    assert db(soft, 2.8, 3.3) < db(x, 2.8, 3.3) - 20


@needs_model
def test_strong_cleans_more_than_soft(noisy: tuple[Path, np.ndarray], tmp_path: Path) -> None:
    floors = {}
    for level in ("off", "soft", "strong"):
        out = tmp_path / f"{level}.wav"
        render.process_audio(noisy[0], out, studio_level=level, models_dir=MODELS)
        y = studio.read_audio(out)
        floors[level] = db(y, 2.8, 3.3) - db(y, 4.0, 5.0)
    assert floors["strong"] < floors["soft"] < floors["off"] - 10, floors


def test_hum_is_detected_only_when_present(noisy: tuple[Path, np.ndarray], hiss: np.ndarray) -> None:
    assert studio.detect_hum(studio.read_audio(noisy[0]))[:3] == [50.0, 100.0, 150.0]
    assert studio.detect_hum(hiss) == []
    t = np.arange(RATE * 5) / RATE
    assert studio.detect_hum((hiss[: RATE * 5] + 0.01 * np.sin(2 * np.pi * 60 * t)).astype(np.float32))[:1] == [60.0]


@needs_model
def test_hum_is_removed(noisy: tuple[Path, np.ndarray], tmp_path: Path) -> None:
    out = tmp_path / "voz.wav"
    info = render.process_audio(noisy[0], out, studio_level="soft", models_dir=MODELS)
    assert info["studio"]["hum"][:3] == [50.0, 100.0, 150.0]
    y = studio.read_audio(out)
    pause = y[int(2.8 * RATE) : int(3.3 * RATE)]
    spec = np.abs(np.fft.rfft(pause * np.hanning(len(pause))))
    freqs = np.fft.rfftfreq(len(pause), 1 / RATE)
    at = lambda f: 20 * np.log10(spec[np.argmin(np.abs(freqs - f))] + 1e-12)  # noqa: E731
    voice = 20 * np.log10(np.abs(np.fft.rfft(y[int(4 * RATE) : int(4.5 * RATE)])).max())
    assert at(50) < voice - 50 and at(100) < voice - 45, (at(50), at(100), voice)


def bursts(seed: int) -> np.ndarray:
    """Sílabas de 180 ms con cortes secos de 120 ms: los finales de palabra que usa la estimación del eco."""
    y = vowels(seed=seed)
    t = np.arange(len(y)) / RATE
    gate = ((t % 0.3) < 0.18).astype(float)
    gate = np.convolve(gate, np.ones(240) / 240, "same")
    return (y * gate).astype(np.float32)


@needs_model
def test_reverb_estimate_follows_the_room() -> None:
    clean = bursts(4)
    dry = studio.estimate_t60(studio.denoise(clean.astype(np.float32), MODELS))
    wet = studio.estimate_t60(studio.denoise(reverberate(clean, 0.8).astype(np.float32), MODELS))
    assert dry is not None and wet is not None
    assert wet > dry


def test_dereverb_shortens_the_tail() -> None:
    clean = vowels(seed=6)
    wet = reverberate(clean, 0.8).astype(np.float32)
    out = studio.dereverb(wet, 0.8, -14.0)
    # Energía en la cola (300 ms después de cada tramo de voz) respecto de la voz.
    tail = lambda y: np.mean([db(y, b + 0.05, b + 0.35) for _a, b in SPEECH[:-1]]) - db(y, 4.0, 5.0)  # noqa: E731
    assert tail(out) < tail(wet) - 4
    assert abs(lag(wet, out)) <= 1
