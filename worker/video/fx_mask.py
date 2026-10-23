"""Recorte de la persona (máscara por cuadro) para los efectos que ponen cosas detrás de ella.

Modelo: MediaPipe Selfie Segmentation (Apache-2.0, 440 KB en ONNX, `assets/fx/selfie_segmentation.onnx`), elegido
con datos frente a PP-HumanSeg, U²-Net (human_seg, silueta, u2netp) y BiRefNet (ver docs/worker.md, "Recorte de la
persona"). Cómo se usa:

1. **Mosaico**: un cuadro vertical se mira en dos cuadrados (arriba y abajo) a 256×256 y se mezclan en la zona común:
   el doble de resolución útil que aplastar el 9:16 entero en un cuadrado.
2. **Suavizado temporal**: filtro bilateral en el tiempo (±2 cuadros, gaussiano en el tiempo y en el valor): mezcla
   lo que se parece (quita el parpadeo) y respeta lo que cambia de verdad (un movimiento rápido no deja estela). Como
   se procesa todo el tramo de una vez, no hay retraso.
3. **Bordes**: guided filter (He et al.) con el cuadro en gris como guía, a 540×960: la máscara se pega a los bordes
   reales de la imagen. Al componer se agranda al tamaño final con interpolación bilineal.

La máscara depende solo del cuadro del original y del encuadre (no de los cortes): se guarda por **segundos del
original** (bloques de 30 cuadros, `npz` con uint8) en `/data/work/<proyecto>/fx-mask/<encuadre>/`. La vista previa
(trabajo VIDEO_FX) y el render usan los mismos bloques: lo que se ve en la revisión es lo que sale en el MP4.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import math
import os
import subprocess
from pathlib import Path
from typing import Callable, Iterable, Iterator

import cv2
import numpy as np

from comunes.errors import JobError

log = logging.getLogger("worker.video.fx_mask")

FPS = 30
CHUNK = 30  # cuadros por bloque (un segundo del original)
CONTEXT = 2  # cuadros de contexto a cada lado (suavizado temporal)
MODEL_FILE = Path(__file__).resolve().parent.parent / "assets" / "fx" / "selfie_segmentation.onnx"
MODEL_SIZE = 256
MASK_VERSION = "mp2"  # cambia la caché si cambia el modelo o el refinado

# Suavizado temporal y guided filter (elegidos en la evaluación: menos parpadeo sin perder borde).
SIGMA_T = 1.2
SIGMA_V = 0.15
GF_RADIUS = 6
GF_EPS = 1e-3
CHOKE = 0.12


def work_size(fmt: str) -> tuple[int, int]:
    """Tamaño de trabajo de la máscara (la mitad del video final)."""
    return (540, 960) if fmt == "9:16" else (960, 540)


def output_size(fmt: str) -> tuple[int, int]:
    return (1080, 1920) if fmt == "9:16" else (1920, 1080)


# ─── Encuadre (el mismo de render.framing_graph, sin zooms) ─────────────────


def framing_filter(src_w: int, src_h: int, fmt: str, offset_x: float, out_w: int, out_h: int) -> str:
    """Grafo para -filter_complex de una sola entrada ([0:v] → [v]) que deja el cuadro como en el video final, a
    `out_w`×`out_h`. Mismo recorte que render.framing_graph (16:9 → 9:16 con el ajuste horizontal; vertical en 16:9
    sobre una copia desenfocada)."""
    ref_w, ref_h = output_size(fmt)
    target_ratio = ref_w / ref_h
    src_ratio = src_w / src_h
    if src_ratio > target_ratio * 1.02:
        crop_w = min(src_w, int(round(src_h * target_ratio / 2)) * 2)
        free = src_w - crop_w
        x = int(round(free / 2 * (1 + max(-1.0, min(1.0, offset_x)))))
        x = max(0, min(free, x))
        return f"[0:v]crop={crop_w}:{src_h}:{x}:0,scale={out_w}:{out_h}:flags=lanczos,setsar=1[v]"
    if src_ratio < target_ratio / 1.02 and fmt == "16:9":
        blur = max(2, round(24 * out_w / ref_w))
        return (
            f"[0:v]split[a][b];[a]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,crop={out_w}:{out_h},boxblur={blur}:2,eq=brightness=-0.08[bg];"
            f"[b]scale=-2:{out_h}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1[v]"
        )
    return f"[0:v]scale={out_w}:{out_h}:force_original_aspect_ratio=increase:flags=lanczos,crop={out_w}:{out_h},setsar=1[v]"


def framing_key(src_w: int, src_h: int, fmt: str, offset_x: float) -> str:
    """Nombre corto del encuadre (carpeta de la caché y de la vista previa): "9x16-op000-mp2", "9x16-om035-mp2"…
    (sin signos raros: va en las claves del almacenamiento)."""
    ref_w, ref_h = output_size(fmt)
    wide = src_w / src_h > ref_w / ref_h * 1.02
    off = math.floor(max(-1.0, min(1.0, offset_x)) * 100 + 0.5) if wide else 0  # como Math.round de la app
    return f"{fmt.replace(':', 'x')}-o{'m' if off < 0 else 'p'}{abs(off):03d}-{MASK_VERSION}"


def read_frames(src: Path, start_frame: int, count: int, graph: str, size: tuple[int, int]) -> Iterator[np.ndarray]:
    """Cuadros RGB (uint8) del archivo, desde `start_frame`, ya encuadrados a `size`."""
    w, h = size
    proc = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
            "-ss", f"{start_frame / FPS:.6f}", "-i", str(src),
            "-filter_complex", graph, "-map", "[v]", "-frames:v", str(count),
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdout
    size_b = w * h * 3
    try:
        for _ in range(count):
            buf = proc.stdout.read(size_b)
            if len(buf) < size_b:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


# ─── Modelo ─────────────────────────────────────────────────────────────────


@functools.lru_cache(maxsize=1)
def _session():
    import onnxruntime as ort

    model = Path(os.environ.get("FX_MASK_MODEL") or MODEL_FILE)
    if not model.exists():
        raise JobError("Falta el modelo de recorte de los efectos en el servicio de procesamiento.", retry=False, detail=str(model))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, min(4, os.cpu_count() or 2))
    opts.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(model), opts, providers=["CPUExecutionProvider"])
    return sess, sess.get_inputs()[0].name


def _square(rgb: np.ndarray) -> np.ndarray:
    sess, name = _session()
    h, w = rgb.shape[:2]
    x = cv2.resize(rgb, (MODEL_SIZE, MODEL_SIZE), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    out = sess.run(None, {name: x[None]})[0][0, :, :, 0]
    return cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)


def predict(rgb: np.ndarray) -> np.ndarray:
    """Probabilidad de persona (0..1, float32) al tamaño del cuadro. Vertical: dos cuadrados mezclados; horizontal:
    dos cuadrados a izquierda y derecha."""
    h, w = rgb.shape[:2]
    if max(h, w) <= min(h, w) * 1.1:
        return _square(rgb)
    vertical = h > w
    side = min(h, w)
    length = max(h, w)
    first = _square(rgb[:side] if vertical else rgb[:, :side])
    second = _square(rgb[length - side :] if vertical else rgb[:, length - side :])
    ov0, ov1 = length - side, side  # zona común (ov0 < ov1 cuando el cuadro mide menos de dos cuadrados)
    wa = np.zeros(length, np.float32)
    wb = np.zeros(length, np.float32)
    wa[:side] = 1
    wb[length - side :] = 1
    if ov1 > ov0:
        ramp = np.linspace(1, 0, ov1 - ov0, dtype=np.float32)
        wa[ov0:ov1] = ramp
        wb[ov0:ov1] = 1 - ramp
    out = np.zeros((h, w), np.float32)
    if vertical:
        out[:side] += first * wa[:side, None]
        out[length - side :] += second * wb[length - side :, None]
    else:
        out[:, :side] += first * wa[None, :side]
        out[:, length - side :] += second * wb[None, length - side :]
    return out


# ─── Refinado ───────────────────────────────────────────────────────────────


def _box(x: np.ndarray, r: int) -> np.ndarray:
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))


def guided(gray: np.ndarray, p: np.ndarray, r: int = GF_RADIUS, eps: float = GF_EPS) -> np.ndarray:
    """Guided filter con guía en gris (He, Sun y Tang 2010): bordes de la máscara pegados a los de la imagen."""
    mi, mp = _box(gray, r), _box(p, r)
    a = (_box(gray * p, r) - mi * mp) / (_box(gray * gray, r) - mi * mi + eps)
    b = mp - a * mi
    return _box(a, r) * gray + _box(b, r)


def temporal(seq: list[np.ndarray], index: int) -> np.ndarray:
    """Bilateral en el tiempo alrededor de `index` (±CONTEXT cuadros)."""
    cur = seq[index]
    acc = np.zeros_like(cur)
    weight = np.zeros_like(cur)
    n = len(seq)
    for d in range(-CONTEXT, CONTEXT + 1):
        j = min(n - 1, max(0, index + d))
        w = np.exp(-(d * d) / (2 * SIGMA_T**2)) * np.exp(-((seq[j] - cur) ** 2) / (2 * SIGMA_V**2))
        acc += w * seq[j]
        weight += w
    return acc / weight


def refine_sequence(frames: list[np.ndarray], probs: list[np.ndarray], keep: range) -> list[np.ndarray]:
    """Máscaras uint8 de los cuadros `keep` (índices dentro de la lista, que trae contexto a los lados)."""
    out = []
    for i in keep:
        p = temporal(probs, i)
        gray = cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        # Un leve "choke": el borde suave de afuera trae color del fondo original, que se nota sobre un fondo nuevo.
        q = np.clip((guided(gray, p.astype(np.float32)) - CHOKE) / (1.0 - CHOKE - 0.08), 0.0, 1.0)
        out.append((q * 255 + 0.5).astype(np.uint8))
    return out


def masks_for(frames: list[np.ndarray], context_before: int = 0, context_after: int = 0) -> list[np.ndarray]:
    """Máscaras de una lista de cuadros RGB al tamaño de trabajo. Los cuadros de contexto no se devuelven."""
    probs = [predict(f) for f in frames]
    return refine_sequence(frames, probs, range(context_before, len(frames) - context_after))


# ─── Caché por segundos del original ────────────────────────────────────────


def chunk_path(cache: Path, key: str, k: int) -> Path:
    return cache / key / f"m-{k:05d}.npz"


def ensure_chunks(
    mezz: Path,
    src_size: tuple[int, int],
    total_frames: int,
    fmt: str,
    offset_x: float,
    chunks: Iterable[int],
    cache: Path,
    on_progress: Callable[[float], None] | None = None,
    check: Callable[[], None] | None = None,
) -> str:
    """Calcula (si faltan) los bloques de máscara del original. Devuelve la clave del encuadre."""
    key = framing_key(src_size[0], src_size[1], fmt, offset_x)
    size = work_size(fmt)
    graph = framing_filter(src_size[0], src_size[1], fmt, offset_x, *size)
    wanted = sorted({k for k in chunks if 0 <= k * CHUNK < total_frames})
    missing = [k for k in wanted if not chunk_path(cache, key, k).exists()]
    (cache / key).mkdir(parents=True, exist_ok=True)
    for n, k in enumerate(missing):
        if check:
            check()
        first = k * CHUNK
        last = min(total_frames, first + CHUNK)
        a = max(0, first - CONTEXT)
        b = min(total_frames, last + CONTEXT)
        frames = list(read_frames(mezz, a, b - a, graph, size))
        if not frames:
            raise JobError("No pudimos leer el video para recortarte.", detail=f"bloque {k}")
        before = first - a
        after = max(0, len(frames) - before - (last - first))
        masks = masks_for(frames, before, after)
        # Si el archivo terminó antes (redondeo de la duración), se repite la última máscara.
        while len(masks) < last - first:
            masks.append(masks[-1])
        path = chunk_path(cache, key, k)
        tmp = path.with_name(path.stem + ".part.npz")
        np.savez_compressed(tmp, m=np.stack(masks[: last - first]))
        os.replace(tmp, path)
        if on_progress:
            on_progress((n + 1) / max(1, len(missing)))
    return key


@functools.lru_cache(maxsize=8)
def _load_chunk(path: str) -> np.ndarray:
    with np.load(path) as data:
        return data["m"]


def mask_at(cache: Path, key: str, source_frame: int) -> np.ndarray:
    k, i = divmod(source_frame, CHUNK)
    arr = _load_chunk(str(chunk_path(cache, key, k)))
    return arr[min(i, len(arr) - 1)]


def chunks_for_frames(frames: Iterable[int]) -> list[int]:
    return sorted({f // CHUNK for f in frames})


# ─── Vista previa (tiras de máscaras chicas para el navegador) ─────────────

PREVIEW_FPS = 10
PREVIEW_SIZE = {"9:16": (180, 320), "16:9": (320, 180)}


def preview_strip(cache: Path, key: str, k: int, fmt: str, out: Path) -> Path:
    """Una tira PNG (blanca, con la máscara en el alfa) con las máscaras de un segundo del original a 10 cuadros por segundo (una al lado de la
    otra). El navegador la agranda y compone en vivo, con la misma máscara que el render."""
    arr = _load_chunk(str(chunk_path(cache, key, k)))
    w, h = PREVIEW_SIZE[fmt]
    tiles = []
    for j in range(PREVIEW_FPS):
        i = min(len(arr) - 1, round(j * CHUNK / PREVIEW_FPS))
        tiles.append(cv2.resize(arr[i], (w, h), interpolation=cv2.INTER_AREA))
    alpha = np.hstack(tiles)
    # Blanca con la máscara en el alfa: el navegador la dibuja tal cual (sin leer píxeles, que con un origen distinto
    # no se puede).
    rgba = np.dstack([np.full_like(alpha, 255)] * 3 + [alpha])
    cv2.imwrite(str(out), rgba, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    return out


def content_hash(obj: object) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:12]
