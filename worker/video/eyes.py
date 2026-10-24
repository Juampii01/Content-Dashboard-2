"""Ojos del director de edición: lo que se ve en el video, medido y resumido para que Claude lo mire.

Al analizar (VIDEO_ANALYZE, después de transcribir) se mide sobre el mezzanine, todo en CPU y open source:

- Cambios de escena: ffmpeg `select='gt(scene,0.3)'` sobre una copia chiquita (rápido, exacto al cuadro).
- Muestreo: un cuadro cada 1 a 3 s (según el largo, con tope) más uno al empezar cada escena.
- Por cuadro: cara (YuNet, el detector que ya usan estilos y clips) con su posición, tamaño y si mira a cámara (con los
  puntos de los ojos y la nariz), nitidez (varianza del laplaciano), exposición (oscuro, quemado, contraluz),
  movimiento de cámara (correlación de fase entre cuadros a 0,5 s), texto quemado en pantalla (Tesseract) y energía
  de la voz (dB, del WAV de 16 kHz).
- Tramos: cada escena partida en ventanas de hasta 6 s, con los promedios de lo anterior.
- Hojas de contacto: los cuadros en baja resolución, en grilla, con su número y su marca de tiempo. Es lo que mira
  Claude con visión (unos 120 tokens por cuadro) y lo que la app recorta para las miniaturas de "Lo que entendió".

Se guardan en el almacenamiento privado del proyecto (`editor/<id>/ojos/hoja-NN.jpg`) y las medidas, en
`video_projects.eyes`. Si algo falla (sin modelo de caras, sin Tesseract), se sigue sin esa medida y se anota.
"""

from __future__ import annotations

import logging
import math
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

log = logging.getLogger("worker.eyes")

VERSION = 1
FPS_SCAN = 2.0  # cuadros por segundo que se miden (movimiento, nitidez y caras salen de aquí)
SCENE_THRESHOLD = 0.25
MAX_FRAMES = 240
MAX_OCR = 48
TRAMO_MAX = 6.0
MIN_GAP = 0.6  # dos muestras no quedan a menos de esto
LABEL_H = 22


# ─── Muestreo ──────────────────────────────────────────────────────────────


def sample_times(duration: float, scenes: list[float], max_frames: int = MAX_FRAMES) -> list[tuple[float, bool]]:
    """Instantes a mirar: una grilla pareja (1 a 3 s) más el inicio de cada escena. (t, es_inicio_de_escena)."""
    max_frames = max(12, int(max_frames))
    if duration <= 0:
        return []
    starts = [s for s in sorted(set(round(x, 3) for x in scenes)) if 0.2 < s < duration - 0.3]
    room = max(6, max_frames - min(len(starts), max_frames // 3))
    interval = max(1.0, min(3.0, duration / room)) if duration / room > 1.0 else 1.0
    grid = [min(duration - 0.05, interval / 2 + k * interval) for k in range(int(duration / interval) + 1)]
    grid = [t for t in grid if t < duration]
    picks: list[tuple[float, bool]] = [(min(duration - 0.05, s + 0.35), True) for s in starts[: max_frames // 3]]
    for t in grid:
        if all(abs(t - p) >= MIN_GAP for p, _ in picks):
            picks.append((t, False))
    picks.sort()
    if len(picks) > max_frames:
        # Se sacan muestras de la grilla de forma pareja hasta entrar en el tope (los inicios de escena quedan).
        scene = [p for p in picks if p[1]]
        rest = [p for p in picks if not p[1]]
        keep = max(0, max_frames - len(scene))
        step = len(rest) / keep if keep else math.inf
        rest = [rest[int(i * step)] for i in range(keep)] if keep else []
        picks = sorted(scene + rest)
    return [(round(t, 2), s) for t, s in picks]


# ─── Medidas por cuadro ────────────────────────────────────────────────────


def frontal_from_landmarks(lm: list[float]) -> tuple[bool, float]:
    """Si la cara mira a cámara (de frente) con los 5 puntos de YuNet: ojo derecho, ojo izquierdo, nariz, boca.

    Se mide el corrimiento de la nariz respecto del centro de los ojos (giro de la cabeza) y la inclinación de los ojos.
    Devuelve (de_frente, giro) con giro de -1 (mira a un lado) a 1 (al otro); 0 es de frente.
    """
    if len(lm) < 10:
        return False, 0.0
    rx, ry, lx, ly, nx, ny = lm[0], lm[1], lm[2], lm[3], lm[4], lm[5]
    eye_dist = math.hypot(lx - rx, ly - ry)
    if eye_dist < 1e-6:
        return False, 0.0
    mid_x = (rx + lx) / 2
    yaw = (nx - mid_x) / eye_dist
    tilt = abs(ly - ry) / eye_dist
    # La nariz por debajo de los ojos (si está por encima, la cabeza está muy inclinada hacia atrás o abajo).
    pitch_ok = ny > (ry + ly) / 2
    return bool(abs(yaw) < 0.32 and tilt < 0.35 and pitch_ok), round(float(max(-1.0, min(1.0, yaw * 2))), 3)


def sharpness(gray: np.ndarray) -> float:
    """Varianza del laplaciano (más alto = más nítido). Se mide en el centro (los bordes suelen estar desenfocados)."""
    import cv2  # noqa: PLC0415

    h, w = gray.shape[:2]
    core = gray[h // 8 : h - h // 8, w // 8 : w - w // 8]
    return round(float(cv2.Laplacian(core, cv2.CV_64F).var()), 1)


def exposure(gray: np.ndarray, face: tuple[float, float, float, float] | None) -> dict[str, Any]:
    """Luz del cuadro: brillo medio (0 a 1), proporción quemada y oscura, y contraluz (cara mucho más oscura que el fondo)."""
    g = gray.astype(np.float32) / 255.0
    luma = float(g.mean())
    out: dict[str, Any] = {
        "luma": round(luma, 3),
        "clipped": round(float((g > 0.97).mean()), 3),
        "crushed": round(float((g < 0.03).mean()), 3),
        "backlit": False,
    }
    if face:
        h, w = g.shape[:2]
        x0, y0 = max(0, int(face[0] * w)), max(0, int(face[1] * h))
        x1, y1 = min(w, int((face[0] + face[2]) * w)), min(h, int((face[1] + face[3]) * h))
        if x1 - x0 > 4 and y1 - y0 > 4:
            face_l = float(g[y0:y1, x0:x1].mean())
            mask = np.ones_like(g, dtype=bool)
            mask[y0:y1, x0:x1] = False
            bg = float(g[mask].mean()) if mask.any() else luma
            out["faceLuma"] = round(face_l, 3)
            out["backlit"] = bool(face_l < 0.32 and bg > face_l * 1.8)
    return out


def camera_shift(prev: np.ndarray | None, cur: np.ndarray) -> float:
    """Movimiento de cámara entre dos cuadros chicos (fracción del ancho que se corrió la imagen)."""
    if prev is None or prev.shape != cur.shape:
        return 0.0
    import cv2  # noqa: PLC0415

    (dx, dy), response = cv2.phaseCorrelate(prev.astype(np.float32), cur.astype(np.float32))
    if response < 0.05:
        # Sin correlación clara: o es un corte o se movió mucho. Lo resuelve la diferencia de cuadros.
        return 0.0
    return round(float(math.hypot(dx, dy) / cur.shape[1]), 4)


class FaceFinder:
    """YuNet con los 5 puntos de la cara (para saber si mira a cámara). Sin el modelo, no detecta (y se anota)."""

    def __init__(self, models_dir: Path) -> None:
        from .style import YUNET_FILE  # noqa: PLC0415

        self.detector = None
        self.size: tuple[int, int] | None = None
        model = models_dir / YUNET_FILE
        if model.exists():
            import cv2  # noqa: PLC0415

            self.detector = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.65, 0.3, 50)

    @property
    def ready(self) -> bool:
        return self.detector is not None

    def find(self, frame: np.ndarray) -> list[dict[str, Any]]:
        if self.detector is None:
            return []
        h, w = frame.shape[:2]
        if self.size != (w, h):
            self.detector.setInputSize((w, h))
            self.size = (w, h)
        _, faces = self.detector.detect(frame)
        out = []
        for f in faces if faces is not None else []:
            x, y, fw, fh = (float(v) for v in f[:4])
            if (fw * fh) / (w * h) < 0.003:
                continue
            frontal, yaw = frontal_from_landmarks([float(v) for v in f[4:14]])
            out.append({"x": round(x / w, 3), "y": round(y / h, 3), "w": round(fw / w, 3), "h": round(fh / h, 3), "score": round(float(f[-1]), 2), "frontal": frontal, "yaw": yaw})
        out.sort(key=lambda d: -(d["w"] * d["h"]))
        return out


def text_boxes(gray: np.ndarray, limit: int = 3) -> list[tuple[int, int, int, int]]:
    """Renglones de texto candidatos (x, y, w, h): bordes fuertes y horizontales agrupados (gradiente + cierre).

    Tesseract sobre el cuadro entero se confunde con una foto de fondo; sobre cada renglón recortado lee bien un texto
    quemado (un rótulo, un precio, un subtítulo).
    """
    import cv2  # noqa: PLC0415

    h, w = gray.shape[:2]
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (max(9, w // 30), 1)))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        x, y, bw_, bh = cv2.boundingRect(c)
        if bh < h * 0.012 or bh > h * 0.12 or bw_ < bh * 2.2 or bw_ < w * 0.12:
            continue
        fill = cv2.countNonZero(bw[y : y + bh, x : x + bw_]) / float(bw_ * bh)
        if fill < 0.08 or fill > 0.85:
            continue
        boxes.append((x, y, bw_, bh))
    boxes.sort(key=lambda b: -(b[2] * b[3]))
    return boxes[:limit]


def _tesseract_line(image: Path, langs: str) -> tuple[str, float]:
    try:
        res = subprocess.run(["tesseract", str(image), "stdout", "-l", langs, "--psm", "7", "tsv"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return "", 0.0
    words, confs = [], []
    for line in res.stdout.splitlines()[1:]:
        cols = line.split("\t")
        if len(cols) < 12 or not cols[11].strip():
            continue
        try:
            conf = float(cols[10])
        except ValueError:
            continue
        if conf >= 60 and _wordlike(cols[11].strip()):
            words.append(cols[11].strip())
            confs.append(conf)
    return " ".join(words), (sum(confs) / len(confs) if confs else 0.0)


def read_text(frame: np.ndarray, tmp: Path, langs: str, full_frame: bool = True) -> tuple[str, list[float] | None]:
    """Texto quemado en el cuadro y la franja vertical donde está (fracciones del alto).

    Primero renglón por renglón (lo normal: un rótulo o un subtítulo sobre una foto); si no aparece nada, el cuadro
    entero (pantallas con mucho texto chico, como una app).
    """
    import cv2  # noqa: PLC0415
    from .style import ocr_words  # noqa: PLC0415

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h = gray.shape[0]
    found: list[tuple[str, float, float]] = []
    for x, y, bw, bh in text_boxes(gray):
        pad = max(4, bh // 3)
        crop = gray[max(0, y - pad) : y + bh + pad, max(0, x - pad) : x + bw + pad]
        crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        cv2.imwrite(str(tmp), crop)
        text, conf = _tesseract_line(tmp, langs)
        if text and conf >= 70 and len(text.replace(" ", "")) >= 4:
            found.append((text, y / h, (y + bh) / h))
    if not found and full_frame:
        cv2.imwrite(str(tmp), cv2.resize(frame, (frame.shape[1] * 2, frame.shape[0] * 2), interpolation=cv2.INTER_CUBIC))
        try:
            words = [w for w in ocr_words(tmp, langs) if w.conf >= 70 and _wordlike(w.text)]
        except Exception:  # noqa: BLE001 — sin Tesseract se sigue sin texto
            return "", None
        # Un par de letras sueltas suele ser ruido de una textura (pelo, ropa): se pide algo que parezca texto de verdad.
        if not words or sum(len(w.text) for w in words) < 5:
            return "", None
        words.sort(key=lambda w: (round(w.y / max(1, 2 * h) * 20), w.x))
        found = [(" ".join(w.text for w in words), min(w.y for w in words) / (2 * h), max(w.y + w.h for w in words) / (2 * h))]
    if not found:
        return "", None
    found.sort(key=lambda f: f[1])
    text = " · ".join(f[0] for f in found)[:80]
    return text, [round(min(f[1] for f in found), 3), round(min(1.0, max(f[2] for f in found)), 3)]


_WORD = re.compile(r"^[¿¡(\"']?[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ$%€#@+/.,:x-]{3,}[?!).,:\"']?$")


def _wordlike(text: str) -> bool:
    letters = sum(ch.isalnum() for ch in text)
    return bool(_WORD.match(text)) and letters >= max(3, len(text) * 0.6)


def voice_db(db_frames: np.ndarray | None, t: float, span: float = 0.5) -> float | None:
    """Energía media de la voz alrededor de t (ventanas de 10 ms del WAV de 16 kHz)."""
    if db_frames is None or not len(db_frames):
        return None
    a = max(0, int((t - span) / 0.01))
    b = min(len(db_frames), int((t + span) / 0.01) + 1)
    if b <= a:
        return None
    return round(float(np.mean(db_frames[a:b])), 1)


# ─── Tramos ────────────────────────────────────────────────────────────────


def build_tramos(samples: list[dict[str, Any]], scenes: list[float], duration: float) -> list[dict[str, Any]]:
    """Escenas partidas en ventanas de hasta 6 s, con el resumen de sus muestras."""
    sharp_all = [s["sharp"] for s in samples if s.get("sharp") is not None]
    ref = float(np.median(sharp_all)) if sharp_all else 0.0
    cuts = set(round(s, 3) for s in scenes if 0.2 < s < duration - 0.2)
    # Además de los cortes de escena, un tramo nuevo donde cambia lo que se ve: aparece o desaparece la cara, o se
    # desenfoca (una toma mala dentro de la misma escena, o un cambio que el detector de escenas no vio).
    ordered = sorted(samples, key=lambda s: s["t"])
    state = lambda s: (bool(s.get("face")), bool(ref > 0 and s["sharp"] < max(25.0, ref * 0.35)), bool(s.get("text")))  # noqa: E731
    for a, b in zip(ordered, ordered[1:]):
        if state(a) != state(b) and not any(a["t"] < c <= b["t"] for c in cuts):
            cuts.add(round((a["t"] + b["t"]) / 2, 3))
    bounds = [0.0, *sorted(cuts), duration]
    spans: list[tuple[float, float, bool]] = []
    for a, b in zip(bounds, bounds[1:]):
        n = max(1, math.ceil((b - a) / TRAMO_MAX - 1e-6))
        for k in range(n):
            spans.append((a + (b - a) * k / n, a + (b - a) * (k + 1) / n, k == 0 and a > 0))
    out = []
    for i, (a, b, cut) in enumerate(spans):
        inside = [s for s in samples if a <= s["t"] < b] or ([min(samples, key=lambda s: abs(s["t"] - (a + b) / 2))] if samples else [])
        if not inside:
            continue
        faces = [s["face"] for s in inside if s.get("face")]
        face_ratio = len(faces) / len(inside)
        frontal = sum(1 for f in faces if f.get("frontal")) / len(faces) if faces else 0.0
        sharp = float(np.median([s["sharp"] for s in inside])) if inside else 0.0
        texts = [s["text"] for s in inside if s.get("text")]
        energies = [s["energy"] for s in inside if s.get("energy") is not None]
        tramo = {
            "id": f"T{i + 1}",
            "start": round(a, 2),
            "end": round(b, 2),
            "sceneStart": cut,
            "samples": [s["i"] for s in inside],
            "faceRatio": round(face_ratio, 2),
            "frontalRatio": round(frontal, 2),
            "face": _mean_face(faces),
            "sharp": round(sharp, 1),
            "blurry": bool(ref > 0 and sharp < max(25.0, ref * 0.35)),
            "luma": round(float(np.mean([s["luma"] for s in inside])), 3),
            "dark": bool(np.mean([s["luma"] for s in inside]) < 0.16),
            "bright": bool(np.mean([s["clipped"] for s in inside]) > 0.25),
            "backlit": sum(1 for s in inside if s.get("backlit")) > len(inside) / 2,
            "motion": round(float(max(s["shift"] for s in inside)), 4),
            "shaky": bool(np.mean([s["shift"] for s in inside]) > 0.03),
            "text": max(texts, key=len) if texts else "",
            "textBand": next((s["textBand"] for s in inside if s.get("textBand")), None),
            "energy": round(float(np.mean(energies)), 1) if energies else None,
        }
        out.append(tramo)
    return out


def _mean_face(faces: list[dict[str, Any]]) -> dict[str, float] | None:
    if not faces:
        return None
    return {k: round(float(np.mean([f[k] for f in faces])), 3) for k in ("x", "y", "w", "h")}


# ─── Hojas de contacto ─────────────────────────────────────────────────────


@dataclass
class SheetLayout:
    tile_w: int
    tile_h: int
    cols: int
    rows: int
    label_h: int = LABEL_H

    @property
    def per_sheet(self) -> int:
        return self.cols * self.rows

    @property
    def size(self) -> tuple[int, int]:
        return self.cols * self.tile_w, self.rows * (self.tile_h + self.label_h)


def layout_for(width: int, height: int) -> SheetLayout:
    """Vertical: 6 × 3 cuadros de 216×384; horizontal: 4 × 5 de 384×216; cuadrado: 5 × 4 de 288×288. Menos de 2000 px por lado."""
    ratio = width / max(1, height)
    if ratio < 0.8:
        return SheetLayout(216, 384, 6, 3)
    if ratio > 1.25:
        return SheetLayout(384, 216, 4, 5)
    return SheetLayout(288, 288, 5, 4)


def fmt_time(t: float) -> str:
    m, s = divmod(max(0.0, t), 60)
    return f"{int(m)}:{s:04.1f}"


def make_sheet(tiles: list[tuple[int, float, np.ndarray]], layout: SheetLayout, fonts_dir: Path | None, mark: str = "#") -> Any:
    """Una hoja: cada cuadro (BGR, ya al tamaño del cuadro) con una franja abajo: "#n · m:ss.s" (o "R#n" en una referencia)."""
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415

    sheet = Image.new("RGB", layout.size, (8, 12, 28))
    draw = ImageDraw.Draw(sheet)
    font = None
    for name in ("Inter-Bold.ttf", "Montserrat-Bold.ttf"):
        if fonts_dir and (fonts_dir / name).exists():
            font = ImageFont.truetype(str(fonts_dir / name), 15)
            break
    if font is None:
        font = ImageFont.load_default()
    for k, (index, t, img) in enumerate(tiles):
        col, row = k % layout.cols, k // layout.cols
        x, y = col * layout.tile_w, row * (layout.tile_h + layout.label_h)
        rgb = Image.fromarray(img[:, :, ::-1])
        if rgb.size != (layout.tile_w, layout.tile_h):
            rgb = rgb.resize((layout.tile_w, layout.tile_h))
        sheet.paste(rgb, (x, y))
        draw.rectangle([x, y + layout.tile_h, x + layout.tile_w - 1, y + layout.tile_h + layout.label_h - 1], fill=(3, 10, 34))
        draw.text((x + 6, y + layout.tile_h + 3), f"{mark}{index}  {fmt_time(t)}", fill=(220, 231, 247), font=font)
        # Línea fina entre cuadros (para que Claude no los confunda).
        draw.rectangle([x, y, x + layout.tile_w - 1, y + layout.tile_h + layout.label_h - 1], outline=(40, 70, 120))
    return sheet


def fit_tile(frame: np.ndarray, layout: SheetLayout) -> np.ndarray:
    """El cuadro entero dentro del cuadro de la hoja (con barras si la proporción no coincide)."""
    import cv2  # noqa: PLC0415

    h, w = frame.shape[:2]
    scale = min(layout.tile_w / w, layout.tile_h / h)
    nw, nh = max(2, int(w * scale)), max(2, int(h * scale))
    small = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)
    tile = np.full((layout.tile_h, layout.tile_w, 3), (28, 12, 8), dtype=np.uint8)
    y0, x0 = (layout.tile_h - nh) // 2, (layout.tile_w - nw) // 2
    tile[y0 : y0 + nh, x0 : x0 + nw] = small
    return tile


def save_sheets(tiles: list[tuple[int, float, np.ndarray]], layout: SheetLayout, out_dir: Path, fonts_dir: Path | None, prefix: str = "hoja", mark: str = "#") -> list[tuple[Path, list[int]]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    sheets = []
    for n, a in enumerate(range(0, len(tiles), layout.per_sheet)):
        chunk = tiles[a : a + layout.per_sheet]
        img = make_sheet(chunk, layout, fonts_dir, mark)
        path = out_dir / f"{prefix}-{n + 1:02d}.jpg"
        img.save(path, "JPEG", quality=80, optimize=True)
        sheets.append((path, [i for i, _, _ in chunk]))
    return sheets


# ─── Lectura del video ─────────────────────────────────────────────────────


def detect_scenes(video: Path, threshold: float = SCENE_THRESHOLD) -> list[float]:
    """Instantes de corte de escena (ffmpeg, sobre una copia de 192 px de ancho)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(video), "-an",
        "-vf", f"scale=192:-2,select='gt(scene\\,{threshold})',metadata=print:file=-", "-f", "null", "-",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except (OSError, subprocess.SubprocessError):
        log.warning("no se pudieron medir los cambios de escena", exc_info=True)
        return []
    times = [float(m) for m in re.findall(r"pts_time:([\d.]+)", res.stdout)]
    out: list[float] = []
    for t in times:
        if not out or t - out[-1] > 0.5:
            out.append(round(t, 3))
    return out


def scan_frames(video: Path, size: tuple[int, int], fps: float = FPS_SCAN):
    """Cuadros BGR a `fps` por segundo y al tamaño dado (pipe de ffmpeg, sin archivos intermedios)."""
    w, h = size
    # El mezzanine es de 30 cuadros fijos: se toma 1 de cada 15 por número de cuadro (exacto al instante, sin el
    # corrimiento del filtro fps).
    step = max(1, int(round(30 / fps)))
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(video), "-an",
        "-vf", f"select='not(mod(n\\,{step}))',scale={w}:{h}:flags=area", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_bytes = w * h * 3
    assert proc.stdout is not None
    k = 0
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield k / fps, np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
            k += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


def scan_size(width: int, height: int) -> tuple[int, int]:
    """Lado corto de 432 px (suficiente para caras de un talking head y para el OCR de textos grandes)."""
    short = 432
    if width <= height:
        return short, max(2, int(round(height * short / width / 2)) * 2)
    return max(2, int(round(width * short / height / 2)) * 2), short


@dataclass
class EyesResult:
    eyes: dict[str, Any]
    sheets: list[tuple[Path, list[int]]] = field(default_factory=list)


def analyze(
    video: Path,
    width: int,
    height: int,
    duration: float,
    out_dir: Path,
    *,
    models_dir: Path,
    fonts_dir: Path | None,
    db_frames: np.ndarray | None = None,
    max_frames: int = MAX_FRAMES,
    on_progress: Callable[[float], None] | None = None,
    check: Callable[[], None] | None = None,
) -> EyesResult:
    """Mide el video y arma las hojas de contacto (en `out_dir`). No sube nada: eso lo hace el pipeline."""
    import cv2  # noqa: PLC0415

    notes: list[str] = []
    scenes = detect_scenes(video)
    if on_progress:
        on_progress(0.15)
    picks = sample_times(duration, scenes, max_frames)
    wanted = {}
    for i, (t, is_scene) in enumerate(picks):
        k = int(round(t * FPS_SCAN))
        while k in wanted:  # dos muestras en el mismo cuadro escaneado: la segunda va al siguiente
            k += 1
        wanted[k] = (i + 1, t, is_scene)
    finder = FaceFinder(models_dir)
    if not finder.ready:
        notes.append("Sin detector de caras: no se midió si estás en cuadro.")
    from .style import tesseract_langs  # noqa: PLC0415

    langs = tesseract_langs()
    ocr_budget = MAX_OCR
    ocr_every = max(1, len(picks) // MAX_OCR)
    layout = layout_for(width, height)
    size = scan_size(width, height)
    samples: list[dict[str, Any]] = []
    tiles: list[tuple[int, float, np.ndarray]] = []
    prev_small: np.ndarray | None = None
    shifts: dict[int, float] = {}
    tmp = out_dir / "ocr.png"
    out_dir.mkdir(parents=True, exist_ok=True)
    total = max(1, int(duration * FPS_SCAN))
    for k, (_, frame) in enumerate(scan_frames(video, size)):
        if check and k % 20 == 0:
            check()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (128, max(2, int(128 * gray.shape[0] / gray.shape[1]))), interpolation=cv2.INTER_AREA)
        shifts[k] = camera_shift(prev_small, small)
        prev_small = small
        if k in wanted:
            index, t, is_scene = wanted[k]
            faces = finder.find(frame)
            main = faces[0] if faces else None
            expo = exposure(gray, (main["x"], main["y"], main["w"], main["h"]) if main else None)
            text, band = "", None
            if ocr_budget > 0 and (is_scene or index % ocr_every == 0):
                ocr_budget -= 1
                # El cuadro entero solo sin cara (una pantalla o un producto): con cara, los renglones alcanzan y es más rápido.
                text, band = read_text(frame, tmp, langs, full_frame=not faces)
            samples.append(
                {
                    "i": index,
                    "t": t,
                    "scene": is_scene,
                    "face": main,
                    "faces": len(faces),
                    "sharp": sharpness(gray),
                    **{key: expo[key] for key in ("luma", "clipped", "crushed", "backlit")},
                    "shift": max(shifts.get(k, 0.0), shifts.get(k - 1, 0.0)),
                    "text": text,
                    "textBand": band,
                    "energy": voice_db(db_frames, t),
                }
            )
            tiles.append((index, t, fit_tile(frame, layout)))
        if on_progress and k % 10 == 0:
            on_progress(0.15 + 0.7 * min(1.0, k / total))
    tmp.unlink(missing_ok=True)
    if not samples:
        notes.append("No se pudieron leer cuadros del video.")
    samples.sort(key=lambda s: s["t"])
    tiles.sort(key=lambda x: x[0])
    tramos = build_tramos(samples, scenes, duration) if samples else []
    sheets = save_sheets(tiles, layout, out_dir, fonts_dir)
    if on_progress:
        on_progress(1.0)
    with_face = [s for s in samples if s.get("face")]
    eyes = {
        "version": VERSION,
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "scenes": scenes[:2000],
        "samples": samples,
        "tramos": tramos,
        "sheets": [],  # el pipeline completa las claves al subir
        "layout": {"tileW": layout.tile_w, "tileH": layout.tile_h, "cols": layout.cols, "rows": layout.rows, "labelH": layout.label_h},
        "stats": {
            "frames": len(samples),
            "faceRatio": round(len(with_face) / len(samples), 3) if samples else 0.0,
            "frontalRatio": round(sum(1 for s in with_face if s["face"].get("frontal")) / len(with_face), 3) if with_face else 0.0,
            "sharpMedian": round(float(np.median([s["sharp"] for s in samples])), 1) if samples else 0.0,
            "scenes": len(scenes),
            "ocr": MAX_OCR - ocr_budget,
        },
        "notes": notes,
    }
    return EyesResult(eyes=eyes, sheets=sheets)


def frames_at(video: Path, times: list[float], size: tuple[int, int]) -> list[np.ndarray]:
    """Cuadros sueltos de un video en los instantes dados (para la revisión del video final)."""
    import cv2  # noqa: PLC0415

    out = []
    cap = cv2.VideoCapture(str(video))
    try:
        for t in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                frame = np.zeros((size[1], size[0], 3), dtype=np.uint8)
            out.append(frame)
    finally:
        cap.release()
    return out
