"""Genera los efectos de sonido del editor de forma procedural (sin grabaciones de terceros: no hay licencia que cuidar).

    python scripts/make_sfx.py [carpeta ...]   (por defecto: worker/assets/sfx y public/sfx del repo)

Son 40 (la lista y sus nombres en español están en lib/video/sfx-library.ts). Los tres de siempre:

- whoosh: ruido blanco por un pasabanda que barre de 350 Hz a 3,8 kHz y baja, con envolvente que sube y cae.
- pop: senoidal corta que cae de 900 a 480 Hz (decaimiento de 30 ms) con un clic de 2 ms de ruido agudo.
- riser: barrido exponencial de 180 a 1 400 Hz (dos osciladores levemente desafinados) más ruido que se abre,
  con volumen que crece hasta el final (termina justo en el corte).

Los archivos son WAV mono de 48 kHz y 16 bits, deterministas (semilla fija): correr el script dos veces da los mismos
bytes. Cada uno queda con su ventana de 100 ms más fuerte a -12 dBFS RMS y el pico por debajo de -1 dBFS (el
whoosh, que es muy picudo, queda en -14,5 por ese tope), así las ganancias de la mezcla (lib/video/sfx.ts)
significan casi lo mismo para los tres. Se usan en el render (worker) y en la
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


# ─── Biblioteca ampliada (síntesis simple: senos, ruido filtrado, envolventes y Karplus-Strong) ─────────────


def _t(dur: float) -> np.ndarray:
    return np.arange(int(dur * RATE)) / RATE


def _sweep(f0: float, f1: float, dur: float, curve: str = "exp") -> np.ndarray:
    t = _t(dur)
    freq = f0 * (f1 / f0) ** (t / dur) if curve == "exp" else f0 + (f1 - f0) * t / dur
    return 2 * np.pi * np.cumsum(freq) / RATE


def _lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Pasabajos de un polo (rápido: en bloque con la fórmula recursiva vectorizada por tramos)."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    prev = 0.0
    for i in range(len(x)):
        prev = (1 - a) * x[i] + a * prev
        y[i] = prev
    return y


def _highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - _lowpass(x, cutoff)


def _env(dur: float, attack: float, decay: float) -> np.ndarray:
    t = _t(dur)
    return np.minimum(1.0, t / max(attack, 1e-4)) * np.exp(-np.maximum(0.0, t - attack) / decay)


def _fade(y: np.ndarray, ms: float = 3.0) -> np.ndarray:
    n = min(len(y) // 2, int(ms / 1000 * RATE))
    if n > 1:
        y[:n] *= np.linspace(0, 1, n)
        y[-n:] *= np.linspace(1, 0, n)
    return y


def _place(total: float, parts: list[tuple[float, np.ndarray]]) -> np.ndarray:
    out = np.zeros(int(total * RATE))
    for at, y in parts:
        i = int(at * RATE)
        n = min(len(y), len(out) - i)
        if n > 0:
            out[i : i + n] += y[:n]
    return out


def _bell(freq: float, dur: float, decay: float = 0.35, partials=((1, 1.0), (2.76, 0.45), (5.4, 0.25), (8.93, 0.12))) -> np.ndarray:
    t = _t(dur)
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / (decay / (1 + r * 0.35))) for r, a in partials)
    return _fade(y * np.minimum(1, t / 0.002), 2)


def _pluck(freq: float, dur: float, rng: np.random.Generator, damp: float = 0.996) -> np.ndarray:
    """Cuerda pulsada (Karplus-Strong)."""
    n = int(dur * RATE)
    period = max(2, int(RATE / freq))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    for i in range(n):
        j = i % period
        out[i] = buf[j]
        buf[j] = damp * 0.5 * (buf[j] + buf[(j + 1) % period])
    return out


def _reverb_tail(y: np.ndarray, rng: np.random.Generator, length: float = 0.4, mix: float = 0.25) -> np.ndarray:
    ir = rng.standard_normal(int(length * RATE)) * np.exp(-_t(length) / (length / 5))
    wet = np.convolve(y, ir)[: len(y) + len(ir) // 2]
    wet = wet / (np.abs(wet).max() + 1e-9) * np.abs(y).max()
    out = np.zeros(len(wet))
    out[: len(y)] += y
    return out + wet * mix


def bandsweep(rng: np.random.Generator, dur: float, f0: float, f1: float, q: float, peak: float, tail: float) -> np.ndarray:
    n = int(dur * RATE)
    t = _t(dur)
    pk = peak * dur
    sweep = np.where(t < pk, f0 * (f1 / f0) ** (t / pk), f1 * (f0 / f1) ** ((t - pk) / max(1e-3, dur - pk)) )
    y = _biquad_bandpass(rng.standard_normal(n), np.clip(sweep, 60, 18000), q)
    env = np.where(t < pk, (t / pk) ** 2, np.exp(-(t - pk) / tail))
    return y * env


def more_sounds() -> dict[str, np.ndarray]:
    g = np.random.default_rng
    s: dict[str, np.ndarray] = {}
    # Transiciones
    s["whoosh_soft"] = bandsweep(g(21), 0.8, 250, 2000, 1.2, 0.55, 0.12)
    s["swipe"] = bandsweep(g(22), 0.32, 600, 6500, 2.0, 0.5, 0.05)
    t = _t(0.38)
    sw = _biquad_bandpass(g(23).standard_normal(len(t)), 400 * (7000 / 400) ** (t / 0.38), 1.8)
    s["swipe_up"] = _fade(sw * (t / 0.38) ** 1.6, 8)
    s["swish"] = bandsweep(g(24), 0.26, 7500, 2200, 1.4, 0.12, 0.06)
    t = _t(0.75)
    s["air"] = _lowpass(g(25).standard_normal(len(t)), 1400) * np.sin(np.pi * t / 0.75) ** 2
    t = _t(1.2)
    tone = np.sin(_sweep(120, 1800, 1.2)) * 0.5 + np.sin(_sweep(121, 1810, 1.2) * 1.5) * 0.3
    noise = _biquad_bandpass(g(26).standard_normal(len(t)), 500 * (8000 / 500) ** (t / 1.2), 0.8)
    s["riser_long"] = _fade((tone * 0.6 + noise) * (t / 1.2) ** 3, 15)
    t = _t(1.1)
    s["downlifter"] = _fade((np.sin(_sweep(1400, 90, 1.1)) * 0.5 + _biquad_bandpass(g(27).standard_normal(len(t)), 6000 * (300 / 6000) ** (t / 1.1), 0.8)) * np.exp(-t / 0.4), 5)
    hit = _lowpass(g(28).standard_normal(int(0.8 * RATE)), 2500) * np.exp(-_t(0.8) / 0.12) + np.sin(_sweep(160, 50, 0.8)) * np.exp(-_t(0.8) / 0.18)
    s["reverse_hit"] = _fade(hit[::-1].copy(), 4)
    # Golpes
    t = _t(0.8)
    s["impact"] = _reverb_tail(np.sin(_sweep(110, 38, 0.8)) * np.exp(-t / 0.22) + _lowpass(g(31).standard_normal(len(t)), 1800) * np.exp(-t / 0.05) * 0.8, g(32), 0.35, 0.2)[: int(1.0 * RATE)]
    t = _t(1.2)
    s["boom"] = _fade(np.sin(_sweep(70, 28, 1.2)) * np.exp(-t / 0.45) + _lowpass(g(33).standard_normal(len(t)), 300) * np.exp(-t / 0.35) * 2.5, 20)
    t = _t(0.25)
    s["thud"] = _fade(np.sin(_sweep(130, 55, 0.25)) * np.exp(-t / 0.06) + _lowpass(g(34).standard_normal(len(t)), 900) * np.exp(-t / 0.015) * 0.6, 3)
    t = _t(0.32)
    click = np.zeros(len(t))
    click[: int(0.003 * RATE)] = g(35).standard_normal(int(0.003 * RATE)) * 0.6
    s["punch"] = _fade(np.sin(_sweep(190, 60, 0.32)) * np.exp(-t / 0.07) + _biquad_bandpass(g(36).standard_normal(len(t)), np.full(len(t), 1800.0), 1.2) * np.exp(-t / 0.03) * 1.5 + click, 3)
    t = _t(0.7)
    metal = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((523, 0.3), (1187, 0.25), (1871, 0.2), (2633, 0.15))) * np.exp(-t / 0.18)
    s["slam"] = _fade(_lowpass(g(37).standard_normal(len(t)), 5000) * np.exp(-t / 0.06) + np.sin(_sweep(95, 45, 0.7)) * np.exp(-t / 0.15) + metal * 0.5, 4)
    t = _t(1.2)
    s["sub_drop"] = _fade(np.sin(_sweep(130, 28, 1.2)) * np.exp(-t / 0.5) * np.minimum(1, t / 0.01), 20)
    # Interfaz
    t = _t(0.1)
    s["pop_soft"] = _fade(np.sin(2 * np.pi * np.cumsum(350 + 260 * np.exp(-t / 0.01)) / RATE) * np.exp(-t / 0.028), 2)
    clk = np.zeros(int(0.03 * RATE))
    clk[0], clk[int(0.004 * RATE)] = 1.0, -0.6
    s["click"] = _highpass(np.convolve(clk, np.exp(-_t(0.004) / 0.0007) * np.sin(2 * np.pi * 3200 * _t(0.004)))[: len(clk)], 800)
    t = _t(0.09)
    s["tap"] = _fade(np.sin(2 * np.pi * 1150 * t) * np.exp(-t / 0.012) + _highpass(g(41).standard_normal(len(t)), 2000) * np.exp(-t / 0.004) * 0.4, 1)
    s["ding"] = _bell(1318.5, 1.2, 0.5)
    s["ding_double"] = _place(1.0, [(0.0, _bell(1568, 0.9, 0.3) * 0.8), (0.13, _bell(1318.5, 0.85, 0.35))])
    notes = [1046.5, 1318.5, 1568.0]
    s["notification"] = _place(0.7, [(i * 0.07, _bell(f, 0.55, 0.12, ((1, 1.0), (4.0, 0.3), (9.2, 0.08)))) for i, f in enumerate(notes)])
    s["success"] = _place(1.1, [(i * 0.08, _bell(f, 0.9, 0.3)) for i, f in enumerate([523.3, 659.3, 784.0, 1046.5])])
    t = _t(0.22)
    buzz = lambda f: np.sign(np.sin(2 * np.pi * f * t)) * np.exp(-t / 0.12)  # noqa: E731
    s["error"] = _lowpass(_place(0.5, [(0.0, buzz(220) * 0.6), (0.22, buzz(165) * 0.6)]), 1800)
    rr = g(42)
    keys = []
    at = 0.02
    for _ in range(9):
        k = np.zeros(int(0.03 * RATE))
        k[0] = 1
        tk = _t(0.03)
        keys.append((at, _highpass(np.convolve(k, np.sin(2 * np.pi * rr.uniform(2400, 3600) * tk) * np.exp(-tk / 0.003))[: len(k)] + rr.standard_normal(len(k)) * np.exp(-tk / 0.002) * 0.3, 700) * rr.uniform(0.6, 1)))
        at += rr.uniform(0.06, 0.12)
    s["typing"] = _place(at + 0.05, keys)
    t = _t(0.02)
    sclick = lambda f: np.sin(2 * np.pi * f * t) * np.exp(-t / 0.003)  # noqa: E731
    s["switch"] = _place(0.08, [(0.0, sclick(2600)), (0.04, sclick(1900) * 0.8)])
    t = _t(0.14)
    s["bubble"] = _fade(np.sin(_sweep(280, 950, 0.14)) * np.sin(np.pi * t / 0.14) ** 0.5 * np.exp(-t / 0.08), 2)
    # Efectos
    rr = g(51)
    t = _t(0.5)
    gl = np.zeros(len(t))
    i = 0
    while i < len(t):
        n = int(rr.uniform(0.01, 0.05) * RATE)
        kind = rr.integers(0, 3)
        seg = t[: min(n, len(t) - i)]
        if kind == 0:
            gl[i : i + len(seg)] = np.round(rr.standard_normal(len(seg)) * 2) / 4
        elif kind == 1:
            gl[i : i + len(seg)] = np.sign(np.sin(2 * np.pi * rr.uniform(200, 2000) * seg)) * 0.5
        i += n
    s["glitch"] = _fade(gl, 4)
    s["glitch_soft"] = _fade(np.repeat(_lowpass(g(52).standard_normal(int(0.3 * RATE) // 40), 6000), 40)[: int(0.3 * RATE)] * np.exp(-_t(0.3) / 0.12), 4)
    parts = []
    rr = g(53)
    for k in range(7):
        tb = _t(0.035)
        parts.append((k * 0.05, np.sign(np.sin(2 * np.pi * rr.choice([880, 1320, 1760, 2640]) * tb)) * 0.4 * np.exp(-tb / 0.03)))
    s["digital"] = _lowpass(_place(0.42, parts), 7000)
    t = _t(0.06)
    shut = lambda seed: _biquad_bandpass(g(seed).standard_normal(len(t)), np.full(len(t), 3500.0), 2.0) * np.exp(-t / 0.012)  # noqa: E731
    s["camera"] = _place(0.32, [(0.0, shut(54)), (0.11, shut(55) * 0.8), (0.0, _lowpass(g(56).standard_normal(int(0.16 * RATE)), 900) * 0.25)])
    rr = g(57)
    s["shimmer"] = _place(1.2, [(rr.uniform(0, 0.5), _bell(rr.uniform(2500, 6000), 0.7, 0.25) * 0.3) for _ in range(14)])
    s["sparkle"] = _place(0.7, [(i * 0.05, _bell(f, 0.4, 0.12) * 0.6) for i, f in enumerate([2093, 2637, 3136, 3951, 4186])])
    rr = g(58)
    penta = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5, 1568.0]
    s["magic"] = _place(1.1, [(i * 0.055, _pluck(f, 0.6, rr, 0.995) * 0.5) for i, f in enumerate(penta)])
    t1 = _t(0.08)
    t2 = _t(0.3)
    sq = lambda f, t: np.sign(np.sin(2 * np.pi * f * t)) * 0.35  # noqa: E731
    s["coin"] = _lowpass(_place(0.38, [(0.0, sq(988, t1)), (0.08, sq(1319, t2) * np.exp(-t2 / 0.12))]), 9000)
    rr = g(59)
    jingle = [(0.12 + rr.uniform(0, 0.25), _bell(rr.uniform(3000, 5000), 0.3, 0.05) * 0.25) for _ in range(8)]
    s["cash"] = _place(1.0, [(0.0, shut(60) * 0.6), (0.05, _bell(2093, 0.9, 0.35) * 0.9), (0.05, _bell(2637, 0.9, 0.3) * 0.5), *jingle])
    t = _t(0.18)
    beat = lambda: np.sin(_sweep(70, 45, 0.18)) * np.exp(-t / 0.05)  # noqa: E731
    s["heartbeat"] = _lowpass(_place(0.75, [(0.0, beat()), (0.22, beat() * 0.7)]), 400)
    t = _t(0.05)
    s["tick"] = _fade(_biquad_bandpass(g(61).standard_normal(len(t)), np.full(len(t), 4200.0), 6.0) * np.exp(-t / 0.006), 1)
    t = _t(0.5)
    wob = 900 * (1 + 0.8 * np.sin(2 * np.pi * 5 * t) * np.exp(-t / 0.3))
    s["record_scratch"] = _fade(_biquad_bandpass(g(62).standard_normal(len(t)), np.clip(wob, 150, 8000), 3.0) * np.sin(np.pi * t / 0.5) ** 0.7, 4)
    return s


# ─── Cine y anunciador (más cuerpo: capas, saturación y una sala con reverberación) ──────────────────────────


def _reverb(y: np.ndarray, seconds: float, mix: float, seed: int, bright: float = 4000.0) -> np.ndarray:
    """Reverberación por convolución con una respuesta sintética (ruido que decae, más oscuro al final)."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 6.9 / seconds)
    ir = _lowpass_fast(ir, bright)
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9
    size = 1 << int(np.ceil(np.log2(len(y) + n)))
    wet = np.fft.irfft(np.fft.rfft(y, size) * np.fft.rfft(ir, size), size)[: len(y) + n]
    out = np.zeros(len(y) + n)
    out[: len(y)] += y * (1 - mix)
    out += wet * mix * 0.6
    return out


def _lowpass_fast(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Pasabajos por FFT (suave, sin bucles): para capas largas."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    spec *= 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


def _bandpass_fast(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    spec *= (1 / np.sqrt(1 + (f / hi) ** 4)) * (1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4))
    return np.fft.irfft(spec, len(x))


def _sat(x: np.ndarray, drive: float) -> np.ndarray:
    return np.tanh(x * drive) / np.tanh(drive)


def _saw(phase: np.ndarray, harmonics: int = 24) -> np.ndarray:
    return sum(np.sin(phase * k) / k for k in range(1, harmonics + 1))


def cinematic_sounds() -> dict[str, np.ndarray]:
    """Efectos de cine (tráiler, golpes con sala, risers largos, vidrio, espada, gore, cinta) para reels."""
    s: dict[str, np.ndarray] = {}
    g = np.random.default_rng

    # Braam de tráiler: metales graves desafinados, saturados y con sala.
    t = _t(2.4)
    env = np.minimum(1, t / 0.08) * np.exp(-np.maximum(0, t - 0.35) / 0.7)
    ph = 2 * np.pi * 55 * t
    body = sum(_saw(ph * d, 30) for d in (1.0, 1.006, 0.994, 2.003))
    body = _lowpass_fast(_sat(body * 0.5, 2.5), 900) * env
    s["braam"] = _reverb(body, 2.0, 0.35, 101)[: int(3.5 * RATE)]

    # Golpe de tráiler: sub que cae, ruido de impacto, capa metálica y sala grande.
    t = _t(0.9)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t / 0.05)) / RATE) * np.exp(-t / 0.45)
    crack = _bandpass_fast(g(102).standard_normal(len(t)), 200, 6000) * np.exp(-t / 0.03)
    metal = sum(np.sin(2 * np.pi * f * t) for f in (311, 467, 739, 1153)) * np.exp(-t / 0.25) * 0.15
    s["trailer_hit"] = _reverb(_sat(sub * 1.2 + crack * 0.8 + metal, 1.6), 2.6, 0.4, 103)[: int(3.5 * RATE)]

    # Explosión: ruido grave que se abre y se apaga lento, con sub y ráfagas.
    t = _t(2.5)
    n = g(104).standard_normal(len(t))
    boomy = _lowpass_fast(n, 700) * np.exp(-t / 0.6) * 1.6 + _bandpass_fast(n, 800, 5000) * np.exp(-t / 0.08) * 0.6
    sub = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-t / 0.1)) / RATE) * np.exp(-t / 0.8)
    s["explosion"] = _reverb(_sat(boomy + sub, 1.8), 1.8, 0.25, 105)[: int(3.5 * RATE)]

    # Trueno: grieta aguda y retumbe largo.
    t = _t(3.2)
    n = g(106).standard_normal(len(t))
    rumble = _lowpass_fast(n, 220) * (np.exp(-t / 1.2) * (1 + 0.6 * np.sin(2 * np.pi * 3.1 * t))) * 2.5
    crack = _bandpass_fast(n, 1500, 9000) * np.exp(-t / 0.04)
    s["thunder"] = _reverb(rumble + crack * 0.7, 2.5, 0.3, 107)[: int(4.0 * RATE)]

    # Espada: silbido muy rápido y el filo que vibra.
    t = _t(0.7)
    sweep = 2500 * (9000 / 2500) ** np.minimum(1, t / 0.12)
    swish = _biquad_bandpass(g(108).standard_normal(len(t)), sweep, 3.0) * np.exp(-((t - 0.06) / 0.05) ** 2)
    ring = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((2793, 0.5), (4410, 0.3), (6890, 0.2))) * np.where(t > 0.08, np.exp(-(t - 0.08) / 0.18), 0)
    s["sword"] = _reverb(swish * 1.4 + ring * 0.35, 0.8, 0.2, 109)

    # Vidrio que se rompe: golpe y muchos tintineos al azar.
    t = _t(1.6)
    rng = g(110)
    y = _bandpass_fast(rng.standard_normal(len(t)), 2000, 12000) * np.exp(-t / 0.02) * 1.5
    for _ in range(70):
        st = rng.uniform(0.0, 0.7) ** 1.7
        f = rng.uniform(2500, 9500)
        i0 = int(st * RATE)
        tt = t[: len(t) - i0]
        y[i0:] += np.sin(2 * np.pi * f * tt) * np.exp(-tt / rng.uniform(0.03, 0.15)) * rng.uniform(0.05, 0.25)
    s["glass_break"] = _reverb(y, 1.2, 0.25, 111)[: int(2.2 * RATE)]

    # Hueso que cruje.
    t = _t(0.5)
    rng = g(112)
    y = np.zeros(len(t))
    for _ in range(9):
        i0 = int(rng.uniform(0, 0.12) * RATE)
        burst = _bandpass_fast(rng.standard_normal(len(t) - i0), 800, 5000) * np.exp(-t[: len(t) - i0] / 0.006)
        y[i0:] += burst * rng.uniform(0.4, 1.0)
    y += np.sin(2 * np.pi * 140 * t) * np.exp(-t / 0.04) * 0.6
    s["bone_crack"] = y

    # Gore: golpe húmedo con salpicadura.
    t = _t(0.9)
    rng = g(113)
    thump = np.sin(2 * np.pi * np.cumsum(70 + 120 * np.exp(-t / 0.02)) / RATE) * np.exp(-t / 0.12)
    wet = _bandpass_fast(rng.standard_normal(len(t)), 300, 3500) * np.exp(-t / 0.09) * (1 + 0.8 * np.sin(2 * np.pi * 23 * t))
    drops = np.zeros(len(t))
    for _ in range(14):
        i0 = int(rng.uniform(0.08, 0.6) * RATE)
        tt = t[: len(t) - i0]
        drops[i0:] += np.sin(2 * np.pi * rng.uniform(500, 1400) * tt * (1 + 2 * tt)) * np.exp(-tt / 0.02) * 0.25
    s["splat"] = _sat(thump * 1.2 + wet * 0.9 + drops, 1.4)

    # Riser de Shepard (sube sin parar) de 3 s, termina en el golpe.
    t = _t(3.0)
    y = np.zeros(len(t))
    for k in range(6):
        pos = (k / 6 + t / 3.0) % 1.0
        f = 80 * 2 ** (pos * 6)
        amp = np.sin(np.pi * pos) ** 2
        y += np.sin(2 * np.pi * np.cumsum(f) / RATE) * amp
    noise = _biquad_bandpass(g(114).standard_normal(len(t)), 500 * (8000 / 500) ** (t / 3.0), 1.0)
    y = (y * 0.5 + noise * 0.6) * (t / 3.0) ** 2
    s["riser_epic"] = y

    # Platillo al revés (succión hacia el golpe).
    t = _t(1.5)
    cym = _bandpass_fast(g(115).standard_normal(len(t)), 3000, 14000) * np.exp(-t / 0.5)
    cym += sum(np.sin(2 * np.pi * f * t) for f in (3150, 4780, 6230)) * np.exp(-t / 0.4) * 0.05
    s["reverse_cymbal"] = cym[::-1].copy()

    # Cinta que se frena (todo baja y se apaga).
    t = _t(0.9)
    speed = np.maximum(0.02, 1 - (t / 0.9) ** 0.8)
    f = np.array([220, 277, 330, 440])
    y = sum(np.sin(2 * np.pi * np.cumsum(ff * speed) / RATE) for ff in f) * speed
    s["tape_stop"] = _lowpass_fast(y, 2500) * 0.6

    # Bajo 808 que cae.
    t = _t(1.4)
    y = np.sin(2 * np.pi * np.cumsum(45 + 140 * np.exp(-t / 0.03)) / RATE) * np.exp(-t / 0.6)
    s["bass_808"] = _sat(y, 2.2)

    # Whoosh en cámara lenta (grave y largo).
    t = _t(1.6)
    sweep = 150 * (1300 / 150) ** np.sin(np.pi * t / 1.6)
    y = _biquad_bandpass(g(116).standard_normal(len(t)), sweep, 2.2) * np.sin(np.pi * t / 1.6) ** 2
    s["whoosh_slowmo"] = _reverb(y, 1.0, 0.25, 117)[: int(2.2 * RATE)]

    # Doble whoosh (pasa y vuelve).
    a = whoosh(g(118))
    b = whoosh(g(119))
    y = np.zeros(int(0.9 * RATE))
    y[: len(a)] += a
    y[int(0.28 * RATE) : int(0.28 * RATE) + len(b)] += b[: len(y) - int(0.28 * RATE)] * 0.8
    s["whoosh_double"] = y

    # Latido rápido (tensión).
    t = _t(1.6)
    y = np.zeros(len(t))
    for k in range(4):
        for off, amp in ((0.0, 1.0), (0.14, 0.6)):
            i0 = int((k * 0.4 + off) * RATE)
            tt = t[: len(t) - i0]
            y[i0:] += np.sin(2 * np.pi * 55 * tt) * np.exp(-tt / 0.07) * amp
    s["heartbeat_fast"] = _lowpass_fast(y, 300) * 1.4

    # Reloj (tic tac).
    t = _t(2.0)
    y = np.zeros(len(t))
    for k in range(4):
        i0 = int(k * 0.5 * RATE)
        tt = t[: len(t) - i0]
        f = 3200 if k % 2 == 0 else 2600
        y[i0:] += _bandpass_fast(g(120 + k).standard_normal(len(tt)), f * 0.8, f * 1.2) * np.exp(-tt / 0.008)
    s["clock"] = y

    # Láser.
    t = _t(0.45)
    y = np.sin(_sweep(2400, 300, 0.45)) * np.exp(-t / 0.15) + np.sin(_sweep(2410, 305, 0.45)) * np.exp(-t / 0.15) * 0.7
    s["laser"] = y

    # Potencia arriba y abajo.
    t = _t(0.9)
    s["power_up"] = (np.sin(_sweep(200, 1600, 0.9)) + 0.5 * np.sin(_sweep(300, 2400, 0.9))) * (t / 0.9) ** 1.5 * np.exp(-np.maximum(0, t - 0.85) / 0.02)
    s["power_down"] = (np.sin(_sweep(1600, 120, 0.9)) + 0.5 * np.sin(_sweep(2400, 180, 0.9))) * (1 - t / 0.9) ** 0.7

    # Flash de cámara (carga y disparo).
    t = _t(1.0)
    whine = np.concatenate([np.sin(_sweep(1200, 9000, 0.8)), np.zeros(len(t) - int(0.8 * RATE))]) * np.minimum(1, t / 0.8) * 0.25
    shot = _bandpass_fast(g(124).standard_normal(len(t)), 1000, 8000) * np.where(t > 0.8, np.exp(-(t - 0.8) / 0.02), 0) * 1.4
    s["camera_flash"] = whine * (t < 0.8) + shot

    # Disco que se frena.
    t = _t(0.8)
    speed = np.maximum(0.01, 1 - t / 0.8)
    y = _biquad_bandpass(g(125).standard_normal(len(t)), np.clip(1500 * speed, 80, 8000), 4.0) + np.sin(2 * np.pi * np.cumsum(330 * speed) / RATE) * 0.6 * speed
    s["vinyl_stop"] = y

    # Golpe de bombo de estadio con sala (para cifras).
    t = _t(0.6)
    kick = np.sin(2 * np.pi * np.cumsum(50 + 150 * np.exp(-t / 0.015)) / RATE) * np.exp(-t / 0.18)
    s["stadium_kick"] = _reverb(_sat(kick, 1.8), 1.6, 0.35, 126)[: int(2.0 * RATE)]

    # Campanazo épico (gong).
    t = _t(3.0)
    y = sum(np.sin(2 * np.pi * f * t + np.sin(2 * np.pi * 0.7 * t) * 0.3) * a * np.exp(-t / d) for f, a, d in ((98, 1.0, 1.6), (147.7, 0.6, 1.2), (231, 0.45, 0.9), (389, 0.3, 0.6), (612, 0.2, 0.4)))
    y += _bandpass_fast(g(127).standard_normal(len(t)), 300, 3000) * np.exp(-t / 0.05) * 0.4
    s["gong"] = y

    # Glitch largo (digital que se rompe).
    t = _t(0.9)
    rng = g(128)
    y = np.zeros(len(t))
    i = 0
    while i < len(t):
        seg = int(rng.uniform(0.01, 0.06) * RATE)
        kind = rng.integers(0, 3)
        tt = np.arange(min(seg, len(t) - i)) / RATE
        if kind == 0:
            y[i : i + len(tt)] = np.sign(np.sin(2 * np.pi * rng.uniform(200, 3000) * tt)) * 0.5
        elif kind == 1:
            y[i : i + len(tt)] = rng.standard_normal(len(tt)) * 0.5
        i += len(tt) + int(rng.uniform(0, 0.02) * RATE)
    s["glitch_long"] = y

    # Silbido de bomba que cae (antes del impacto).
    t = _t(1.4)
    s["falling"] = np.sin(_sweep(2200, 500, 1.4)) * np.minimum(1, t / 0.2) * 0.7

    return s


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
    out = {
        "whoosh": normalize(whoosh(np.random.default_rng(7))),
        "pop": normalize(pop(np.random.default_rng(11))),
        "riser": normalize(riser(np.random.default_rng(13))),
    }
    for name, y in more_sounds().items():
        out[name] = normalize(np.asarray(y, dtype=np.float64)[: int(1.2 * RATE)])
    # Los de cine pueden durar más (colas de sala, risers largos): hasta 4 s, con fundido al final.
    for name, y in cinematic_sounds().items():
        y = np.asarray(y, dtype=np.float64)[: int(4.0 * RATE)]
        tail = min(len(y), int(0.05 * RATE))
        y[-tail:] *= np.linspace(1, 0, tail)
        out[name] = normalize(y)
    return out


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
