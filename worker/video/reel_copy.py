"""Trabajo REEL_COPY ("Copia este reel"): baja un reel, TikTok o short ajeno, lo transcribe y mide su edición.

Entrada: {reelCopyId, styleId, sourceKind: "upload" | "link", url?, sourceKey?, language?}
1. Baja el video: de un link con yt-dlp (lo mismo que "Edita como este") o del almacenamiento privado, en la ruta del
   estilo (`editor/estilos/<styleId>/referencia.<ext>`).
2. Mide la edición con el análisis de "Edita como este" (style.analyze: cortes, zooms, b-roll, subtítulos, ritmo,
   audio) y, en la misma pasada, guarda la transcripción por palabra que usa ese análisis.
3. Entrega las medidas y la transcripción a la app (/api/worker/copias/<id>/result): Claude analiza la estructura y
   escribe la versión propia de la persona; la app deja listo el estilo y borra el archivo subido.
El video y la transcripción nunca se guardan en el worker: la carpeta de trabajo se borra al terminar, y la salida
del trabajo (jobs.output) solo lleva números.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

import psycopg

from comunes.errors import JobError
from comunes.runner import JobContext, register

from . import style, style_job, transcribe

log = logging.getLogger("worker.copia")

MAX_SECONDS = style.MAX_SECONDS  # 3 minutos: reels, TikToks y shorts
TOO_LONG = "Ese video dura más de 3 minutos. «Copia este reel» funciona con reels, TikToks y shorts."
NO_SPEECH = "No encontramos voz en ese video. «Copia este reel» funciona con videos hablados: prueba con otro."
MIN_WORDS = 12


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    data = job.get("input") or {}
    if data.get("reelCopyId"):
        conn.execute(
            "UPDATE reel_copies SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status <> 'READY'",
            (message[:1000], data["reelCopyId"]),
        )
    if data.get("styleId"):
        conn.execute(
            "UPDATE video_styles SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status <> 'READY'",
            (message[:1000], data["styleId"]),
        )


def _valid_id(value: Any) -> str:
    text = str(value or "")
    if not re.fullmatch(r"[0-9a-f-]{36}", text):
        raise JobError("Copia no válida.", retry=False)
    return text


def plain_words(words: list[dict]) -> list[dict[str, Any]]:
    """Solo lo que necesita la app: texto y tiempos (sin ids ni confianza)."""
    return [{"text": str(w["text"])[:80], "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)} for w in words if str(w.get("text", "")).strip()]


@register("REEL_COPY", on_fail=mark_failed)
def copy_reel(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    copy_id = _valid_id(data.get("reelCopyId"))
    style_id = _valid_id(data.get("styleId"))
    row = ctx.conn.execute("SELECT status FROM reel_copies WHERE id = %s", (copy_id,)).fetchone()
    if not row:
        raise JobError("La copia ya no existe.", retry=False)
    if row["status"] not in ("ANALYZING", "WRITING"):
        return {"skipped": row["status"]}
    workdir = ctx.config.work_dir / "copias" / copy_id
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        ctx.stage("Bajando el video", 0.0, 0.15)
        if data.get("sourceKind") == "link":
            src = style_job.download_link(str(data.get("url") or ""), workdir, name="original")
        else:
            key = str(data.get("sourceKey") or "")
            if not key.startswith(f"editor/estilos/{style_id}/"):
                raise JobError("No encontramos el video que subiste. Vuelve a subirlo.", retry=False)
            ext = Path(key).suffix.lower() if 0 < len(Path(key).suffix) <= 5 else ".mp4"
            src = ctx.app.download(None, key, workdir / f"original{ext}", ctx.progress, owner={"styleId": style_id})
        ctx.check()
        meta = style.probe_reference(src)
        if meta["duration"] > MAX_SECONDS + 1:
            raise JobError(TOO_LONG, retry=False)
        if not meta["hasAudio"]:
            raise JobError(NO_SPEECH, retry=False)

        language = data.get("language") or "es"
        heard: list[dict] = []

        def transcribe_fn(ogg: Path, wav16: Path) -> list[dict]:
            _, words = transcribe.transcribe(ctx.config, ogg, language, wav16, fixture=ctx.config.test_style_transcript)
            heard[:] = words
            return words

        def stage(name: str, start: float, end: float) -> None:
            ctx.stage(name, 0.15 + start * 0.6, 0.15 + end * 0.6)

        metrics = style.analyze(src, workdir, models_dir=ctx.config.models_dir, transcribe_fn=transcribe_fn, stage=stage, progress=ctx.progress)
        ctx.check()
        words = plain_words([w for w in heard if w["end"] <= metrics["analyzedSeconds"] + 0.5])
        if len(words) < MIN_WORDS:
            raise JobError(NO_SPEECH, retry=False)
        # El video ya no hace falta: se borra antes de la parte más larga (la IA).
        shutil.rmtree(workdir, ignore_errors=True)

        ctx.stage("Escribiendo tu versión", 0.8, 1.0)
        result = ctx.app.reel_copy_result(copy_id, {"metrics": metrics, "words": words, "jobId": str(ctx.job.get("id") or "") or None})
        return {"status": result.get("status"), "cuts": metrics["cuts"]["count"], "words": len(words)}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
