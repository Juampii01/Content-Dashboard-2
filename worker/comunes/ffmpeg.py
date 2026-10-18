"""Ejecución de ffmpeg y ffprobe con progreso real y cancelación.

ffmpeg informa su avance con `-progress pipe:1` (líneas `out_time_us=…`); con la duración esperada
se convierte en una fracción. Si el trabajo se cancela o el worker se apaga, el proceso se mata.
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
from collections import deque
from pathlib import Path
from typing import Callable

from .errors import Cancelled, JobError

log = logging.getLogger("worker.ffmpeg")

# Señal global: se activa cuando el trabajo actual tiene que parar (cancelado o apagado).
stop_event = threading.Event()


def run(
    args: list[str],
    *,
    duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
    what: str = "ffmpeg",
) -> str:
    """Corre ffmpeg. `args` sin el binario ni las opciones de log. Devuelve stderr (útil para filtros que miden)."""
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "info", "-progress", "pipe:1", "-nostats", *args]
    log.debug("ffmpeg %s", " ".join(a if len(a) < 200 else a[:200] + "…" for a in args))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    err_tail: deque[str] = deque(maxlen=400)

    def read_err() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            err_tail.append(line.rstrip())

    reader = threading.Thread(target=read_err, daemon=True)
    reader.start()
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            if stop_event.is_set():
                proc.kill()
                raise Cancelled()
            if on_progress and duration and line.startswith("out_time_us="):
                try:
                    us = int(line.split("=", 1)[1])
                    on_progress(max(0.0, min(1.0, us / 1e6 / duration)))
                except ValueError:
                    pass
        code = proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    reader.join(timeout=5)
    if stop_event.is_set():
        raise Cancelled()
    stderr = "\n".join(err_tail)
    if code != 0:
        log.error("%s falló (código %s): %s", what, code, stderr[-1500:])
        raise JobError("Falló el procesamiento del video. Vamos a reintentarlo.", detail=f"{what}: código {code}")
    return stderr


def probe(path: Path) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        ).stdout
        return json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise JobError(
            "No pudimos leer el video. Puede que el archivo esté dañado o en un formato raro: expórtalo de nuevo en MP4 o MOV.",
            retry=False,
            detail=f"ffprobe: {exc}",
        ) from exc


def fraction(value: str | None) -> float:
    """'30000/1001' → 29.97."""
    if not value or value in ("0/0", "N/A"):
        return 0.0
    if "/" in value:
        num, den = value.split("/", 1)
        try:
            return float(num) / float(den) if float(den) else 0.0
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0
