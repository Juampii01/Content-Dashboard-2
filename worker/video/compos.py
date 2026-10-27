"""Animaciones a medida del Editor (composiciones, lib/video/compos): lo que hace el worker mientras la app las escribe.

1. **Imágenes generadas** (`compos-images`): con la cuenta de ChatGPT del cliente (Codex) o su API key de OpenAI, las
   mismas piezas que los carruseles. Siempre sin texto (el texto lo dibuja la animación). Se guardan en
   `editor/<proyecto>/compos/<id>.<ext>` (quedan en la biblioteca del proyecto). Si una falla, se avisa y la app sigue
   sin ella.
2. **Cuadros para la revisión** (`compos-stills`): se arma el video con los cortes de la revisión y se dibuja cada
   animación en 5 instantes con el mismo motor del render; los cuadros van en una hoja que Claude compara con la
   referencia o con el pedido.
3. **VIDEO_COMPOS**: los pedidos del Estudio ("Pide una animación aquí", "Pídele un cambio a esta animación"): maneja el
   taller paso a paso con la app, sin sacar el video de la revisión.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

import numpy as np

from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import director, eyes, fx, fx_mask, render

log = logging.getLogger("worker.compos")

ASPECTS = {"vertical": ("formato vertical 9:16", "1024x1536"), "horizontal": ("formato horizontal 16:9", "1536x1024"), "square": ("formato cuadrado 1:1", "1024x1024")}

def _credentials(ctx: JobContext, pid: str) -> dict[str, Any]:
    return ctx.app._post(f"/api/worker/projects/{pid}/imagenes", {"op": "credentials"}, timeout=60)  # noqa: SLF001


def generate_images(ctx: JobContext, pid: str, items: list[dict[str, Any]], workdir: Path) -> list[dict[str, Any]]:
    """Genera las imágenes pedidas. Devuelve una fila por pedido: con su clave y tamaño, o con el error."""
    from PIL import Image  # noqa: PLC0415

    from carruseles import openai_api  # noqa: PLC0415

    out: list[dict[str, Any]] = []
    try:
        creds = _credentials(ctx, pid)
    except JobError as e:
        return [{"taskId": i.get("taskId"), "imageId": i.get("imageId"), "error": e.user_message} for i in items]
    if creds.get("provider") != "openai":
        return [{"taskId": i.get("taskId"), "imageId": i.get("imageId"), "error": "Agrega tu API key de OpenAI en Ajustes → Claves de servicios para generar imágenes."} for i in items]
    work = workdir / "compos-img"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    try:
        for n, item in enumerate(items[:8]):
            ctx.check()
            image_id = str(item.get("imageId") or "")
            if not image_id.replace("g", "", 1).isalnum():
                continue
            _, size = ASPECTS.get(str(item.get("aspect")), ASPECTS["vertical"])
            prompt = str(item.get("prompt") or "")[:1500]
            dest = work / f"img-{n + 1}"
            dest.mkdir()
            try:
                image = openai_api.generate_image({**creds, "size": size}, prompt, [], dest / "imagen.png")
                with Image.open(image) as im:
                    im.verify()
                with Image.open(image) as im:
                    w, h = im.size
                    fmt = (im.format or "PNG").upper()
                ext, ctype = {"JPEG": ("jpg", "image/jpeg"), "WEBP": ("webp", "image/webp")}.get(fmt, ("png", "image/png"))
                key = f"editor/{pid}/compos/{image_id.lower()}.{ext}"
                ctx.app.upload(pid, key, image, ctype)
                out.append({"taskId": item.get("taskId"), "imageId": image_id, "key": key, "width": int(w), "height": int(h)})
            except Cancelled:
                raise
            except JobError as e:
                log.warning("imagen %s sin generar: %s", image_id, e.detail or e.user_message)
                out.append({"taskId": item.get("taskId"), "imageId": image_id, "error": e.user_message[:380]})
            except Exception as e:  # noqa: BLE001 — una imagen que falla no corta el resto
                log.warning("imagen %s sin generar", image_id, exc_info=True)
                out.append({"taskId": item.get("taskId"), "imageId": image_id, "error": f"No se pudo generar ({e.__class__.__name__})."})
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return out


def stills(ctx: JobContext, project: dict[str, Any], data: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cuadros de cada animación dibujada sobre el video (con los cortes de la revisión), en una hoja por animación."""
    import cv2  # noqa: PLC0415

    from .pipeline import compose, fx_image_hosts  # noqa: PLC0415 — evita el import circular

    pid = str(project["id"])
    built = compose(ctx, project, data, preview=True)
    joined = Path(built["joined"])
    workdir = ctx.workdir(pid)
    mezz = workdir / "mezz.mp4"
    media = project.get("media") or {}
    src_size = (int(media.get("width") or 1080), int(media.get("height") or 1920))
    total = int(round(float(media.get("duration") or 0) * render.FPS)) or 1
    fmt = built["fmt"]
    offset_x = float((data.get("framing") or {}).get("offsetX", 0))
    out_w, out_h = render.OUTPUT_SIZE[fmt]
    out_dir = Path(built["out_dir"]) / "compos-cuadros"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    uploaded: list[dict[str, Any]] = []
    for item in items[:20]:
        ctx.check()
        task_id = str(item.get("taskId") or "")
        times = [float(t) for t in item.get("times") or []][:8]
        if not task_id.isalnum() or not times:
            continue
        try:
            paths = fx.render_stills(
                ctx,
                {"spec": item.get("spec"), "sourceFrames": item.get("sourceFrames") or [], "imageKeys": item.get("imageKeys") or {}, "projectId": item.get("projectId")},
                times,
                joined=joined,
                mezz=mezz,
                src_size=src_size,
                total_frames=total,
                fmt=fmt,
                offset_x=offset_x,
                workdir=workdir,
                fonts_dir=ctx.config.fonts_dir,
                image_hosts=fx_image_hosts(ctx.config.app_url),
                out_dir=out_dir / task_id,
            )
        except fx.ComposFailed as e:
            log.warning("cuadros de la animación %s: %s", task_id, e.detail)
            continue
        frames = [cv2.imread(str(p)) if p and p.exists() else np.zeros((out_h // 2, out_w // 2, 3), np.uint8) for p in paths]
        sheets = director._sheets_from_frames(frames, times, (out_w, out_h), out_dir / f"hoja-{task_id}", ctx.config.fonts_dir, "anim")  # noqa: SLF001
        if not sheets:
            continue
        from PIL import Image  # noqa: PLC0415

        path = sheets[0][0]
        rnd = int(item.get("round") or 1)
        key = f"editor/{pid}/director/compos-{task_id.lower()}-{rnd}.jpg"
        ctx.app.upload(pid, key, path, "image/jpeg")
        with Image.open(path) as im:
            w, h = im.size
        uploaded.append({"taskId": task_id, "key": key, "width": w, "height": h, "times": times})
    shutil.rmtree(out_dir, ignore_errors=True)
    return uploaded


PARALLEL = max(1, min(4, int(os.environ.get("COMPOS_PARALLEL", "3") or 3)))
ADOPT_LEASE = 2 * 3600
# Imágenes (una sola cuenta de ChatGPT) y cuadros (arman el video en la carpeta del proyecto): de a uno.
HEAVY = threading.Lock()
# La conexión a la base del trabajo se usa de a un hilo por vez.
DBLOCK = threading.Lock()


def _one(ctx: JobContext, project: dict[str, Any], work_id: str) -> str | None:
    """Un pedido de punta a punta. Devuelve el error (si falló) para dejarlo en su fila; nunca tumba a los demás."""
    from comunes import db  # noqa: PLC0415

    try:
        director.run(ctx, project, "compos", 0.0, 1.0, extra={"workId": work_id}, heavy=HEAVY)
        return None
    except Cancelled:
        raise
    except JobError as e:
        log.warning("pedido %s: %s", work_id, e.detail or e.user_message)
        message = e.user_message
    except Exception:  # noqa: BLE001
        log.exception("pedido %s: error inesperado", work_id)
        message = "No pudimos terminar esta animación. Prueba de nuevo."
    with DBLOCK:
        db.fail_compos_request(ctx.conn, work_id, message)
    return message


@register("VIDEO_COMPOS")
def compos_job(ctx: JobContext) -> dict[str, Any]:
    """Pedidos del Estudio: el taller de animaciones paso a paso. El video sigue en revisión.

    Cada pedido tiene su trabajo; este toma además los otros pedidos en cola del mismo video y corre hasta
    COMPOS_PARALLEL (3) a la vez en hilos (los pasos de IA, que son lo lento, van en paralelo; imágenes y cuadros, de a
    uno). Un pedido que falla deja su aviso en su fila y no marca el video como fallido."""
    from comunes import db  # noqa: PLC0415

    project = db.get_project(ctx.conn, ctx.input["projectId"])
    if not project:
        raise JobError("El proyecto ya no existe.", retry=False)
    if project["status"] not in ("AWAITING_REVIEW", "DONE"):
        return {"skipped": project["status"]}
    own = str(ctx.input.get("workId") or "")
    if not own:
        # Taller del director (estado viejo, un solo pedido).
        res = director.run(ctx, project, "compos", 0.0, 1.0)
        return {"status": res.get("status")}
    pid = str(project["id"])
    ctx.stage("Creando animaciones", 0.0, 0.95)
    done: list[str] = []
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="pedido") as pool:
        running: dict[Future[str | None], tuple[str | None, str]] = {pool.submit(_one, ctx, project, own): (None, own)}
        while running:
            # Más pedidos del mismo video en cola: se toman mientras haya lugar.
            while len(running) < PARALLEL and not ctx_stopped():
                with DBLOCK:
                    job = db.adopt_compos(ctx.conn, ctx.config.worker_id, pid, ADOPT_LEASE)
                if not job:
                    break
                wid = str((job.get("input") or {}).get("workId") or "")
                log.info("pedido %s en paralelo (trabajo %s)", wid, job["id"])
                running[pool.submit(_one, ctx, project, wid)] = (str(job["id"]), wid)
            finished, _ = wait(list(running), timeout=2.0, return_when=FIRST_COMPLETED)
            for fut in finished:
                job_id, wid = running.pop(fut)
                error = fut.result()  # Cancelled se propaga y corta todo (el trabajo principal se canceló)
                (failed if error else done).append(wid)
                if job_id:
                    with DBLOCK:
                        db.finish_adopted(ctx.conn, job_id, ctx.config.worker_id, error)
    return {"done": done, "failed": failed}


def ctx_stopped() -> bool:
    from comunes.ffmpeg import stop_event  # noqa: PLC0415

    return stop_event.is_set()


__all__ = ["generate_images", "stills", "eyes", "fx_mask"]
