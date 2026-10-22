"""Genera los efectos de sonido del editor de forma procedural (sin grabaciones de terceros: no hay licencia que cuidar).

    python scripts/make_sfx.py [carpeta ...]   (por defecto: worker/assets/sfx y public/sfx del repo)

- whoosh: ruido blanco por un pasabanda que barre de 350 Hz a 3,8 kHz y baja, con envolvente que sube y cae.
- pop: senoidal corta que cae de 900 a 480 Hz (decaimiento de 30 ms) con un clic de 2 ms de ruido agudo.
- riser: barrido exponencial de 180 a 1 400 Hz (dos osciladores levemente desafinados) más ruido que se abre,
  con volumen que crece hasta el final (termina justo en el corte).

Los archivos son WAV mono de 48 kHz y 16 bits, deterministas (semilla fija): correr el script dos veces da los mismos
bytes. Cada uno queda con su ventana de 100 ms más fuerte a -12 dBFS RMS (pico por debajo de -1 dBFS), así las
ganancias de la mezcla (lib/video/sfx.ts) significan lo mismo para los tres. Se usan en el render (worker) y en la
vista previa del navegador (public/sfx).
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

RATE = 48000
REF_RMS_DB = -12.0
PEAK_DB = -1.0


def _biquad_bandpass(x: np.ndarray, freqs: np.ndarray, q: float) -> np.ndarray:
    """Pasabanda (RBJ, ganancia constante en el pico) con la frecuencia central cambiando muestra a muestra."""
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        w0 = 2 * np.pi * freqs[i] / RATE
        alpha = np.sin(w0) / (2 * q)
        cos = np.cos(w0)
        a0 = 1 + alpha
        b0, b2 = alpha / a0, -alpha / a0
        a1, a2 = -2 * cos / a0, (1 - alpha) / a0
        out = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, x[i]
        y2, y1 = y1, out
        y[i] = out
    return y


def whoosh(rng: np.random.Generator) -> np.ndarray:
    dur = 0.55
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    noise = rng.standard_normal(n)
    # Sube rápido hasta el 60 % y baja: el "paso" del objeto frente al micrófono.
    peak = 0.6 * dur
    sweep = np.where(t < peak, 350 * (3800 / 350) ** (t / peak), 3800 * (900 / 3800) ** ((t - peak) / (dur - peak)))
    y = _biquad_bandpass(noise, sweep, q=1.6)
    env = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.07))
    return y * env


def pop(rng: np.random.Generator) -> np.ndarray:
    dur = 0.12
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    freq = 480 + 420 * np.exp(-t / 0.012)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    tone = np.sin(phase) * np.exp(-t / 0.03)
    click = np.zeros(n)
    m = int(0.002 * RATE)
    click[:m] = np.diff(rng.standard_normal(m + 1)) * np.linspace(1, 0, m) * 0.35
    y = tone + click
    y[: int(0.0015 * RATE)] *= np.linspace(0, 1, int(0.0015 * RATE))
    return y


def riser(rng: np.random.Generator) -> np.ndarray:
    dur = 1.0
    n = int(dur * RATE)
    t = np.arange(n) / RATE
    freq = 180 * (1400 / 180) ** (t / dur)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    tone = 0.6 * np.sin(phase) + 0.4 * np.sin(phase * 1.007 + 0.5)
    noise = _biquad_bandpass(rng.standard_normal(n), 600 * (6000 / 600) ** (t / dur), q=0.9)
    y = (tone * 0.7 + noise * 0.9) * (t / dur) ** 2.5
    tail = int(0.02 * RATE)
    y[-tail:] *= np.linspace(1, 0, tail)
    return y


def normalize(y: np.ndarray) -> np.ndarray:
    win = int(0.1 * RATE)
    if len(y) <= win:
        rms = np.sqrt(np.mean(y**2))
    else:
        rms = np.sqrt(np.convolve(y**2, np.ones(win) / win, mode="valid").max())
    y = y * (10 ** (REF_RMS_DB / 20) / max(rms, 1e-9))
    peak = np.abs(y).max()
    limit = 10 ** (PEAK_DB / 20)
    if peak > limit:
        y = y * (limit / peak)
    return y


def write(path: Path, y: np.ndarray) -> None:
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())


def build() -> dict[str, np.ndarray]:
    return {
        "whoosh": normalize(whoosh(np.random.default_rng(7))),
        "pop": normalize(pop(np.random.default_rng(11))),
        "riser": normalize(riser(np.random.default_rng(13))),
    }


def main(dirs: list[Path]) -> None:
    sounds = build()
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        for name, y in sounds.items():
            write(d / f"{name}.wav", y)
            print(d / f"{name}.wav", f"{len(y) / RATE:.2f} s")


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent
    targets = [Path(a) for a in sys.argv[1:]] or [here / "assets" / "sfx", here.parent / "public" / "sfx"]
    main(targets)
