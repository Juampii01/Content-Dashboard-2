"""Medidas de un slide de referencia: cajas de texto con Tesseract, colores por zona con k-means (numpy + Pillow),
fondo, zona de foto, adornos y la fuente más parecida entre las autoalojadas.

Solo sale **geometría y color**: posición y tamaño de cada bloque de texto, su color, el color de los resaltados,
la alineación y la fuente parecida. El texto leído por Tesseract se usa en memoria (para contar caracteres, saber si un
bloque es un número o un @ y comparar fuentes) y se descarta: nunca se devuelve ni se guarda.

Todas las medidas se expresan sobre el slide normalizado a 1080 px de ancho; las posiciones, en fracciones (0 a 1).
"""

from __future__ import annotations

import csv
import io
import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("worker.carruseles")

WIDTH = 1080
MIN_CONF = 55
TESSERACT_TIMEOUT = 60
FONTS_DIR = Path(__file__).resolve().parent / "fuentes"

# Fuentes candidatas (las mismas claves que lib/carousels/theme.ts → FONTS) con los pesos que se prueban.
FONT_CANDIDATES: dict[str, tuple[str, list[int | None]]] = {
    "inter": ("inter-latin-wght-normal.woff2", [400, 500, 600, 800]),
    "montserrat": ("montserrat-latin-wght-normal.woff2", [500, 800]),
    "playfair": ("playfair-display-latin-wght-normal.woff2", [400, 700]),
    "instrument": ("instrument-serif-latin-400-normal.woff2", [None]),
    "oswald": ("oswald-latin-wght-normal.woff2", [400, 600]),
    "anton": ("anton-latin-400-normal.woff2", [None]),
    "caveat": ("caveat-latin-wght-normal.woff2", [500, 700]),
    "mono": ("jetbrains-mono-latin-wght-normal.woff2", [500, 700]),
}


class OcrMissing(RuntimeError):
    """Tesseract no está instalado en el worker."""


# ─── Color ────────────────────────────────────────────────────────────────


def to_hex(rgb: Any) -> str:
    r, g, b = (int(max(0, min(255, round(float(v))))) for v in list(rgb)[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def from_hex(value: str) -> np.ndarray:
    return np.array([int(value[i : i + 2], 16) for i in (1, 3, 5)], np.float32)


def luminance(rgb: Any) -> float:
    def ch(v: float) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (float(x) for x in list(rgb)[:3])
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def saturation(rgb: Any) -> float:
    r, g, b = (float(x) / 255 for x in list(rgb)[:3])
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def distance(a: Any, b: Any) -> float:
    return float(np.sqrt(((np.asarray(a, np.float32) - np.asarray(b, np.float32)) ** 2).sum()))


def is_colorful(rgb: Any) -> bool:
    """Un color de acento: saturado y no casi negro (los grises oscuros con tinte no cuentan)."""
    return saturation(rgb) > 0.4 and max(float(x) for x in list(rgb)[:3]) > 80


def kmeans(pixels: np.ndarray, k: int, iters: int = 12, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """k-means simple (inicio k-means++ determinista). Devuelve (centros, proporción), de mayor a menor."""
    data = pixels.reshape(-1, 3).astype(np.float32)
    if len(data) == 0:
        return np.zeros((0, 3), np.float32), np.zeros(0, np.float32)
    k = max(1, min(k, len(np.unique(data, axis=0))))
    rng = np.random.default_rng(seed)
    centers = [data[rng.integers(len(data))]]
    for _ in range(1, k):
        dist = np.min(((data[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(-1), axis=1)
        total = float(dist.sum())
        if total <= 0:
            break
        centers.append(data[rng.choice(len(data), p=dist / total)])
    c = np.array(centers, np.float32)
    labels = np.zeros(len(data), np.int64)
    for _ in range(iters):
        labels = ((data[:, None, :] - c[None, :, :]) ** 2).sum(-1).argmin(1)
        new = np.array([data[labels == i].mean(0) if np.any(labels == i) else c[i] for i in range(len(c))], np.float32)
        done = np.allclose(new, c, atol=0.5)
        c = new
        if done:
            break
    counts = np.bincount(labels, minlength=len(c)).astype(np.float32)
    order = np.argsort(-counts)
    return c[order], counts[order] / counts.sum()


def palette_of(pixels: np.ndarray, k: int = 5) -> list[dict[str, Any]]:
    """Colores dominantes con su proporción (une los casi iguales)."""
    flat = pixels.reshape(-1, 3)
    if len(flat) > 25_000:
        flat = flat[:: len(flat) // 25_000 + 1]
    centers, shares = kmeans(flat, k)
    out: list[dict[str, Any]] = []
    for c, s in zip(centers, shares):
        same = next((o for o in out if distance(o["_rgb"], c) < 20), None)
        if same:
            same["share"] = round(same["share"] + float(s), 4)
            continue
        out.append({"hex": to_hex(c), "_rgb": c, "share": round(float(s), 4)})
    out.sort(key=lambda o: -o["share"])
    return [{"hex": o["hex"], "share": o["share"]} for o in out]


def mode_color(img: np.ndarray, mask: np.ndarray | None = None) -> tuple[np.ndarray, float]:
    """Color más repetido (cuantizado a 4 bits por canal) y su proporción. Sirve para hallar el fondo plano."""
    px = img[::3, ::3]
    if mask is not None:
        px = px[~mask[::3, ::3]]
    px = px.reshape(-1, 3).astype(np.int32)
    if len(px) == 0:
        return np.array([0, 0, 0], np.float32), 0.0
    q = (px >> 4) * np.array([256, 16, 1])
    keys = q.sum(1)
    counts = np.bincount(keys, minlength=4096)
    top = int(counts.argmax())
    sel = px[keys == top]
    return sel.mean(0).astype(np.float32), float(counts[top]) / len(px)


# ─── OCR ──────────────────────────────────────────────────────────────────


@dataclass
class Word:
    x: int
    y: int
    w: int
    h: int
    conf: float
    text: str
    color: np.ndarray = field(default_factory=lambda: np.zeros(3, np.float32))
    back: np.ndarray = field(default_factory=lambda: np.zeros(3, np.float32))

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def ocr_langs() -> str:
    try:
        out = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return "eng"
    have = {line.strip() for line in out.splitlines()[1:]}
    return "+".join(lang for lang in ("spa", "eng") if lang in have) or "eng"


def ocr_words(gray: Image.Image, langs: str) -> list[Word]:
    """Palabras con caja y confianza (TSV de Tesseract)."""
    buf = io.BytesIO()
    gray.save(buf, format="PNG")
    try:
        res = subprocess.run(["tesseract", "stdin", "stdout", "-l", langs, "--psm", "11", "tsv"], input=buf.getvalue(), capture_output=True, timeout=TESSERACT_TIMEOUT)
    except FileNotFoundError as exc:
        raise OcrMissing("tesseract no está instalado") from exc
    except subprocess.TimeoutExpired:
        log.warning("tesseract tardó demasiado; sigo sin texto en este slide")
        return []
    if res.returncode != 0:
        log.warning("tesseract falló (código %s)", res.returncode)
        return []
    words: list[Word] = []
    for row in csv.DictReader(io.StringIO(res.stdout.decode("utf-8", "ignore")), delimiter="\t", quoting=csv.QUOTE_NONE):
        try:
            if row.get("level") != "5":
                continue
            text = (row.get("text") or "").strip()
            conf = float(row.get("conf") or -1)
            w, h = int(row["width"]), int(row["height"])
        except (KeyError, ValueError):
            continue
        if not text or conf < MIN_CONF or w < 4 or h < 8:
            continue
        if not any(c.isalnum() for c in text):
            continue  # signos sueltos: casi siempre ruido de una foto o un adorno
        words.append(Word(int(row["left"]), int(row["top"]), w, h, conf, text))
    return words


def _overlap(a: Word, b: Word) -> float:
    ix = max(0, min(a.x2, b.x2) - max(a.x, b.x))
    iy = max(0, min(a.y2, b.y2) - max(a.y, b.y))
    return ix * iy / max(1, min(a.w * a.h, b.w * b.h))


def merge_passes(*passes: list[Word]) -> list[Word]:
    """Une la pasada normal y la invertida (texto claro sobre oscuro) sin duplicar palabras."""
    out: list[Word] = []
    for words in passes:
        for w in words:
            dup = next((i for i, o in enumerate(out) if _overlap(o, w) > 0.2), None)
            if dup is None:
                out.append(w)
            elif w.conf > out[dup].conf:
                out[dup] = w
    return out


# ─── Colores de cada palabra ──────────────────────────────────────────────


def word_colors(img: np.ndarray, word: Word) -> None:
    """Color de la tinta y del fondo de una palabra: k-means 2 dentro de su caja; el fondo es el del borde."""
    h, w = img.shape[:2]
    x0, y0, x1, y1 = max(0, word.x), max(0, word.y), min(w, word.x2), min(h, word.y2)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        return
    centers, _ = kmeans(crop[:: max(1, crop.shape[0] // 30), :: max(1, crop.shape[1] // 90)], 2)
    edge = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]]).astype(np.float32)
    bg = np.median(edge, axis=0)
    if len(centers) < 2:
        word.color, word.back = centers[0], bg
        return
    a, b = centers[0], centers[1]
    fg = a if distance(a, bg) > distance(b, bg) else b
    word.color, word.back = fg, bg


# ─── Líneas y bloques (solo por geometría) ────────────────────────────────


@dataclass
class Line:
    words: list[Word]

    @property
    def x(self) -> int:
        return min(w.x for w in self.words)

    @property
    def y(self) -> int:
        return min(w.y for w in self.words)

    @property
    def x2(self) -> int:
        return max(w.x2 for w in self.words)

    @property
    def y2(self) -> int:
        return max(w.y2 for w in self.words)

    @property
    def height(self) -> float:
        return float(np.median([w.h for w in self.words]))

    @property
    def chars(self) -> int:
        return sum(len(w.text) for w in self.words)

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


def group_lines(words: list[Word]) -> list[Line]:
    """Primero filas (misma altura en la página y tamaño parecido); después cada fila se corta donde hay un hueco grande."""
    rows: list[list[Word]] = []
    for w in sorted(words, key=lambda w: w.cy):
        target = None
        for row in rows:
            rh = float(np.median([v.h for v in row]))
            same_row = abs(float(np.mean([v.cy for v in row])) - w.cy) < 0.4 * max(rh, w.h)
            similar = abs(rh - w.h) < 0.5 * max(rh, w.h)
            if same_row and similar:
                target = row
                break
        if target is not None:
            target.append(w)
        else:
            rows.append([w])
    lines: list[Line] = []
    for row in rows:
        row.sort(key=lambda v: v.x)
        rh = float(np.median([v.h for v in row]))
        current = [row[0]]
        for w in row[1:]:
            if w.x - max(v.x2 for v in current) > 2.2 * rh:
                lines.append(Line(current))
                current = [w]
            else:
                current.append(w)
        lines.append(Line(current))
    return sorted(lines, key=lambda line: (line.y, line.x))


def group_blocks(lines: list[Line]) -> list[list[Line]]:
    """Bloques = líneas seguidas, de altura parecida y poca separación (un titular de 3 líneas es un bloque)."""
    blocks: list[list[Line]] = []
    for line in sorted(lines, key=lambda line: line.y):
        target = None
        for b in blocks:
            last = b[-1]
            gap = line.y - last.y2
            similar = abs(last.height - line.height) < 0.3 * max(last.height, line.height)
            left, right = min(l.x for l in b), max(l.x2 for l in b)
            horiz = line.x <= right + last.height and line.x2 >= left - last.height
            if similar and horiz and -0.3 * last.height <= gap < 1.0 * max(last.height, line.height):
                target = b
        if target is not None:
            target.append(line)
        else:
            blocks.append([line])
    return blocks


# ─── Fuente más parecida ──────────────────────────────────────────────────

_font_cache: dict[tuple[str, int | None, int], ImageFont.FreeTypeFont] = {}


def _font(key: str, weight: int | None, size: int) -> ImageFont.FreeTypeFont | None:
    file, _ = FONT_CANDIDATES[key]
    cache_key = (key, weight, size)
    if cache_key in _font_cache:
        return _font_cache[cache_key]
    try:
        font = ImageFont.truetype(str(FONTS_DIR / file), size)
        if weight is not None:
            try:
                font.set_variation_by_axes([weight])
            except (OSError, ValueError):
                pass
    except OSError:
        return None
    _font_cache[cache_key] = font
    return font


def _ink(gray: np.ndarray, line: Line, light_text: bool) -> np.ndarray | None:
    pad = max(2, int(line.height * 0.12))
    crop = gray[max(0, line.y - pad) : line.y2 + pad, max(0, line.x - pad) : line.x2 + pad].astype(np.float32)
    if crop.size == 0:
        return None
    thr = (float(crop.max()) + float(crop.min())) / 2
    ink = crop > thr if light_text else crop < thr
    rows, cols = np.where(ink.any(1))[0], np.where(ink.any(0))[0]
    if len(rows) < 4 or len(cols) < 4:
        return None
    return ink[rows.min() : rows.max() + 1, cols.min() : cols.max() + 1]


def _render(text: str, key: str, weight: int | None, height: int) -> np.ndarray | None:
    return _render_size(text, key, weight, max(12, int(height * 1.3)))


def font_size(gray: np.ndarray, lines: list[Line], light_text: bool, key: str, weight: int | None) -> float | None:
    """Tamaño de letra en px: se dibuja el mismo texto con la fuente elegida a 100 px y se compara la altura de la tinta."""
    sizes = []
    for line in lines:
        if len(line.text) < 2:
            continue
        ink = _ink(gray, line, light_text)
        ref = _render_size(line.text, key, weight, 100)
        if ink is None or ref is None or ref.shape[0] < 5:
            continue
        # Por alto y por ancho: el alto se infla con tildes que el OCR no leyó; el ancho, con el espaciado. Se promedian.
        by_height = 100 * ink.shape[0] / ref.shape[0]
        by_width = 100 * ink.shape[1] / ref.shape[1]
        sizes.append(float(np.sqrt(by_height * by_width)) if 0.6 < by_width / by_height < 1.6 else min(by_height, by_width))
    return round(float(np.median(sizes)), 1) if sizes else None


def _render_size(text: str, key: str, weight: int | None, size: int) -> np.ndarray | None:
    font = _font(key, weight, size)
    if font is None:
        return None
    left, top, right, bottom = font.getbbox(text)
    if right - left < 2 or bottom - top < 2:
        return None
    im = Image.new("L", (right - left + 8, bottom - top + 8), 0)
    ImageDraw.Draw(im).text((4 - left, 4 - top), text, font=font, fill=255)
    arr = np.asarray(im) > 127
    rows, cols = np.where(arr.any(1))[0], np.where(arr.any(0))[0]
    if not len(rows):
        return None
    return arr[rows.min() : rows.max() + 1, cols.min() : cols.max() + 1]


def _resize(mask: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), np.float32) / 255


def match_font(gray: np.ndarray, lines: list[Line], light_text: bool) -> list[dict[str, Any]]:
    """Compara las líneas más grandes con cada fuente candidata dibujada con el mismo texto.

    Puntaje = parecido de la forma (correlación de las máscaras a la misma caja) menos la diferencia de proporción
    (ancho/alto). Devuelve las candidatas ordenadas de mejor a peor.
    """
    scores: dict[str, list[float]] = {}
    best_weight: dict[str, tuple[float, int | None]] = {}
    used = 0
    for line in sorted(lines, key=lambda line: -line.height * line.chars):
        if used >= 3:
            break
        text = line.text
        if len(text) < 4:
            continue
        ink = _ink(gray, line, light_text)
        if ink is None or ink.shape[0] < 10:
            continue
        used += 1
        H = 40
        W = max(8, int(ink.shape[1] * H / ink.shape[0]))
        target = _resize(ink, W, H)
        t = target - target.mean()
        for key, (_, weights) in FONT_CANDIDATES.items():
            best = -9.0
            for weight in weights:
                rendered = _render(text, key, weight, ink.shape[0])
                if rendered is None:
                    continue
                ratio = (rendered.shape[1] / rendered.shape[0]) / (ink.shape[1] / ink.shape[0])
                r = _resize(rendered, W, H)
                r = r - r.mean()
                corr = float((t * r).sum() / (np.sqrt((t * t).sum() * (r * r).sum()) + 1e-6))
                score = corr - 0.9 * abs(float(np.log(ratio)))
                if score > best:
                    best = score
                if score > best_weight.get(key, (-9.0, None))[0]:
                    best_weight[key] = (score, weight)
            scores.setdefault(key, []).append(best)
    ranked = sorted(
        ({"font": k, "score": round(float(np.mean(v)), 3), "weight": best_weight.get(k, (0, None))[1]} for k, v in scores.items()),
        key=lambda d: -d["score"],
    )
    return ranked


def line_upper(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.8


# ─── Rasgos de un bloque ──────────────────────────────────────────────────


def alignment(block: list[Line], width: int) -> str:
    if len(block) < 2:
        line = block[0]
        center = (line.x + line.x2) / 2
        if abs(center - width / 2) < width * 0.04 and line.x > width * 0.12:
            return "center"
        if line.x2 > width * 0.86 and line.x > width * 0.4:
            return "right"
        return "left"
    lefts = np.array([l.x for l in block], np.float32)
    rights = np.array([l.x2 for l in block], np.float32)
    centers = (lefts + rights) / 2
    spread = {"left": float(lefts.std()), "center": float(centers.std()), "right": float(rights.std())}
    if spread["left"] <= min(spread.values()) * 1.3 + 3:
        return "left"
    return min(spread, key=lambda k: spread[k])


def block_features(block: list[Line], width: int, height: int) -> dict[str, Any]:
    words = [w for line in block for w in line.words]
    text = " ".join(line.text for line in block)
    letters = [c for c in text if c.isalpha()]
    upper = sum(1 for c in letters if c.isupper()) / max(1, len(letters))
    x, y = min(l.x for l in block), min(l.y for l in block)
    x2, y2 = max(l.x2 for l in block), max(l.y2 for l in block)
    box_h = float(np.median([l.height for l in block]))
    pitch = float(np.median(np.diff([l.y for l in block]))) if len(block) > 1 else None
    # Tamaño de letra: la caja de una palabra mide ~0,75 em en minúsculas con ascendentes y ~0,72–0,86 em en mayúsculas.
    font_px = box_h / (0.8 if upper > 0.8 else 0.75)
    line_height = round(pitch / font_px, 2) if pitch else None
    # Color principal (por caracteres) y resaltado: palabras de un color claramente distinto y saturado.
    by_color: list[tuple[np.ndarray, int]] = [(w.color, len(w.text)) for w in words]
    weights = np.array([n for _, n in by_color], np.float32)
    colors = np.array([c for c, _ in by_color], np.float32)
    main = colors[np.argmax([sum(n for c2, n in by_color if distance(c, c2) < 45) for c, _ in by_color])]
    highlight = None
    hl_chars = 0
    for c, n in by_color:
        if distance(c, main) > 70 and is_colorful(c):
            hl_chars += n
            highlight = c if highlight is None else highlight
    back = np.median(np.array([w.back for w in words], np.float32), axis=0)
    digits = sum(c.isdigit() for c in text) / max(1, len(text.replace(" ", "")))
    del weights
    return {
        "x": round(x / width, 4),
        "y": round(y / height, 4),
        "w": round((x2 - x) / width, 4),
        "h": round((y2 - y) / height, 4),
        "lines": len(block),
        "box_px": round(box_h, 1),
        "font_px": round(font_px, 1),
        "line_height": line_height,
        "chars": sum(l.chars for l in block),
        "color": to_hex(main),
        "back": to_hex(back),
        "highlight": to_hex(highlight) if highlight is not None else None,
        "highlight_share": round(hl_chars / max(1, len(text)), 3),
        "align": alignment(block, width),
        "upper_ratio": round(upper, 3),
        "digits": round(digits, 3),
        "has_at": any(w.text.startswith("@") for w in words),
        "confidence": round(float(np.mean([w.conf for w in words])), 1),
        "light_text": luminance(main) > luminance(back),
    }


def guess_roles(blocks: list[dict[str, Any]]) -> None:
    """Rol probable: titular (letra más grande), cuerpo, etiqueta superior, número, handle o contador."""
    if not blocks:
        return
    content = [b for b in blocks if not (b["has_at"] and b["chars"] < 60) and not (b["digits"] > 0.5 and b["chars"] <= 7)]
    biggest = max(content or blocks, key=lambda b: b["font_px"] * (1 + 0.1 * min(b["lines"], 3)))
    for b in blocks:
        if b["has_at"] and b["chars"] < 60:
            b["role"] = "handle"
        elif b["digits"] > 0.5 and b["chars"] <= 7:
            b["role"] = "number" if b["font_px"] > 70 else "counter"
        elif b is biggest:
            b["role"] = "headline"
        elif b["font_px"] < biggest["font_px"] * 0.6 and b["y"] < biggest["y"] and b["chars"] <= 40 and b["lines"] == 1:
            b["role"] = "kicker"
        elif b["font_px"] < biggest["font_px"] * 0.8:
            b["role"] = "body"
        else:
            b["role"] = "headline"


# ─── Fondo, foto y adornos ────────────────────────────────────────────────


def text_mask(shape: tuple[int, int], blocks: list[dict[str, Any]], pad: float = 0.012) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), bool)
    for b in blocks:
        x0, y0 = int(max(0, (b["x"] - pad) * w)), int(max(0, (b["y"] - pad) * h))
        x1, y1 = int(min(w, (b["x"] + b["w"] + pad) * w)), int(min(h, (b["y"] + b["h"] + pad) * h))
        mask[y0:y1, x0:x1] = True
    return mask


def _longest_run(flags: np.ndarray) -> tuple[int, int]:
    best, start, cur = (0, 0), None, 0
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    del cur
    return best


def row_runs(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Racha más larga de True en cada fila (largo e inicio), vectorizado."""
    m = mask.astype(np.int32)
    cols = np.arange(m.shape[1])[None, :]
    last_zero = np.maximum.accumulate(np.where(m == 0, cols, -1), axis=1)
    run = (cols - last_zero) * m
    length = run.max(1)
    start = run.argmax(1) - length + 1
    return length, np.maximum(0, start)


def edge_energy(img: np.ndarray, mask: np.ndarray) -> float:
    gray = img.mean(-1)
    e = np.abs(np.diff(gray, axis=1))[:-1, :] + np.abs(np.diff(gray, axis=0))[:, :-1]
    m = ~mask[:-1, :-1]
    return float(e[m].mean()) if m.any() else 0.0


def background_and_photo(img: np.ndarray, tmask: np.ndarray) -> tuple[dict[str, Any], dict[str, Any]]:
    h, w = img.shape[:2]
    base, share = mode_color(img, tmask)
    far = np.sqrt(((img.astype(np.float32) - base) ** 2).sum(-1)) > 42
    far &= ~tmask
    photo: dict[str, Any] = {"present": False, "share": 0.0}
    rows = far.mean(1)
    y0, y1 = _longest_run(rows > 0.55)
    if y1 - y0 > h * 0.12:
        cols = far[y0:y1].mean(0)
        x0, x1 = _longest_run(cols > 0.5)
        region = np.zeros((h, w), bool)
        region[y0:y1, x0:x1] = True
        area = (y1 - y0) * (x1 - x0) / (h * w)
        energy = edge_energy(img[y0:y1, x0:x1], tmask[y0:y1, x0:x1])
        colors = len(np.unique((img[y0:y1:6, x0:x1:6].reshape(-1, 3) // 32).astype(np.int32), axis=0))
        if area > 0.1 and (energy > 2.2 or colors > 40):
            photo = {
                "present": True,
                "share": round(area, 3),
                "x": round(x0 / w, 3),
                "y": round(y0 / h, 3),
                "w": round((x1 - x0) / w, 3),
                "h": round((y1 - y0) / h, 3),
                "edge_energy": round(energy, 2),
            }
    # Fondo fuera de la foto.
    outside = tmask.copy()
    if photo["present"]:
        outside[int(photo["y"] * h) : int((photo["y"] + photo["h"]) * h), int(photo["x"] * w) : int((photo["x"] + photo["w"]) * w)] = True
    kind, colors_out, angle = "solid", [to_hex(base)], 180
    if photo["present"] and photo["share"] > 0.8:
        kind = "photo"
    else:
        free = ~outside
        if free.mean() > 0.05:
            ys, xs = np.where(free)
            top = img[free & (np.arange(h)[:, None] < np.percentile(ys, 15))].mean(0)
            bottom = img[free & (np.arange(h)[:, None] > np.percentile(ys, 85))].mean(0)
            left = img[free & (np.arange(w)[None, :] < np.percentile(xs, 15))].mean(0)
            right = img[free & (np.arange(w)[None, :] > np.percentile(xs, 85))].mean(0)
            vert, horiz = distance(top, bottom), distance(left, right)
            noise = edge_energy(img, outside)
            if max(vert, horiz) > 30 and share < 0.5:
                kind = "gradient"
                colors_out, angle = ([to_hex(top), to_hex(bottom)], 180) if vert >= horiz else ([to_hex(left), to_hex(right)], 90)
            elif noise > 3.5 and share < 0.35:
                kind = "texture"
    bg = {"kind": kind, "color": to_hex(base), "colors": colors_out, "angle": angle, "share": round(share, 3)}
    return bg, photo


def horizontal_lines(img: np.ndarray, tmask: np.ndarray, bg: str, photo: dict[str, Any]) -> list[dict[str, Any]]:
    """Líneas finas horizontales (separadores, subrayados de adorno) fuera del texto y de la foto."""
    h, w = img.shape[:2]
    diff = np.sqrt(((img.astype(np.float32) - from_hex(bg)) ** 2).sum(-1)) > 60
    diff &= ~tmask
    if photo.get("present"):
        diff[int(photo["y"] * h) : int((photo["y"] + photo["h"]) * h), int(photo["x"] * w) : int((photo["x"] + photo["w"]) * w)] = False
    runs, starts = row_runs(diff)
    out: list[dict[str, Any]] = []
    y = 0
    while y < h:
        if runs[y] >= w * 0.05:
            y0 = y
            while y < h and runs[y] >= w * 0.05:
                y += 1
            if y - y0 <= max(10, h // 120):
                x0 = int(np.median(starts[y0:y]))
                length = int(np.median(runs[y0:y]))
                color = img[y0:y, x0 : x0 + length].reshape(-1, 3).mean(0)
                out.append({"y": round(y0 / h, 4), "x": round(x0 / w, 4), "w": round(length / w, 4), "thickness": y - y0, "color": to_hex(color)})
        y += 1
    return out[:8]


def has_frame(img: np.ndarray, bg: str) -> bool:
    h, w = img.shape[:2]
    diff = np.sqrt(((img.astype(np.float32) - from_hex(bg)) ** 2).sum(-1)) > 60
    for inset in range(int(w * 0.015), int(w * 0.07), 2):
        sides = [diff[inset, inset : w - inset].mean(), diff[inset : h - inset, inset].mean(), diff[h - 1 - inset, inset : w - inset].mean(), diff[inset : h - inset, w - 1 - inset].mean()]
        if min(sides) > 0.85:
            return True
    return False


def avatar_near(img: np.ndarray, bg: str, handle: dict[str, Any] | None) -> bool:
    """Un círculo/cuadro de color a la izquierda del nombre y el @ (cabecera tipo tweet)."""
    if not handle:
        return False
    h, w = img.shape[:2]
    y0, y1 = int(handle["y"] * h), int((handle["y"] + handle["h"]) * h)
    x1 = int(handle["x"] * w) - 8
    if x1 < w * 0.05:
        return False
    zone = img[max(0, y0 - 20) : y1 + 20, max(0, x1 - int(w * 0.16)) : x1]
    if zone.size == 0:
        return False
    far = np.sqrt(((zone.astype(np.float32) - from_hex(bg)) ** 2).sum(-1)) > 40
    return float(far.mean()) > 0.3


# ─── Slide completo ───────────────────────────────────────────────────────


def load_normalized(path: Path) -> Image.Image:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        if im.width != WIDTH:
            im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
        return im.copy()


def measure_slide(path: Path, index: int, langs: str) -> dict[str, Any]:
    im = load_normalized(path)
    img = np.asarray(im, np.uint8)
    h, w = img.shape[:2]
    gray_im = im.convert("L")
    gray = np.asarray(gray_im, np.uint8)
    words = merge_passes(ocr_words(gray_im, langs), ocr_words(ImageOps.invert(gray_im), langs))
    for word in words:
        word_colors(img, word)
    lines = group_lines(words)
    groups = group_blocks(lines)
    blocks = [block_features(b, w, h) for b in groups]
    # Fuera: ruido (bloques diminutos con poca confianza) y "texto" del mismo color que lo que tiene detrás.
    keep = [
        i
        for i, b in enumerate(blocks)
        if not (b["chars"] <= 2 and b["confidence"] < 80 and b["digits"] < 0.5) and distance(from_hex(b["color"]), from_hex(b["back"])) > 45
    ]
    blocks, groups = [blocks[i] for i in keep], [groups[i] for i in keep]
    guess_roles(blocks)
    tmask = text_mask((h, w), blocks)
    bg, photo = background_and_photo(img, tmask)
    hlines = horizontal_lines(img, tmask, bg["color"], photo)
    handle = next((b for b in blocks if b.get("role") == "handle"), None)
    # Fuente: la de las líneas del titular; si no hay, la de cualquier línea grande.
    head_lines = [line for b, g in zip(blocks, groups) if b.get("role") == "headline" for line in g]
    body_lines = [line for b, g in zip(blocks, groups) if b.get("role") == "body" for line in g]
    head_light = next((b["light_text"] for b in blocks if b.get("role") == "headline"), luminance(from_hex(bg["color"])) < 0.4)
    fonts = {
        "headline": match_font(gray, head_lines, head_light)[:3] if head_lines else [],
        "body": match_font(gray, body_lines, head_light)[:3] if body_lines else [],
    }
    # Tamaño de letra exacto: el texto dibujado con la fuente elegida, comparado con la tinta medida.
    for b, g in zip(blocks, groups):
        role_fonts = fonts["headline"] if b.get("role") in ("headline", "number") else fonts["body"] or fonts["headline"]
        if not role_fonts:
            continue
        size = font_size(gray, g, b["light_text"], role_fonts[0]["font"], role_fonts[0].get("weight"))
        if size and 0.5 < size / b["font_px"] < 1.8:
            b["font_px"] = size
            if len(g) > 1:
                b["line_height"] = round(float(np.median(np.diff([l.y for l in g]))) / size, 2)
    zones = {name: palette_of(img[int(a * h) : int(b * h)], 3)[:3] for name, (a, b) in {"top": (0, 1 / 3), "middle": (1 / 3, 2 / 3), "bottom": (2 / 3, 1)}.items()}
    for b in blocks:
        b.pop("light_text", None)
    return {
        "index": index,
        "width": int(w),
        "height": int(h),
        "aspect": round(h / w, 4),
        "background": bg,
        "palette": palette_of(img, 6),
        "zones": zones,
        "text_blocks": sorted(blocks, key=lambda b: (b["y"], b["x"])),
        "photo": photo,
        "fonts": fonts,
        "ornaments": {
            "hlines": hlines,
            "frame": has_frame(img, bg["color"]),
            "handle": {k: handle[k] for k in ("x", "y", "w", "h")} if handle else None,
            "avatar": avatar_near(img, bg["color"], handle),
            "big_number": any(b.get("role") == "number" for b in blocks),
            "counter": next(({"x": b["x"], "y": b["y"]} for b in blocks if b.get("role") == "counter"), None),
        },
    }


def summarize(slides: list[dict[str, Any]]) -> dict[str, Any]:
    """Resumen del carrusel: fondo, texto, acento, fuentes y si usa foto."""
    if not slides:
        return {}

    def most(values: list[Any], default: Any = None) -> Any:
        values = [v for v in values if v is not None]
        return max(set(values), key=values.count) if values else default

    blocks = [b for s in slides for b in s["text_blocks"]]
    bg = most([s["background"]["color"] for s in slides if not s["photo"].get("present")] or [s["background"]["color"] for s in slides])
    heads = [b for b in blocks if b.get("role") == "headline"]
    text = most([b["color"] for b in heads] or [b["color"] for b in blocks], "#ffffff")
    body = most([b["color"] for b in blocks if b.get("role") == "body"], None)
    highlights = [b["highlight"] for b in blocks if b.get("highlight")]
    accent = most(highlights)
    if accent is None:
        cands = [l["color"] for s in slides for l in s["ornaments"]["hlines"] if is_colorful(from_hex(l["color"]))]
        cands += [p["hex"] for s in slides for p in s["palette"] if is_colorful(from_hex(p["hex"])) and distance(from_hex(p["hex"]), from_hex(bg)) > 60 and not s["photo"].get("present")]
        accent = most(cands)
    font_votes: dict[str, dict[str, float]] = {"headline": {}, "body": {}}
    for s in slides:
        for role in ("headline", "body"):
            for rank, f in enumerate(s["fonts"].get(role, [])[:2]):
                font_votes[role][f["font"]] = font_votes[role].get(f["font"], 0) + f["score"] * (1.0 if rank == 0 else 0.5)
    fonts = {role: sorted(v, key=lambda k: -v[k])[0] if v else None for role, v in font_votes.items()}
    kinds = [s["background"]["kind"] for s in slides]
    return {
        "slides": len(slides),
        "background": bg,
        "background_kind": most(kinds),
        "text": text,
        "body": body,
        "accent": accent,
        "fonts": fonts,
        "uses_photo": sum(1 for s in slides if s["photo"].get("present")) >= max(1, len(slides) // 2),
        "aspect": most([s["aspect"] for s in slides]),
    }


def measure_all(paths: list[Path], on_progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    if not tesseract_available():
        raise OcrMissing("tesseract no está instalado")
    langs = ocr_langs()
    slides = []
    for i, p in enumerate(paths):
        slides.append(measure_slide(p, i, langs))
        if on_progress:
            on_progress((i + 1) / len(paths))
    return {"version": 1, "summary": summarize(slides), "slides": slides}
