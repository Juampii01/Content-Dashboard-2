"""Ajuste de los bordes de cada palabra a la energía real del audio.

Los proveedores de transcripción dan tiempos aproximados (Whisper sobre todo inventa el final de la palabra).
Un corte justo en el borde se come sílabas o deja respiraciones. Aquí se mide la energía en ventanas de 10 ms
y se mueve cada borde hasta donde la voz empieza o termina de verdad, sin pisar a las palabras vecinas.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

FRAME_SEC = 0.01
EXTEND_START = 0.12  # cuánto se puede adelantar el inicio para no comerse el ataque
TRIM_START = 0.10  # cuánto se puede atrasar si el proveedor incluyó silencio antes
EXTEND_END = 0.18  # cuánto se puede estirar el final (colas de sílaba, la "s")
TRIM_END = 0.12
MIN_WORD = 0.04


def load_energy(path: Path) -> tuple[np.ndarray, float]:
    """Energía en dB por ventana de 10 ms y el umbral de voz para este audio."""
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        raw = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError("se espera PCM de 16 bits")
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    hop = max(1, int(rate * FRAME_SEC))
    count = len(samples) // hop
    if count == 0:
        return np.full(1, -100.0), -40.0
    frames = samples[: count * hop].reshape(count, hop)
    rms = np.sqrt(np.mean(frames**2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    return db, threshold_for(db)


def threshold_for(db: np.ndarray) -> float:
    """Umbral relativo al ruido de fondo (percentil 10) y a la voz (percentil 90): sirve con ruido de sala."""
    floor = float(np.percentile(db, 10))
    loud = float(np.percentile(db, 90))
    return max(floor + 6.0, min(loud - 20.0, floor + 12.0), -55.0)


def refine(words: list[dict], db: np.ndarray, threshold: float, duration: float) -> list[dict]:
    """Devuelve copias de las palabras con `start`/`end` ajustados. Nunca se superponen ni cambian de orden."""
    n = len(db)
    voiced = db > threshold

    def idx(t: float) -> int:
        return max(0, min(n - 1, int(round(t / FRAME_SEC))))

    out: list[dict] = []
    for i, word in enumerate(words):
        start = float(word["start"])
        end = max(float(word["end"]), start + MIN_WORD)
        prev_end = out[-1]["end"] if out else 0.0
        next_start = float(words[i + 1]["start"]) if i + 1 < len(words) else duration

        # Inicio: si hay voz justo antes, retroceder hasta donde empieza; si hay silencio al principio, avanzar.
        k = idx(start)
        if voiced[k]:
            lo = idx(max(prev_end, start - EXTEND_START))
            while k > lo and voiced[k - 1]:
                k -= 1
        else:
            hi = idx(min(end - MIN_WORD, start + TRIM_START))
            while k < hi and not voiced[k]:
                k += 1
        new_start = k * FRAME_SEC

        # Final: si sigue habiendo voz, estirar hasta que termina; si ya era silencio, recortar.
        k = idx(end) - 1
        if 0 <= k < n and voiced[k]:
            hi = idx(min(next_start, end + EXTEND_END))
            while k + 1 < hi and voiced[k + 1]:
                k += 1
        else:
            lo = idx(max(new_start + MIN_WORD, end - TRIM_END))
            while k > lo and not voiced[k]:
                k -= 1
        new_end = (k + 1) * FRAME_SEC

        new_start = max(prev_end, min(new_start, start + TRIM_START))
        new_end = min(max(new_end, new_start + MIN_WORD), max(next_start, new_start + MIN_WORD), duration)
        if new_end - new_start < MIN_WORD:
            new_start, new_end = start, end
        out.append({**word, "start": round(new_start, 3), "end": round(new_end, 3)})
    return out
