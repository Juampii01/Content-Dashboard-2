"""B-roll "a medida": gráficos animados con la marca del cliente, dibujados cuadro a cuadro con Pillow.

El diseño es una copia línea por línea de `lib/video/graphic-scene.ts` (la vista previa del navegador usa ese
archivo): mismas cajas, mismos tamaños, mismas curvas y mismos tiempos. Si cambias algo aquí, cámbialo allá.

Cada elemento se dibuja una sola vez (a 2x y reducido, para bordes suaves) y en cada cuadro solo se mueve,
se escala, se recorta (barrido) y se le cambia la opacidad. El contador se dibuja en cada cuadro.

Salida:
- "full": MP4 H.264 (yuv420p) con el fondo de la marca, a la medida del tramo.
- "overlay": MOV QuickTime Animation (qtrle, ARGB) con transparencia: el velo y el gráfico sobre el video.

Es determinista (sin azar ni reloj): el mismo spec da los mismos cuadros, así se cachea por hash.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from comunes.errors import JobError

FPS = 30
SS = 2  # sobremuestreo de los elementos fijos

TEMPLATES = ("number", "list", "quote", "keyword", "compare", "flow")
FONT_FILES = {
    ("inter", 900): "Inter-Black.ttf",
    ("inter", 800): "Inter-ExtraBold.ttf",
    ("inter", 700): "Inter-Bold.ttf",
    ("montserrat", 900): "Montserrat-Black.ttf",
    ("montserrat", 800): "Montserrat-ExtraBold.ttf",
    ("montserrat", 700): "Montserrat-Bold.ttf",
}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def rnd(v: float) -> int:
    """Redondeo como Math.round de JavaScript (no el de banquero de Python)."""
    return math.floor(v + 0.5)


# ─── Curvas ───────────────────────────────────────────────────────────────


def clamp01(p: float) -> float:
    return 0.0 if p < 0 else 1.0 if p > 1 else p


def ease_out_cubic(p: float) -> float:
    return 1 - (1 - p) ** 3


def ease_in_cubic(p: float) -> float:
    return p**3


def ease_in_out_cubic(p: float) -> float:
    return 4 * p**3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def ease_out_back(p: float) -> float:
    return 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2


def ease_out_expo(p: float) -> float:
    return 1.0 if p >= 1 else 1 - 2 ** (-10 * p)


# ─── Fuentes y medición ───────────────────────────────────────────────────


class Fonts:
    def __init__(self, fonts_dir: Path):
        self.dir = Path(fonts_dir)
        missing = [f for f in set(FONT_FILES.values()) if not (self.dir / f).exists()]
        if missing:
            raise JobError("Faltan las fuentes de los gráficos en el servicio de procesamiento.", retry=False, detail=", ".join(sorted(missing)))

    @lru_cache(maxsize=256)
    def font(self, family: str, weight: int, size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(str(self.dir / FONT_FILES[(family, weight)]), max(1, int(size)))

    def measure(self, text: str, font: tuple[str, int], size: float) -> float:
        if not text:
            return 0.0
        return float(self.font(font[0], font[1], rnd(size)).getlength(text))


def spaced_width(fonts: Fonts, text: str, font: tuple[str, int], size: float, spacing: float) -> float:
    if not spacing:
        return fonts.measure(text, font, size)
    return sum(fonts.measure(ch, font, size) for ch in text) + spacing * max(0, len(text) - 1)


def wrap(fonts: Fonts, text: str, font: tuple[str, int], size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        nxt = f"{current} {word}" if current else word
        if current and fonts.measure(nxt, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = nxt
    if current:
        lines.append(current)
    return lines


@dataclass
class Fitted:
    size: int
    lines: list[str]
    widths: list[float]


def fit_text(fonts: Fonts, text: str, font: tuple[str, int], mx: float, mn: float, max_width: float, max_lines: int, balance: bool = True) -> Fitted:
    size = rnd(mx)
    floor = rnd(mn)
    while True:
        lines = wrap(fonts, text, font, size, max_width)
        widest = max([0.0, *[fonts.measure(line, font, size) for line in lines]])
        if (len(lines) <= max_lines and widest <= max_width) or size <= floor:
            break
        size = max(floor, math.floor(size * 0.94))
    if balance and len(lines) > 1:
        target = max_width
        for _ in range(24):
            narrower = target * 0.95
            attempt = wrap(fonts, text, font, size, narrower)
            if len(attempt) != len(lines):
                break
            lines = attempt
            target = narrower
    return Fitted(size, lines, [fonts.measure(line, font, size) for line in lines])


def baseline_of(i: int, lh: float, size: float) -> float:
    return i * lh + lh * 0.5 + size * 0.35


# ─── Escena ───────────────────────────────────────────────────────────────


@dataclass
class Element:
    x: float
    y: float
    w: float
    h: float
    paints: list[dict[str, Any]]
    anim: dict[str, Any]
    pad: int = 8
    sprite: Image.Image | None = None


@dataclass
class Scene:
    width: int
    height: int
    mode: str
    theme: dict[str, str]
    duration: float
    elements: list[Element]
    veil: list[tuple[float, float]] | None
    time_scale: float
    exit: float
    box: dict[str, float]
    fonts: Fonts = field(repr=False)


def content_box(width: int, height: int, mode: str, position: str) -> dict[str, float]:
    vertical = height > width

    def frac(x0: float, y0: float, y1: float) -> dict[str, float]:
        return {"x": x0, "y": height * y0, "w": width - 2 * x0, "h": height * (y1 - y0)}

    if mode == "full":
        return frac(96, 0.11, 0.6) if vertical else frac(200, 0.1, 0.7)
    if vertical:
        return frac(80, 0.06, 0.34) if position == "top" else frac(80, 0.58, 0.82)
    return frac(200, 0.07, 0.42) if position == "top" else frac(200, 0.58, 0.9)


def veil_stops(width: int, height: int, position: str) -> list[tuple[float, float]]:
    vertical = height > width
    if position == "top":
        return [(0, 0.88), (0.22, 0.78), (0.42, 0.35), (0.56, 0)] if vertical else [(0, 0.86), (0.3, 0.7), (0.5, 0.3), (0.66, 0)]
    return [(0.45, 0), (0.55, 0.4), (0.66, 0.8), (1, 0.9)] if vertical else [(0.45, 0), (0.58, 0.35), (0.72, 0.78), (1, 0.88)]


def element_pad(paints: list[dict[str, Any]]) -> int:
    size = 0.0
    for p in paints:
        if p["type"] == "text":
            for r in p["runs"]:
                size = max(size, r["size"])
        if p["type"] == "counter":
            size = max(size, p["counter"]["size"])
    return rnd(size * 0.3 + 8)


def el(box: dict[str, float], paints: list[dict[str, Any]], anim: dict[str, Any]) -> Element:
    return Element(box["x"], box["y"], box["w"], box["h"], paints, anim, element_pad(paints))


def run(text: str, x: float, baseline: float, size: float, font: tuple[str, int], color: str, spacing: float = 0) -> dict[str, Any]:
    return {"text": text, "x": x, "baseline": baseline, "size": size, "font": font, "color": color, "spacing": spacing}


def text_runs(f: Fitted, font: tuple[str, int], color: str, lh: float, width: float, align: str) -> list[dict[str, Any]]:
    return [run(t, (width - f.widths[i]) / 2 if align == "center" else 0, baseline_of(i, lh, f.size), f.size, font, color) for i, t in enumerate(f.lines)]


def eyebrow(fonts: Fonts, text: str, max_size: float, max_width: float, color: str) -> tuple[dict[str, Any], float, int]:
    font = ("inter", 700)
    upper = text.upper()
    size = rnd(max_size)
    width = spaced_width(fonts, upper, font, size, rnd(size * 0.16))
    while width > max_width and size > 18:
        size = max(18, math.floor(size * 0.94))
        width = spaced_width(fonts, upper, font, size, rnd(size * 0.16))
    return run(upper, 0, size * 0.5 + size * 0.35, size, font, color, rnd(size * 0.16)), width, size


@dataclass
class Ctx:
    fonts: Fonts
    box: dict[str, float]
    s: float
    theme: dict[str, str]
    family: str
    overlay: bool
    vertical: bool
    duration: float


SHRINK = (1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55)


def build_scene(spec: dict[str, Any], width: int, height: int, duration: float, fonts: Fonts) -> Scene:
    u = min(width, height) / 1080
    box = content_box(width, height, spec["mode"], spec.get("position", "top"))
    overlay = spec["mode"] == "overlay"
    elements: list[Element] = []
    for k in SHRINK:
        ctx = Ctx(fonts, box, (0.8 if overlay else 1) * k * u, spec["theme"], spec["font"], overlay, height > width, duration)
        elements, h = LAYOUTS[spec["template"]](spec, ctx)
        if h <= box["h"]:
            break
    exit_ = min(0.4, duration * 0.16)
    last = 0.0
    for e in elements:
        last = max(last, e.anim["start"] + e.anim["dur"])
        for p in e.paints:
            if p["type"] == "counter":
                last = max(last, p["counter"]["start"] + p["counter"]["dur"])
    available = duration - exit_ - 0.15
    time_scale = max(0.3, min(1.0, available / last)) if last > 0 else 1.0
    return Scene(width, height, spec["mode"], spec["theme"], duration, elements, veil_stops(width, height, spec.get("position", "top")) if overlay else None, time_scale, exit_, box, fonts)


def element_state(scene: Scene, e: Element, t: float) -> dict[str, float]:
    a = e.anim
    ts = scene.time_scale
    p = clamp01((t - a["start"] * ts) / max(0.001, a["dur"] * ts))
    st = {"opacity": 1.0, "dx": 0.0, "dy": 0.0, "scale": 1.0, "reveal": 1.0}
    dist = a.get("dist", 0)
    kind = a["kind"]
    if kind == "fade":
        st["opacity"] = ease_out_cubic(p)
    elif kind == "up":
        q = ease_out_cubic(p)
        st["opacity"] = q
        st["dy"] = (1 - q) * dist
    elif kind == "slide":
        q = ease_out_cubic(p)
        st["opacity"] = q
        st["dx"] = -(1 - q) * dist
    elif kind == "pop":
        frm = a.get("from", 0.85)
        st["scale"] = frm + (1 - frm) * ease_out_back(p)
        st["opacity"] = ease_out_cubic(clamp01(p * 1.6))
    elif kind == "zoom":
        q = ease_out_cubic(p)
        frm = a.get("from", 1.12)
        st["scale"] = frm + (1 - frm) * q
        st["opacity"] = q
    else:
        st["reveal"] = ease_in_out_cubic(p)
        st["opacity"] = 1.0 if p > 0 else 0.0
    exit_p = clamp01((t - (scene.duration - scene.exit)) / max(0.001, scene.exit))
    if exit_p > 0:
        q = ease_in_cubic(exit_p)
        st["opacity"] *= 1 - q
        st["dy"] -= q * 24 * (min(scene.width, scene.height) / 1080)
    return st


def counter_text(scene: Scene, c: dict[str, Any], t: float) -> str:
    p = clamp01((t - c["start"] * scene.time_scale) / max(0.001, c["dur"] * scene.time_scale))
    if p >= 1:
        return c["text"]
    v = c["to"] * ease_out_expo(p)
    if c["decimals"] > 0:
        return f"{v:.{c['decimals']}f}".replace(".", c["decimalChar"])
    n = math.floor(v + 0.5)
    if not c["thousands"]:
        return str(n)
    return f"{n:,}".replace(",", c["thousands"])


def split_value(value: str) -> dict[str, Any]:
    m = re.match(r"^(\D*?)(\d+(?:[.,]\d+)*)(.*)$", value)
    prefix = m.group(1) if m else ""
    num = m.group(2) if m else "0"
    suffix = m.group(3) if m else ""
    if re.match(r"^\d{1,3}([.,]\d{3})+$", num):
        return {"prefix": prefix, "num": num, "suffix": suffix, "to": float(re.sub(r"[.,]", "", num)), "decimals": 0, "thousands": "." if "." in num else ",", "decimalChar": ","}
    dec = re.match(r"^(\d+)([.,])(\d+)$", num)
    if dec:
        return {"prefix": prefix, "num": num, "suffix": suffix, "to": float(f"{dec.group(1)}.{dec.group(3)}"), "decimals": len(dec.group(3)), "thousands": "", "decimalChar": dec.group(2)}
    return {"prefix": prefix, "num": num, "suffix": suffix, "to": float(re.sub(r"[.,]", "", num)), "decimals": 0, "thousands": "", "decimalChar": ","}


# ─── Plantillas ───────────────────────────────────────────────────────────


def layout_number(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    display = (c.family, 900)
    v = split_value(spec["value"])
    size = fit_text(fonts, spec["value"], display, (340 if c.vertical else 300) * s, 110 * s, box["w"], 1, False).size
    prefix_w = fonts.measure(v["prefix"], display, size)
    num_w = fonts.measure(v["num"], display, size)
    value_w = prefix_w + num_w + fonts.measure(v["suffix"], display, size)
    label_font = (c.family, 800)
    label = fit_text(fonts, spec["label"], label_font, 60 * s, 32 * s, min(box["w"], 860 * s), 2) if spec.get("label") else None
    label_lh = label.size * 1.18 if label else 0
    value_h = size * 1.02
    bar_h = max(6, 12 * s)
    gap1 = 26 * s
    gap2 = 34 * s
    height = value_h + gap1 + bar_h + (gap2 + len(label.lines) * label_lh if label else 0)
    y = box["y"] + (box["h"] - height) / 2
    cx = box["x"] + box["w"] / 2
    out: list[Element] = []
    if not c.overlay:
        gw = value_w * 1.5 + 220 * s
        gh = size * 2.3
        out.append(el({"x": cx - gw / 2, "y": y + value_h / 2 - gh / 2, "w": gw, "h": gh}, [{"type": "glow", "color": theme["accent"], "alpha": 0.3}], {"kind": "fade", "start": 0, "dur": 0.7}))
    counter = {
        **{k: v[k] for k in ("prefix", "suffix", "to", "decimals", "thousands", "decimalChar")},
        "text": v["num"],
        "right": prefix_w + num_w,
        "baseline": baseline_of(0, value_h, size),
        "size": size,
        "font": display,
        "digitsColor": theme["text"],
        "affixColor": theme["accent"],
        "start": 0.1,
        "dur": min(1.2, max(0.6, c.duration * 0.4)),
    }
    out.append(el({"x": cx - value_w / 2, "y": y, "w": value_w, "h": value_h}, [{"type": "counter", "counter": counter}], {"kind": "pop", "start": 0.04, "dur": 0.55, "from": 0.82}))
    y += value_h + gap1
    bar_w = min(value_w * 0.42, 240 * s)
    out.append(el({"x": cx - bar_w / 2, "y": y, "w": bar_w, "h": bar_h}, [rect(0, 0, bar_w, bar_h, bar_h / 2, theme["accent"], 1)], {"kind": "wipe-x", "start": 0.5, "dur": 0.45}))
    y += bar_h
    if label:
        y += gap2
        w = max(label.widths)
        color = theme["text"] if c.overlay else theme["muted"]
        out.append(el({"x": cx - w / 2, "y": y, "w": w, "h": len(label.lines) * label_lh}, [{"type": "text", "runs": text_runs(label, label_font, color, label_lh, w, "center")}], {"kind": "up", "start": 0.42, "dur": 0.5, "dist": 30 * s}))
    return out, height


def rect(x: float, y: float, w: float, h: float, r: float, fill: str, alpha: float, stroke: str | None = None, stroke_alpha: float = 1, stroke_width: float = 0) -> dict[str, Any]:
    return {"type": "rect", "x": x, "y": y, "w": w, "h": h, "r": r, "fill": fill, "alpha": alpha, "stroke": stroke, "strokeAlpha": stroke_alpha, "strokeWidth": stroke_width}


def layout_list(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    head = (c.family, 800)
    title = fit_text(fonts, spec["title"], head, 66 * s, 40 * s, box["w"], 2) if spec.get("title") else None
    title_lh = title.size * 1.12 if title else 0
    d = 78 * s
    gap = 30 * s
    pad = 30 * s
    text_w = box["w"] - 2 * pad - d - gap
    item_font = (c.family, 800)
    size = min(fit_text(fonts, it, item_font, 56 * s, 32 * s, text_w, 2).size for it in spec["items"])
    items = [fit_text(fonts, it, item_font, size, size, text_w, 2) for it in spec["items"]]
    lh = size * 1.18
    rows = [max(d, len(it.lines) * lh) + 2 * pad for it in items]
    row_gap = 22 * s
    title_gap = 40 * s
    height = (len(title.lines) * title_lh + title_gap if title else 0) + sum(rows) + row_gap * (len(rows) - 1)
    y = box["y"] + (box["h"] - height) / 2
    out: list[Element] = []
    if title:
        h = len(title.lines) * title_lh
        out.append(el({"x": box["x"], "y": y, "w": box["w"], "h": h}, [{"type": "text", "runs": text_runs(title, head, theme["text"], title_lh, box["w"], "left")}], {"kind": "up", "start": 0, "dur": 0.5, "dist": 30 * s}))
        y += h + title_gap
    stagger = max(0.3, min(0.7, (c.duration - 1.6) / len(items)))
    for i, it in enumerate(items):
        h = rows[i]
        start = 0.25 + i * stagger
        text_h = len(it.lines) * lh
        runs = [{**r, "x": r["x"] + pad + d + gap, "baseline": r["baseline"] + (h - text_h) / 2} for r in text_runs(it, item_font, theme["text"], lh, text_w, "left")]
        out.append(
            el(
                {"x": box["x"], "y": y, "w": box["w"], "h": h},
                [rect(0, 0, box["w"], h, 28 * s, theme["surface"], 0.92 if c.overlay else 1, theme["accent"], 0.28, max(2, 2 * s)), {"type": "text", "runs": runs}],
                {"kind": "slide", "start": start, "dur": 0.5, "dist": 70 * s},
            )
        )
        badge_font = (c.family, 900)
        num = str(i + 1)
        ns = rnd(40 * s)
        out.append(
            el(
                {"x": box["x"] + pad, "y": y + (h - d) / 2, "w": d, "h": d},
                [
                    {"type": "circle", "cx": d / 2, "cy": d / 2, "r": d / 2, "fill": theme["accent"], "alpha": 1},
                    {"type": "text", "runs": [run(num, (d - fonts.measure(num, badge_font, ns)) / 2, d / 2 + ns * 0.35, ns, badge_font, theme["accentText"])]},
                ],
                {"kind": "pop", "start": start + 0.12, "dur": 0.45, "from": 0.4},
            )
        )
        y += h + row_gap
    return out, height


def norm(w: str) -> str:
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(ch for ch in w if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9ñ%]+", "", w)


def highlight_indexes(words: list[str], highlight: str) -> set[int]:
    target = [t for t in (norm(x) for x in highlight.split()) if t]
    out: set[int] = set()
    if not target:
        return out
    plain = [norm(w) for w in words]
    for i in range(0, len(plain) - len(target) + 1):
        if all(plain[i + k] == t for k, t in enumerate(target)):
            return set(range(i, i + len(target)))
    return {i for i, w in enumerate(plain) if w and w in target}


def layout_quote(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    font = (c.family, 900)
    fitted = fit_text(fonts, spec["text"], font, 100 * s, 48 * s, box["w"], 5)
    size = fitted.size
    lh = size * 1.14
    qm = rnd(150 * s)
    qm_h = qm * 0.62
    gap = 14 * s
    height = qm_h + gap + len(fitted.lines) * lh
    top = box["y"] + (box["h"] - height) / 2
    cx = box["x"] + box["w"] / 2
    qw = fonts.measure("“", font, qm)
    out = [el({"x": cx - qw / 2, "y": top, "w": qw, "h": qm_h}, [{"type": "text", "runs": [run("“", 0, qm * 0.86, qm, font, theme["accent"])]}], {"kind": "pop", "start": 0, "dur": 0.5, "from": 0.5})]
    words = [w for line in fitted.lines for w in line.split(" ")]
    marked = highlight_indexes(words, spec.get("highlight", ""))
    step = max(0.05, min(0.14, (c.duration * 0.42) / max(1, len(words))))
    space = fonts.measure(" ", font, size)
    markers: list[Element] = []
    word_els: list[Element] = []
    k = 0
    for li, line in enumerate(fitted.lines):
        line_top = top + qm_h + gap + li * lh
        x = box["x"] + (box["w"] - fitted.widths[li]) / 2
        for word in line.split(" "):
            ww = fonts.measure(word, font, size)
            start = 0.15 + k * step
            baseline = baseline_of(0, lh, size)
            word_els.append(el({"x": x, "y": line_top, "w": ww, "h": lh}, [{"type": "text", "runs": [run(word, 0, baseline, size, font, theme["text"])]}], {"kind": "up", "start": start, "dur": 0.4, "dist": 28 * s}))
            if k in marked:
                px = size * 0.1
                mh = size * 1.0
                mb = {"x": x - px, "y": line_top + lh / 2 - mh / 2, "w": ww + 2 * px, "h": mh}
                anim = {"kind": "wipe-x", "start": start + 0.25, "dur": 0.35}
                markers.append(el(mb, [rect(0, 0, mb["w"], mb["h"], size * 0.12, theme["accent"], 1)], anim))
                markers.append(el(mb, [{"type": "text", "runs": [run(word, px, baseline - (mb["y"] - line_top), size, font, theme["accentText"])]}], anim))
            x += ww + space
            k += 1
    return [*out, *word_els, *markers], height


def layout_keyword(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    font = (c.family, 900)
    fitted = fit_text(fonts, spec["text"], font, 230 * s, 80 * s, box["w"] * 0.88, 2)
    size = fitted.size
    lh = size * 1.12
    label = eyebrow(fonts, spec["label"], 34 * s, box["w"], theme["accent"]) if spec.get("label") else None
    label_gap = 30 * s
    height = (label[2] * 1.2 + label_gap if label else 0) + len(fitted.lines) * lh
    y = box["y"] + (box["h"] - height) / 2
    cx = box["x"] + box["w"] / 2
    out: list[Element] = []
    if label:
        lrun, lw, ls = label
        out.append(el({"x": cx - lw / 2, "y": y, "w": lw, "h": ls * 1.2}, [{"type": "text", "runs": [{**lrun, "baseline": ls * 0.6 + ls * 0.35}]}], {"kind": "up", "start": 0, "dur": 0.45, "dist": 24 * s}))
        y += ls * 1.2 + label_gap
    block_h = len(fitted.lines) * lh
    block_w = max(fitted.widths)
    out.append(el({"x": cx - block_w / 2, "y": y, "w": block_w, "h": block_h}, [{"type": "text", "runs": text_runs(fitted, font, theme["text"], lh, block_w, "center")}], {"kind": "zoom", "start": 0.05, "dur": 0.5, "from": 1.12}))
    for i, line in enumerate(fitted.lines):
        lw = fitted.widths[i]
        lx = cx - lw / 2
        line_top = y + i * lh
        baseline = baseline_of(0, lh, size)
        anim = {"kind": "wipe-x", "start": 0.55 + i * 0.14, "dur": 0.5}
        if spec.get("emphasis") == "underline":
            bh = max(8, size * 0.085)
            out.append(el({"x": lx, "y": line_top + baseline + size * 0.14, "w": lw, "h": bh}, [rect(0, 0, lw, bh, bh / 2, theme["accent"], 1)], anim))
        else:
            px = size * 0.16
            mh = size * 0.98
            mb = {"x": lx - px, "y": line_top + lh / 2 - mh / 2, "w": lw + 2 * px, "h": mh}
            out.append(el(mb, [rect(0, 0, mb["w"], mb["h"], size * 0.1, theme["accent"], 1)], anim))
            out.append(el(mb, [{"type": "text", "runs": [run(line, px, baseline - (mb["y"] - line_top), size, font, theme["accentText"])]}], anim))
    return out, height


def layout_compare(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    pad = 40 * s
    gap = (64 if c.vertical else 96) * s
    card_w = box["w"] if c.vertical else (box["w"] - gap) / 2
    font = (c.family, 800)
    size = min(
        fit_text(fonts, spec["left"]["text"], font, 60 * s, 32 * s, card_w - 2 * pad, 3).size,
        fit_text(fonts, spec["right"]["text"], font, 60 * s, 32 * s, card_w - 2 * pad, 3).size,
    )
    left = fit_text(fonts, spec["left"]["text"], font, size, size, card_w - 2 * pad, 3)
    right = fit_text(fonts, spec["right"]["text"], font, size, size, card_w - 2 * pad, 3)
    lh = size * 1.18
    pill_h = 54 * s
    pill_gap = 24 * s
    card_h = pad + pill_h + pill_gap + max(len(left.lines), len(right.lines)) * lh + pad
    height = 2 * card_h + gap if c.vertical else card_h
    top = box["y"] + (box["h"] - height) / 2
    second = max(0.5, min(1.1, c.duration * 0.3))

    def card(x: float, y: float, side: dict[str, str], fitted: Fitted, strong: bool) -> Element:
        prun, pw, ps = eyebrow(fonts, side["label"], 28 * s, card_w - 2 * pad - 48 * s, theme["accentText"] if strong else theme["muted"])
        pill_w = pw + 48 * s
        runs = [{**r, "x": r["x"] + pad, "baseline": r["baseline"] + pad + pill_h + pill_gap} for r in text_runs(fitted, font, theme["text"] if strong else theme["muted"], lh, card_w - 2 * pad, "left")]
        return el(
            {"x": x, "y": y, "w": card_w, "h": card_h},
            [
                rect(0, 0, card_w, card_h, 34 * s, theme["surface"], 0.92 if c.overlay else 1, theme["accent"] if strong else theme["muted"], 1 if strong else 0.3, max(2, (3 if strong else 2) * s)),
                rect(pad, pad, pill_w, pill_h, pill_h / 2, theme["accent"] if strong else theme["muted"], 1 if strong else 0.18),
                {"type": "text", "runs": [{**prun, "x": pad + 24 * s, "baseline": pad + pill_h / 2 + ps * 0.35}]},
                {"type": "text", "runs": runs},
            ],
            {"kind": "up", "start": second if strong else 0.05, "dur": 0.5, "dist": 40 * s},
        )

    x1, y1 = box["x"], top
    x2 = box["x"] if c.vertical else box["x"] + card_w + gap
    y2 = top + card_h + gap if c.vertical else top
    out = [card(x1, y1, spec["left"], left, False)]
    sh = max(5, size * 0.07)
    strikes = [rect(0, baseline_of(i, lh, size) - size * 0.3 - sh / 2, left.widths[i], sh, sh / 2, theme["accent"], 0.95) for i in range(len(left.lines))]
    text_top = y1 + pad + pill_h + pill_gap
    out.append(el({"x": x1 + pad, "y": text_top, "w": max(left.widths), "h": len(left.lines) * lh}, strikes, {"kind": "wipe-x", "start": second + 0.4, "dur": 0.45}))
    out.append(card(x2, y2, spec["right"], right, True))
    d = 84 * s
    bcx = box["x"] + box["w"] / 2 if c.vertical else x1 + card_w + gap / 2
    bcy = y1 + card_h + gap / 2 if c.vertical else top + card_h / 2
    aw = max(4, 6 * s)
    arm = d * 0.22
    arrow = (
        {"type": "arrow", "x1": d / 2, "y1": d / 2 - arm, "x2": d / 2, "y2": d / 2 + arm, "color": theme["accent"], "width": aw}
        if c.vertical
        else {"type": "arrow", "x1": d / 2 - arm, "y1": d / 2, "x2": d / 2 + arm, "y2": d / 2, "color": theme["accent"], "width": aw}
    )
    out.append(
        el(
            {"x": bcx - d / 2, "y": bcy - d / 2, "w": d, "h": d},
            [{"type": "circle", "cx": d / 2, "cy": d / 2, "r": d / 2, "fill": theme["surface"] if c.overlay else theme["bg"], "alpha": 1, "stroke": theme["accent"], "strokeWidth": max(2, 3 * s)}, arrow],
            {"kind": "pop", "start": second - 0.12, "dur": 0.45, "from": 0.4},
        )
    )
    return out, height


def layout_flow(spec: dict[str, Any], c: Ctx) -> tuple[list[Element], float]:
    fonts, box, s, theme = c.fonts, c.box, c.s, c.theme
    font = (c.family, 800)
    title = eyebrow(fonts, spec["title"], 34 * s, box["w"], theme["accent"]) if spec.get("title") else None
    title_gap = 36 * s
    pad = 30 * s
    conn = (74 if c.vertical else 92) * s
    node_w = min(box["w"], 760 * s) if c.vertical else (box["w"] - 2 * conn) / 3
    max_lines = 2 if c.vertical else 3
    size = min(fit_text(fonts, st, font, 54 * s, 30 * s, node_w - 2 * pad, max_lines).size for st in spec["steps"])
    steps = [fit_text(fonts, st, font, size, size, node_w - 2 * pad, max_lines) for st in spec["steps"]]
    lh = size * 1.16
    num_size = rnd(26 * s)
    num_h = num_size * 1.3
    num_gap = 10 * s
    node_h = pad + num_h + num_gap + max(len(x.lines) for x in steps) * lh + pad
    title_h = title[2] * 1.2 + title_gap if title else 0
    height = title_h + (3 * node_h + 2 * conn if c.vertical else node_h)
    y = box["y"] + (box["h"] - height) / 2
    cx = box["x"] + box["w"] / 2
    out: list[Element] = []
    if title:
        trun, tw, ts = title
        out.append(el({"x": cx - tw / 2, "y": y, "w": tw, "h": ts * 1.2}, [{"type": "text", "runs": [{**trun, "baseline": ts * 0.6 + ts * 0.35}]}], {"kind": "up", "start": 0, "dur": 0.45, "dist": 24 * s}))
        y += title_h
    step = max(0.35, min(0.75, (c.duration - 1.4) / 3))
    num_font = ("inter", 700)
    nodes = [
        ({"x": cx - node_w / 2, "y": y + i * (node_h + conn), "w": node_w, "h": node_h} if c.vertical else {"x": box["x"] + i * (node_w + conn), "y": y, "w": node_w, "h": node_h})
        for i in range(len(steps))
    ]
    for i, st in enumerate(steps):
        last = i == len(steps) - 1
        n = nodes[i]
        start = 0.15 + i * step
        num = f"0{i + 1}"
        color = theme["accentText"] if last else theme["text"]
        align = "center" if c.vertical else "left"
        inner_w = node_w - 2 * pad
        runs = [{**r, "x": r["x"] + pad, "baseline": r["baseline"] + pad + num_h + num_gap} for r in text_runs(st, font, color, lh, inner_w, align)]
        num_w = spaced_width(fonts, num, num_font, num_size, rnd(num_size * 0.16))
        out.append(
            el(
                n,
                [
                    rect(0, 0, n["w"], n["h"], 30 * s, theme["accent"] if last else theme["surface"], 1 if last or not c.overlay else 0.92, theme["accent"], 0 if last else 0.4, max(2, 2 * s)),
                    {"type": "text", "runs": [run(num, (n["w"] - num_w) / 2 if align == "center" else pad, pad + num_h / 2 + num_size * 0.35, num_size, num_font, theme["accentText"] if last else theme["accent"], rnd(num_size * 0.16))]},
                    {"type": "text", "runs": runs},
                ],
                {"kind": "pop", "start": start, "dur": 0.5, "from": 0.86},
            )
        )
        if not last:
            nxt = nodes[i + 1]
            aw = max(4, 6 * s)
            g = 12 * s
            if c.vertical:
                y0 = n["y"] + n["h"] + g
                y1 = nxt["y"] - g
                out.append(el({"x": cx - 20 * s, "y": y0, "w": 40 * s, "h": y1 - y0}, [{"type": "arrow", "x1": 20 * s, "y1": 0, "x2": 20 * s, "y2": y1 - y0, "color": theme["accent"], "width": aw}], {"kind": "wipe-y", "start": start + 0.3, "dur": step * 0.75}))
            else:
                x0 = n["x"] + n["w"] + g
                x1 = nxt["x"] - g
                out.append(el({"x": x0, "y": n["y"] + n["h"] / 2 - 20 * s, "w": x1 - x0, "h": 40 * s}, [{"type": "arrow", "x1": 0, "y1": 20 * s, "x2": x1 - x0, "y2": 20 * s, "color": theme["accent"], "width": aw}], {"kind": "wipe-x", "start": start + 0.3, "dur": step * 0.75}))
    return out, height


LAYOUTS: dict[str, Callable[[dict[str, Any], Ctx], tuple[list[Element], float]]] = {
    "number": layout_number,
    "list": layout_list,
    "quote": layout_quote,
    "keyword": layout_keyword,
    "compare": layout_compare,
    "flow": layout_flow,
}


# ─── Dibujo ───────────────────────────────────────────────────────────────


def rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgba(hex_color: str, alpha: float) -> tuple[int, int, int, int]:
    return (*rgb(hex_color), rnd(max(0.0, min(1.0, alpha)) * 255))


def _text_layer(img: Image.Image, fonts: Fonts, r: dict[str, Any], ox: float, oy: float, k: float) -> None:
    """Texto con alfa correcto: la forma de las letras va como máscara de una capa del color (sin bordes oscuros)."""
    font = fonts.font(r["font"][0], r["font"][1], rnd(r["size"] * k))
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    x = (ox + r["x"]) * k
    y = (oy + r["baseline"]) * k
    if not r.get("spacing"):
        draw.text((x, y), r["text"], font=font, fill=255, anchor="ls")
    else:
        for ch in r["text"]:
            draw.text((x, y), ch, font=font, fill=255, anchor="ls")
            x += fonts.measure(ch, r["font"], r["size"]) * k + r["spacing"] * k
    layer = Image.new("RGBA", img.size, (*rgb(r["color"]), 0))
    layer.putalpha(mask)
    img.alpha_composite(layer)


def _shape_layer(size: tuple[int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    return layer, ImageDraw.Draw(layer)


def _paint(img: Image.Image, fonts: Fonts, p: dict[str, Any], ox: float, oy: float, k: float, box: tuple[float, float]) -> None:
    """Dibuja una pieza (en coordenadas de la caja) sobre `img`, que está a escala k y tiene el margen en ox, oy."""
    kind = p["type"]
    if kind == "text":
        for r in p["runs"]:
            _text_layer(img, fonts, r, ox, oy, k)
        return
    layer, draw = _shape_layer(img.size)
    if kind == "rect":
        x0, y0 = (ox + p["x"]) * k, (oy + p["y"]) * k
        x1, y1 = x0 + p["w"] * k, y0 + p["h"] * k
        if x1 - x0 < 1 or y1 - y0 < 1:
            return
        r = min(p["r"] * k, (x1 - x0) / 2, (y1 - y0) / 2)
        draw.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=rgba(p["fill"], p["alpha"]))
        if p.get("stroke") and p.get("strokeWidth") and p.get("strokeAlpha", 1) > 0:
            outline, odraw = _shape_layer(img.size)
            odraw.rounded_rectangle((x0, y0, x1, y1), radius=r, outline=rgba(p["stroke"], p.get("strokeAlpha", 1)), width=max(1, rnd(p["strokeWidth"] * k)))
            layer = Image.alpha_composite(layer, outline)
    elif kind == "circle":
        cx, cy, rr = (ox + p["cx"]) * k, (oy + p["cy"]) * k, p["r"] * k
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=rgba(p["fill"], p["alpha"]))
        if p.get("stroke") and p.get("strokeWidth"):
            draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=rgba(p["stroke"], 1), width=max(1, rnd(p["strokeWidth"] * k)))
    elif kind == "arrow":
        _arrow(draw, p, ox, oy, k)
    elif kind == "glow":
        layer = _glow(img.size, p, ox, oy, k, box)
    img.alpha_composite(layer)


def _arrow(draw: ImageDraw.ImageDraw, p: dict[str, Any], ox: float, oy: float, k: float) -> None:
    x1, y1, x2, y2 = ((ox + p["x1"]) * k, (oy + p["y1"]) * k, (ox + p["x2"]) * k, (oy + p["y2"]) * k)
    w = p["width"] * k
    color = rgba(p["color"], 1)
    angle = math.atan2(y2 - y1, x2 - x1)
    head = p["width"] * 3 * k
    points = [(x1, y1), (x2, y2)]
    wings = [(x2 - head * math.cos(angle - math.pi / 5), y2 - head * math.sin(angle - math.pi / 5)), (x2 - head * math.cos(angle + math.pi / 5), y2 - head * math.sin(angle + math.pi / 5))]
    for a, b in [points, (wings[0], (x2, y2)), (wings[1], (x2, y2))]:
        draw.line([a, b], fill=color, width=max(1, rnd(w)))
        for cx, cy in (a, b):  # puntas redondeadas
            draw.ellipse((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), fill=color)


def _glow(size: tuple[int, int], p: dict[str, Any], ox: float, oy: float, k: float, box: tuple[float, float]) -> Image.Image:
    """Resplandor radial (elipse que llena la caja): las mismas paradas que el degradado del navegador."""
    w, h = size
    bw, bh = box[0] * k, box[1] * k
    cx, cy = ox * k + bw / 2, oy * k + bh / 2
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xs - cx) / (bw / 2)) ** 2 + ((ys - cy) / (bh / 2)) ** 2)
    a = np.interp(d, [0, 0.55, 1], [p["alpha"], p["alpha"] * 0.35, 0]).astype(np.float32)
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., :3] = rgb(p["color"])
    arr[..., 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def element_sprite(fonts: Fonts, e: Element) -> Image.Image:
    """El elemento entero (con su margen) a escala 1, dibujado a 2x y reducido."""
    pad = e.pad
    w1, h1 = max(1, math.ceil(e.w + 2 * pad)), max(1, math.ceil(e.h + 2 * pad))
    big = Image.new("RGBA", (w1 * SS, h1 * SS), (0, 0, 0, 0))
    for p in e.paints:
        if p["type"] != "counter":
            _paint(big, fonts, p, pad, pad, SS, (e.w, e.h))
    return big.resize((w1, h1), Image.Resampling.LANCZOS)


def counter_sprite(scene: Scene, e: Element, t: float) -> Image.Image:
    fonts = scene.fonts
    c = next(p["counter"] for p in e.paints if p["type"] == "counter")
    pad = e.pad
    img = Image.new("RGBA", (max(1, math.ceil(e.w + 2 * pad)), max(1, math.ceil(e.h + 2 * pad))), (0, 0, 0, 0))
    digits = counter_text(scene, c, t)
    right = c["right"]
    dw = fonts.measure(digits, c["font"], c["size"])
    pw = fonts.measure(c["prefix"], c["font"], c["size"])
    for text, x, color in ((c["suffix"], right, c["affixColor"]), (digits, right - dw, c["digitsColor"]), (c["prefix"], right - dw - pw, c["affixColor"])):
        if text:
            _text_layer(img, fonts, run(text, x, c["baseline"], c["size"], c["font"], color), pad, pad, 1)
    return img


def background(scene: Scene) -> Image.Image:
    """Fondo de pantalla completa: color de la marca, resplandor del acento arriba y una grilla casi invisible."""
    w, h = scene.width, scene.height
    theme = scene.theme
    arr = np.zeros((h, w, 3), dtype=np.float32)
    arr[...] = rgb(theme["bg"])
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    # Resplandor elíptico arriba al centro (como el fondo de la app).
    d = np.sqrt(((xs - w * 0.5) / (w * 0.95)) ** 2 + ((ys + h * 0.05) / (h * 0.55)) ** 2)
    a = np.interp(d, [0, 0.5, 1], [0.22, 0.1, 0])[..., None]
    arr = arr * (1 - a) + np.array(rgb(theme["accent"]), dtype=np.float32) * a
    # Grilla de 48 px (escala del formato) en el color del texto, muy suave.
    step = 48 * min(w, h) / 1080
    lines = ((np.mod(xs, step) < 1.0) | (np.mod(ys, step) < 1.0))[..., None]
    arr = np.where(lines, arr * 0.955 + np.array(rgb(theme["text"]), dtype=np.float32) * 0.045, arr)
    out = np.dstack([np.clip(arr + 0.5, 0, 255).astype(np.uint8), np.full((h, w), 255, dtype=np.uint8)])
    return Image.fromarray(out)


def veil_layer(scene: Scene) -> Image.Image:
    w, h = scene.width, scene.height
    stops = scene.veil or []
    ys = (np.arange(h, dtype=np.float32) + 0.5) / h
    a = np.interp(ys, [s[0] for s in stops], [s[1] for s in stops])
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., :3] = rgb(scene.theme["bg"])
    arr[..., 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)[:, None]
    return Image.fromarray(arr)


def _composite(frame: Image.Image, sprite: Image.Image, x: int, y: int) -> None:
    """Pega con transparencia (la parte que cae fuera del cuadro se recorta)."""
    fw, fh = frame.size
    sw, sh = sprite.size
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(fw, x + sw), min(fh, y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    if (x0, y0, x1, y1) != (x, y, x + sw, y + sh):
        sprite = sprite.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    frame.alpha_composite(sprite, (x0, y0))


def draw_frame(scene: Scene, t: float, base: Image.Image) -> Image.Image:
    frame = base.copy()
    for e in scene.elements:
        st = element_state(scene, e, t)
        if st["opacity"] <= 0.003:
            continue
        has_counter = any(p["type"] == "counter" for p in e.paints)
        sprite = counter_sprite(scene, e, t) if has_counter else e.sprite
        if sprite is None:
            sprite = e.sprite = element_sprite(scene.fonts, e)
        pad = e.pad
        if st["reveal"] < 1:
            kind = e.anim["kind"]
            if st["reveal"] <= 0:
                continue
            if kind == "wipe-x":
                sprite = sprite.crop((0, 0, max(1, rnd(pad + e.w * st["reveal"])), sprite.size[1]))
            else:
                sprite = sprite.crop((0, 0, sprite.size[0], max(1, rnd(pad + e.h * st["reveal"]))))
        x = e.x - pad + st["dx"]
        y = e.y - pad + st["dy"]
        if abs(st["scale"] - 1) > 0.002:
            sw, sh = sprite.size
            nw, nh = max(1, rnd(sw * st["scale"])), max(1, rnd(sh * st["scale"]))
            sprite = sprite.resize((nw, nh), Image.Resampling.BILINEAR)
            x += (sw - nw) / 2
            y += (sh - nh) / 2
        if st["opacity"] < 0.997:
            alpha = sprite.getchannel("A").point(lambda v, o=st["opacity"]: rnd(v * o))
            sprite = sprite.copy()
            sprite.putalpha(alpha)
        _composite(frame, sprite, rnd(x), rnd(y))
    return frame


# ─── Validación y render ──────────────────────────────────────────────────


def validate_spec(spec: Any) -> dict[str, Any]:
    """Revisión defensiva (la app ya lo validó con Zod): plantilla, modo, colores y textos."""
    if not isinstance(spec, dict) or spec.get("template") not in TEMPLATES:
        raise JobError("Un gráfico del b-roll no es válido. Cámbialo en la revisión.", retry=False)
    if spec.get("mode") not in ("full", "overlay") or spec.get("font") not in ("inter", "montserrat"):
        raise JobError("Un gráfico del b-roll no es válido. Cámbialo en la revisión.", retry=False)
    theme = spec.get("theme") or {}
    if not all(isinstance(theme.get(k), str) and HEX.match(theme[k]) for k in ("bg", "surface", "text", "muted", "accent", "accentText")):
        raise JobError("Los colores de un gráfico no son válidos. Cámbialo en la revisión.", retry=False)
    return spec


def cache_name(spec: dict[str, Any], size: tuple[int, int], duration: float) -> str:
    key = json.dumps({"spec": spec, "size": list(size), "duration": round(duration, 3), "v": 1}, sort_keys=True, ensure_ascii=False)
    ext = "mov" if spec["mode"] == "overlay" else "mp4"
    return f"graphic-{hashlib.sha1(key.encode()).hexdigest()[:16]}.{ext}"


def render_graphic(spec: dict[str, Any], duration: float, size: tuple[int, int], out: Path, fonts_dir: Path, on_frame: Callable[[float], None] | None = None) -> Path:
    """Dibuja el gráfico y lo codifica. Si el archivo ya existe (misma caché), no hace nada."""
    if out.exists() and out.stat().st_size > 0:
        return out
    spec = validate_spec(spec)
    fonts = Fonts(fonts_dir)
    w, h = size
    frames = max(1, rnd(duration * FPS))
    scene = build_scene(spec, w, h, duration, fonts)
    for e in scene.elements:
        if not any(p["type"] == "counter" for p in e.paints):
            e.sprite = element_sprite(fonts, e)
    base = background(scene) if scene.mode == "full" else veil_layer(scene)
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    codec = (
        ["-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-g", str(FPS)]
        if scene.mode == "full"
        else ["-c:v", "qtrle", "-pix_fmt", "argb"]
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
        "-frames:v", str(frames), *codec, "-an", str(tmp),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert proc.stdin is not None
        for i in range(frames):
            proc.stdin.write(draw_frame(scene, i / FPS, base).tobytes())
            if on_frame:
                on_frame((i + 1) / frames)
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        code = proc.wait()
    except BrokenPipeError:
        err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        code = proc.wait()
    if code != 0:
        tmp.unlink(missing_ok=True)
        raise JobError("No pudimos dibujar un gráfico del b-roll.", detail=err[-800:])
    os.replace(tmp, out)
    return out


def still(spec: dict[str, Any], t: float, duration: float, size: tuple[int, int], fonts_dir: Path) -> Image.Image:
    """Un cuadro suelto (para pruebas y capturas), sobre negro en el modo "overlay"."""
    fonts = Fonts(fonts_dir)
    scene = build_scene(validate_spec(spec), size[0], size[1], duration, fonts)
    base = background(scene) if scene.mode == "full" else veil_layer(scene)
    return draw_frame(scene, t, base)
