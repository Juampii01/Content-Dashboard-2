"""Medios sintéticos para medir la sincronía del render sin mirar el video.

- **Imagen**: cada mitad del cuadro es de un color parejo (en YUV); la izquierda lleva el número de cuadro del original
  módulo 360 y la derecha el resto y una suma de control, así un cuadro tapado o teñido por un gráfico no se lee como otro número.
  Un color parejo sobrevive a los zooms (el recorte de un color parejo es el mismo color) y al reencuadre.
- **Audio**: una "voz" sintética (pulsos con armónicos y formantes, con su entonación) en cada palabra del caso y
  silencio entre palabras: tiene forma (sílabas y pausas), así la correlación encuentra exactamente dónde está cada
  pedazo. El audio de estudio la trata como voz.

`decode_video` devuelve, para cada cuadro del MP4 final, el cuadro del original que se ve (o -1 si no se puede leer) y
`expected_frames` el que tendría que verse según el timeline.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import numpy as np

FPS = 30
SR = 48000
# Código por mitad del cuadro, en YUV (lo que guarda el video, sin pasar por RGB): 10 niveles de luma y 6 de cada
# croma, separados de sobra para los redondeos de escalar, superponer y comprimir.
Y_LEVELS = [36 + 20 * i for i in range(10)]
C_LEVELS = [68 + 24 * i for i in range(6)]
PER_HALF = len(Y_LEVELS) * len(C_LEVELS) ** 2  # 360
TOL = 8
DECODE_W, DECODE_H = 36, 64


def _yuv(code: int) -> tuple[int, int, int]:
    y, rest = divmod(code, len(C_LEVELS) ** 2)
    u, v = divmod(rest, len(C_LEVELS))
    return Y_LEVELS[y], C_LEVELS[u], C_LEVELS[v]


def halves(n: int) -> tuple[int, int]:
    """Izquierda: n módulo 360. Derecha: n // 360 (hasta 6, 84 s) y una suma de control."""
    return n % PER_HALF, (n // PER_HALF) * 50 + (n * 7 + 3) % 50


def from_halves(left: int, right: int) -> int | None:
    n = (right // 50) * PER_HALF + left
    return n if (n * 7 + 3) % 50 == right % 50 else None


def _nearest(levels: list[int], value: float) -> int | None:
    i = min(range(len(levels)), key=lambda k: abs(levels[k] - value))
    return i if abs(levels[i] - value) <= TOL else None


def _decode_yuv(px: np.ndarray) -> int | None:
    y, u, v = _nearest(Y_LEVELS, px[0]), _nearest(C_LEVELS, px[1]), _nearest(C_LEVELS, px[2])
    if y is None or u is None or v is None:
        return None
    return (y * len(C_LEVELS) + u) * len(C_LEVELS) + v


def make_video(path: Path, frames: int, size: tuple[int, int] = (1080, 1920)) -> None:
    """Video H.264 sin audio con el código de cada cuadro (se genera chico, en YUV, y se agranda sin interpolar)."""
    w, h = 8, 8
    buf = bytearray()
    for n in range(frames):
        cl, cr = (_yuv(c) for c in halves(n))
        for plane in range(3):
            row = bytes([cl[plane]]) * (w // 2) + bytes([cr[plane]]) * (w // 2)
            buf += row * h
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "yuv444p", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
            "-vf", f"scale={size[0]}:{size[1]}:flags=neighbor,format=yuv420p",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-g", "30",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            str(path),
        ],
        input=bytes(buf),
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr.decode()[-500:]


def speech(words: list[dict[str, Any]], seconds: float, seed: int = 7) -> np.ndarray:
    """Voz sintética: cada palabra con su tono, su vocal y su ataque; silencio (con un piso de ruido) entre palabras."""
    rng = np.random.default_rng(seed)
    n = int(round(seconds * SR))
    y = (rng.standard_normal(n) * 10 ** (-62 / 20)).astype(np.float64)
    for w in words:
        a, b = int(round(w["start"] * SR)), min(n, int(round(w["end"] * SR)))
        if b - a < 64:
            continue
        t = np.arange(b - a) / SR
        dur = (b - a) / SR
        f0 = 105 + 70 * rng.random() + np.linspace(0, rng.uniform(-25, 25), b - a)
        phase = 2 * np.pi * np.cumsum(f0) / SR
        f1, f2 = rng.uniform(350, 800), rng.uniform(900, 2200)
        sig = np.zeros(b - a)
        for k in range(1, 30):
            fk = k * f0.mean()
            if fk > 4500:
                break
            gain = np.exp(-(((fk - f1) / 180) ** 2)) + 0.6 * np.exp(-(((fk - f2) / 260) ** 2)) + 0.05
            sig += gain * np.sin(k * phase) / k**0.3
        sig /= np.max(np.abs(sig)) + 1e-9
        # Envolvente de sílaba: ataque, una o dos sílabas y caída.
        syll = 1 + int(dur > 0.22)
        env = np.clip(np.minimum(t / 0.015, (dur - t) / 0.03), 0, 1) * (0.65 + 0.35 * np.abs(np.sin(np.pi * syll * t / dur)))
        burst = np.zeros(b - a)
        m = min(b - a, int(0.02 * SR))
        burst[:m] = rng.standard_normal(m) * 0.25 * np.linspace(1, 0, m)
        y[a:b] += 0.22 * rng.uniform(0.7, 1.0) * sig * env + burst
    return y.astype(np.float32)


def write_wav(path: Path, y: np.ndarray) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "pcm_s16le", str(path)],
        input=np.asarray(y, dtype="<f4").tobytes(),
        check=True,
    )


def make_source(path: Path, words: list[dict[str, Any]], seconds: float, work: Path) -> None:
    """El "original del teléfono": video con el código por cuadro y la voz sintética en AAC, en un MP4."""
    frames = int(round(seconds * FPS))
    video, audio = work / "src-video.mp4", work / "src-audio.wav"
    make_video(video, frames)
    write_wav(audio, speech(words, seconds))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(audio), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(path)], check=True)


def make_music(path: Path, seconds: float = 20.0) -> None:
    """Una pista de música de fondo (acordes con pulso) para el ducking."""
    t = np.arange(int(seconds * SR)) / SR
    y = np.zeros_like(t)
    for f in (110.0, 164.8, 220.0, 277.2):
        y += np.sin(2 * np.pi * f * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 2 * t) ** 2)
    write_wav(path, (0.08 * y / 4).astype(np.float32))


def make_stock(path: Path, seconds: float = 8.0) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=1920x1080:rate=30:duration={seconds}", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)], check=True)


# ─── Lectura ────────────────────────────────────────────────────────────────


def decode_video(path: Path) -> np.ndarray:
    """Cuadro del original que se ve en cada cuadro del MP4 (-1 si no se puede leer: gráfico, efecto, b-roll)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"scale={DECODE_W}:{DECODE_H}:flags=area,format=yuv444p", "-f", "rawvideo", "-"],
        capture_output=True,
        check=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3, DECODE_H, DECODE_W).transpose(0, 2, 3, 1).astype(np.int16)
    out = np.full(len(frames), -1, dtype=np.int64)
    # Puntos de lectura: arriba del centro (los subtítulos van abajo), a cada lado del medio (los zooms recortan
    # centrado, así cada punto se queda en su mitad).
    ys = [int(DECODE_H * f) for f in (0.24, 0.32, 0.4, 0.48)]
    xl = [int(DECODE_W * f) for f in (0.22, 0.3)]
    xr = [int(DECODE_W * f) for f in (0.7, 0.78)]
    for i, fr in enumerate(frames):
        lefts = {_decode_yuv(fr[y, x]) for y in ys for x in xl}
        rights = {_decode_yuv(fr[y, x]) for y in ys for x in xr}
        if len(lefts) != 1 or len(rights) != 1:
            continue
        (a,), (b,) = lefts, rights
        n = from_halves(a, b) if a is not None and b is not None else None
        if n is not None:
            out[i] = n
    return out


def expected_frames(clips: list[dict[str, Any]]) -> np.ndarray:
    return np.concatenate([np.arange(int(c["start"]), int(c["end"])) for c in clips])


def video_report(path: Path, clips: list[dict[str, Any]]) -> dict[str, Any]:
    got = decode_video(path)
    want = expected_frames(clips)
    n = min(len(got), len(want))
    read = got[:n] >= 0
    diff = got[:n] - want[:n]
    bad = np.nonzero(read & (diff != 0))[0]
    return {
        "frames": len(got),
        "expected": len(want),
        "read": int(read.sum()),
        "wrong": int(len(bad)),
        "first_wrong": [(int(i), int(want[i]), int(got[i])) for i in bad[:8]],
        "max_off_frames": int(np.abs(diff[read]).max()) if read.any() else 0,
    }
