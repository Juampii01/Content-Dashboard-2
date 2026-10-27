"""Trabajo VIDEO_CLIP: prepara un clip de la biblioteca del cliente (datos, miniatura y hojas de cuadros para la ficha).

Entrada: {clipId} (o {clipId, fichaOnly: true} para sacar solo las hojas de un clip que ya estaba listo).
El clip ya está en el almacenamiento privado (`editor/biblioteca/<id>/clip.<ext>`). Se lee con ffprobe (duración,
tamaño, que tenga video), se genera la miniatura y se guarda todo en `broll_clips`: desde ahí el clip ya se puede usar.
Después se arman hojas de contacto con cuadros marcados "#n · m:ss.s" (el arranque, cada cambio de escena y cuadros
parejos en el tiempo), se suben y se le entregan a la app, que escribe la ficha con Claude. Si las hojas o la app fallan,
el clip queda listo igual y la ficha marcada para reintentar.

Las imágenes de la biblioteca no pasan por aquí: la app las prepara al subirlas.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import psycopg

from comunes import ffmpeg
from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import eyes

log = logging.getLogger("worker.library")

MAX_CLIP_SECONDS = 10 * 60
MIN_GAP = 0.5


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


def sheet_times(duration: float, scenes: list[float], max_frames: int) -> list[float]:
    """Instantes a mirar: el arranque, justo después de cada cambio de escena y cuadros parejos en el tiempo, sin dos a
    menos de medio segundo y sin pasar del tope (si sobran, se reparten parejo)."""
    duration = max(0.5, duration)
    step = max(0.8, duration / max(1, max_frames - 1))
    # Primero el arranque y los cambios de escena; los parejos solo donde no hay uno cerca.
    chosen = [round(min(0.15, duration / 4), 2)]
    for s in scenes:
        t = round(s + 0.3, 2)
        if 0 < t < duration - 0.05 and all(abs(t - c) >= MIN_GAP for c in chosen):
            chosen.append(t)
    t = step
    while t < duration - 0.1:
        if all(abs(t - c) >= MIN_GAP for c in chosen):
            chosen.append(round(t, 2))
        t += step
    out = sorted(chosen)
    if len(out) > max_frames:
        idx = np.linspace(0, len(out) - 1, max_frames).round().astype(int)
        out = [out[i] for i in sorted(set(idx.tolist()))]
    return out


def make_sheets(src: Path, workdir: Path, meta: dict[str, Any], fonts_dir: Path | None) -> list[dict[str, Any]]:
    """Hojas de cuadros del clip (1 si dura hasta 20 s, hasta 2 si es más largo): [{path, frames, times}]."""
    layout = eyes.layout_for(meta["width"] or 1080, meta["height"] or 1920)
    max_frames = layout.per_sheet * (1 if meta["duration"] <= 20 else 2)
    scenes = eyes.detect_scenes(src)
    times = sheet_times(meta["duration"], scenes, max_frames)
    frames = eyes.frames_at(src, times, (meta["width"] or 1080, meta["height"] or 1920))
    tiles = [(i + 1, t, eyes.fit_tile(f, layout)) for i, (t, f) in enumerate(zip(times, frames))]
    sheets = eyes.save_sheets(tiles, layout, workdir / "hojas", fonts_dir, prefix="hoja", mark="#")[:2]
    by_index = {i + 1: t for i, t in enumerate(times)}
    return [{"path": path, "frames": nums, "times": [by_index[n] for n in nums]} for path, nums in sheets]


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    data = job.get("input") or {}
    clip_id = data.get("clipId")
    if not clip_id:
        return
    if data.get("fichaOnly"):
        # El clip sigue listo: solo la ficha queda para reintentar.
        conn.execute("UPDATE broll_clips SET ficha_status = 'failed', ficha_error = %s, updated_at = now() WHERE id = %s AND ficha_status = 'pending'", (message[:300], clip_id))
        return
    conn.execute("UPDATE broll_clips SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s", (message[:1000], clip_id))


def deliver_sheets(ctx: JobContext, clip_id: str, src: Path, workdir: Path, meta: dict[str, Any]) -> int:
    """Arma y sube las hojas y se las entrega a la app. Nunca corta el trabajo: si algo falla, la ficha queda con el aviso."""
    owner = {"clipId": clip_id}
    payload: dict[str, Any]
    try:
        sheets = make_sheets(src, workdir, meta, ctx.config.fonts_dir)
        from PIL import Image  # noqa: PLC0415

        uploaded = []
        for n, sheet in enumerate(sheets):
            key = f"editor/biblioteca/{clip_id}/hoja-{n + 1:02d}.jpg"
            ctx.app.upload(None, key, sheet["path"], "image/jpeg", owner=owner)
            with Image.open(sheet["path"]) as img:
                w, h = img.size
            uploaded.append({"key": key, "width": w, "height": h, "frames": sheet["frames"], "times": sheet["times"]})
        payload = {"ok": True, "sheets": uploaded}
    except Cancelled:
        raise
    except Exception as exc:  # noqa: BLE001 — la ficha es aparte: el clip ya está listo
        log.warning("no se pudieron armar las hojas del clip %s", clip_id, exc_info=True)
        payload = {"ok": False, "error": f"No pudimos sacar los cuadros del clip ({exc.__class__.__name__}). Reintenta."}
    try:
        ctx.app.library_ficha(clip_id, payload)
    except JobError as exc:
        log.warning("la app no recibió las hojas del clip %s: %s", clip_id, exc.detail or exc.user_message)
        ctx.conn.execute(
            "UPDATE broll_clips SET ficha_status = 'failed', ficha_error = %s, updated_at = now() WHERE id = %s AND ficha_status = 'pending'",
            ("No pudimos escribir la ficha. Reintenta en un momento.", clip_id),
        )
    return len(payload.get("sheets") or [])


@register("VIDEO_CLIP", on_fail=mark_failed)
def prepare_clip(ctx: JobContext) -> dict[str, Any]:
    clip_id = str(ctx.input["clipId"])
    if not re.fullmatch(r"[0-9a-f-]{36}", clip_id):
        raise JobError("Clip no válido.", retry=False)
    row = ctx.conn.execute("SELECT * FROM broll_clips WHERE id = %s", (clip_id,)).fetchone()
    if not row:
        raise JobError("El clip ya no existe.", retry=False)
    ficha_only = bool(ctx.input.get("fichaOnly"))
    if ficha_only and not (row["status"] == "READY" and row.get("ficha_status") == "pending"):
        return {"skipped": row.get("ficha_status")}
    if not ficha_only and row["status"] not in ("PROCESSING",):
        return {"skipped": row["status"]}
    if (row.get("kind") or "video") != "video":
        return {"skipped": "imagen"}
    owner = {"clipId": clip_id}
    workdir = ctx.config.work_dir / "biblioteca" / clip_id
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        ctx.stage("Bajando el clip", 0.0, 0.5)
        key = row["file_key"]
        ext = Path(key).suffix.lower() if len(Path(key).suffix) <= 5 else ".mp4"
        src = ctx.app.download(None, key, workdir / f"clip{ext or '.mp4'}", ctx.progress, owner=owner)
        meta = probe_clip(src)
        if not ficha_only:
            ctx.stage("Preparando la miniatura", 0.5, 0.7)
            thumb = workdir / "miniatura.jpg"
            at = min(1.0, meta["duration"] / 3)
            ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", str(thumb)], what="miniatura")
            thumb_key = f"editor/biblioteca/{clip_id}/miniatura.jpg"
            ctx.app.upload(None, thumb_key, thumb, "image/jpeg", owner=owner)
            # Listo para usarse desde ya; la ficha llega después.
            ctx.conn.execute(
                """UPDATE broll_clips SET status = 'READY', thumb_key = %s, duration = %s, width = %s, height = %s, error_message = NULL,
                   ficha_status = 'pending', ficha_error = NULL, updated_at = now() WHERE id = %s""",
                (thumb_key, meta["duration"], meta["width"], meta["height"], clip_id),
            )
        ctx.stage("Mirando el clip", 0.7, 1.0)
        sheets = deliver_sheets(ctx, clip_id, src, workdir, meta)
        return {"duration": meta["duration"], "sheets": sheets}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
