"""Música generada (licencia propia): la pista se arma en Node con el mismo generador que la vista previa
(`worker/motion/music.mjs` + `music-engine.mjs`, desde lib/video/music-gen) y queda en caché por estilo, semilla, tempo,
duración y versión del generador. El render la mezcla bajo la voz como cualquier música (render.mix_audio)."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from comunes.errors import JobError

from . import motion

SCRIPT = motion.MOTION_DIR / "music.mjs"
ENGINE = motion.MOTION_DIR / "music-engine.mjs"
STYLES = ("lofi", "corporativo", "trap", "ambiente", "acustico", "tension", "epica")
TIMEOUT = 300


def enabled() -> bool:
    return bool(motion.node_bin()) and SCRIPT.exists() and ENGINE.exists()


@lru_cache(maxsize=1)
def engine_hash() -> str:
    try:
        return hashlib.sha1(ENGINE.read_bytes() + SCRIPT.read_bytes()).hexdigest()[:10]
    except OSError:
        return "sin-motor"


def validate(spec: Any) -> dict[str, Any]:
    """Revisión defensiva (la app ya validó con Zod)."""
    if not isinstance(spec, dict) or spec.get("style") not in STYLES:
        raise JobError("La música elegida no es válida. Elígela de nuevo en la revisión.", retry=False)
    seed, bpm = spec.get("seed"), spec.get("bpm")
    if not isinstance(seed, int) or not isinstance(bpm, int) or not (0 <= seed < 2**31) or not (50 <= bpm <= 180):
        raise JobError("La música elegida no es válida. Elígela de nuevo en la revisión.", retry=False)
    return {"style": spec["style"], "seed": seed, "bpm": bpm}


def generate(spec: Any, seconds: float, cache: Path) -> Path:
    """La pista generada para `seconds` segundos (WAV mono, 48 kHz)."""
    clean = validate(spec)
    if not enabled():
        raise JobError("Falta el generador de música en el servicio de procesamiento.", retry=False)
    seconds = max(2.0, min(600.0, round(float(seconds), 2)))
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(json.dumps({**clean, "s": seconds, "e": engine_hash()}, sort_keys=True).encode()).hexdigest()[:16]
    out = cache / f"gen-{key}.wav"
    if out.exists() and out.stat().st_size > 44:
        return out
    tmp = out.with_name(out.stem + ".part.wav")
    node = motion.node_bin()
    try:
        proc = subprocess.run([node, str(SCRIPT)], input=json.dumps({"spec": clean, "seconds": seconds, "out": str(tmp)}).encode(), capture_output=True, timeout=TIMEOUT, cwd=str(motion.MOTION_DIR))
    except subprocess.TimeoutExpired as e:
        raise JobError("Generar la música tardó demasiado.", detail=str(e)) from e
    try:
        result = json.loads(proc.stdout.decode(errors="replace").strip().splitlines()[-1] or "{}")
    except (ValueError, IndexError):
        result = {}
    if proc.returncode != 0 or not result.get("ok"):
        raise JobError("No pudimos generar la música del video.", detail=(result.get("error") or proc.stderr.decode(errors="replace"))[-800:])
    os.replace(tmp, out)
    return out
