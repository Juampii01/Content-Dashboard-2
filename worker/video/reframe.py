"""Reencuadre de horizontal a vertical (9:16) que sigue la cara ("Clips desde un video largo").

1. Muestreo: 5 cuadros por segundo a 640 px de ancho, solo en el tramo del clip (con su margen). Caras con
   YuNet: el mismo detector que ya usan los estilos (OpenCV Zoo, 230 KB, unos milisegundos por cuadro en CPU y ya
   incluido en la imagen). MediaPipe sumaría ~40 MB de dependencias para ganar poco en planos de podcast.
   Por cada cara se mide la "actividad de la boca": cuánto cambia la parte baja de la cara entre dos muestras.
2. Seguimiento: las caras se unen en pistas por cercanía de una muestra a la siguiente. Un cambio de plano (la
   imagen cambia de golpe) corta las pistas.
3. A quién mirar: con una cara, a esa. Con dos o más que entran juntas en el cuadro vertical, al grupo. Si no
   entran, a la que habla: la de más actividad de boca mientras hay voz (según la transcripción), con histéresis
   (tiene que ganar con claridad durante 1 s) y al menos 2 s entre cambios. Como el análisis es sobre un video ya
   grabado, el cambio se adelanta al momento en que la otra persona empezó a hablar. Sin voz o sin diferencia clara,
   la cámara se queda donde está; si la cara elegida desaparece, pasa a la más grande.
   LÍMITE: es una heurística visual (no identifica voces). Con bocas tapadas, perfiles, planos muy abiertos o dos
   personas que hablan a la vez puede elegir mal; en ese caso se queda con la cara más grande o con la última.
4. Cámara virtual: zona muerta (no se mueve por temblores del detector), resorte críticamente amortiguado
   (acelera y frena suave, sin saltos) con velocidad máxima, y corte seco solo en cambios de plano o de persona,
   como haría un editor. Sin cara: mantiene la última posición 1,5 s y después vuelve al centro.
5. El camino se simplifica a puntos clave (Ramer–Douglas–Peucker) y se convierte en una expresión de `crop` de
   ffmpeg, lineal entre puntos: el mismo camino sirve para la vista previa y para el corte final.
"""

from __future__ import annotations

import logging
import math
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np

from comunes import ffmpeg
from comunes.errors import Cancelled

log = logging.getLogger("worker.reframe")

SAMPLE_FPS = 5.0
ANALYSIS_WIDTH = 960  # caras de planos abiertos (dos o tres personas) todavía se detectan
ASPECT = 9 / 16

DEADZONE = 0.035  # fracción del ancho del original que la cara se puede mover sin que la cámara la siga
MAX_SPEED = 0.35  # fracción del ancho por segundo
MAX_ACCEL = 1.2  # fracción del ancho por segundo²: arranca y frena suave
SPRING = 4.0  # ω del resorte (rad/s): con 4 se acomoda en ~1 s
HOLD_GAP = 1.5  # segundos que se mantiene la posición sin cara
CUT_DIFF = 30.0  # diferencia media (0–255) entre muestras chicas que se considera cambio de plano
SWITCH_RATIO = 1.6  # quien habla tiene que tener 1,6 veces la actividad de la cara actual
SWITCH_FLOOR = 1.5  # y al menos esta diferencia absoluta
SWITCH_HOLD = 1.0  # durante este tiempo
MIN_SHOT = 2.0  # segundos mínimos entre cambios de persona
GROUP_FILL = 0.9  # dos caras "entran juntas" si ocupan hasta el 90 % del ancho del cuadro vertical
RDP_EPSILON = 0.002
MAX_KEYFRAMES = 160


@dataclass
class Face:
    cx: float
    cy: float
    w: float
    h: float
    score: float = 1.0
    activity: float = 0.0
    track: int = -1


@dataclass
class Sample:
    t: float
    faces: list[Face] = field(default_factory=list)
    cut: bool = False


def _even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


class FaceFinder:
    """YuNet (el mismo modelo que los estilos) sin achicar el cuadro: en un plano abierto las caras son chicas."""

    def __init__(self, models_dir: Path) -> None:
        import cv2  # noqa: PLC0415

        from .style import YUNET_FILE  # noqa: PLC0415

        model = models_dir / YUNET_FILE
        if not model.exists():
            from comunes.errors import JobError  # noqa: PLC0415

            raise JobError("Falta el detector de caras en el worker. Avísale a soporte.", retry=False, detail=f"sin {model}")
        self.detector = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.6, 0.3, 50)
        self.size: tuple[int, int] | None = None

    def detect(self, frame: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        h, w = frame.shape[:2]
        if self.size != (w, h):
            self.detector.setInputSize((w, h))
            self.size = (w, h)
        _, faces = self.detector.detect(frame)
        out = []
        for f in faces if faces is not None else []:
            x, y, fw, fh = (float(v) for v in f[:4])
            if fw * fh / (w * h) >= 0.0012:
                out.append((max(0.0, x / w), max(0.0, y / h), fw / w, fh / h, float(f[-1])))
        return out


def crop_size(width: int, height: int) -> tuple[int, int]:
    """Tamaño del recorte 9:16 en píxeles del original (todo el alto si el original es más ancho que 9:16)."""
    if width / height > ASPECT:
        return min(width, _even(height * ASPECT)), height
    return width, min(height, _even(width / ASPECT))


# ─── 1. Muestreo ───────────────────────────────────────────────────────────


def _frames(src: Path, start: float, duration: float, width: int, height: int) -> Iterable[np.ndarray]:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", f"{max(0.0, start):.3f}", "-i", str(src), "-t", f"{duration:.3f}",
        "-an", "-vf", f"fps={SAMPLE_FPS},scale={width}:{height}:flags=bilinear,format=bgr24", "-f", "rawvideo", "-",
    ]
    size = width * height * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    try:
        while True:
            if ffmpeg.stop_event.is_set():
                raise Cancelled()
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
    finally:
        proc.kill()
        proc.wait()


def _mouth(gray: np.ndarray, face: Face) -> np.ndarray | None:
    """Parte baja de la cara (boca y mentón) en la imagen gris."""
    h, w = gray.shape
    x0, x1 = int((face.cx - face.w * 0.3) * w), int((face.cx + face.w * 0.3) * w)
    y0, y1 = int((face.cy + face.h * 0.12) * h), int((face.cy + face.h * 0.48) * h)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return gray[y0:y1, x0:x1]


def sample_faces(src: Path, start: float, duration: float, width: int, height: int, detector: Any, progress: Callable[[float], None] | None = None) -> list[Sample]:
    """Caras de cada muestra (coordenadas relativas al cuadro) con la actividad de la boca y los cambios de plano."""
    import cv2  # noqa: PLC0415

    aw = min(ANALYSIS_WIDTH, _even(width))
    ah = _even(height * aw / width)
    total = max(1, int(duration * SAMPLE_FPS))
    samples: list[Sample] = []
    prev_gray: np.ndarray | None = None
    prev_small: np.ndarray | None = None
    for i, frame in enumerate(_frames(src, start, duration, aw, ah)):
        t = start + i / SAMPLE_FPS
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
        cut = prev_small is not None and float(np.mean(np.abs(small - prev_small))) > CUT_DIFF
        faces = [Face(cx=x + fw / 2, cy=y + fh / 2, w=fw, h=fh, score=sc) for x, y, fw, fh, sc in detector.detect(frame)]
        for f in faces:
            if prev_gray is not None and not cut:
                a, b = _mouth(gray, f), _mouth(prev_gray, f)
                if a is not None and b is not None and a.shape == b.shape:
                    f.activity = float(np.mean(cv2.absdiff(a, b)))
        samples.append(Sample(t=round(t, 3), faces=faces, cut=cut))
        prev_gray, prev_small = gray, small
        if progress and i % 10 == 0:
            progress(min(1.0, (i + 1) / total))
    return samples


# ─── 2. Pistas ─────────────────────────────────────────────────────────────


def assign_tracks(samples: list[Sample], max_jump: float = 0.12, max_gap: float = 1.0) -> None:
    """Une las caras de muestras seguidas en pistas (Face.track). Un cambio de plano empieza pistas nuevas."""
    next_id = 0
    last: dict[int, tuple[float, float, float, float]] = {}  # pista → (cx, cy, w, t)
    for s in samples:
        if s.cut:
            last = {}
        used: set[int] = set()
        for f in sorted(s.faces, key=lambda f: -f.w * f.h):
            best, best_d = None, math.inf
            for tid, (cx, cy, w, t) in last.items():
                if tid in used or s.t - t > max_gap:
                    continue
                d = math.hypot(f.cx - cx, f.cy - cy)
                if d < max(max_jump, 0.6 * w) and d < best_d:
                    best, best_d = tid, d
            if best is None:
                best = next_id
                next_id += 1
            f.track = best
            used.add(best)
            last[best] = (f.cx, f.cy, f.w, s.t)


# ─── 3. A quién mirar ──────────────────────────────────────────────────────


def speaking_at(spans: list[tuple[float, float]], t: float, pad: float = 0.2) -> bool:
    lo, hi = 0, len(spans)
    while lo < hi:
        mid = (lo + hi) // 2
        if spans[mid][1] + pad < t:
            lo = mid + 1
        else:
            hi = mid
    return lo < len(spans) and spans[lo][0] - pad <= t


def speech_spans(words: list[dict], gap: float = 0.5) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    for w in sorted(words, key=lambda w: w["start"]):
        if spans and w["start"] - spans[-1][1] <= gap:
            spans[-1] = (spans[-1][0], max(spans[-1][1], w["end"]))
        else:
            spans.append((w["start"], w["end"]))
    return spans


def choose_targets(samples: list[Sample], crop_w: float, spans: list[tuple[float, float]]) -> tuple[list[float | None], list[bool], int]:
    """Centro horizontal (0 a 1) que la cámara debería mirar en cada muestra, cortes secos y cambios de persona."""
    n = len(samples)
    targets: list[float | None] = [None] * n
    hard = [s.cut for s in samples]
    switches = 0
    current: int | None = None
    last_switch = -math.inf
    ema: dict[int, float] = {}
    challenger: tuple[int, int] | None = None  # (pista, índice desde el que gana)
    for i, s in enumerate(samples):
        if s.cut:
            current, challenger, ema = None, None, {}
        for f in s.faces:
            ema[f.track] = 0.5 * ema.get(f.track, f.activity) + 0.5 * f.activity
        if not s.faces:
            continue
        big = max(f.h for f in s.faces)
        main = [f for f in s.faces if f.h >= big * 0.5]  # caras chicas del fondo no cuentan
        by_track = {f.track: f for f in main}
        left, right = min(f.cx - f.w / 2 for f in main), max(f.cx + f.w / 2 for f in main)
        if len(main) >= 2 and right - left <= crop_w * GROUP_FILL:
            targets[i] = (left + right) / 2
            current, challenger = None, None
            continue
        if current not in by_track:
            current = max(main, key=lambda f: f.w * f.h).track
            challenger = None
        if len(main) >= 2 and speaking_at(spans, s.t):
            best = max(by_track, key=lambda k: ema.get(k, 0.0))
            cur_act, best_act = ema.get(current, 0.0), ema.get(best, 0.0)
            if best != current and best_act > cur_act * SWITCH_RATIO and best_act - cur_act > SWITCH_FLOOR:
                if challenger is None or challenger[0] != best:
                    challenger = (best, i)
                j = challenger[1]
                if s.t - samples[j].t >= SWITCH_HOLD and samples[j].t - last_switch >= MIN_SHOT:
                    # Cambio de persona, adelantado a cuando empezó a ganar (el video ya está grabado).
                    current = best
                    last_switch = samples[j].t
                    switches += 1
                    hard[j] = True
                    for k in range(j, i):
                        face = next((f for f in samples[k].faces if f.track == best), None)
                        if face is not None:
                            targets[k] = face.cx
                    challenger = None
            else:
                challenger = None
        targets[i] = by_track[current].cx
    return targets, hard, switches


# ─── 4. Cámara virtual ─────────────────────────────────────────────────────


def fill_gaps(times: list[float], targets: list[float | None], hold: float = HOLD_GAP) -> list[float]:
    """Sin cara: se mantiene la última posición `hold` segundos y después el centro (0,5). Sin ninguna cara, centro."""
    out: list[float] = []
    last: float | None = None
    last_t = -math.inf
    first = next((x for x in targets if x is not None), None)
    for t, x in zip(times, targets):
        if x is not None:
            last, last_t = x, t
            out.append(x)
        elif last is None:
            out.append(0.5)
        else:
            out.append(last if t - last_t <= hold else 0.5)
    # Al principio, si la cara aparece enseguida, se arranca ya en ella (no desde el centro).
    lead = next((i for i, x in enumerate(targets) if x is not None), None)
    if lead is not None and first is not None and times[lead] - times[0] <= hold:
        for i in range(lead):
            out[i] = first
    return out


def median_filter(values: list[float], hard: list[bool], radius: int = 2) -> list[float]:
    """Mediana móvil dentro de cada plano (no mezcla valores de dos lados de un corte)."""
    out = list(values)
    starts = [i for i, h in enumerate(hard) if h or i == 0]
    bounds = list(zip(starts, starts[1:] + [len(values)]))
    for a, b in bounds:
        for i in range(a, b):
            lo, hi = max(a, i - radius), min(b, i + radius + 1)
            out[i] = float(np.median(values[lo:hi]))
    return out


def smooth_path(times: list[float], targets: list[float | None], hard: list[bool], crop_w: float) -> list[float]:
    """Posición de la cámara (centro del recorte, 0 a 1) en cada muestra."""
    if not times:
        return []
    half = crop_w / 2
    lo, hi = half, 1 - half
    clamp = (lambda x: min(hi, max(lo, x))) if lo <= hi else (lambda x: 0.5)
    goals = median_filter(fill_gaps(times, targets), hard)
    pos = goal = clamp(goals[0])
    vel = 0.0
    out = [pos]
    for i in range(1, len(times)):
        target = clamp(goals[i])
        if hard[i]:
            pos = goal = target
            vel = 0.0
            out.append(pos)
            continue
        if abs(target - goal) > DEADZONE:
            goal = target
        dt = max(1e-3, times[i] - times[i - 1])
        steps = 8
        h = dt / steps
        for _ in range(steps):
            acc = SPRING * SPRING * (goal - pos) - 2 * SPRING * vel
            acc = max(-MAX_ACCEL, min(MAX_ACCEL, acc))
            vel = max(-MAX_SPEED, min(MAX_SPEED, vel + acc * h))
            pos += vel * h
        pos = clamp(pos)
        out.append(pos)
    return out


def _rdp(points: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    (t0, x0), (t1, x1) = points[0], points[-1]
    best, idx = -1.0, 0
    for i in range(1, len(points) - 1):
        t, x = points[i]
        expected = x0 + (x1 - x0) * (t - t0) / (t1 - t0) if t1 > t0 else x0
        d = abs(x - expected)
        if d > best:
            best, idx = d, i
    if best <= eps:
        return [points[0], points[-1]]
    return _rdp(points[: idx + 1], eps)[:-1] + _rdp(points[idx:], eps)


def keyframes(times: list[float], positions: list[float], hard: list[bool], eps: float = RDP_EPSILON) -> list[list[float]]:
    """Puntos clave [t, x]: tramos lineales; en un corte seco, dos puntos casi en el mismo instante."""
    if not times:
        return []
    while True:
        out: list[list[float]] = []
        start = 0
        for i in range(1, len(times) + 1):
            if i == len(times) or hard[i]:
                seg = _rdp(list(zip(times[start:i], positions[start:i])), eps)
                if out and i - start > 0:
                    # Corte: se mantiene la posición anterior hasta un instante antes del cambio.
                    out.append([round(times[start] - 0.001, 3), out[-1][1]])
                out.extend([round(t, 3), round(x, 4)] for t, x in seg)
                start = i
        if len(out) <= MAX_KEYFRAMES:
            return out
        eps *= 2


def position_at(points: list[list[float]], t: float) -> float:
    """Posición interpolada (la misma regla que la expresión de ffmpeg)."""
    if not points:
        return 0.5
    if t <= points[0][0]:
        return points[0][1]
    for (t0, x0), (t1, x1) in zip(points, points[1:]):
        if t < t1:
            return x0 + (x1 - x0) * (t - t0) / (t1 - t0) if t1 > t0 else x1
    return points[-1][1]


def crop_x_expression(points: list[list[float]], offset: float, src_w: int, crop_w: int) -> str:
    """Expresión de `crop` (x en píxeles, en función de t desde `offset`) lineal entre los puntos clave."""
    if not points:
        return str((src_w - crop_w) // 2)
    limit = src_w - crop_w

    def px(x: float) -> float:
        return round(min(limit, max(0.0, x * src_w - crop_w / 2)), 2)

    pts = [(round(t - offset, 3), px(x)) for t, x in points]
    expr = f"{pts[-1][1]}"
    for (t0, p0), (t1, p1) in reversed(list(zip(pts, pts[1:]))):
        seg = f"{p1}" if t1 - t0 < 1e-3 or p0 == p1 else f"{p0}+({round(p1 - p0, 2)})*(t-{t0})/{round(t1 - t0, 3)}"
        expr = f"if(lt(t,{t1}),{seg},{expr})"
    return f"if(lt(t,{pts[0][0]}),{pts[0][1]},{expr})"


# ─── Todo junto ────────────────────────────────────────────────────────────


def analyze_window(src: Path, start: float, end: float, width: int, height: int, detector: Any, spans: list[tuple[float, float]], progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    """Camino de la cámara para el tramo [start, end] del original (tiempos absolutos del original)."""
    cw, ch = crop_size(width, height)
    crop_w = cw / width
    samples = sample_faces(src, start, end - start, width, height, detector, progress)
    if not samples:
        return framing_center(start, end, cw / width, ch / height)
    assign_tracks(samples)
    targets, hard, switches = choose_targets(samples, crop_w, spans)
    times = [s.t for s in samples]
    positions = smooth_path(times, targets, hard, crop_w)
    with_face = sum(1 for s in samples if s.faces)
    points = keyframes(times, positions, hard)
    return {
        "version": 1,
        "mode": "face" if with_face / len(samples) >= 0.2 else "center",
        "crop": {"w": round(crop_w, 4), "h": round(ch / height, 4)},
        "keyframes": points if with_face else [[round(start, 3), 0.5], [round(end, 3), 0.5]],
        "faceRatio": round(with_face / len(samples), 3),
        "maxFaces": max(len(s.faces) for s in samples),
        "speakerSwitches": switches,
        "shotCuts": sum(1 for s in samples if s.cut),
        "start": round(start, 3),
        "end": round(end, 3),
    }


def framing_center(start: float, end: float, crop_w: float = ASPECT, crop_h: float = 1.0) -> dict[str, Any]:
    return {"version": 1, "mode": "center", "crop": {"w": round(min(1.0, crop_w), 4), "h": round(min(1.0, crop_h), 4)}, "keyframes": [[round(start, 3), 0.5], [round(end, 3), 0.5]], "faceRatio": 0.0, "maxFaces": 0, "speakerSwitches": 0, "shotCuts": 0, "start": round(start, 3), "end": round(end, 3)}


HDR_CHAIN = ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv"]


def render(
    src: Path,
    out: Path,
    start: float,
    duration: float,
    points: list[list[float]],
    width: int,
    height: int,
    size: tuple[int, int],
    *,
    crf: int,
    preset: str,
    audio_bitrate: str,
    hdr: bool = False,
    on_progress: Callable[[float], None] | None = None,
) -> Path:
    """Corta [start, start + duration] del original y lo reencuadra a `size` siguiendo el camino de la cámara."""
    cw, ch = crop_size(width, height)
    x = crop_x_expression(points, start, width, cw)
    chain = [*(HDR_CHAIN if hdr else []), f"crop=w={cw}:h={ch}:x='{x}':y={(height - ch) // 2}", f"scale={size[0]}:{size[1]}:flags=lanczos", "setsar=1", "fps=30", "format=yuv420p"]
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    ffmpeg.run(
        [
            "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{duration:.3f}",
            "-map", "0:v:0", "-map", "0:a:0",
            "-vf", ",".join(chain),
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-g", "30",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", "aac", "-b:a", audio_bitrate, "-ar", "48000",
            "-movflags", "+faststart",
            str(tmp),
        ],
        duration=duration,
        on_progress=on_progress,
        what="corte del clip",
    )
    os.replace(tmp, out)
    return out
