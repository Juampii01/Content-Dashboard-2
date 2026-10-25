"""Control de sincronía de la IMAGEN del render: ¿cada cuadro del MP4 final es el cuadro del original que dice el
timeline? El control del audio (render.sync_check) mira solo el sonido; este mira la imagen, así un video con la imagen
corrida respecto del audio (o al revés) no se entrega.

Cómo: en puntos repartidos por el video donde no hay nada encima (b-roll, gráficos, efectos, animaciones, emojis ni
zooms), se compara el cuadro del final con los cuadros del original alrededor del que tendría que verse (±1 s), con el
mismo encuadre del render, chicos y en gris (solo la parte de arriba: abajo van los subtítulos). Un punto cuenta si el
cuadro tiene detalle y el parecido es claro (una toma quieta no sirve para medir: se descarta). El desfase es la
distancia entre el cuadro esperado y el que más se parece.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from . import fx_mask
from .render import FPS

SIZE = (36, 64)  # ancho × alto de comparación (9:16); en 16:9 se usa al revés
TOP = 0.62  # parte de arriba del cuadro que se compara (abajo van los subtítulos)
SEARCH = FPS  # ±1 s de cuadros del original
POINTS = 14
MARGIN = 0.25  # segundos de aire alrededor de lo que tapa la imagen
CONFIDENT = 0.6  # parecido mínimo del mejor cuadro (en lo que se mueve) para que el punto cuente
DISTINCT = 0.2  # el mejor tiene que ganarle por esto a los que están a medio segundo (si no, es una toma quieta)
TOLERANCE = 3  # cuadros (100 ms) de desfase que se toleran en un punto
SEVERE = 6  # cuadros (200 ms): 2 puntos así frenan la entrega


def source_frame_at(clips: list[dict[str, Any]], out_frame: int) -> int | None:
    """Cuadro del original (30 fps del mezzanine) que va en el cuadro `out_frame` del final, según el timeline."""
    acc = 0
    for c in clips:
        n = int(c["end"]) - int(c["start"])
        if out_frame < acc + n:
            return int(c["start"]) + (out_frame - acc)
        acc += n
    return None


def _covered(t: float, spans: list[tuple[float, float]]) -> bool:
    return any(a - MARGIN <= t <= b + MARGIN for a, b in spans)


def pick_points(duration: float, spans: list[tuple[float, float]], clips: list[dict[str, Any]], n: int = POINTS) -> list[int]:
    """Cuadros del final para medir: repartidos, lejos de lo que tapa la imagen y de los bordes de cada tramo."""
    cuts: list[float] = []
    acc = 0
    for c in clips:
        acc += int(c["end"]) - int(c["start"])
        cuts.append(acc / FPS)
    out: list[int] = []
    step = duration / (n * 3 + 1)
    t = step
    while t < duration - 0.3 and len(out) < n * 3:
        if not _covered(t, spans) and all(abs(t - x) > 0.15 for x in cuts):
            out.append(int(round(t * FPS)))
        t += step
    # Hasta n, repartidos entre los candidatos.
    if len(out) > n:
        idx = np.linspace(0, len(out) - 1, n).round().astype(int)
        out = [out[i] for i in idx]
    return out


def _decode(cmd: list[str], w: int, h: int) -> np.ndarray:
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, dtype=np.uint8)
    if frames.size < w * h:
        return np.zeros((0, h, w), dtype=np.float32)
    return frames[: (frames.size // (w * h)) * w * h].reshape(-1, h, w).astype(np.float32)


def _norm(a: np.ndarray) -> np.ndarray:
    a = a.reshape(len(a), -1)
    a = a - a.mean(1, keepdims=True)
    return a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-6)


def _size(fmt: str) -> tuple[int, int]:
    return SIZE if fmt == "9:16" else (SIZE[1], SIZE[0])


def final_frames(final: Path, frames: list[int], fmt: str) -> np.ndarray:
    w, h = _size(fmt)
    expr = "+".join(f"eq(n\\,{f})" for f in frames)
    return _decode(
        ["ffmpeg", "-v", "error", "-i", str(final), "-vf", f"select='{expr}',scale={w}:{h}:flags=area,format=gray", "-fps_mode", "passthrough", "-f", "rawvideo", "-"],
        w,
        h,
    )


def source_window(mezz: Path, center: int, src_size: tuple[int, int], fmt: str, offset_x: float, total: int) -> tuple[int, np.ndarray]:
    """Cuadros del original alrededor de `center` (±SEARCH) con el encuadre del render, chicos y en gris."""
    w, h = _size(fmt)
    a = max(0, center - SEARCH)
    count = min(total, center + SEARCH + 1) - a
    graph = fx_mask.framing_filter(src_size[0], src_size[1], fmt, offset_x, w, h).replace("[v]", ",format=gray[v]")
    frames = _decode(
        ["ffmpeg", "-v", "error", "-ss", f"{a / FPS:.6f}", "-i", str(mezz), "-filter_complex", graph, "-map", "[v]", "-frames:v", str(max(1, count)), "-f", "rawvideo", "-"],
        w,
        h,
    )
    return a, frames


def offsets(final: Path, mezz: Path, clips: list[dict[str, Any]], spans: list[tuple[float, float]], *, fmt: str, offset_x: float, src_size: tuple[int, int], total_frames: int, duration: float) -> list[dict[str, Any]]:
    """Por punto: cuadro del final, segundo, cuadro esperado del original, el que más se parece, parecido y desfase."""
    points = pick_points(duration, spans, clips)
    if not points:
        return []
    got = final_frames(final, points, fmt)
    w, h = _size(fmt)
    top = max(8, int(h * TOP))
    out: list[dict[str, Any]] = []
    for k, f in enumerate(points[: len(got)]):
        want = source_frame_at(clips, f)
        if want is None:
            continue
        a, window = source_window(mezz, want, src_size, fmt, offset_x, total_frames)
        if len(window) < 3:
            continue
        # Sin lo que no cambia en el segundo de alrededor (fondo, barras): se compara lo que se mueve, así una toma con
        # mucho fondo fijo no da "todo igual".
        base = window[:, :top].mean(0)
        o = _norm((got[k, :top] - base)[None])[0]
        r = _norm(window[:, :top] - base) @ o
        best = int(np.argmax(r))
        exp = want - a
        if exp >= len(r):
            continue
        far = [r[i] for i in range(len(r)) if abs(i - best) >= FPS // 2]
        distinct = float(r[best] - (max(far) if far else -1.0))
        detail = float(np.std(got[k, :top] - base))
        out.append(
            {
                "out": round(f / FPS, 2),
                "want": round(want / FPS, 2),
                "got": round((a + best) / FPS, 2),
                "lag": (a + best) - want,
                "r": round(float(r[best]), 3),
                "r_want": round(float(r[exp]), 3),
                "confident": bool(r[best] >= CONFIDENT and distinct >= DISTINCT and detail >= 1.5),
            }
        )
    return out


def check(final: Path, mezz: Path, clips: list[dict[str, Any]], spans: list[tuple[float, float]], *, fmt: str, offset_x: float, src_size: tuple[int, int], total_frames: int, duration: float) -> dict[str, Any]:
    """Para el control de calidad: falla si 2 o más puntos confiables muestran otro cuadro a más de 200 ms del esperado
    (la imagen no sigue el timeline), y avisa si alguno está a más de 100 ms."""
    pts = offsets(final, mezz, clips, spans, fmt=fmt, offset_x=offset_x, src_size=src_size, total_frames=total_frames, duration=duration)
    conf = [p for p in pts if p["confident"]]
    # Un punto está corrido si el esperado se parece claramente menos que el mejor (no una toma casi quieta).
    off = [p for p in conf if abs(p["lag"]) > TOLERANCE and p["r_want"] < p["r"] - 0.05]
    severe = [p for p in off if abs(p["lag"]) > SEVERE]
    if not conf:
        detail = "sin tomas para medir (todo tapado o muy quieto)"
    elif off:
        p = max(off, key=lambda p: abs(p["lag"]))
        detail = f"la imagen está corrida {p['lag'] / FPS * 1000:+.0f} ms en el segundo {p['out']:.1f} ({len(off)} de {len(conf)} puntos)"
    else:
        worst = max((abs(p["lag"]) for p in conf), default=0)
        detail = f"{len(conf)} de {len(pts)} puntos medidos, desfase máximo {worst / FPS * 1000:.0f} ms"
    return {"name": "Sincronía de la imagen", "ok": len(severe) < 2, "warn": bool(off), "detail": detail, "points": pts}
