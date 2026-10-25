"""Diagnóstico de «Sacar la música de un reel» en la máquina del worker (solo lectura, no toca la base ni la app):
carga el modelo de separación y separa 20 s de una mezcla sintética (un tono de voz y un acorde), con el tiempo."""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from comunes.config import load
from video import separar


def main() -> None:
    cfg = load()
    model = separar.model_path(cfg.models_dir)
    print(f"modelo: {model} ({model.stat().st_size // (1024 * 1024)} MB)")
    sr = separar.SAMPLE_RATE
    t = np.arange(20 * sr) / sr
    voice = 0.3 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 3 * t) > 0)
    music = 0.2 * (np.sin(2 * np.pi * 110 * t) + np.sin(2 * np.pi * 165 * t) + np.sin(2 * np.pi * 220 * t)) / 3
    mix = np.stack([voice + music, voice + music]).astype(np.float32)
    start = time.time()
    v, r = separar.separate(mix, model)
    secs = time.time() - start
    print(f"separó 20 s en {secs:.1f} s · voz {separar.rms_db(v):.1f} dBFS · resto {separar.rms_db(r):.1f} dBFS")


if __name__ == "__main__":
    main()
