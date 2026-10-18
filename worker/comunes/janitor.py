"""Limpieza de la carpeta de trabajo del worker.

Cada proyecto deja en `work_dir/<id>` el original, el intermedio, el audio y los tramos (pueden ser varios GB).
Se conservan un tiempo para poder volver a renderizar rápido, pero no para siempre:
- proyecto borrado → se borra su carpeta enseguida (el video del cliente no queda en el volumen);
- proyecto terminado (DONE) o fallido sin tocar hace más de `keep_done_days` → se borra;
- cualquier carpeta sin tocar hace más de `max_age_days` → se borra.
Si después hace falta, el trabajo vuelve a bajar el original y rearma todo.
"""

from __future__ import annotations

import logging
import shutil
import time
import uuid
from pathlib import Path

import psycopg

log = logging.getLogger("worker")


def _last_touch(path: Path) -> float:
    latest = path.stat().st_mtime
    for child in path.rglob("*"):
        try:
            latest = max(latest, child.stat().st_mtime)
        except OSError:
            pass
    return latest


def cleanup_workdirs(conn: psycopg.Connection, work_dir: Path, *, busy: set[str] | None = None, keep_done_days: float = 3, max_age_days: float = 14) -> int:
    """Devuelve cuántas carpetas borró. Nunca toca las de los proyectos en `busy`."""
    if not work_dir.exists():
        return 0
    busy = busy or set()
    now = time.time()
    removed = 0
    for path in work_dir.iterdir():
        if not path.is_dir() or path.name in busy:
            continue
        try:
            uuid.UUID(path.name)
        except ValueError:
            continue  # no es una carpeta de proyecto
        try:
            row = conn.execute("SELECT status FROM video_projects WHERE id = %s", (path.name,)).fetchone()
        except psycopg.Error as exc:
            log.warning("limpieza: no se pudo consultar la base (%s)", exc.__class__.__name__)
            return removed
        age_days = (now - _last_touch(path)) / 86_400
        status = row["status"] if row else None
        if row is None or (status in ("DONE", "FAILED") and age_days > keep_done_days) or age_days > max_age_days:
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
            log.info("limpieza: borrada la carpeta %s (%s)", path.name, "proyecto borrado" if row is None else status)
    return removed
