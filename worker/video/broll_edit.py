"""Edición de cada b-roll (la arma la app en `lib/video/broll-edit.ts`, en píxeles del video final).

Aquí solo se ejecuta lo que llega en el trabajo, con las mismas fórmulas que la vista previa del navegador:

- **Encuadre**: el clip se escala para cubrir su marco por el zoom y se recorta corrido según x/y (`frame_crop`).
- **Look**: una matriz de color 3×4 (filtro, saturación, contraste y brillo) que se escribe como una LUT 3D `.cube`
  y se aplica con `lut3d`. Una LUT de una transformación afín con interpolación trilineal es exacta (salvo donde
  satura), así el color del render es el del filtro SVG `feColorMatrix` de la vista previa.
- **Tarjeta**: máscara de esquinas redondeadas, sombra y borde fino dibujados con Pillow (con sobremuestreo), que
  ffmpeg combina con el clip en una capa con alfa (FFV1 en MKV).
- **Zoom de entrada**: `zoompan` con la misma curva (salida cúbica) que la vista previa.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

FPS = 30
LUT_SIZE = 17

DEFAULT_FRAME = {"x": 0.0, "y": 0.0, "zoom": 1.0}


def even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def frame_crop(src_w: int, src_h: int, box_w: int, box_h: int, frame: dict[str, Any] | None) -> tuple[int, int, int, int]:
    """Tamaño escalado (par) y esquina del recorte del clip en su marco. Igual que `frameCrop` de la app."""
    frame = frame or DEFAULT_FRAME
    w = src_w if src_w > 0 else box_w
    h = src_h if src_h > 0 else box_h
    s = max(box_w / w, box_h / h) * clamp(float(frame.get("zoom", 1)), 1.0, 3.0)
    sw = max(box_w, even(w * s))
    sh = max(box_h, even(h * s))
    cx = (sw - box_w) / 2 * (1 + clamp(float(frame.get("x", 0)), -1, 1))
    cy = (sh - box_h) / 2 * (1 + clamp(float(frame.get("y", 0)), -1, 1))
    return sw, sh, int(round(clamp(cx, 0, sw - box_w))), int(round(clamp(cy, 0, sh - box_h)))


def apply_matrix(m: list[float], rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = rgb
    return tuple(clamp(m[i * 4] * r + m[i * 4 + 1] * g + m[i * 4 + 2] * b + m[i * 4 + 3], 0.0, 1.0) for i in range(3))  # type: ignore[return-value]


def write_cube(matrix: list[float], path: Path, size: int = LUT_SIZE) -> Path:
    """LUT 3D de la matriz (rojo cambia más rápido, como pide el formato .cube)."""
    if len(matrix) != 12:
        raise ValueError("matriz de color inválida")
    lines = ['TITLE "broll"', f"LUT_3D_SIZE {size}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    step = size - 1
    for bi in range(size):
        for gi in range(size):
            for ri in range(size):
                r, g, b = apply_matrix(matrix, (ri / step, gi / step, bi / step))
                lines.append(f"{r:.6f} {g:.6f} {b:.6f}")
    path.write_text("\n".join(lines) + "\n", encoding="ascii")
    return path


def card_pad(card: dict[str, Any]) -> int:
    """Margen alrededor de la tarjeta para que entre la sombra."""
    return even(float(card.get("shadowBlur", 0)) * 1.5 + float(card.get("shadowY", 0)) + 4)


def _rounded(size: tuple[int, int], box: tuple[int, int, int, int], radius: int, *, fill: int | None = None, outline: int | None = None, width: int = 0, scale: int = 4) -> Image.Image:
    """Rectángulo redondeado en escala de grises con bordes suaves (dibujado al cuádruple y reducido)."""
    big = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    d = ImageDraw.Draw(big)
    x0, y0, x1, y1 = (v * scale for v in box)
    d.rounded_rectangle((x0, y0, x1 - 1, y1 - 1), radius=radius * scale, fill=fill, outline=outline, width=width * scale)
    return big.resize(size, Image.Resampling.LANCZOS)


def card_assets(card: dict[str, Any], box_w: int, box_h: int, folder: Path) -> tuple[Path, Path, Path, int]:
    """Máscara (gris, tamaño del clip), sombra y borde (RGBA, tamaño de la capa). Devuelve las rutas y el margen."""
    pad = card_pad(card)
    key = hashlib.sha1(json.dumps([card, box_w, box_h], sort_keys=True).encode()).hexdigest()[:12]
    mask_p, shadow_p, border_p = folder / f"card-{key}-mask.png", folder / f"card-{key}-shadow.png", folder / f"card-{key}-border.png"
    if mask_p.exists() and shadow_p.exists() and border_p.exists():
        return mask_p, shadow_p, border_p, pad
    radius = int(card.get("radius", 0))
    layer = (box_w + pad * 2, box_h + pad * 2)
    _rounded((box_w, box_h), (0, 0, box_w, box_h), radius, fill=255).save(mask_p)
    # Sombra: como `box-shadow: 0 Y B rgba(0,0,0,a)` de CSS (desenfoque gaussiano de desvío B/2).
    sy = int(card.get("shadowY", 0))
    blur = float(card.get("shadowBlur", 0))
    alpha = int(round(255 * float(card.get("shadowAlpha", 0.5))))
    shade = _rounded(layer, (pad, pad + sy, pad + box_w, pad + sy + box_h), radius, fill=alpha, scale=1)
    if blur > 0:
        shade = shade.filter(ImageFilter.GaussianBlur(blur / 2))
    # Como en CSS, la sombra no se pinta debajo de la tarjeta (se nota si el clip es translúcido).
    inside = _rounded(layer, (pad, pad, pad + box_w, pad + box_h), radius, fill=255)
    shade = Image.composite(Image.new("L", layer, 0), shade, inside)
    shadow = Image.new("RGBA", layer, (0, 0, 0, 0))
    shadow.putalpha(shade)
    shadow.save(shadow_p)
    # Borde fino por dentro del clip (como `box-shadow: inset 0 0 0 Npx` sobre la tarjeta).
    bw = int(card.get("border", 0))
    ring = _rounded(layer, (pad, pad, pad + box_w, pad + box_h), radius, outline=int(round(255 * float(card.get("borderAlpha", 0.2)))), width=bw) if bw > 0 else Image.new("L", layer, 0)
    border = Image.new("RGBA", layer, (255, 255, 255, 0))
    border.putalpha(ring)
    border.save(border_p)
    return mask_p, shadow_p, border_p, pad


def edit_key(edit: dict[str, Any] | None) -> str:
    """Hash de lo que cambia el clip preparado (para la caché)."""
    if not edit:
        return "base"
    relevant = {k: edit.get(k) for k in ("layout", "box", "card", "frame", "color", "zoom", "clipStart")}
    return hashlib.sha1(json.dumps(relevant, sort_keys=True).encode()).hexdigest()[:12]


def zoom_filter(zoom: dict[str, Any] | None, box_w: int, box_h: int) -> str | None:
    """Zoom de entrada: escala 1+(from-1)·(1-p)³ con p = t/segundos (t = cuadro/30)."""
    if not zoom:
        return None
    amount = float(zoom.get("from", 1.15)) - 1
    frames = max(1, int(round(float(zoom.get("seconds", 0.5)) * FPS)))
    if amount <= 0:
        return None
    return f"zoompan=z='1+{amount:.4f}*pow(1-min(1,on/{frames}),3)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={box_w}x{box_h}:fps={FPS}"


def ground_hex(color: str | None) -> str:
    c = (color or "").strip().lstrip("#")
    return f"0x{c.upper()}" if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c) else "0x030A22"


def placement(edit: dict[str, Any] | None) -> tuple[int, int]:
    """Dónde se superpone la capa preparada (la tarjeta lleva el margen de la sombra)."""
    if not edit:
        return 0, 0
    box = edit.get("box") or {}
    x, y = int(box.get("x", 0)), int(box.get("y", 0))
    if edit.get("layout") == "card" and edit.get("card"):
        pad = card_pad(edit["card"])
        return x - pad, y - pad
    return x, y


def fade_of(edit: dict[str, Any] | None, duration: float, default: float = 0.2) -> float:
    if not edit:
        return min(default, duration / 4)
    return max(0.0, min(float(edit.get("fade", default)), duration / 4))


def opacity_of(edit: dict[str, Any] | None) -> float:
    return clamp(float((edit or {}).get("opacity", 1)), 0.0, 1.0)


def lut_name(matrix: list[float]) -> str:
    return "lut-" + hashlib.sha1(json.dumps([round(v, 5) for v in matrix]).encode()).hexdigest()[:12] + ".cube"


def is_finite_matrix(matrix: Any) -> bool:
    return isinstance(matrix, list) and len(matrix) == 12 and all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) < 10 for v in matrix)
