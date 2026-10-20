"""Subtítulos ASS a partir de los bloques que arma la app (lib/video/captions.ts).

Presets:
- Clásico: hasta 3 palabras por bloque, blanco con borde negro; la palabra que se está diciendo va en el
  color de acento de la marca. Montserrat ExtraBold.
- Pop: 1 o 2 palabras en mayúsculas, Montserrat Black, que entran con un pequeño salto de escala.

Siempre por encima del 20 % inferior de la pantalla (ahí van los botones y el texto de las redes)
y por debajo de la barbilla. Las fuentes van en la imagen del worker (`fontsdir`), con licencia OFL.
"""

from __future__ import annotations

from typing import Any

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


def build_ass(captions: dict[str, Any], width: int, height: int, fmt: str) -> str:
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
