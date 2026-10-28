"""Edición de cada b-roll (la arma la app en `lib/video/broll-edit.ts`, en píxeles del video final).

Aquí solo se ejecuta lo que llega en el trabajo, con las mismas fórmulas que la vista previa del navegador:

- **Encuadre**: el clip se escala para cubrir su marco por el zoom y se recorta corrido según x/y (`frame_crop`).
- **Look**: una matriz de color 3×4 (filtro, saturación, contraste y brillo) que se escribe como una LUT 3D `.cube`
  y se aplica con `lut3d`. Una LUT de una transformación afín con interpolación trilineal es exacta (salvo donde
  satura), así el color del render es el del filtro SVG `feColorMatrix` de la vista previa.
- **Tarjeta**: máscara de esquinas redondeadas, sombra y borde fino dibujados con Pillow (con sobremuestreo), que
  ffmpeg combina con el clip en una capa con alfa (FFV1 en MKV).
- **Zoom de entrada**: `zoompan` con la misma curva (salida cúbica) que la vista previa.
- **Fotos con movimiento** (`edit.photo`, solo imágenes de la biblioteca): la foto se encaja en un "cuadro base"
  (recortada como siempre o entera sobre una copia desenfocada con `gblur`) preparado a la resolución de la escala
  máxima del recorrido, y una cámara lo recorre con `perspective` (ver `perspective_filter`). Sin `photo`, la foto
  queda fija como antes.
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
    if edit.get("photo"):
        # Solo si viene (así la caché de los b-roll de antes no cambia).
        relevant["photo"] = edit.get("photo")
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


def fades_of(edit: dict[str, Any] | None, duration: float, default: float = 0.2) -> tuple[float, float]:
    """Fundido de entrada y de salida (s). Un gráfico con animación propia trae los dos (`fadeIn`/`fadeOut`, calculados
    en la app con `animFades` de lib/video/canvas/transform.ts); si no, el mismo `fade` en los dos, como siempre."""
    if edit and ("fadeIn" in edit or "fadeOut" in edit):
        cap = max(0.0, duration) * 0.45
        fi = max(0.0, min(float(edit.get("fadeIn") or 0), cap))
        fo = max(0.0, min(float(edit.get("fadeOut") or 0), cap))
        return fi, fo
    fade = fade_of(edit, duration, default)
    return fade, fade


def ramp_alpha(fade_in: float, fade_out: float, t: float, duration: float) -> float:
    """Opacidad con rampas lineales en el instante t (lo que hace `fade=...:alpha=1`); espejo de `rampAlpha`."""
    a = 1.0
    if fade_in > 0:
        a = min(a, t / fade_in)
    if fade_out > 0:
        a = min(a, (duration - t) / fade_out)
    return clamp(a, 0.0, 1.0)


def opacity_of(edit: dict[str, Any] | None) -> float:
    return clamp(float((edit or {}).get("opacity", 1)), 0.0, 1.0)


def lut_name(matrix: list[float]) -> str:
    return "lut-" + hashlib.sha1(json.dumps([round(v, 5) for v in matrix]).encode()).hexdigest()[:12] + ".cube"


def is_finite_matrix(matrix: Any) -> bool:
    return isinstance(matrix, list) and len(matrix) == 12 and all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) < 10 for v in matrix)


# ─── Fotos con movimiento ─────────────────────────────────────────────────
#
# La app (`photoRender` y `motionPath` de lib/video/broll-edit.ts) manda el encaje, el recorrido de la cámara y el
# desenfoque; aquí se repite la misma cuenta que `motionAt` para que la vista previa y el render coincidan.
#
# Por qué `perspective` y no `zoompan`: zoompan redondea la esquina del recorte a píxeles enteros en cada cuadro, y en
# un acercamiento o un recorrido lento eso se ve como temblor (el corrimiento avanza a saltos de 0 y 1 píxel).
# `perspective` con `eval=frame` toma las cuatro esquinas del recorte como números reales (con precisión de 1/256 de
# píxel) e interpola con cúbica, así la cámara avanza pareja a 30 fps. La foto se prepara antes a la resolución de la
# escala máxima del recorrido: al acercar nunca se agranda una imagen chica (no pierde nitidez).

MOTION_EASES = ("linear", "smooth")
PHOTO_FITS = ("cover", "blur")
DEFAULT_BLUR = {"sigma": 0.05, "overscan": 1.2, "dim": 0.78}
MAX_MOTION_SCALE = 1.5


def _num(raw: dict[str, Any], key: str, default: float) -> float:
    v = raw.get(key)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else default


def _state(raw: Any) -> dict[str, float]:
    raw = raw if isinstance(raw, dict) else {}
    return {"scale": clamp(_num(raw, "scale", 1.0), 1.0, MAX_MOTION_SCALE), "x": clamp(_num(raw, "x", 0.5), 0.0, 1.0), "y": clamp(_num(raw, "y", 0.5), 0.0, 1.0)}


def photo_of(edit: dict[str, Any] | None) -> dict[str, Any] | None:
    """El `photo` de la edición, validado. None si no viene o si es una foto fija recortada (como antes)."""
    raw = (edit or {}).get("photo")
    if not isinstance(raw, dict):
        return None
    fit = raw.get("fit") if raw.get("fit") in PHOTO_FITS else "cover"
    motion = None
    m = raw.get("motion")
    if isinstance(m, dict):
        motion = {"from": _state(m.get("from")), "to": _state(m.get("to")), "ease": m.get("ease") if m.get("ease") in MOTION_EASES else "smooth"}
    b = raw.get("blur") if isinstance(raw.get("blur"), dict) else {}
    blur = {
        "sigma": clamp(_num(b, "sigma", DEFAULT_BLUR["sigma"]), 0.0, 0.2),
        "overscan": clamp(_num(b, "overscan", DEFAULT_BLUR["overscan"]), 1.0, 2.0),
        "dim": clamp(_num(b, "dim", DEFAULT_BLUR["dim"]), 0.2, 1.0),
    }
    if fit == "cover" and motion is None:
        return None
    return {"fit": fit, "motion": motion, "blur": blur}


def motion_ease(ease: str, p: float) -> float:
    q = clamp(p, 0.0, 1.0)
    return (1 - math.cos(math.pi * q)) / 2 if ease == "smooth" else q


def motion_at(path: dict[str, Any], t: float) -> dict[str, float]:
    """Espejo de `motionAt`: escala geométrica, centro en línea recta y sin dejar ver fuera de la foto."""
    e = motion_ease(path["ease"], t)
    a, b = path["from"], path["to"]
    scale = max(1.0, a["scale"] * (b["scale"] / a["scale"]) ** e)
    half = 0.5 / scale
    x = clamp(a["x"] + (b["x"] - a["x"]) * e, half, 1 - half)
    y = clamp(a["y"] + (b["y"] - a["y"]) * e, half, 1 - half)
    return {"scale": scale, "x": x, "y": y}


def motion_max_scale(path: dict[str, Any] | None) -> float:
    return max(1.0, path["from"]["scale"], path["to"]["scale"]) if path else 1.0


def photo_canvas_size(box_w: int, box_h: int, photo: dict[str, Any]) -> tuple[int, int]:
    """Tamaño del cuadro base preparado: el marco por la escala máxima del recorrido (pares)."""
    q = motion_max_scale(photo.get("motion"))
    return even(box_w * q), even(box_h * q)


def contain_size(src_w: int, src_h: int, box_w: int, box_h: int) -> tuple[int, int]:
    """La foto entera dentro del marco (pares). Igual que `containSize` de la app."""
    if src_w <= 0 or src_h <= 0:
        return box_w, box_h
    s = min(box_w / src_w, box_h / src_h)
    return min(box_w, even(src_w * s)), min(box_h, even(src_h * s))


def photo_canvas_graph(src_w: int, src_h: int, cw: int, ch: int, photo: dict[str, Any], frame: dict[str, Any] | None) -> str:
    """Grafo (de la entrada 0 a [v]) que arma el cuadro base de `cw`×`ch`:

    - "cover": recortada como siempre (con el encuadre de la revisión, `frame_crop`).
    - "blur": la foto entera al centro sobre una copia que cubre el marco, agrandada (`overscan`), oscurecida (`dim`
      multiplica el color, como `brightness()` de CSS) y desenfocada con `gblur` (desvío = `sigma` × el lado corto,
      como `blur()` de CSS)."""
    if photo["fit"] != "blur":
        sw, sh, cx, cy = frame_crop(src_w, src_h, cw, ch, frame)
        return f"[0:v]scale={sw}:{sh}:flags=lanczos,crop={cw}:{ch}:{cx}:{cy},setsar=1,format=rgb24[v]"
    blur = photo["blur"]
    ow, oh = even(cw * blur["overscan"]), even(ch * blur["overscan"])
    fw, fh = contain_size(src_w, src_h, cw, ch)
    sigma = blur["sigma"] * min(cw, ch)
    dim = blur["dim"]
    bg = (
        f"[a]scale={ow}:{oh}:force_original_aspect_ratio=increase:flags=lanczos,crop={ow}:{oh},crop={cw}:{ch},"
        f"format=gbrp,colorchannelmixer=rr={dim:.4f}:gg={dim:.4f}:bb={dim:.4f}" + (f",gblur=sigma={sigma:.3f}:steps=3" if sigma > 0.05 else "") + "[bg]"
    )
    fg = f"[b]scale={fw}:{fh}:flags=lanczos,format=gbrp[fg]"
    return f"[0:v]split[a][b];{bg};{fg};[bg][fg]overlay=({cw}-{fw})/2:({ch}-{fh})/2,setsar=1,format=rgb24[v]"


def perspective_filter(path: dict[str, Any], duration: float, box_w: int, box_h: int, cw: int, ch: int) -> str:
    """Cámara sobre el cuadro base (`cw`×`ch`) con salida de `box_w`×`box_h`: `perspective` manda a las esquinas de la
    salida las esquinas de la ventana que ve la cámara en cada cuadro (t = cuadro / (30 · duración), la misma cuenta
    que `motion_at`). La salida de perspective tiene el tamaño de la entrada; la ventana queda en su esquina de arriba
    a la izquierda (`box_w`×`box_h`), que es lo que se recorta después."""
    a, b = path["from"], path["to"]
    frames = max(1.0, duration * FPS)
    # En perspective `in` cuenta desde 1 (el primer cuadro es in=1): el cuadro n del tramo es in-1.
    p = f"clip((in-1)/{frames:.4f},0,1)"
    e = f"((1-cos(PI*{p}))/2)" if path["ease"] == "smooth" else p
    ratio = b["scale"] / a["scale"]
    # Nunca por debajo de 1: con el redondeo, 1,15·0,869565 da 0,9999997 y `clip` con mínimo > máximo da NaN.
    s = f"max(1,{a['scale']:.9f}*pow({ratio:.9f},{e}))" if abs(ratio - 1) > 1e-9 else f"{max(1.0, a['scale']):.9f}"

    def center(k: str) -> str:
        d = b[k] - a[k]
        lin = f"({a[k]:.6f}+{d:.6f}*{e})" if abs(d) > 1e-9 else f"{a[k]:.6f}"
        return f"clip({lin},0.5/{s},1-0.5/{s})"

    # Esquina de la ventana (en píxeles del cuadro base) y lo que mide la salida completa vista en el cuadro base.
    left = f"({center('x')}*{cw}-{cw}/(2*{s}))"
    top = f"({center('y')}*{ch}-{ch}/(2*{s}))"
    right = f"({left}+{cw}*{cw}/({s}*{box_w}))"
    bottom = f"({top}+{ch}*{ch}/({s}*{box_h}))"

    def q(v: str) -> str:
        return f"'{v}'"

    return (
        f"perspective=x0={q(left)}:y0={q(top)}:x1={q(right)}:y1={q(top)}:x2={q(left)}:y2={q(bottom)}:x3={q(right)}:y3={q(bottom)}"
        f":interpolation=cubic:sense=source:eval=frame,crop={box_w}:{box_h}:0:0"
    )


def photo_key(photo: dict[str, Any], box_w: int, box_h: int, frame: dict[str, Any] | None, duration: float) -> str:
    return hashlib.sha1(json.dumps([photo, box_w, box_h, frame or DEFAULT_FRAME, round(duration, 3)], sort_keys=True).encode()).hexdigest()[:12]


def speed_of(edit: dict[str, Any] | None) -> float:
    """Velocidad del clip (lib/video/broll-edit.ts): entre 0,25 y 4; 1 sin el campo (planes de antes)."""
    try:
        speed = float((edit or {}).get("speed") or 1.0)
    except (TypeError, ValueError):
        return 1.0
    if not (speed > 0):
        return 1.0
    return max(0.25, min(4.0, speed))
