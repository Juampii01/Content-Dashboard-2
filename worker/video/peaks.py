"""Forma de onda de la voz para la línea de tiempo del Estudio (y sus medidores en la vista previa).

Se mide el audio del original (el mismo que suena en la vista previa) en ventanas de 20 ms: el pico y el RMS de cada
una, en una escala de 0 a 255 (raíz cuadrada de la amplitud lineal: la voz baja se sigue viendo). Queda en un JSON chico
(`editor/<id>/picos-v1.json`, unos 30 KB por cada 10 minutos) y en `media.peaks` su clave.

Lo arma el análisis (VIDEO_ANALYZE) y, para los videos de antes, el trabajo VIDEO_PEAKS (lo pide el Estudio al abrir
un video sin forma de onda): baja solo el proxy si no está el WAV de la ingesta.
"""

from __future__ import annotations

import base64
import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from comunes import db
from comunes.errors import JobError
from comunes.runner import JobContext, register

log = logging.getLogger("worker.video.peaks")

VERSION = 1
RATE = 50  # ventanas por segundo (20 ms)
SAMPLE_RATE = 8000  # alcanza para el contorno de la voz y es rápido
MAX_SECONDS = 4 * 3600


def decode(path: Path) -> Any:
    """Audio mono como float32 a SAMPLE_RATE (lo decodifica ffmpeg: WAV, MP4 o MKV)."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-t", str(MAX_SECONDS), "-f", "f32le", "-"],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise JobError("No pudimos leer el audio para dibujar su forma de onda.", detail=proc.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(proc.stdout, dtype="<f4")


def quantize(values: Any) -> bytes:
    """Amplitud lineal (0 a 1) → 0..255 con raíz cuadrada (la app lo vuelve a lineal con (v / 255)²)."""
    import numpy as np

    v = np.sqrt(np.clip(values, 0.0, 1.0)) * 255.0
    return np.round(v).astype(np.uint8).tobytes()


def compute(path: Path) -> dict[str, Any]:
    """Picos y RMS por ventana de 1/RATE s. Devuelve lo que va en el JSON (los arreglos en base64)."""
    import numpy as np

    x = decode(path).astype(np.float64)
    hop = SAMPLE_RATE // RATE
    n = int(np.ceil(len(x) / hop)) if len(x) else 0
    if n == 0:
        return {"version": VERSION, "rate": RATE, "count": 0, "duration": 0.0, "peak": "", "rms": ""}
    pad = np.zeros(n * hop - len(x))
    frames = np.concatenate([x, pad]).reshape(n, hop)
    peak = np.abs(frames).max(axis=1)
    rms = np.sqrt((frames**2).mean(axis=1))
    return {
        "version": VERSION,
        "rate": RATE,
        "count": n,
        "duration": round(len(x) / SAMPLE_RATE, 3),
        "peak": base64.b64encode(quantize(peak)).decode("ascii"),
        "rms": base64.b64encode(quantize(rms)).decode("ascii"),
    }


def peaks_key(pid: str) -> str:
    return f"editor/{pid}/picos-v{VERSION}.json"


def make(ctx: JobContext, pid: str, audio: Path, out_dir: Path) -> dict[str, Any]:
    """Mide `audio`, sube el JSON y devuelve lo que va en `media.peaks`."""
    data = compute(audio)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"picos-v{VERSION}.json"
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    key = peaks_key(pid)
    ctx.app.upload(pid, key, path, "application/json")
    return {"version": VERSION, "key": key, "rate": RATE, "count": data["count"]}


def save_media(ctx: JobContext, pid: str, peaks: dict[str, Any]) -> None:
    """Solo toca `media.peaks` (la persona o el render pudieron cambiar otras cosas de media mientras tanto)."""
    fresh = db.get_project(ctx.conn, pid) or {}
    current = dict(fresh.get("media") or {})
    current["peaks"] = peaks
    db.update_project(ctx.conn, pid, media=current)


@register("VIDEO_PEAKS")
def peaks_job(ctx: JobContext) -> dict[str, Any]:
    """Forma de onda de un video de antes de las pistas de audio: del WAV de la ingesta si está, o del proxy."""
    project = db.get_project(ctx.conn, ctx.input["projectId"])
    if not project:
        raise JobError("El proyecto ya no existe.", retry=False)
    pid = str(project["id"])
    media = dict(project.get("media") or {})
    if (media.get("peaks") or {}).get("version") == VERSION:
        return {"skipped": "ya está"}
    workdir = ctx.workdir(pid)
    wav = workdir / "audio.wav"
    source = wav
    if not wav.exists():
        proxy_key = str(media.get("proxyKey") or "")
        if not proxy_key.startswith(f"editor/{pid}/"):
            raise JobError("Este video todavía no tiene vista previa.", retry=False)
        source = workdir / "proxy.mp4"
        if not source.exists():
            ctx.stage("Bajando la vista previa", 0.0, 0.5)
            ctx.app.download(pid, proxy_key, source, ctx.progress)
    ctx.stage("Dibujando la forma de onda", 0.5, 1.0)
    peaks = make(ctx, pid, source, workdir / "picos")
    save_media(ctx, pid, peaks)
    return {"count": peaks["count"]}
