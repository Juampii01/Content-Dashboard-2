"""Genera los PNG de los emojis de los subtítulos con Noto Color Emoji (SIL Open Font License 1.1).

    python scripts/make_emoji.py [ruta/NotoColorEmoji.ttf]

Escribe `worker/assets/emoji/<nombre>.png` (render) y `public/emoji/<nombre>.png` (vista previa): las mismas imágenes en
los dos lados, así el emoji se ve igual en la revisión y en el video (los emojis del sistema cambian entre Mac,
Windows y Android). Los nombres son los de EMOJI_NAMES en lib/video/caption-styles.ts. libass no dibuja emojis a color,
por eso van como imágenes que el render superpone con ffmpeg.

Si no se pasa la fuente, se usa la del sistema (paquete fonts-noto-color-emoji) o se baja de github.com/googlefonts/noto-emoji.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

EMOJIS = {
    "dinero": "\U0001f4b0",
    "carrito": "\U0001f6d2",
    "grafico": "\U0001f4c8",
    "idea": "\U0001f4a1",
    "fuego": "\U0001f525",
    "reloj": "⏰",
    "cruz": "❌",
    "check": "✅",
    "diana": "\U0001f3af",
    "rayo": "⚡",
    "corazon": "❤️",
    "robot": "\U0001f916",
    "alerta": "⚠️",
    "cohete": "\U0001f680",
    "cerebro": "\U0001f9e0",
    "sonrisa": "\U0001f604",
    "telefono": "\U0001f4f1",
    "maletin": "\U0001f4bc",
}
SIZE = 128
SYSTEM = Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf")
URL = "https://github.com/googlefonts/noto-emoji/raw/v2.051/fonts/NotoColorEmoji.ttf"


def font_path(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    if SYSTEM.exists():
        return SYSTEM
    dest = Path("/tmp/NotoColorEmoji.ttf")
    if not dest.exists():
        urllib.request.urlretrieve(URL, dest)
    return dest


def render(font: ImageFont.FreeTypeFont, char: str) -> Image.Image:
    # Noto Color Emoji es un mapa de bits de 109 px: se dibuja a ese tamaño, se recorta y se lleva a SIZE.
    canvas = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text((80, 80), char, font=font, embedded_color=True, anchor="mm")
    box = canvas.getbbox()
    if not box:
        raise SystemExit(f"La fuente no tiene el emoji {char!r}")
    glyph = canvas.crop(box)
    side = max(glyph.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2))
    return square.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    font = ImageFont.truetype(str(font_path(sys.argv[1] if len(sys.argv) > 1 else None)), size=109)
    here = Path(__file__).resolve().parent.parent
    targets = [here / "assets" / "emoji", here.parent / "public" / "emoji"]
    for d in targets:
        d.mkdir(parents=True, exist_ok=True)
    for name, char in EMOJIS.items():
        image = render(font, char)
        for d in targets:
            image.save(d / f"{name}.png", optimize=True)
    print(f"{len(EMOJIS)} emojis en", ", ".join(str(d) for d in targets))


if __name__ == "__main__":
    main()
