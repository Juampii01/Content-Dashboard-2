"""Análisis de un video de referencia ("Edita como este"): mide el estilo, nunca copia el contenido.

Todo open source y en CPU:
- Cortes: detector de escenas de ffmpeg (`scdet`) sobre todos los cuadros.
- Zooms y punch-ins: entre cuadros (10 por segundo, en gris) se estima una transformación de similitud con
  puntos ORB y RANSAC (OpenCV); la escala de esa transformación es el zoom. Dentro de una toma, una escala
  que crece o baja de forma sostenida es un zoom suave; en un corte, si los dos lados son la misma imagen a
  distinta escala, es un punch-in.
- B-roll: cuadros con y sin la cara del hablante (detector YuNet de OpenCV, 2 cuadros por segundo). Una toma
  sin cara en un video donde la cara aparece es b-roll.
- Subtítulos: OCR con Tesseract en los mismos cuadros. Se descarta el texto fijo (marcas de agua, @usuario)
  y queda el que cambia: posición vertical, tamaño, mayúsculas, palabras por bloque, color del texto y del
  resaltado (muestreo de píxeles) y si llevan caja de fondo.
- Habla: con la transcripción por palabra, palabras por segundo, largo del gancho y pausas.
- Audio: sonoridad integrada (EBU R128) y música (energía fuera de la voz, en las pausas).

Devuelve un diccionario de métricas (versión 1). El preset de estilo lo arma la app (lib/video/style.ts).
"""

from __future__ import annotations

import csv
import io
import logging
import math
import re
import subprocess
import tempfile
import wave
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from comunes import ffmpeg
from comunes.errors import Cancelled, JobError

log = logging.getLogger("worker.style")

MAX_SECONDS = 180.0
GRAY_FPS = 5
COLOR_FPS = 2.0
MAX_OCR_FRAMES = 120
SCDET_THRESHOLD = 12.0
YUNET_FILE = "face_detection_yunet_2023mar.onnx"
# Tamaño de fuente ≈ alto de la caja de una palabra en mayúsculas / 0,72 (altura de las mayúsculas de
# Montserrat/Inter). Calibrado con drawtext en las pruebas.
CAP_HEIGHT = 0.72

Progress = Callable[[float], None]


# ─── Utilidades ────────────────────────────────────────────────────────────


def _cv2():
    try:
        import cv2  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - la imagen siempre lo trae
        raise JobError("Falta OpenCV en el worker. Avísale a soporte.", retry=False, detail="sin cv2") from exc
    return cv2


def _frames(src: Path, vf: str, width: int, height: int, channels: int, seconds: float):
    """Lee cuadros crudos de ffmpeg (sin escribirlos a disco)."""
    pix = "gray" if channels == 1 else "bgr24"
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-t", f"{seconds:.3f}", "-i", str(src), "-an", "-vf", f"{vf},format={pix}", "-f", "rawvideo", "-"]
    size = width * height * channels
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    try:
        while True:
            if ffmpeg.stop_event.is_set():
                raise Cancelled()
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            arr = np.frombuffer(buf, dtype=np.uint8)
            yield arr.reshape(height, width) if channels == 1 else arr.reshape(height, width, 3)
    finally:
        proc.kill()
        proc.wait()


def _even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


def _hex(bgr: np.ndarray | tuple[float, float, float]) -> str:
    b, g, r = (int(max(0, min(255, round(float(c))))) for c in bgr)
    return f"#{r:02X}{g:02X}{b:02X}"


def _lum(bgr: np.ndarray) -> np.ndarray:
    bgr = np.asarray(bgr, dtype=np.float32)
    return 0.114 * bgr[..., 0] + 0.587 * bgr[..., 1] + 0.299 * bgr[..., 2]


def _color_distance(a: Any, b: Any) -> float:
    return float(np.linalg.norm(np.asarray(a, dtype=np.float32) - np.asarray(b, dtype=np.float32)))


# ─── 1. Cortes ─────────────────────────────────────────────────────────────


def detect_cuts(src: Path, seconds: float, threshold: float = SCDET_THRESHOLD) -> list[float]:
    """Instantes de corte con `scdet` (puntaje de cambio de escena de 0 a 100)."""
    stderr = ffmpeg.run(
        ["-t", f"{seconds:.3f}", "-i", str(src), "-an", "-vf", f"scale=-2:360,scdet=threshold={threshold}:sc_pass=0,metadata=mode=print:key=lavfi.scd.time", "-f", "null", "-"],
        what="detección de cortes",
    )
    times = [float(m) for m in re.findall(r"lavfi\.scd\.time=([\d.]+)", stderr)]
    return merge_close(sorted(times), 0.25)


def merge_close(times: list[float], gap: float) -> list[float]:
    out: list[float] = []
    for t in times:
        if t < 0.15:
            continue
        if out and t - out[-1] < gap:
            continue
        out.append(round(t, 3))
    return out


def shots_from_cuts(cuts: list[float], duration: float) -> list[tuple[float, float]]:
    edges = [0.0, *[c for c in cuts if 0 < c < duration], duration]
    return [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 0.05]


def cut_stats(cuts: list[float], duration: float) -> dict[str, Any]:
    shots = shots_from_cuts(cuts, duration)
    lengths = [b - a for a, b in shots] or [duration]
    minutes = max(duration / 60.0, 1e-6)
    return {
        "count": len(cuts),
        "perMinute": round(len(cuts) / minutes, 1),
        "avgShot": round(float(np.mean(lengths)), 2),
        "medianShot": round(float(np.median(lengths)), 2),
        "times": [round(c, 2) for c in cuts[:300]],
    }


# ─── 2. Zooms ──────────────────────────────────────────────────────────────


@dataclass
class Scale:
    value: float
    inliers: int


def _is_identity(matrix: np.ndarray, tol_scale: float = 0.004, tol_shift: float = 1.0) -> bool:
    scale = math.hypot(float(matrix[0, 0]), float(matrix[1, 0]))
    return abs(scale - 1) < tol_scale and abs(float(matrix[0, 2])) < tol_shift and abs(float(matrix[1, 2])) < tol_shift


def estimate_scale(a: np.ndarray, b: np.ndarray, orb: Any = None) -> Scale | None:
    """Escala de la transformación de similitud que lleva el cuadro `a` al `b` (1,1 = el segundo está al 110 %).

    El texto fijo encima del video (subtítulos, marca de agua) no se mueve y suele tener los puntos más fuertes:
    si el mejor modelo es la identidad, se busca un segundo modelo con los puntos que quedan. Si ese segundo
    modelo es consistente y cubre una buena parte del cuadro, es el movimiento real de la imagen.
    """
    cv2 = _cv2()
    orb = orb or cv2.ORB_create(nfeatures=1500, fastThreshold=10)
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 12 or len(kb) < 12:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(matcher.match(da, db), key=lambda m: m.distance)[:800]
    if len(matches) < 12:
        return None
    pa = np.float32([ka[m.queryIdx].pt for m in matches])
    pb = np.float32([kb[m.trainIdx].pt for m in matches])
    area = float(a.shape[0] * a.shape[1])
    best: Scale | None = None
    for _ in range(3):
        if len(pa) < 12:
            break
        matrix, mask = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=1.2, maxIters=2000, confidence=0.99)
        if matrix is None or mask is None:
            break
        inl = mask.ravel().astype(bool)
        count = int(inl.sum())
        if count < 12:
            break
        pts = pa[inl]
        spread = float((pts[:, 0].max() - pts[:, 0].min()) * (pts[:, 1].max() - pts[:, 1].min())) / area
        scale = Scale(math.hypot(float(matrix[0, 0]), float(matrix[1, 0])), count)
        if best is None:
            if count < 0.2 * len(matches):
                return None
            best = scale
            if not _is_identity(matrix):
                return best
        elif count >= 20 and spread >= 0.04 and not _is_identity(matrix):
            return scale
        pa, pb = pa[~inl], pb[~inl]
    return best


def detect_zooms(src: Path, seconds: float, cuts: list[float], width: int, height: int, on_progress: Progress | None = None) -> dict[str, Any]:
    """Zooms suaves dentro de cada toma y punch-ins en los cortes."""
    cv2 = _cv2()
    gh = 480 if height >= width else 270
    gw = _even(width * gh / height)
    orb = cv2.ORB_create(nfeatures=900, fastThreshold=12)
    step = 1.0 / GRAY_FPS
    frames: list[np.ndarray] = []
    for i, frame in enumerate(_frames(src, f"fps={GRAY_FPS},scale={gw}:{gh}", gw, gh, 1, seconds)):
        frames.append(frame)
        if on_progress and i % 20 == 0:
            on_progress(min(0.5, i * step / max(seconds, 1) * 0.5))
    times = [i * step for i in range(len(frames))]

    def shot_index(t: float) -> int:
        return sum(1 for c in cuts if c <= t + 1e-6)

    # Escala entre cuadros consecutivos de la misma toma.
    logs: list[tuple[float, float, int]] = []  # (t, log escala, toma)
    for i in range(1, len(frames)):
        if on_progress and i % 20 == 0:
            on_progress(0.5 + 0.5 * i / len(frames))
        if shot_index(times[i - 1]) != shot_index(times[i]):
            continue
        est = estimate_scale(frames[i - 1], frames[i], orb)
        logs.append((times[i], math.log(est.value) if est and est.inliers >= 15 else 0.0, shot_index(times[i])))

    smooth = smooth_zoom_events(logs, step)
    # Punch-ins: a cada lado del corte, la misma imagen con otra escala.
    punches: list[dict[str, Any]] = []
    for cut in cuts:
        before = int(math.floor((cut - 0.12) / step))
        after = int(math.ceil((cut + 0.12) / step))
        if before < 0 or after >= len(frames):
            continue
        est = estimate_scale(frames[before], frames[after], orb)
        if est and est.inliers >= 25 and abs(math.log(est.value)) >= math.log(1.06):
            punches.append({"t": round(cut, 2), "kind": "punch", "scale": round(est.value, 3)})
    events = sorted([*smooth, *punches], key=lambda e: e["t"])
    minutes = max(seconds / 60.0, 1e-6)
    scales = [abs(math.log(e["scale"])) for e in events]
    return {
        "punchIns": len(punches),
        "smooth": len(smooth),
        "perMinute": round(len(events) / minutes, 1),
        "avgScale": round(math.exp(float(np.mean(scales))), 3) if scales else 1.0,
        "events": events[:100],
    }


def smooth_zoom_events(logs: list[tuple[float, float, int]], step: float, per_step: float = 0.008, min_total: float = math.log(1.05)) -> list[dict[str, Any]]:
    """Tramos donde la escala cambia en la misma dirección varios cuadros seguidos (zoom de cámara o de edición)."""
    events: list[dict[str, Any]] = []
    run: list[tuple[float, float, int]] = []

    def close() -> None:
        if len(run) >= 3:
            total = sum(x[1] for x in run)
            if abs(total) >= min_total:
                start = run[0][0] - step
                events.append({"t": round(start, 2), "kind": "smooth", "scale": round(math.exp(total), 3), "duration": round(run[-1][0] - start, 2)})
        run.clear()

    for item in logs:
        t, value, shot = item
        moving = abs(value) >= per_step
        same_dir = not run or (value > 0) == (run[-1][1] > 0)
        same_shot = not run or run[-1][2] == shot
        contiguous = not run or t - run[-1][0] <= step * 1.5
        if moving and same_dir and same_shot and contiguous:
            run.append(item)
        else:
            close()
            if moving:
                run.append(item)
    close()
    return events


# ─── 3. Caras y b-roll ─────────────────────────────────────────────────────


class FaceDetector:
    def __init__(self, models_dir: Path) -> None:
        cv2 = _cv2()
        model = models_dir / YUNET_FILE
        if not model.exists():
            raise JobError("Falta el detector de caras en el worker. Avísale a soporte.", retry=False, detail=f"sin {model}")
        self.detector = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.7, 0.3, 50)
        self.size: tuple[int, int] | None = None

    def detect(self, frame: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        """Caras como (x, y, w, h, puntaje) relativos al cuadro. Se analiza a 640 px de ancho como mucho."""
        cv2 = _cv2()
        h, w = frame.shape[:2]
        scale = min(1.0, 640 / w)
        img = cv2.resize(frame, (_even(w * scale), _even(h * scale))) if scale < 1 else frame
        ih, iw = img.shape[:2]
        if self.size != (iw, ih):
            self.detector.setInputSize((iw, ih))
            self.size = (iw, ih)
        _, faces = self.detector.detect(img)
        out = []
        for f in faces if faces is not None else []:
            x, y, fw, fh = (float(v) for v in f[:4])
            area = (fw * fh) / (iw * ih)
            if area >= 0.004:
                out.append((x / iw, y / ih, fw / iw, fh / ih, float(f[-1])))
        return out


def broll_stats(face_samples: list[tuple[float, bool]], shots: list[tuple[float, float]], duration: float) -> dict[str, Any]:
    """B-roll: tomas donde casi no aparece la cara, en un video donde la cara sí aparece."""
    with_face = sum(1 for _, f in face_samples if f)
    face_ratio = with_face / len(face_samples) if face_samples else 0.0
    if face_ratio < 0.2:
        return {"faceRatio": round(face_ratio, 3), "ratio": 0.0, "perMinute": 0.0, "avgDuration": 0.0, "shots": [], "reliable": False}
    broll: list[tuple[float, float]] = []
    for a, b in shots:
        samples = [f for t, f in face_samples if a <= t < b]
        if samples and sum(samples) / len(samples) < 0.34:
            if broll and abs(broll[-1][1] - a) < 0.05:
                broll[-1] = (broll[-1][0], b)  # dos tomas seguidas de b-roll cuentan como una inserción
            else:
                broll.append((a, b))
    total = sum(b - a for a, b in broll)
    minutes = max(duration / 60.0, 1e-6)
    return {
        "faceRatio": round(face_ratio, 3),
        "ratio": round(total / duration, 3) if duration else 0.0,
        "perMinute": round(len(broll) / minutes, 1),
        "avgDuration": round(total / len(broll), 2) if broll else 0.0,
        "shots": [[round(a, 2), round(b, 2)] for a, b in broll[:100]],
        "reliable": True,
    }


# ─── 4. Subtítulos (OCR) ───────────────────────────────────────────────────


@dataclass
class OcrWord:
    text: str
    x: int
    y: int
    w: int
    h: int
    conf: float


def tesseract_langs() -> str:
    try:
        out = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return "eng"
    langs = {line.strip() for line in out.splitlines()[1:]}
    return "+".join(l for l in ("spa", "eng") if l in langs) or "eng"


def ocr_words(image: Path, langs: str) -> list[OcrWord]:
    try:
        res = subprocess.run(["tesseract", str(image), "stdout", "-l", langs, "--psm", "11", "tsv"], capture_output=True, text=True, timeout=60)
    except FileNotFoundError as exc:
        raise JobError("Falta Tesseract en el worker. Avísale a soporte.", retry=False, detail="sin tesseract") from exc
    except subprocess.TimeoutExpired:
        return []
    words = []
    for row in csv.DictReader(io.StringIO(res.stdout), delimiter="\t", quoting=csv.QUOTE_NONE):
        text = (row.get("text") or "").strip()
        try:
            conf = float(row.get("conf") or -1)
        except ValueError:
            continue
        if not text or conf < 55 or not any(ch.isalpha() for ch in text):
            continue
        words.append(OcrWord(text, int(row["left"]), int(row["top"]), int(row["width"]), int(row["height"]), conf))
    return words


def _kmeans_colors(pixels: np.ndarray, k: int = 3) -> list[tuple[np.ndarray, float]]:
    """Colores dominantes (centro, proporción), del más frecuente al menos frecuente."""
    cv2 = _cv2()
    data = pixels.reshape(-1, 3).astype(np.float32)
    if len(data) < k * 4:
        return [(data.mean(axis=0), 1.0)] if len(data) else []
    if len(data) > 6000:
        data = data[np.random.default_rng(0).choice(len(data), 6000, replace=False)]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(data, k, None, criteria, 2, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.ravel(), minlength=k) / len(labels)
    order = np.argsort(-counts)
    return [(centers[i], float(counts[i])) for i in order]


def word_colors(frame: np.ndarray, word: OcrWord) -> dict[str, Any] | None:
    """Color del relleno de una palabra, si tiene borde oscuro y si está sobre una caja de color uniforme."""
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = max(0, word.x), max(0, word.y), min(w, word.x + word.w), min(h, word.y + word.h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    inside = frame[y0:y1, x0:x1]
    pad = max(3, int(word.h * 0.35))
    rx0, ry0, rx1, ry1 = max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)
    ring_mask = np.ones((ry1 - ry0, rx1 - rx0), dtype=bool)
    ring_mask[y0 - ry0 : y1 - ry0, x0 - rx0 : x1 - rx0] = False
    ring = frame[ry0:ry1, rx0:rx1][ring_mask]
    box_color = None
    if len(ring) > 20:
        std = float(ring.astype(np.float32).std(axis=0).mean())
        if std < 14:
            box_color = ring.astype(np.float32).mean(axis=0)
    clusters = _kmeans_colors(inside, 3)
    if not clusters:
        return None
    lum = [float(_lum(c)) for c, _ in clusters]
    if box_color is not None:
        # Con caja: el texto es el color con buena proporción más distinto de la caja.
        candidates = [(c, s) for c, s in clusters if s >= 0.12]
        fill = max(candidates, key=lambda cs: _color_distance(cs[0], box_color))[0]
        outline = False
    else:
        # Sin caja: el relleno es el color claro (o saturado) con buena proporción; el borde, el oscuro.
        candidates = [(c, s, l) for (c, s), l in zip(clusters, lum) if s >= 0.12]
        fill = max(candidates, key=lambda c: c[2] + 0.5 * (float(np.max(c[0])) - float(np.min(c[0]))))[0]
        outline = any(l < 60 and s >= 0.12 for (_, s), l in zip(clusters, lum)) and float(_lum(fill)) > 120
    return {"fill": fill, "box": box_color, "outline": outline}


def _static_keys(frames_words: list[list[OcrWord]], width: int, height: int) -> set[tuple[str, int, int]]:
    """Texto que no cambia (marca de agua, @usuario): misma palabra en el mismo lugar en muchos cuadros."""
    counter: Counter[tuple[str, int, int]] = Counter()
    for words in frames_words:
        keys = {(w.text.lower(), round((w.x + w.w / 2) / width * 20), round((w.y + w.h / 2) / height * 20)) for w in words}
        counter.update(keys)
    n = max(1, len(frames_words))
    return {k for k, c in counter.items() if c >= max(4, 0.5 * n)}


def caption_style(samples: list[tuple[np.ndarray, list[OcrWord]]]) -> dict[str, Any]:
    """Estilo de los subtítulos a partir de los cuadros con su OCR."""
    if not samples:
        return {"detected": False}
    height, width = samples[0][0].shape[:2]
    static = _static_keys([ws for _, ws in samples], width, height)
    cleaned: list[tuple[np.ndarray, list[OcrWord]]] = []
    for frame, words in samples:
        keep = [w for w in words if (w.text.lower(), round((w.x + w.w / 2) / width * 20), round((w.y + w.h / 2) / height * 20)) not in static]
        cleaned.append((frame, keep))
    centers = [(w.y + w.h / 2) / height for _, ws in cleaned for w in ws]
    if len(centers) < 6:
        return {"detected": False}
    # Banda dominante: el texto que se repite a la misma altura en muchos cuadros.
    hist, edges = np.histogram(centers, bins=25, range=(0, 1))
    peak = int(np.argmax(hist))
    lo, hi = edges[max(0, peak - 1)], edges[min(len(edges) - 1, peak + 2)]
    caption_frames = []
    for frame, ws in cleaned:
        band = [w for w in ws if lo <= (w.y + w.h / 2) / height <= hi]
        if band:
            caption_frames.append((frame, band))
    if len(caption_frames) < max(3, 0.15 * len(samples)):
        return {"detected": False}

    all_words = [w for _, ws in caption_frames for w in ws]
    letters = [ch for w in all_words for ch in w.text if ch.isalpha()]
    upper_share = sum(1 for ch in letters if ch.isupper()) / max(1, len(letters))
    uppercase = upper_share >= 0.85
    # Tamaño: alto de la caja de las palabras (en mayúsculas el alto de las mayúsculas).
    heights = [w.h for w in all_words if len(w.text) >= 2]
    text_h = float(np.median(heights)) / height if heights else 0.0
    font_size = text_h / CAP_HEIGHT if uppercase else text_h / (CAP_HEIGHT + 0.12)
    position = float(np.median([(w.y + w.h / 2) / height for w in all_words]))
    per_frame = [len(ws) for _, ws in caption_frames]
    words_per_block = int(max(1, min(6, round(float(np.median(per_frame))))))

    fills: list[np.ndarray] = []
    highlights: list[np.ndarray] = []
    boxes: list[np.ndarray] = []
    outlines = 0
    measured = 0
    measured_words = 0
    for frame, ws in caption_frames[:60]:
        colors = [c for c in (word_colors(frame, w) for w in ws) if c]
        if not colors:
            continue
        measured += 1
        measured_words += len(colors)
        frame_fills = [c["fill"] for c in colors]
        outlines += sum(1 for c in colors if c["outline"]) > len(colors) / 2
        boxes += [c["box"] for c in colors if c["box"] is not None]
        if len(frame_fills) >= 2:
            # Resaltado: una palabra de otro color que el resto del bloque.
            ref = np.median(np.stack(frame_fills), axis=0)
            odd = [f for f in frame_fills if _color_distance(f, ref) > 70]
            if odd and len(odd) < len(frame_fills):
                highlights += odd
                fills += [f for f in frame_fills if _color_distance(f, ref) <= 70]
                continue
        fills += frame_fills
    if not fills:
        return {"detected": False}
    text_color = np.median(np.stack(fills), axis=0)
    box = len(boxes) >= 3 and len(boxes) >= 0.5 * measured_words
    box_color = _hex(np.median(np.stack(boxes), axis=0)) if box else None
    highlight = None
    if len(highlights) >= max(3, 0.25 * measured):
        center = np.median(np.stack(highlights), axis=0)
        # Un resaltado de verdad es siempre del mismo color; colores sueltos son ruido del fondo.
        close = [h for h in highlights if _color_distance(h, center) < 45]
        if len(close) >= 0.7 * len(highlights) and _color_distance(center, text_color) > 70:
            highlight = _hex(np.median(np.stack(close), axis=0))
    return {
        "detected": True,
        "position": round(position, 3),
        "size": round(font_size, 4),
        "uppercase": uppercase,
        "wordsPerBlock": words_per_block,
        "textColor": _hex(text_color),
        "highlightColor": highlight,
        "box": bool(box),
        "boxColor": box_color,
        "outline": outlines >= max(1, measured / 2),
        "samples": len(caption_frames),
    }


# ─── 5. Habla y audio ──────────────────────────────────────────────────────

SENTENCE_END = re.compile(r"[.!?…]$")


def speech_stats(words: list[dict]) -> dict[str, Any]:
    if len(words) < 3:
        return {"words": len(words), "detected": False}
    gaps = [max(0.0, b["start"] - a["end"]) for a, b in zip(words, words[1:])]
    long_pauses = [g for g in gaps if g >= 0.6]
    speaking = (words[-1]["end"] - words[0]["start"]) - sum(long_pauses)
    # Gancho: la primera frase (hasta un punto o una pausa clara), con tope de 12 s.
    hook_end = words[-1]["end"]
    for i, w in enumerate(words):
        nxt = words[i + 1] if i + 1 < len(words) else None
        if SENTENCE_END.search(w["text"]) or (nxt and nxt["start"] - w["end"] >= 0.45):
            hook_end = w["end"]
            break
    minutes = max((words[-1]["end"] - words[0]["start"]) / 60, 1e-6)
    return {
        "detected": True,
        "words": len(words),
        "wps": round(len(words) / max(speaking, 0.5), 2),
        "hookSeconds": round(min(12.0, hook_end - words[0]["start"]), 2),
        "firstWordAt": round(words[0]["start"], 2),
        "pauseMedian": round(float(np.median(gaps)), 3),
        "pauseP90": round(float(np.percentile(gaps, 90)), 3),
        "longPausesPerMinute": round(len(long_pauses) / minutes, 1),
        "maxPause": round(max(gaps), 2),
    }


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels()).mean(axis=1)
    return data, rate


def music_stats(samples: np.ndarray, rate: int, words: list[dict]) -> dict[str, Any]:
    """Música: energía sostenida fuera de la voz (en las pausas). Sin palabras, se mira la energía en general."""
    hop = int(rate * 0.05)
    n = len(samples) // hop
    if n < 10:
        return {"music": False, "musicDb": None}
    frames = samples[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt(np.mean(frames**2, axis=1) + 1e-12) + 1e-9)
    speech = np.zeros(n, dtype=bool)
    for w in words:
        a, b = int(max(0, (w["start"] - 0.12) / 0.05)), int(min(n, (w["end"] + 0.12) / 0.05 + 1))
        speech[a:b] = True
    gaps = db[~speech]
    if not words:
        # Sin transcripción: música si casi no hay silencios (la voz sola deja huecos).
        quiet = float(np.mean(db < np.percentile(db, 95) - 30))
        return {"music": quiet < 0.05 and float(np.median(db)) > -45, "musicDb": None}
    if len(gaps) < 20:  # menos de 1 s fuera de la voz: no se puede saber
        return {"music": False, "musicDb": None}
    gap_level = float(np.percentile(gaps, 50))
    voice_level = float(np.percentile(db[speech], 75)) if speech.any() else gap_level
    present = gap_level > -48 and voice_level - gap_level < 32
    return {"music": bool(present), "musicDb": round(gap_level - voice_level, 1) if present else None}


def loudness(src: Path, seconds: float) -> float | None:
    stderr = ffmpeg.run(["-t", f"{seconds:.3f}", "-i", str(src), "-map", "0:a:0", "-af", "ebur128", "-f", "null", "-"], what="sonoridad de la referencia")
    summary = stderr[stderr.rfind("Summary:") :] if "Summary:" in stderr else stderr
    m = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    return round(float(m.group(1)), 1) if m else None


# ─── Orquestación ──────────────────────────────────────────────────────────


def probe_reference(src: Path) -> dict[str, Any]:
    info = ffmpeg.probe(src)
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    if not video:
        raise JobError("Ese archivo no tiene video. Sube un video MP4 o MOV.", retry=False)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    rotation = 0
    for side in video.get("side_data_list", []) or []:
        if "rotation" in side:
            rotation = int(round(float(side["rotation"])))
    if abs(rotation) == 90:
        width, height = height, width
    duration = float(info.get("format", {}).get("duration") or video.get("duration") or 0)
    if duration < 3:
        raise JobError("El video de referencia es demasiado corto: usa uno de al menos 3 segundos.", retry=False)
    if width < 160 or height < 160:
        raise JobError("La resolución del video de referencia es demasiado baja.", retry=False)
    return {"width": width, "height": height, "duration": duration, "hasAudio": audio is not None}


def aspect_label(width: int, height: int) -> str:
    ratio = width / height
    if ratio < 0.7:
        return "9:16"
    if ratio > 1.4:
        return "16:9"
    if ratio < 0.9:
        return "4:5"
    return "1:1"


def analyze(
    src: Path,
    workdir: Path,
    *,
    models_dir: Path,
    transcribe_fn: Callable[[Path, Path], list[dict]] | None,
    stage: Callable[[str, float, float], None] | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Mide el estilo de `src`. `transcribe_fn(ogg, wav16)` devuelve palabras (o None si no hay transcripción)."""
    stage = stage or (lambda name, a, b: None)
    progress = progress or (lambda f: None)
    meta = probe_reference(src)
    seconds = min(meta["duration"], MAX_SECONDS)
    width, height = meta["width"], meta["height"]

    stage("Buscando los cortes", 0.0, 0.15)
    cuts = detect_cuts(src, seconds)
    shots = shots_from_cuts(cuts, seconds)
    progress(1.0)

    stage("Midiendo los zooms", 0.15, 0.4)
    zooms = detect_zooms(src, seconds, cuts, width, height, progress)

    stage("Leyendo los subtítulos y las caras", 0.4, 0.75)
    detector = FaceDetector(models_dir)
    langs = tesseract_langs()
    ch = min(1280, _even(height)) if height >= width else min(720, _even(height))
    cw = _even(width * ch / height)
    fps = min(COLOR_FPS, MAX_OCR_FRAMES / max(seconds, 1))
    face_samples: list[tuple[float, bool]] = []
    face_boxes: list[tuple[float, float, float, float, float]] = []
    ocr_samples: list[tuple[np.ndarray, list[OcrWord]]] = []
    total_frames = max(1, int(seconds * fps))
    with tempfile.TemporaryDirectory(dir=workdir) as tmp:
        png = Path(tmp) / "frame.png"
        cv2 = _cv2()
        for i, frame in enumerate(_frames(src, f"fps={fps:.4f},scale={cw}:{ch}", cw, ch, 3, seconds)):
            t = (i + 0.5) / fps
            faces = detector.detect(frame)
            face_samples.append((t, bool(faces)))
            if faces:
                face_boxes.append(max(faces, key=lambda f: f[2] * f[3]))
            cv2.imwrite(str(png), frame)
            ocr_samples.append((frame, ocr_words(png, langs)))
            progress(min(1.0, (i + 1) / total_frames))
    captions = caption_style(ocr_samples)
    broll = broll_stats(face_samples, shots, seconds)
    face = None
    if face_boxes:
        arr = np.array(face_boxes)
        face = {"x": round(float(np.median(arr[:, 0] + arr[:, 2] / 2)), 3), "y": round(float(np.median(arr[:, 1] + arr[:, 3] / 2)), 3), "size": round(float(np.median(arr[:, 3])), 3)}

    stage("Escuchando el ritmo", 0.75, 1.0)
    speech: dict[str, Any] = {"detected": False, "words": 0}
    audio: dict[str, Any] = {"lufs": None, "music": False, "musicDb": None}
    if meta["hasAudio"]:
        wav, ogg = workdir / "ref16.wav", workdir / "ref.ogg"
        ffmpeg.run(["-t", f"{seconds:.3f}", "-i", str(src), "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], what="audio de la referencia")
        words: list[dict] = []
        if transcribe_fn:
            ffmpeg.run(["-i", str(wav), "-c:a", "libopus", "-b:a", "32k", "-application", "voip", str(ogg)], what="audio para transcribir")
            try:
                words = [w for w in transcribe_fn(ogg, wav) if w["end"] <= seconds + 0.5]
            except JobError as exc:
                log.warning("referencia sin transcripción: %s", exc.detail or exc.user_message)
        progress(0.6)
        speech = speech_stats(words)
        samples, rate = read_wav(wav)
        audio = {"lufs": loudness(src, seconds), **music_stats(samples, rate, words)}
    progress(1.0)

    return {
        "version": 1,
        "duration": round(meta["duration"], 2),
        "analyzedSeconds": round(seconds, 2),
        "width": width,
        "height": height,
        "aspect": aspect_label(width, height),
        "cuts": cut_stats(cuts, seconds),
        "zooms": zooms,
        "faces": {"detected": bool(face_boxes), "ratio": broll["faceRatio"], **({"center": {"x": face["x"], "y": face["y"]}, "size": face["size"]} if face else {})},
        "broll": {k: v for k, v in broll.items() if k != "faceRatio"},
        "captions": captions,
        "speech": speech,
        "audio": audio,
    }


def thumbnail(src: Path, out: Path, duration: float) -> None:
    at = min(1.0, duration / 3)
    ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", str(out)], what="miniatura")
