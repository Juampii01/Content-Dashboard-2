"""Subtítulos ASS a partir de los bloques que arma la app (lib/video/captions.ts).

Presets:
- Clásico: hasta 3 palabras por bloque, blanco con borde negro; la palabra que se está diciendo va en el
  color de acento de la marca. Montserrat ExtraBold.
- Pop: 1 o 2 palabras en mayúsculas, Montserrat Black, que entran con un pequeño salto de escala.

Siempre por encima del 20 % inferior de la pantalla (ahí van los botones y el texto de las redes)
y por debajo de la barbilla. Las fuentes van en la imagen del worker (`fontsdir`), con licencia OFL.
"""

from __future__ import annotations

import functools
import struct
from pathlib import Path
from typing import Any, Callable

PRESETS: dict[str, dict[str, Any]] = {
    "clasico": {"font": "Montserrat ExtraBold", "size_v": 76, "size_h": 64, "outline": 5, "shadow": 2, "upper": False},
    "pop": {"font": "Montserrat Black", "size_v": 112, "size_h": 92, "outline": 6, "shadow": 3, "upper": True},
}

# Margen inferior: 9:16 → 30 % de la altura (arriba del 20 % reservado, debajo de la cara); 16:9 → 21 %.
MARGIN_V = {"9:16": 0.30, "16:9": 0.21}


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB → &HAABBGGRR (formato de ASS)."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "FFD84D"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(sec: float) -> str:
    cs = max(0, int(round(sec * 100)))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def _hex_ok(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) and len(value.lstrip("#")) == 6 else fallback


def build_style_ass(captions: dict[str, Any], width: int, height: int) -> str:
    """Subtítulos con los parámetros de un estilo medido en una referencia (preset "estilo").

    `captions.style`: size (alto de la fuente / alto del cuadro), position (centro vertical, 0 arriba y 1 abajo),
    uppercase, textColor, highlightColor (o null), box y boxColor, outline y font. Las palabras por bloque ya
    vienen resueltas en los bloques. El bloque se centra en `position` con \\an5\\pos (posición exacta).
    """
    st = captions.get("style") or {}
    size = max(0.018, min(0.09, float(st.get("size") or 0.045)))
    font_px = round(size * height)
    y = max(0.08, min(0.92, float(st.get("position") or 0.7))) * height
    upper = bool(st.get("uppercase"))
    text = ass_color(_hex_ok(st.get("textColor"), "#FFFFFF"))
    highlight = ass_color(st["highlightColor"]) if _hex_ok(st.get("highlightColor"), "") else None
    font = "Montserrat Black" if st.get("font") == "black" else "Montserrat ExtraBold"
    margin_h = round(width * 0.08)
    if st.get("box"):
        # BorderStyle 3: caja opaca del color del borde (OutlineColour); Outline es el relleno alrededor del texto.
        border = f"3,{max(4, round(font_px * 0.22))},0"
        outline_color = ass_color(_hex_ok(st.get("boxColor"), "#000000"))
    elif st.get("outline", True):
        border = f"1,{max(2, round(font_px * 0.075))},{max(1, round(font_px * 0.03))}"
        outline_color = "&H00000000"
    else:
        border = f"1,0,{max(1, round(font_px * 0.04))}"
        outline_color = "&H00000000"
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{font},{font_px},{text},{highlight or text},{outline_color},&H64000000,0,0,0,0,100,100,0,0,{border},5,{margin_h},{margin_h},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    pos = f"{{\\an5\\pos({width // 2},{round(y)})}}"
    lines: list[str] = []
    for block in captions.get("blocks", []):
        words = block.get("words") or []
        if not words:
            continue
        texts = [escape(w["text"].upper() if upper else w["text"]) for w in words]
        if not highlight:
            parts = [f"{{\\fscx110\\fscy110}}{t}{{\\fscx100\\fscy100}}" if w.get("emphasis") else t for w, t in zip(words, texts)]
            lines.append(f"Dialogue: 0,{ass_time(block['start'])},{ass_time(block['end'])},Main,,0,0,0,,{pos}{' '.join(parts)}")
            continue
        # Con resaltado: un evento por palabra activa, esa palabra en el color de resaltado.
        for i, w in enumerate(words):
            start = block["start"] if i == 0 else w["start"]
            end = words[i + 1]["start"] if i + 1 < len(words) else block["end"]
            if end - start < 0.01:
                continue
            parts = [f"{{\\c{highlight}}}{t}{{\\c{text}}}" if j == i else t for j, t in enumerate(texts)]
            lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Main,,0,0,0,,{pos}{' '.join(parts)}")
    return header + "\n".join(lines) + "\n"


def build_ass(captions: dict[str, Any], width: int, height: int, fmt: str, fonts_dir: Path | None = None) -> str:
    if is_look(captions):
        return build_look_ass(captions, width, height, fonts_dir or DEFAULT_FONTS)[0]
    if captions.get("preset") == "estilo" and captions.get("style"):
        return build_style_ass(captions, width, height)
    preset_key = captions.get("preset", "clasico")
    preset = PRESETS.get(preset_key, PRESETS["clasico"])
    vertical = height > width
    size = preset["size_v"] if vertical else preset["size_h"]
    margin_v = round(height * MARGIN_V.get(fmt, 0.25))
    margin_h = round(width * 0.08)
    accent = ass_color(captions.get("accent") or "#FFD84D")
    white = "&H00FFFFFF"
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{preset['font']},{size},{white},{accent},&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,{preset['outline']},{preset['shadow']},2,{margin_h},{margin_h},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines: list[str] = []
    for block in captions.get("blocks", []):
        words = block.get("words") or []
        if not words:
            continue
        texts = [escape(w["text"].upper() if preset["upper"] else w["text"]) for w in words]
        if preset_key == "pop":
            parts = []
            for w, t in zip(words, texts):
                parts.append(f"{{\\c{accent}}}{t}{{\\c{white}}}" if w.get("emphasis") else t)
            pop = "{\\fscx72\\fscy72\\t(0,90,\\fscx106\\fscy106)\\t(90,160,\\fscx100\\fscy100)}"
            lines.append(f"Dialogue: 0,{ass_time(block['start'])},{ass_time(block['end'])},Main,,0,0,0,,{pop}{' '.join(parts)}")
            continue
        # Clásico: un evento por palabra activa, con el bloque completo y esa palabra en el color de acento.
        for i, w in enumerate(words):
            start = block["start"] if i == 0 else w["start"]
            end = words[i + 1]["start"] if i + 1 < len(words) else block["end"]
            if end - start < 0.01:
                continue
            parts = []
            for j, t in enumerate(texts):
                style = ""
                if words[j].get("emphasis"):
                    style = "\\fscx112\\fscy112"
                if j == i:
                    parts.append(f"{{\\c{accent}{style}}}{t}{{\\c{white}\\fscx100\\fscy100}}")
                elif style:
                    parts.append(f"{{{style}}}{t}{{\\fscx100\\fscy100}}")
                else:
                    parts.append(t)
            lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Main,,0,0,0,,{' '.join(parts)}")
    return header + "\n".join(lines) + "\n"


# ─── Galería de estilos animados (lib/video/caption-styles.ts) ────────────────
#
# La app manda, por bloque, cada palabra con su renglón, su tamaño relativo y sus pistas (color, opacidad, escala,
# caja, resaltador y emoji) como claves con tiempos absolutos. Aquí se hace lo mismo que el HTML de la vista previa:
# renglones centrados en `look.y`, cada palabra en su lugar (medida con la misma fuente), la caja y el resaltador
# como dibujos (`\p1`) detrás, la sombra como una copia (desenfocada si corresponde) debajo, y cada tramo entre dos
# claves como una etiqueta `\t` (lineal, igual que la vista previa).

DEFAULT_FONTS = Path(__file__).resolve().parent.parent / "fonts"

FONT_FILES = {
    ("Montserrat", 800): ("Montserrat ExtraBold", "Montserrat-ExtraBold.ttf"),
    ("Montserrat", 900): ("Montserrat Black", "Montserrat-Black.ttf"),
    ("Inter", 600): ("Inter SemiBold", "Inter-SemiBold.ttf"),
    ("Inter", 800): ("Inter ExtraBold", "Inter-ExtraBold.ttf"),
    ("Inter", 900): ("Inter Black", "Inter-Black.ttf"),
}


def is_look(captions: dict[str, Any]) -> bool:
    look = captions.get("look")
    return isinstance(look, dict) and look.get("style") == captions.get("preset") and bool(captions.get("blocks"))


@functools.lru_cache(maxsize=16)
def font_metrics(path: str) -> dict[str, float]:
    """Métricas verticales de la fuente (tablas head, OS/2 y hhea).

    libass escala la fuente para que winAscent + winDescent midan lo que dice `\\fs`; el navegador usa 1 em =
    unitsPerEm. `scale` convierte un tamaño en em a `\\fs`, y `shift` (en em) corrige dónde cae la línea de base
    con `\\an5` respecto del centro del renglón en CSS (que usa las métricas typo o hhea).
    """
    data = Path(path).read_bytes()
    count = struct.unpack(">H", data[4:6])[0]
    tables: dict[str, int] = {}
    for i in range(count):
        tag, _, offset, _ = struct.unpack(">4sIII", data[12 + 16 * i : 28 + 16 * i])
        tables[tag.decode("latin-1")] = offset
    upm = struct.unpack(">H", data[tables["head"] + 18 : tables["head"] + 20])[0]
    os2 = tables["OS/2"]
    selection = struct.unpack(">H", data[os2 + 62 : os2 + 64])[0]
    typo_asc, typo_desc, _, win_asc, win_desc = struct.unpack(">hhhHH", data[os2 + 68 : os2 + 78])
    hhea = tables["hhea"]
    hhea_asc, hhea_desc = struct.unpack(">hh", data[hhea + 4 : hhea + 8])
    css_asc, css_desc = (typo_asc, -typo_desc) if selection & 128 else (hhea_asc, -hhea_desc)
    return {
        "scale": (win_asc + win_desc) / upm,
        "shift": ((css_asc - css_desc) - (win_asc - win_desc)) / (2 * upm),
    }


@functools.lru_cache(maxsize=64)
def _font(path: str, size: float):
    from PIL import ImageFont

    return ImageFont.truetype(path, size=size)


def word_width(path: str, size: float, text: str) -> float:
    """Ancho de avance de una palabra (con interletrado de la fuente), en px."""
    q = max(1.0, round(size * 4) / 4)
    return _font(path, q).getlength(text) * size / q


def _alpha(a: float) -> str:
    return f"&H{max(0, min(255, round((1 - a) * 255))):02X}&"


def _value_at(keys: list[dict[str, Any]], t: float, field: str = "v") -> Any:
    if t <= keys[0]["t"]:
        return keys[0][field]
    for a, b in zip(keys, keys[1:]):
        if t < b["t"]:
            if field == "c":
                return a[field]
            if b["t"] == a["t"]:
                return b[field]
            return a[field] + (b[field] - a[field]) * (t - a["t"]) / (b["t"] - a["t"])
    return keys[-1][field]


def _transforms(keys: list[dict[str, Any]], t0: float, tag: Callable[[Any], str], field: str = "v") -> tuple[str, str]:
    """Etiqueta inicial (el valor al empezar el evento) y una `\\t` por tramo en el que el valor cambia."""
    if not keys:
        return "", ""
    first = _value_at(keys, t0, field)
    out = []
    prev = keys[0]
    for k in keys[1:]:
        if k[field] != prev[field] and k["t"] > t0:
            a = max(0, round((max(prev["t"], t0) - t0) * 1000))
            b = max(a + 1, round((k["t"] - t0) * 1000))
            out.append(f"\\t({a},{b},{tag(k[field])})")
        prev = k
    return tag(first), "".join(out)


def _num(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def rounded_rect(w: float, h: float, r: float) -> str:
    """Rectángulo con esquinas redondeadas como dibujo ASS (curvas de Bézier, k = 0,5523)."""
    r = max(0.0, min(r, w / 2, h / 2))
    k = r * 0.5523
    f = _num
    return (
        f"m {f(r)} 0 l {f(w - r)} 0 b {f(w - r + k)} 0 {f(w)} {f(r - k)} {f(w)} {f(r)} "
        f"l {f(w)} {f(h - r)} b {f(w)} {f(h - r + k)} {f(w - r + k)} {f(h)} {f(w - r)} {f(h)} "
        f"l {f(r)} {f(h)} b {f(r - k)} {f(h)} 0 {f(h - r + k)} 0 {f(h - r)} "
        f"l 0 {f(r)} b 0 {f(r - k)} {f(r - k)} 0 {f(r)} 0"
    )


def _scale_tag(v: float, bord: float) -> str:
    tag = f"\\fscx{v * 100:.1f}\\fscy{v * 100:.1f}"
    # En la vista previa el contorno escala con la palabra (transform); en ASS hay que escalarlo a mano.
    return tag + (f"\\bord{bord * v:.2f}" if bord else "")


def caption_anchor(look: dict[str, Any], place: Any, width: int, height: int) -> tuple[float, float, float, float]:
    """Centro (x, y), tamaño de 1 em y ancho máximo de un bloque, en px, con el lugar del lienzo de la revisión.

    Espejo de `captionAnchor` (lib/video/canvas/captions.ts): `place` = {x, y, scale} (corrimiento en fracción del
    cuadro y tamaño); sin `place`, el lugar del estilo. Agrandar también agranda el ancho máximo (hasta el 96 %).
    """
    p = place if isinstance(place, dict) else {}
    px, py, ps = float(p.get("x", 0) or 0), float(p.get("y", 0) or 0), float(p.get("scale", 1) or 1)
    cx = width * (0.5 + px)
    cy = height * (float(look["y"]) + py)
    em = float(look["size"]) * height * ps
    max_w = min(width * 0.96, float(look["maxWidth"]) * width * ps)
    return cx, cy, em, max_w


def build_look_ass(captions: dict[str, Any], width: int, height: int, fonts_dir: Path) -> tuple[str, list[dict[str, Any]]]:
    """ASS de un estilo de la galería y los emojis a superponer (`{name, start, end, fadeIn, x, y, size}` en px)."""
    look = captions["look"]
    family, weight = look["font"]["family"], int(look["font"]["weight"])
    fontname, filename = FONT_FILES.get((family, weight), FONT_FILES[("Montserrat", 800)])
    font_path = str(Path(fonts_dir) / filename)
    metrics = font_metrics(font_path)
    em0 = float(look["size"]) * height
    line_height = float(look["lineHeight"])
    gap = float(look["gap"])
    outline = float(look.get("outline") or 0)
    outline_color = ass_color(_hex_ok(look.get("outlineColor"), "#000000"))
    shadow = look.get("shadow")
    box = look.get("box")
    marker = look.get("marker")
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{fontname},{round(em0 * metrics['scale'])},&H00FFFFFF,&H00FFFFFF,{outline_color},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines: list[str] = []
    stickers: list[dict[str, Any]] = []
    for block in captions.get("blocks", []):
        words = block.get("words") or []
        start, end = float(block["start"]), float(block["end"])
        if not words or end - start < 0.02:
            continue
        # Lugar del bloque (lienzo de la revisión): centro, tamaño y ancho máximo, igual que la vista previa.
        cx, cy, em0, max_w = caption_anchor(look, block.get("place"), width, height)
        # Medidas a tamaño natural; si un renglón no entra, se achica todo el bloque (igual que la vista previa).
        nlines = max(int(w.get("line", 0)) for w in words) + 1
        rows = [[w for w in words if int(w.get("line", 0)) == i] for i in range(nlines)]
        rows = [r for r in rows if r]
        natural = [[word_width(font_path, em0 * float(w.get("size", 1)), w["text"]) for w in row] for row in rows]
        row_w = [sum(ws) + gap * em0 * max(0, len(ws) - 1) for ws in natural]
        fit = min(1.0, max_w / max(row_w)) if max(row_w) > 0 else 1.0
        em = em0 * fit
        row_h = [line_height * em * max(float(w.get("size", 1)) for w in row) for row in rows]
        top = cy - sum(row_h) / 2
        ts, te = ass_time(start), ass_time(end)
        # Las \t se miden desde el comienzo del evento tal como queda redondeado en el archivo (centésimas).
        t0 = round(start * 100) / 100
        for ri, row in enumerate(rows):
            y = top + sum(row_h[:ri]) + row_h[ri] / 2
            x = cx - row_w[ri] * fit / 2
            for w, natural_w in zip(row, natural[ri]):
                size = float(w.get("size", 1))
                ww = natural_w * fit
                em_w = em * size
                wx = x + ww / 2
                x += ww + gap * em
                fs = f"\\fs{em_w * metrics['scale']:.2f}"
                text_y = y + metrics["shift"] * em_w
                bord = outline * em_w
                s0, st = _transforms(w["scale"], t0, lambda v, b=bord: _scale_tag(v, b))
                c0, ct = _transforms(w["color"], t0, lambda c: f"\\1c{ass_color(c)}", "c")
                a0, at = _transforms(w["alpha"], t0, lambda a: f"\\alpha{_alpha(a)}")
                body = escape(w["text"])
                if box and w.get("box"):
                    bw, bh = ww + 2 * float(box["padX"]) * em_w, (1 + 2 * float(box["padY"])) * em_w
                    ba0, bat = _transforms(w["box"]["alpha"], t0, lambda a: f"\\alpha{_alpha(a)}")
                    bs0, bst = _transforms(w["box"]["scale"], t0, lambda v: _scale_tag(v, 0))
                    color = ass_color(_hex_ok(box.get("color"), "#FFD84D"))
                    lines.append(
                        f"Dialogue: 0,{ts},{te},Main,,0,0,0,,{{\\an5\\pos({wx:.1f},{y:.1f})\\bord0\\shad0\\1c{color}{ba0}{bs0}{bat}{bst}\\p1}}"
                        f"{rounded_rect(bw, bh, float(box['radius']) * em_w)}{{\\p0}}"
                    )
                if marker and w.get("marker"):
                    mw, mh = ww + 2 * float(marker["padX"]) * em_w, float(marker["height"]) * em_w
                    g0, gt = _transforms(w["marker"]["grow"], t0, lambda v: f"\\fscx{v * 100:.1f}")
                    color = ass_color(_hex_ok(marker.get("color"), "#FFD84D"))
                    lines.append(
                        f"Dialogue: 0,{ts},{te},Main,,0,0,0,,{{\\an4\\pos({wx - mw / 2:.1f},{y:.1f})\\bord0\\shad0\\1c{color}"
                        f"\\alpha{_alpha(float(marker.get('alpha', 1)))}{g0}{gt}\\p1}}{rounded_rect(mw, mh, float(marker['radius']) * em_w)}{{\\p0}}"
                    )
                if shadow:
                    sh_alpha = float(shadow.get("alpha", 0.5))
                    sa0, sat = _transforms(w["alpha"], t0, lambda a: f"\\alpha{_alpha(a * sh_alpha)}")
                    sc = ass_color(_hex_ok(shadow.get("color"), "#000000"))
                    # drop-shadow de CSS: el desenfoque es el doble de la desviación de la gaussiana (\blur de libass).
                    blur = float(shadow.get("blur") or 0) * em_w / 2
                    blur_tag = f"\\blur{blur:.2f}" if blur > 0 else ""
                    sy = text_y + float(shadow["y"]) * em_w
                    lines.append(f"Dialogue: 1,{ts},{te},Main,,0,0,0,,{{\\an5\\pos({wx:.1f},{sy:.1f}){fs}\\shad0\\1c{sc}\\3c{sc}{blur_tag}{sa0}{s0}{sat}{st}}}{body}")
                lines.append(f"Dialogue: 2,{ts},{te},Main,,0,0,0,,{{\\an5\\pos({wx:.1f},{text_y:.1f}){fs}\\shad0{c0}{a0}{s0}{ct}{at}{st}}}{body}")
                emoji = w.get("emoji")
                if isinstance(emoji, dict) and isinstance(emoji.get("name"), str):
                    keys = emoji.get("alpha") or []
                    appear = float(keys[0]["t"]) if keys else start
                    fade = float(keys[-1]["t"]) - appear if len(keys) > 1 else 0.0
                    size_px = 1.1 * em_w
                    stickers.append({
                        "name": emoji["name"],
                        "start": appear,
                        "end": end,
                        "fadeIn": max(0.0, fade),
                        "x": wx - size_px / 2,
                        "y": y - line_height * em_w / 2 - 1.15 * em_w,
                        "size": size_px,
                    })
    return header + "\n".join(lines) + "\n", stickers
