"""Video de prueba para los efectos con recorte: una persona real (foto) sobre un fondo con textura, con movimiento leve.

    python scripts/make_fx_video.py /tmp/fx                      # astronauta (foto de la NASA, dominio público)
    python scripts/make_fx_video.py /tmp/fx --subject foto.jpg --alpha alfa.png --seconds 6

Deja `fx-1080x1920.mp4` (H.264 con ruido y compresión de teléfono, 30 fps, con un tono de voz sintético para que el
editor tenga audio), `alpha/` con la máscara exacta de cada cuadro (PNG en 8 bits; la verdad para medir el recorte) y
`transcript.json` (palabras cada ~0,4 s, para WORKER_TEST_TRANSCRIPT).

La persona se balancea (corrimiento, giro y escala que "respira"), el fondo se mueve lento (paneo), la luz cambia un
poco y cada cuadro lleva ruido de sensor: lo que hace parpadear a un recorte cuadro a cuadro.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "tests" / "fixtures"

WORDS = (
    "Hoy te muestro cómo crecer tu cuenta en treinta días. Primero define tu cliente ideal. Segundo publica todos los días. "
    "Tercero mide lo que funciona. Mi revista personal tiene tres titulares: constancia, foco y datos. "
    "Así pasé de mil a diez mil seguidores. Escala tu marca con este sistema. Comenta la palabra SISTEMA y te lo mando."
).split()


def background(w: int, h: int, seed: int = 7) -> np.ndarray:
    """Pared de una habitación: degradado cálido, estantes con libros, una planta y textura fina (sin nada de terceros)."""
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    base = np.zeros((h, w, 3), np.float32)
    base[..., 0] = 70 + 40 * (1 - y) + 10 * x  # B
    base[..., 1] = 95 + 45 * (1 - y) + 5 * x  # G
    base[..., 2] = 120 + 50 * (1 - y)  # R
    img = base.astype(np.uint8)
    for k in range(3):
        sy = int(h * (0.18 + k * 0.2))
        cv2.rectangle(img, (int(w * 0.05), sy), (int(w * 0.95), sy + int(h * 0.012)), (40, 55, 70), -1)
        xpos = int(w * 0.07)
        while xpos < w * 0.92:
            bw = int(rng.integers(w // 90, w // 40))
            bh = int(rng.integers(h // 22, h // 12))
            color = tuple(int(c) for c in rng.integers(30, 200, 3))
            cv2.rectangle(img, (xpos, sy - bh), (xpos + bw, sy), color, -1)
            cv2.line(img, (xpos, sy - bh), (xpos, sy), (20, 20, 20), 1)
            xpos += bw + int(rng.integers(1, w // 200 + 2))
            if rng.random() < 0.08:
                xpos += int(w * 0.06)
    for _ in range(60):
        c = (int(w * 0.85 + rng.normal(0, w * 0.04)), int(h * 0.62 + rng.normal(0, h * 0.06)))
        cv2.ellipse(img, c, (int(w * 0.03), int(h * 0.012)), float(rng.uniform(0, 180)), 0, 360, (40, int(rng.integers(90, 150)), 50), -1)
    noise = rng.normal(0, 6, (h, w, 1)).astype(np.float32)
    img = np.clip(img.astype(np.float32) + cv2.GaussianBlur(noise, (0, 0), 1.2)[..., None], 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(img, (0, 0), 1.6)


def frames(subject: np.ndarray, alpha: np.ndarray, size: tuple[int, int], seconds: float, fps: int = 30, seed: int = 3):
    """Genera (cuadro BGR, alfa 0..1) por cuadro."""
    W, H = size
    rng = np.random.default_rng(seed)
    bg = background(int(W * 1.25), int(H * 1.1))
    # La persona ocupa ~78 % del alto, abajo al centro (encuadre de talking head).
    scale = H * 0.78 / subject.shape[0]
    sw, sh = int(subject.shape[1] * scale), int(subject.shape[0] * scale)
    subj = cv2.resize(subject, (sw, sh), interpolation=cv2.INTER_CUBIC)
    alp = cv2.resize(alpha, (sw, sh), interpolation=cv2.INTER_LINEAR)
    n = int(round(seconds * fps))
    for i in range(n):
        t = i / fps
        # Fondo: paneo lento.
        ox = int((bg.shape[1] - W) * (0.5 + 0.45 * math.sin(t * 0.35)))
        oy = int((bg.shape[0] - H) * (0.5 + 0.4 * math.sin(t * 0.21 + 1)))
        frame = bg[oy : oy + H, ox : ox + W].astype(np.float32)
        # Persona: balanceo, giro y "respiración".
        dx = 26 * math.sin(t * 1.3) + 8 * math.sin(t * 3.1)
        dy = 10 * math.sin(t * 0.9 + 0.5)
        ang = 1.6 * math.sin(t * 1.1)
        sc = 1 + 0.012 * math.sin(t * 1.7)
        cx, cy = W / 2 + dx, H - sh / 2 + 12 + dy
        M = cv2.getRotationMatrix2D((sw / 2, sh / 2), ang, sc)
        M[0, 2] += cx - sw / 2
        M[1, 2] += cy - sh / 2
        layer = cv2.warpAffine(subj, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        a = cv2.warpAffine(alp, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        light = 1 + 0.04 * math.sin(t * 0.8)
        out = (frame * (1 - a[..., None]) + layer.astype(np.float32) * a[..., None]) * light
        out += rng.normal(0, 3.0, out.shape).astype(np.float32)
        yield np.clip(out, 0, 255).astype(np.uint8), a


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("out", type=Path)
    p.add_argument("--subject", type=Path, default=FIXTURES / "astronaut.jpg")
    p.add_argument("--alpha", type=Path, default=FIXTURES / "astronaut-alpha.png")
    p.add_argument("--seconds", type=float, default=float(len(WORDS)) * 0.42 + 1)
    p.add_argument("--size", default="1080x1920")
    p.add_argument("--no-alpha", action="store_true", help="No guarda las máscaras de cada cuadro.")
    args = p.parse_args()
    W, H = (int(v) for v in args.size.split("x"))
    args.out.mkdir(parents=True, exist_ok=True)
    subject = cv2.imread(str(args.subject))
    alpha = cv2.imread(str(args.alpha), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0
    if alpha.shape != subject.shape[:2]:
        alpha = cv2.resize(alpha, (subject.shape[1], subject.shape[0]))
    adir = args.out / "alpha"
    if not args.no_alpha:
        adir.mkdir(exist_ok=True)
    video = args.out / f"fx-{W}x{H}.mp4"
    fps = 30
    n = int(round(args.seconds * fps))
    ff = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
            "-f", "lavfi", "-i", f"sine=frequency=180:sample_rate=48000:duration={args.seconds:.3f},volume=0.4,tremolo=f=2.4:d=0.8",
            "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-shortest", str(video),
        ],
        stdin=subprocess.PIPE,
    )
    assert ff.stdin
    for i, (frame, a) in enumerate(frames(subject, alpha, (W, H), args.seconds, fps)):
        ff.stdin.write(frame.tobytes())
        if not args.no_alpha:
            cv2.imwrite(str(adir / f"{i:05d}.png"), (a * 255).astype(np.uint8))
    ff.stdin.close()
    if ff.wait() != 0:
        raise SystemExit("ffmpeg falló")
    words = []
    t = 0.5
    for i, w in enumerate(WORDS):
        d = 0.24 + 0.02 * len(w)
        words.append({"text": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d + (0.25 if w.endswith(".") else 0.1)
    (args.out / "transcript.json").write_text(json.dumps({"language": "es", "words": words}, ensure_ascii=False), encoding="utf-8")
    print(f"{video} ({n} cuadros)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
