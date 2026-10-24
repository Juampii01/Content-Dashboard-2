"""Video corto de un slide (CAROUSEL_ANIMATE): el slide ya dibujado con su plantilla, con un movimiento sutil.

En carrusel-creator-pro, `animar` movía partes del slide (oleadas, iconos que saltan) con ajustes escritos a mano para
cada slide. Aquí no hay ajustes a mano: el movimiento es del slide entero y siempre suave, para que el texto se lea.

- zoom:   acercamiento lento (1,00 → 1,045) con entrada y salida suaves.
- deriva: un poco acercado y moviéndose de un lado al otro (vuelve al inicio: sirve en bucle).
- latido: crece y vuelve, como si respirara (cada 2 s; en bucle).

Formatos: 4:5 (1080×1350, el slide tal cual) o 9:16 (1080×1920, el slide al centro sobre su propio fondo difuminado
y oscurecido). Cada cuadro se dibuja con Pillow (transformación afín con interpolación bilineal: el movimiento es
suave aunque sea de medio píxel) y va por un pipe a ffmpeg (H.264, yuv420p, +faststart, sin sonido).
"""

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path
from typing import Callable

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from comunes.errors import JobError

SLIDE_W, SLIDE_H = 1080, 1350
FORMATS = {"4:5": (1080, 1350), "9:16": (1080, 1920)}
MOTIONS = ("zoom", "deriva", "latido")


def _smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def transform_at(motion: str, t: float, seconds: float) -> tuple[float, float, float]:
    """(escala, desplazamiento x, desplazamiento y) del slide en el segundo t."""
    if motion == "zoom":
        return 1.0 + 0.045 * _smooth(t / seconds), 0.0, 0.0
    if motion == "deriva":
        phase = 2 * math.pi * t / seconds
        return 1.04, 16.0 * math.sin(phase), 6.0 * math.sin(2 * phase)
    if motion == "latido":
        return 1.0 + 0.018 * (1 - math.cos(2 * math.pi * t / 2.0)) / 2, 0.0, 0.0
    raise JobError("Ese movimiento no existe.", retry=False, detail=f"movimiento {motion}")


def background(slide: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Fondo para 9:16: el mismo slide cubriendo todo, difuminado y oscurecido (no compite con el slide)."""
    bg = ImageOps.fit(slide, size, Image.Resampling.BICUBIC)
    bg = bg.filter(ImageFilter.GaussianBlur(48))
    return ImageEnhance.Brightness(bg).enhance(0.45)


def frame(slide: Image.Image, bg: Image.Image | None, size: tuple[int, int], scale: float, dx: float, dy: float) -> Image.Image:
    """Un cuadro: el slide escalado y desplazado (con decimales) sobre el lienzo.

    Pillow pide la transformación inversa (lienzo → slide). Con escalas cerca de 1 la interpolación bilineal se ve
    igual que la bicúbica y cuesta la mitad. En 9:16 solo se transforma el rectángulo del slide (bordes hacia adentro,
    se pierde menos de un píxel del borde) y se pega sobre el fondo ya hecho.
    """
    w, h = size
    cx, cy = w / 2 + dx, h / 2 + dy
    sx, sy = slide.width / 2, slide.height / 2
    inv = 1.0 / scale
    if bg is None:
        coeffs = (inv, 0.0, sx - cx * inv, 0.0, inv, sy - cy * inv)
        return slide.transform(size, Image.Transform.AFFINE, coeffs, resample=Image.Resampling.BILINEAR)
    x0, y0 = max(0, math.ceil(cx - sx * scale)), max(0, math.ceil(cy - sy * scale))
    x1, y1 = min(w, math.floor(cx + sx * scale)), min(h, math.floor(cy + sy * scale))
    coeffs = (inv, 0.0, (x0 - cx) * inv + sx, 0.0, inv, (y0 - cy) * inv + sy)
    region = slide.transform((x1 - x0, y1 - y0), Image.Transform.AFFINE, coeffs, resample=Image.Resampling.BILINEAR)
    out = bg.copy()
    out.paste(region, (x0, y0))
    return out


def ffmpeg_bin() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise JobError("Falta ffmpeg en el servicio de procesamiento. Avísale a soporte.", retry=False, detail="ffmpeg no está en el PATH")
    return exe


def render(source: Path, dest: Path, *, motion: str, fmt: str, seconds: float, fps: int = 30, check: Callable[[], None] = lambda: None, progress: Callable[[float], None] = lambda _f: None) -> Path:
    if fmt not in FORMATS:
        raise JobError("Ese formato de video no existe.", retry=False, detail=f"formato {fmt}")
    if motion not in MOTIONS:
        raise JobError("Ese movimiento no existe.", retry=False, detail=f"movimiento {motion}")
    seconds = max(2.0, min(12.0, float(seconds)))
    with Image.open(source) as im:
        slide = ImageOps.exif_transpose(im).convert("RGB")
    if slide.size != (SLIDE_W, SLIDE_H):
        slide = ImageOps.fit(slide, (SLIDE_W, SLIDE_H), Image.Resampling.BICUBIC)
    size = FORMATS[fmt]
    bg = background(slide, size).convert("RGB") if fmt == "9:16" else None
    total = int(round(seconds * fps))
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}", "-r", str(fps), "-i", "-",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
        str(dest),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert proc.stdin is not None
        for i in range(total):
            if i % 10 == 0:
                check()
                progress(i / total)
            scale, dx, dy = transform_at(motion, i / fps, seconds)
            proc.stdin.write(frame(slide, bg, size, scale, dx, dy).tobytes())
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        code = proc.wait(timeout=120)
    except BaseException:
        proc.kill()
        raise
    if code != 0 or not dest.exists() or dest.stat().st_size < 1000:
        raise JobError("No pudimos armar el video del slide. Prueba de nuevo.", retry=True, detail=f"ffmpeg {code}: {err[-200:]}")
    progress(1.0)
    return dest
