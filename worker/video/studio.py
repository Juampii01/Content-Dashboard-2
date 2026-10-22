"""Audio de estudio: que una toma con el teléfono en una habitación con eco y ruido suene limpia.

1. **Ruido** con DeepFilterNet3 (Schröter et al., MIT/Apache-2.0), un modelo que corre en CPU. Usamos sus tres
   redes ONNX (`enc`, `erb_dec`, `df_dec`) con onnxruntime (ya viene en la imagen por la transcripción) sobre la
   secuencia entera, por tramos de 45 s con 15 s de contexto, y reproducimos en numpy el procesado de señal de libDF
   (STFT de 960 con ventana de Vorbis, bandas ERB, normalizaciones exponenciales, máscara por banda y filtro profundo
   de orden 5). La salida es la misma que la del binario oficial `deep-filter -D` (diferencia por debajo de -55 dB)
   y unas 12 veces más rápida que ese binario en CPU, porque ONNX procesa todos los cuadros juntos.
   DeepFilterNet3 se entrenó también con reverberación: además del ruido, recorta parte de la cola de eco.
2. **Eco** (reverberación tardía): supresión espectral con el modelo estadístico de Lebart/Habets (la cola es la
   energía de hace 50 ms que cayó según el tiempo de reverberación de la sala), en el mismo STFT. El tiempo de
   reverberación se estima a ciegas con la velocidad de caída de la energía al final de las palabras: en una sala,
   la energía no puede bajar más rápido que la cola. En una sala seca (estimación < 0,17 s) no se toca nada.

Lo que hay que saber:
- Sin retraso: la salida queda alineada muestra a muestra con la entrada (la STFT y el lookahead se compensan).
- Determinista: la misma entrada da la misma salida.
- La ecualización, el de-esser y la compresión van después, en la cadena de ffmpeg (`render.voice_chain`).
"""

from __future__ import annotations

import logging
import os
import struct
import subprocess
import threading
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger("worker.studio")

SR = 48000
N_FFT = 960
HOP = 480
NB_ERB = 32
NB_DF = 96
DF_ORDER = 5
DF_LOOKAHEAD = 2
CONV_LOOKAHEAD = 2
NORM_ALPHA = 0.99  # libDF: exp(-hop / (sr · tau)) con tau = 1 s, redondeado a 3 decimales.
MODEL_DIR = "deepfilternet3"
MODEL_FILES = ("enc.onnx", "erb_dec.onnx", "df_dec.onnx")
VERSION = 1  # Cambia si cambia el procesado (invalida las muestras guardadas).

LEVELS = ("off", "soft", "strong")

# Por nivel: atenuación máxima del ruido (dB; la voz original se mezcla por debajo de ese nivel, así no suena
# "procesado") y cuánto eco se quita (factor sobre el tiempo de reverberación estimado y ganancia mínima).
PRESETS: dict[str, dict[str, float]] = {
    "soft": {"atten_db": 28.0, "reverb_factor": 1.0, "reverb_floor_db": -8.0},
    "strong": {"atten_db": 100.0, "reverb_factor": 1.8, "reverb_floor_db": -14.0},
}
DRY_ROOM_T60 = 0.17  # Por debajo, la sala se considera seca: no se aplica la supresión de eco.
CHUNK_FRAMES = 4500  # 45 s
CONTEXT_FRAMES = 1500  # 15 s de contexto antes de cada tramo: las redes recurrentes arrancan con historia (diferencia con el audio entero de una vez: -41 dB).


def level_of(value: Any) -> str:
    return value if value in LEVELS else "off"


def model_available(models_dir: Path) -> bool:
    return all((models_dir / MODEL_DIR / f).exists() for f in MODEL_FILES)


# ─── STFT de libDF ─────────────────────────────────────────────────────────


def erb_bands(sr: int = SR, n_fft: int = N_FFT, nb_bands: int = NB_ERB, min_nb_freqs: int = 2) -> np.ndarray:
    """Ancho (en bins) de cada banda ERB, igual que `erb_fb` de libDF."""
    freq2erb = lambda f: 9.265 * np.log1p(f / (24.7 * 9.265))  # noqa: E731
    erb2freq = lambda e: 24.7 * 9.265 * (np.exp(e / 9.265) - 1)  # noqa: E731
    low, high = freq2erb(0.0), freq2erb(sr / 2)
    step = (high - low) / nb_bands
    width = sr / n_fft
    out: list[int] = []
    prev = over = 0
    for i in range(1, nb_bands + 1):
        fb = int(round(erb2freq(low + i * step) / width))
        n = fb - prev - over
        if n < min_nb_freqs:
            over = min_nb_freqs - n
            n = min_nb_freqs
        else:
            over = 0
        out.append(n)
        prev = fb
    out[-1] += 1
    extra = sum(out) - (n_fft // 2 + 1)
    if extra > 0:
        out[-1] -= extra
    return np.array(out, dtype=np.int64)


WINDOW = np.sin(0.5 * np.pi * np.sin(0.5 * np.pi * (np.arange(N_FFT) + 0.5) / (N_FFT // 2)) ** 2).astype(np.float32)


def n_frames(n_samples: int) -> int:
    return (n_samples + HOP - 1) // HOP + 1


def stft_frames(x: np.ndarray, start: int, stop: int) -> np.ndarray:
    """Cuadros [start, stop) del STFT de libDF. El cuadro t cubre las muestras [(t-1)·hop, (t+1)·hop) (con ceros fuera
    de la señal) y se normaliza por N_FFT (wnorm de libDF)."""
    start, stop = max(0, start), max(start, stop)
    lo = (start - 1) * HOP
    hi = (stop + 1) * HOP
    seg = np.zeros(hi - lo, dtype=np.float32)
    a, b = max(0, lo), min(len(x), hi)
    if b > a:
        seg[a - lo : b - lo] = x[a:b]
    idx = np.arange(stop - start)[:, None] * HOP + np.arange(N_FFT)[None]
    return (np.fft.rfft(seg[idx] * WINDOW, axis=1) / N_FFT).astype(np.complex64)


class OverlapAdd:
    """Síntesis de libDF (ventana de Vorbis, solapamiento del 50 %) con el retraso de N_FFT − hop compensado: la
    muestra n de la salida corresponde a la muestra n de la entrada."""

    def __init__(self, n_samples: int) -> None:
        self.n = n_samples
        self.buf = np.zeros(n_frames(n_samples) * HOP + N_FFT, dtype=np.float32)

    def add(self, start: int, spec: np.ndarray) -> None:
        frames = (np.fft.irfft(spec.astype(np.complex128) * N_FFT, n=N_FFT, axis=1) * WINDOW).astype(np.float32)
        for k, fr in enumerate(frames):
            # El cuadro t empieza en la muestra (t-1)·hop; el búfer está corrido un hop (índice = muestra + hop).
            pos = (start + k) * HOP
            self.buf[pos : pos + N_FFT] += fr

    def result(self) -> np.ndarray:
        return self.buf[HOP : HOP + self.n].copy()


def _ema(seq: np.ndarray, state: np.ndarray, alpha: float) -> tuple[np.ndarray, np.ndarray]:
    out = np.empty_like(seq)
    s = state.copy()
    for t in range(len(seq)):
        s = seq[t] * (1 - alpha) + s * alpha
        out[t] = s
    return out, s


# ─── DeepFilterNet3 ────────────────────────────────────────────────────────

_sessions: dict[str, tuple[Any, Any, Any]] = {}
_lock = threading.Lock()


def _load(models_dir: Path) -> tuple[Any, Any, Any]:
    key = str(models_dir)
    with _lock:
        if key not in _sessions:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
            opts.inter_op_num_threads = 1
            opts.log_severity_level = 3
            d = models_dir / MODEL_DIR
            _sessions[key] = tuple(ort.InferenceSession(str(d / f), opts, providers=["CPUExecutionProvider"]) for f in MODEL_FILES)  # type: ignore[assignment]
        return _sessions[key]


def denoise(x: np.ndarray, models_dir: Path, atten_db: float = 100.0) -> np.ndarray:
    """Reducción de ruido con DeepFilterNet3. `x`: float32 a 48 kHz mono. Devuelve el mismo largo, alineado."""
    enc, erb_dec, df_dec = _load(models_dir)
    bands = erb_bands()
    edges = np.concatenate([[0], np.cumsum(bands)])
    total = n_frames(len(x))

    # 1. Características de todo el audio (las normalizaciones exponenciales arrastran su estado de cuadro a cuadro).
    f_erb = np.empty((total, NB_ERB), dtype=np.float32)
    f_spec = np.empty((total, NB_DF), dtype=np.complex64)
    erb_state = np.linspace(-60.0, -90.0, NB_ERB).astype(np.float32)
    unit_state = np.linspace(0.001, 0.0001, NB_DF).astype(np.float32)
    for a in range(0, total, CHUNK_FRAMES):
        b = min(total, a + CHUNK_FRAMES)
        X = stft_frames(x, a, b)
        power = X.real**2 + X.imag**2
        erb = np.add.reduceat(power, edges[:-1], axis=1) / bands
        erb_db = (10 * np.log10(erb + 1e-10)).astype(np.float32)
        mean, erb_state = _ema(erb_db, erb_state, NORM_ALPHA)
        f_erb[a:b] = (erb_db - mean) / 40
        spec = X[:, :NB_DF]
        unit, unit_state = _ema(np.abs(spec).astype(np.float32), unit_state, NORM_ALPHA)
        f_spec[a:b] = spec / np.sqrt(unit)
    # Lookahead de las convoluciones: en el cuadro t el modelo ve hasta t + 2.
    f_erb = np.concatenate([f_erb[CONV_LOOKAHEAD:], np.zeros((CONV_LOOKAHEAD, NB_ERB), np.float32)])
    f_spec = np.concatenate([f_spec[CONV_LOOKAHEAD:], np.zeros((CONV_LOOKAHEAD, NB_DF), np.complex64)])

    # 2. Redes por tramos con contexto, y 3. máscara ERB + filtro profundo + síntesis.
    ola = OverlapAdd(len(x))
    lim = 10 ** (-max(0.0, atten_db) / 20) if atten_db < 100 else 0.0
    for a in range(0, total, CHUNK_FRAMES):
        b = min(total, a + CHUNK_FRAMES)
        c = max(0, a - CONTEXT_FRAMES)
        fe = f_erb[c:b][None, None]
        fs = np.stack([f_spec[c:b].real, f_spec[c:b].imag])[None].astype(np.float32)
        e0, e1, e2, e3, emb, c0, _lsnr = enc.run(None, {"feat_erb": fe, "feat_spec": fs})
        mask = erb_dec.run(None, {"emb": emb, "e3": e3, "e2": e2, "e1": e1, "e0": e0})[0][0, 0, a - c :]
        coefs = df_dec.run(None, {"emb": emb, "c0": c0})[0][0, a - c :]
        X = stft_frames(x, a - (DF_ORDER - 1 - DF_LOOKAHEAD), b + DF_LOOKAHEAD)
        # stft_frames recorta los índices negativos: rellenamos con ceros al principio si hace falta.
        missing = (DF_ORDER - 1 - DF_LOOKAHEAD) - a
        if missing > 0:
            X = np.concatenate([np.zeros((missing, X.shape[1]), np.complex64), X])
        T = b - a
        cur = X[DF_ORDER - 1 - DF_LOOKAHEAD : DF_ORDER - 1 - DF_LOOKAHEAD + T]
        out = cur * np.repeat(mask, bands, axis=1)
        cf = coefs.reshape(T, NB_DF, DF_ORDER, 2)
        cf = cf[..., 0] + 1j * cf[..., 1]
        df = np.zeros((T, NB_DF), np.complex64)
        for i in range(DF_ORDER):
            df += X[i : i + T, :NB_DF] * cf[:, :, i]
        out[:, :NB_DF] = df
        if lim > 0:
            out = out * (1 - lim) + cur * lim
        ola.add(a, out)
    return ola.result()


# ─── Eco (reverberación tardía) ────────────────────────────────────────────


def estimate_t60(x: np.ndarray, pct: float = 80.0, win: int = 8) -> float | None:
    """Tiempo de reverberación aparente (s) por la velocidad de caída de la energía (300 Hz a 4 kHz) en ventanas de
    80 ms que empiezan cerca del nivel de la voz. None si hay muy poca voz para medir."""
    total = n_frames(len(x))
    energies = []
    for a in range(0, total, CHUNK_FRAMES):
        X = stft_frames(x, a, min(total, a + CHUNK_FRAMES))
        energies.append(10 * np.log10((X.real**2 + X.imag**2)[:, 6:80].mean(1) + 1e-12))
    e = np.concatenate(energies) if energies else np.zeros(0)
    if len(e) < win + 20:
        return None
    ref = np.percentile(e, 95)
    # Piso: lo que queda en los silencios (o 60 dB por debajo de la voz). Una caída que llega al piso cuenta con su
    # pendiente hasta ahí: un final seco en una sala seca da una pendiente enorme, como debe.
    e = np.maximum(e, max(float(np.percentile(e, 5)), ref - 60))
    tt = np.arange(win) * (HOP / SR)
    tt = tt - tt.mean()
    idx = np.arange(len(e) - win)[:, None] + np.arange(win)[None]
    seg = e[idx]
    slope = (seg - seg.mean(1, keepdims=True)) @ tt / (tt @ tt)
    ok = (seg[:, 0] > ref - 15) & (slope < -20)
    rates = -slope[ok]
    if len(rates) < 20:
        return None
    return float(60 / np.percentile(rates, pct))


def dereverb(x: np.ndarray, t60: float, floor_db: float, delay: float = 0.05, smooth: float = 0.5) -> np.ndarray:
    """Supresión de la cola de eco (Lebart/Habets): la reverberación tardía en el cuadro t es la energía suavizada de
    hace `delay` segundos, caída según `t60`; ganancia de Wiener por bin con un piso (`floor_db`) y un suavizado
    leve en frecuencia para que no aparezca ruido musical."""
    total = n_frames(len(x))
    nd = max(1, int(round(delay * SR / HOP)))
    decay = 10 ** (-6 * delay / max(0.05, t60))
    floor = 10 ** (floor_db / 20)
    ola = OverlapAdd(len(x))
    lam_state: np.ndarray | None = None
    history = np.zeros((nd, N_FFT // 2 + 1), dtype=np.float32)  # λ de los últimos nd cuadros
    for a in range(0, total, CHUNK_FRAMES):
        b = min(total, a + CHUNK_FRAMES)
        X = stft_frames(x, a, b)
        P = (X.real**2 + X.imag**2).astype(np.float32)
        if lam_state is None:
            lam_state = P[0].copy()
        lam, lam_state = _ema(P, lam_state, smooth)
        past = np.concatenate([history, lam])[: len(lam)]
        history = np.concatenate([history, lam])[-nd:]
        late = past * decay
        xi = np.maximum(lam - late, 0) / (late + 1e-12)
        g = np.maximum(xi / (1 + xi), floor)
        g[:, 1:-1] = (g[:, :-2] + 2 * g[:, 1:-1] + g[:, 2:]) / 4
        ola.add(a, X * g)
    return ola.result()


# ─── Zumbido de la red eléctrica ───────────────────────────────────────────


def detect_hum(x: np.ndarray, max_harmonics: int = 8) -> list[float]:
    """Frecuencias (Hz) del zumbido de la red (50 o 60 Hz y sus armónicos) si se escucha en los silencios.
    DeepFilterNet no lo quita bien (lo trata como parte de la voz, que también tiene graves). Espectro medio de los
    tramos de 0,5 s más bajos (resolución de 2 Hz): un armónico cuenta si sobresale 10 dB de sus vecinos."""
    seg = SR // 2
    n = len(x) // seg
    if n < 4:
        return []
    blocks = x[: n * seg].reshape(n, seg).astype(np.float64)
    rms = np.sqrt(np.mean(blocks**2, 1))
    quiet = blocks[np.argsort(rms)[: max(2, n * 3 // 10)]]
    spec = np.mean(np.abs(np.fft.rfft(quiet * np.hanning(seg), axis=1)) ** 2, 0)
    freqs = np.fft.rfftfreq(seg, 1 / SR)
    best: list[float] = []
    for base in (50.0, 60.0):
        found = []
        for k in range(1, max_harmonics + 1):
            f = base * k
            near = (freqs > f - 1.5) & (freqs < f + 1.5)
            around = ((freqs > f - 16) & (freqs < f - 4)) | ((freqs > f + 4) & (freqs < f + 16))
            if np.any(near) and np.any(around) and spec[near].max() > 10 * np.median(spec[around]):
                found.append(f)
        # Zumbido: la fundamental o dos de los tres primeros armónicos.
        low = [f for f in found if f <= base * 3]
        if (base in found or len(low) >= 2) and len(found) > len(best):
            best = found
    return best


# ─── Archivos ──────────────────────────────────────────────────────────────


def read_audio(path: Path) -> np.ndarray:
    """Audio como float32, 48 kHz mono (ffmpeg decodifica cualquier formato)."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg no pudo leer el audio: {proc.stderr.decode(errors='replace')[-300:]}")
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32)


def write_wav(path: Path, x: np.ndarray, sr: int = SR) -> None:
    """WAV mono en float de 32 bits (sin pérdida entre etapas; ffmpeg lo lee directo)."""
    data = np.asarray(x, dtype="<f4").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 3, 1, sr, sr * 4, 4, 32)
    header += b"data" + struct.pack("<I", len(data))
    tmp = path.with_name(f"{path.stem}.part{path.suffix}")
    with open(tmp, "wb") as fh:
        fh.write(header)
        fh.write(data)
    os.replace(tmp, path)


def enhance(src: Path, out: Path, level: str, models_dir: Path) -> dict[str, Any]:
    """Quita ruido y eco según el nivel ("soft" o "strong") y deja un WAV float de 48 kHz mono, del mismo largo y
    alineado con `src`. Devuelve lo que midió (para el registro del render)."""
    preset = PRESETS[level]
    x = read_audio(src)
    if len(x) == 0:
        write_wav(out, x)
        return {"level": level, "applied": False}
    hum = detect_hum(x)
    y = denoise(x, models_dir, preset["atten_db"])
    t60 = estimate_t60(y)
    reverb = None
    if t60 is not None and t60 >= DRY_ROOM_T60:
        reverb = round(min(1.2, t60 * preset["reverb_factor"]), 3)
        y = dereverb(y, reverb, preset["reverb_floor_db"])
    # Sin recortes por los filtros (la ganancia final la pone la normalización).
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak > 0.999:
        y = y * (0.999 / peak)
    write_wav(out, y)
    return {"level": level, "applied": True, "t60": round(t60, 3) if t60 is not None else None, "reverb": reverb, "hum": hum, "version": VERSION}


def hum_filters(freqs: list[float]) -> list[str]:
    """Filtros de ffmpeg que quitan el zumbido: un corte angosto (Q 10, -30 dB) por armónico detectado."""
    return [f"equalizer=f={f:g}:t=q:w=10:g=-30" for f in freqs[:8]]
