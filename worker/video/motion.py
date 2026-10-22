"""Gráficos animados con el motor de motion graphics (lib/video/motion), el mismo que dibuja la vista previa.

El motor está en TypeScript y corre aquí con Node 22 y skia-canvas (`worker/motion/render.mjs`, con el motor
empaquetado en `worker/motion/engine.mjs`). Acepta los gráficos v1 de los planes (6 plantillas) y las escenas v2.

`MOTION_RENDER=0` lo apaga y vuelve al dibujo con Pillow (worker/video/graphics.py), que también queda como
respaldo si el motor falla con un gráfico v1. Las escenas v2 solo se pueden dibujar con el motor.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from comunes.errors import JobError

from . import graphics

log = logging.getLogger("worker.video.motion")

MOTION_DIR = Path(__file__).resolve().parent.parent / "motion"
RENDER_SCRIPT = MOTION_DIR / "render.mjs"
ENGINE = MOTION_DIR / "engine.mjs"
FPS = 30
TIMEOUT = 300


def enabled() -> bool:
    """El motor está prendido (por defecto sí) y tiene lo que necesita: Node, el script, el motor y skia-canvas."""
    if os.environ.get("MOTION_RENDER", "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool(node_bin()) and RENDER_SCRIPT.exists() and ENGINE.exists() and (MOTION_DIR / "node_modules" / "skia-canvas").exists()


def node_bin() -> str | None:
    return os.environ.get("NODE_BIN") or shutil.which("node")


@lru_cache(maxsize=1)
def engine_hash() -> str:
    """Versión del motor (cambia la caché cuando cambia el motor)."""
    try:
        return hashlib.sha1(ENGINE.read_bytes()).hexdigest()[:10]
    except OSError:
        return "sin-motor"


def is_scene(graphic: Any) -> bool:
    return isinstance(graphic, dict) and graphic.get("v") == 2


def validate(graphic: Any) -> dict[str, Any]:
    """Revisión defensiva antes de llamar al motor (la app ya lo validó con Zod; el motor lo vuelve a validar)."""
    if is_scene(graphic):
        if graphic.get("mode") not in ("full", "overlay") or not isinstance(graphic.get("layers"), list) or not graphic["layers"]:
            raise JobError("Un gráfico del b-roll no es válido. Cámbialo en la revisión.", retry=False)
        return graphic
    return graphics.validate_spec(graphic)


def cache_name(graphic: dict[str, Any], size: tuple[int, int], duration: float) -> str:
    key = json.dumps({"g": graphic, "size": list(size), "duration": round(duration, 3), "engine": engine_hash(), "v": 2}, sort_keys=True, ensure_ascii=False)
    ext = "mov" if graphic.get("mode") == "overlay" else "mp4"
    return f"motion-{hashlib.sha1(key.encode()).hexdigest()[:16]}.{ext}"


def render_motion(graphic: dict[str, Any], duration: float, size: tuple[int, int], out: Path, fonts_dir: Path) -> Path:
    """Dibuja el gráfico con el motor (Node + skia-canvas). Si el archivo ya existe (misma caché), no hace nada."""
    if out.exists() and out.stat().st_size > 0:
        return out
    node = node_bin()
    if not node:
        raise JobError("Falta Node en el servicio de procesamiento para dibujar los gráficos.", retry=False)
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    payload = {"graphic": graphic, "width": size[0], "height": size[1], "duration": round(duration, 3), "out": str(tmp), "fps": FPS, "fontsDir": str(fonts_dir)}
    try:
        proc = subprocess.run([node, str(RENDER_SCRIPT)], input=json.dumps(payload).encode(), capture_output=True, timeout=TIMEOUT, cwd=str(MOTION_DIR))
    except subprocess.TimeoutExpired as e:
        tmp.unlink(missing_ok=True)
        raise JobError("Dibujar un gráfico del b-roll tardó demasiado.", detail=str(e)) from e
    result: dict[str, Any] = {}
    try:
        result = json.loads(proc.stdout.decode(errors="replace").strip().splitlines()[-1] or "{}")
    except (ValueError, IndexError):
        result = {}
    if proc.returncode != 0 or not result.get("ok") or not tmp.exists():
        tmp.unlink(missing_ok=True)
        detail = (result.get("error") or proc.stderr.decode(errors="replace"))[-800:]
        raise JobError("No pudimos dibujar un gráfico del b-roll.", detail=detail)
    os.replace(tmp, out)
    log.info("gráfico %s dibujado con el motor: %s cuadros en %s ms", out.name, result.get("frames"), result.get("ms"))
    return out


def render_graphic(graphic: Any, duration: float, size: tuple[int, int], cache: Path, fonts_dir: Path) -> Path:
    """El gráfico listo para superponer. Motor primero; con un v1, Pillow de respaldo si el motor no está o falla."""
    graphic = validate(graphic)
    if enabled():
        path = cache / cache_name(graphic, size, duration)
        try:
            return render_motion(graphic, duration, size, path, fonts_dir)
        except JobError as e:
            if is_scene(graphic):
                raise
            log.warning("el motor falló con un gráfico v1, se usa Pillow: %s", e.detail or e)
    elif is_scene(graphic):
        raise JobError("Este gráfico necesita el motor de gráficos animados, que no está disponible.", retry=False)
    path = cache / graphics.cache_name(graphic, size, duration)
    return graphics.render_graphic(graphic, duration, size, path, fonts_dir)
