"""Trabajo VIDEO_CLIP: prepara un clip de la biblioteca de b-roll del cliente (datos y miniatura).

Entrada: {clipId}. El clip ya está en el almacenamiento privado (`editor/biblioteca/<id>/clip.<ext>`).
Se lee con ffprobe (duración, tamaño, que tenga video), se genera la miniatura y se guarda todo en `broll_clips`.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import psycopg

from comunes import ffmpeg
from comunes.errors import JobError
from comunes.runner import JobContext, register

MAX_CLIP_SECONDS = 10 * 60


def probe_clip(path: Path) -> dict[str, Any]:
    info = ffmpeg.probe(path)
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    if not video:
        raise JobError("Ese archivo no tiene video. Sube un clip MP4 o MOV.", retry=False)
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    for side in video.get("side_data_list", []) or []:
        if "rotation" in side and abs(int(round(float(side["rotation"])))) == 90:
            width, height = height, width
    duration = float(info.get("format", {}).get("duration") or video.get("duration") or 0)
    if duration < 0.5:
        raise JobError("El clip es demasiado corto (menos de medio segundo).", retry=False)
    if duration > MAX_CLIP_SECONDS:
        raise JobError("El clip dura más de 10 minutos. Para b-roll usa clips cortos.", retry=False)
    return {"duration": round(duration, 3), "width": width, "height": height}


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    clip_id = (job.get("input") or {}).get("clipId")
    if clip_id:
        conn.execute("UPDATE broll_clips SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s", (message[:1000], clip_id))


@register("VIDEO_CLIP", on_fail=mark_failed)
def prepare_clip(ctx: JobContext) -> dict[str, Any]:
    clip_id = str(ctx.input["clipId"])
    if not re.fullmatch(r"[0-9a-f-]{36}", clip_id):
        raise JobError("Clip no válido.", retry=False)
    row = ctx.conn.execute("SELECT * FROM broll_clips WHERE id = %s", (clip_id,)).fetchone()
    if not row:
        raise JobError("El clip ya no existe.", retry=False)
    if row["status"] not in ("PROCESSING",):
        return {"skipped": row["status"]}
    owner = {"clipId": clip_id}
    workdir = ctx.config.work_dir / "biblioteca" / clip_id
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        ctx.stage("Bajando el clip", 0.0, 0.6)
        key = row["file_key"]
        ext = Path(key).suffix.lower() if len(Path(key).suffix) <= 5 else ".mp4"
        src = ctx.app.download(None, key, workdir / f"clip{ext or '.mp4'}", ctx.progress, owner=owner)
        ctx.stage("Preparando la miniatura", 0.6, 1.0)
        meta = probe_clip(src)
        thumb = workdir / "miniatura.jpg"
        at = min(1.0, meta["duration"] / 3)
        ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", str(thumb)], what="miniatura")
        thumb_key = f"editor/biblioteca/{clip_id}/miniatura.jpg"
        ctx.app.upload(None, thumb_key, thumb, "image/jpeg", owner=owner)
        ctx.conn.execute(
            """UPDATE broll_clips SET status = 'READY', thumb_key = %s, duration = %s, width = %s, height = %s, error_message = NULL, updated_at = now()
               WHERE id = %s""",
            (thumb_key, meta["duration"], meta["width"], meta["height"], clip_id),
        )
        return {"duration": meta["duration"]}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
