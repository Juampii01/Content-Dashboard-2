"""«Mira este video y dime qué ves» (VIDEO_LOOK).

La persona pega un link o sube un video de una edición que le gusta. El worker lo baja y lo mide igual que la
referencia de "Copiar edición" (video/reference.py: cuadros densos alrededor de cada corte y cambio visual, con su
texto y lo que se dice) y le entrega a la app las medidas y las hojas de cuadros. Claude conversa sobre eso en la app.

El video de referencia nunca se guarda: la carpeta de trabajo se borra al terminar y la app borra el archivo subido.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

import psycopg

from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import reference, transcribe
from .style_job import LINK_ERROR

log = logging.getLogger("worker.look")

UUID = re.compile(r"[0-9a-f-]{36}")


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    data = job.get("input") or {}
    look_id = data.get("lookId")
    if look_id and UUID.fullmatch(str(look_id)):
        conn.execute(
            "UPDATE video_looks SET status = 'failed', error = %s, updated_at = now() WHERE id = %s AND status IN ('queued', 'analyzing')",
            (message[:400], look_id),
        )


@register("VIDEO_LOOK", on_fail=mark_failed)
def look(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    pid, look_id = str(data.get("projectId") or ""), str(data.get("lookId") or "")
    if not UUID.fullmatch(pid) or not UUID.fullmatch(look_id):
        raise JobError("Datos no válidos.", retry=False)
    row = ctx.conn.execute("SELECT status, source FROM video_looks WHERE id = %s AND project_id = %s", (look_id, pid)).fetchone()
    if not row or row["status"] not in ("queued", "analyzing"):
        return {"skipped": row["status"] if row else "sin referencia"}
    ctx.conn.execute("UPDATE video_looks SET status = 'analyzing', updated_at = now() WHERE id = %s", (look_id,))
    workdir = ctx.workdir(pid) / f"mirar-{look_id}"
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {"lookId": look_id}
    try:
        ctx.stage("Bajando el video", 0.0, 0.2)
        src = reference.fetch(ctx, pid, row["source"] or {}, workdir)
        ctx.check()
        language = data.get("language") or "es"

        def transcribe_fn(ogg: Path, wav16: Path) -> list[dict]:
            _, words = transcribe.transcribe(ctx.config, ogg, language, wav16, fixture=ctx.config.test_style_transcript)
            return words

        def stage(name: str, a: float, b: float) -> None:
            ctx.stage(name if name.startswith("Mirando") else "Mirando el video", 0.2 + a * 0.75, 0.2 + b * 0.75)

        found, sheets = reference.analyze(src, workdir, models_dir=ctx.config.models_dir, fonts_dir=ctx.config.fonts_dir, transcribe_fn=transcribe_fn, stage=stage, progress=ctx.progress, dense=True)
        ctx.stage("Guardando los cuadros", 0.95, 1.0)
        from PIL import Image  # noqa: PLC0415

        uploaded = []
        for n, (path, frames) in enumerate(sheets):
            key = f"editor/{pid}/mirar/{look_id}/hoja-{n + 1:02d}.jpg"
            ctx.app.upload(pid, key, path, "image/jpeg")
            with Image.open(path) as img:
                w, h = img.size
            uploaded.append({"key": key, "width": w, "height": h, "frames": frames})
        payload.update({"ok": True, "metrics": found.get("metrics"), "moments": found.get("moments") or [], "transcript": found.get("transcript") or "", "sheets": uploaded})
    except Cancelled:
        raise
    except JobError as exc:
        log.info("referencia %s sin mirar: %s", look_id, exc.detail or exc.user_message)
        message = exc.user_message if exc.user_message != LINK_ERROR else "No pudimos bajar ese link (puede ser privado o pedir iniciar sesión). Descarga el video y súbelo."
        payload.update({"ok": False, "error": message[:380]})
    except Exception as exc:  # noqa: BLE001 — se avisa en el Estudio, el video sigue igual
        log.warning("no se pudo mirar la referencia %s", look_id, exc_info=True)
        payload.update({"ok": False, "error": f"No pudimos mirar ese video ({exc.__class__.__name__}). Prueba subiéndolo."[:380]})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    ctx.app.look_result(pid, payload)
    return {"ok": payload.get("ok"), "sheets": len(payload.get("sheets") or [])}
