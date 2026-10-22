"""Foto del personaje sin fondo, open source y sin red: U²-Net (u2net_human_seg, Apache-2.0) en ONNX con onnxruntime.

Por qué así y no el paquete `rembg` (MIT): rembg trae scipy, scikit-image, pymatting y pooch (~150 MB más en la imagen)
y baja el modelo al usarse. Aquí se usa el mismo modelo y el mismo pre y posproceso que rembg con lo que el worker ya
tiene (onnxruntime viene con onnx-asr, más numpy y Pillow). El modelo (~170 MB) se baja una vez al construir la imagen
(scripts/fetch_models.py → models/rembg/u2net_human_seg.onnx). Si no está, no se recorta: la app usa la foto entera
con un degradado hacia el lado del texto.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

log = logging.getLogger("worker.youtube")

MODEL_NAME = "u2net_human_seg"
INPUT = 320
MAX_HEIGHT = 1440

_session = None


class CutoutUnavailable(Exception):
    """No hay modelo de recorte en esta instalación."""


class NoPerson(Exception):
    """El modelo no encontró a una persona en la foto."""


def model_path(models_dir: Path) -> Path:
    return Path(os.environ.get("CUTOUT_MODEL") or models_dir / "rembg" / f"{MODEL_NAME}.onnx")


def _get_session(path: Path):
    global _session
    if _session is None:
        if not path.exists():
            raise CutoutUnavailable(str(path))
        import onnxruntime as ort  # importación tardía: solo si hay modelo

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        _session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
    return _session


def person_mask(image: Image.Image, models_dir: Path) -> Image.Image:
    """Máscara (L, 0 a 255) del tamaño de la imagen, con el mismo pre y posproceso que rembg para U²-Net."""
    session = _get_session(model_path(models_dir))
    small = image.convert("RGB").resize((INPUT, INPUT), Image.Resampling.LANCZOS)
    arr = np.asarray(small).astype(np.float32)
    arr = arr / max(float(arr.max()), 1e-6)
    mean = np.array([0.485, 0.456, 0.406], np.float32)
    std = np.array([0.229, 0.224, 0.225], np.float32)
    arr = ((arr - mean) / std).transpose(2, 0, 1)[None, ...].astype(np.float32)
    out = session.run(None, {session.get_inputs()[0].name: arr})[0][:, 0, :, :]
    pred = out[0]
    lo, hi = float(pred.min()), float(pred.max())
    pred = (pred - lo) / max(hi - lo, 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8)).resize(image.size, Image.Resampling.LANCZOS)
    return mask


def cutout(src: Path, dest: Path, models_dir: Path) -> Path:
    """PNG con transparencia, recortado al contorno de la persona (con un margen) y de hasta 1440 px de alto."""
    with Image.open(src) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
    if max(image.size) > 2400:
        image.thumbnail((2400, 2400))
    mask = person_mask(image, models_dir)
    alpha = np.asarray(mask).astype(np.float32) / 255
    # Bordes limpios: lo muy transparente se borra y lo casi opaco queda opaco.
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)
    coverage = float((alpha > 0.5).mean())
    if coverage < 0.03:
        raise NoPerson(f"cobertura {coverage:.3f}")
    rgba = image.convert("RGBA")
    rgba.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
    ys, xs = np.nonzero(alpha > 0.04)
    pad = int(0.02 * max(image.size))
    box = (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad), min(image.width, int(xs.max()) + pad + 1), min(image.height, int(ys.max()) + 1))
    rgba = rgba.crop(box)
    if rgba.height > MAX_HEIGHT:
        rgba = rgba.resize((round(rgba.width * MAX_HEIGHT / rgba.height), MAX_HEIGHT), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(dest, "PNG", optimize=True)
    return dest
