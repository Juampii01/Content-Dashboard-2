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
    running: dict[Future[str | None], tuple[str | None, str]] = {}
    try:
        _run_parallel(ctx, project, own, pid, running, done, failed)
    finally:
        # Si se cortó todo (apagado, cancelación del pedido principal o un error), los pedidos adoptados que no
        # terminaron vuelven a la cola enseguida: si no, quedarían "en curso" las 2 horas de su lease.
        for job_id, _wid in running.values():
            if job_id:
                try:
                    with DBLOCK:
                        db.release(ctx.conn, {"id": job_id}, ctx.config.worker_id)
                except Exception:  # noqa: BLE001
                    log.exception("no se pudo devolver a la cola el trabajo %s", job_id)
    return {"done": done, "failed": failed}


def _run_parallel(ctx: JobContext, project: dict[str, Any], own: str, pid: str, running: dict[Future[str | None], tuple[str | None, str]], done: list[str], failed: list[str]) -> None:
    from comunes import db  # noqa: PLC0415

    with ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="pedido") as pool:
        running[pool.submit(_one, ctx, project, own)] = (None, own)
        while True:
            # Más pedidos del mismo video en cola: se toman mientras haya lugar (también cuando terminaron todos los
            # que corrían a la vez: antes el bucle salía ahí y los que seguían en cola esperaban otra vuelta).
            while len(running) < PARALLEL and not ctx_stopped():
                with DBLOCK:
                    job = db.adopt_compos(ctx.conn, ctx.config.worker_id, pid, ADOPT_LEASE)
                if not job:
                    break
                wid = str((job.get("input") or {}).get("workId") or "")
                log.info("pedido %s en paralelo (trabajo %s)", wid, job["id"])
                running[pool.submit(_one, ctx, project, wid)] = (str(job["id"]), wid)
            if not running:
                break
            finished, _ = wait(list(running), timeout=2.0, return_when=FIRST_COMPLETED)
            for fut in finished:
                job_id, wid = running.pop(fut)
                error = fut.result()  # Cancelled se propaga y corta todo (el trabajo principal se canceló)
                (failed if error else done).append(wid)
                if job_id:
                    with DBLOCK:
                        db.finish_adopted(ctx.conn, job_id, ctx.config.worker_id, error)


def ctx_stopped() -> bool:
    from comunes.ffmpeg import stop_event  # noqa: PLC0415

    return stop_event.is_set()


# ─── Videos dentro de una animación (compos-clips) ───────────────────────────
# Mismos números que CLIP_SHEET en lib/video/compos/contract.ts.
CLIP_FPS = 12
CLIP_FRAME_W = 640
CLIP_COLS = 4
CLIP_ROWS = 4
CLIP_MAX_SECONDS = 30.0
CLIP_MAX_ITEMS = 2


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def clip_sheets(ctx: JobContext, pid: str, items: list[dict[str, Any]], workdir: Path) -> list[dict[str, Any]]:
    """Paso `compos-clips`: un video de la biblioteca que va DENTRO de una animación. Se sacan sus cuadros a CLIP_FPS
    (como mucho CLIP_MAX_SECONDS) y se juntan en hojas JPEG de CLIP_COLS×CLIP_ROWS cuadros, que la animación usa como
    imágenes (env.clip en lib/video/compos/runtime). Las hojas van a `editor/<proyecto>/compos/clips/`."""
    from PIL import Image  # noqa: PLC0415

    from comunes import ffmpeg  # noqa: PLC0415
    from comunes.ffmpeg import probe  # noqa: PLC0415

    out: list[dict[str, Any]] = []
    base = workdir / "compos-clips"
    for item in items[:CLIP_MAX_ITEMS]:
        ctx.check()
        ref = str(item.get("ref") or "")
        clip_id = str(item.get("clipId") or "")
        key = str(item.get("key") or "")
        if not ref.isalnum() or not key.startswith(f"editor/biblioteca/{clip_id}/"):
            out.append({"ref": ref, "error": "Ese video de la biblioteca ya no está disponible."})
            continue
        try:
            raw = base / f"lib-{clip_id}{Path(key).suffix or '.mp4'}"
            if not raw.exists():
                ctx.app.download(None, key, raw, owner={"clipId": clip_id})
            info = probe(raw)
            video = next((st for st in info.get("streams") or [] if st.get("codec_type") == "video"), None)
            if not video:
                raise JobError("Ese archivo no tiene video.", retry=False)
            width, height = int(video.get("width") or 0), int(video.get("height") or 0)
            rotation = abs(int(float(((video.get("tags") or {}).get("rotate")) or 0))) % 180
            if rotation == 90:
                width, height = height, width
            duration = min(CLIP_MAX_SECONDS, float((info.get("format") or {}).get("duration") or video.get("duration") or 0))
            if width < 16 or height < 16 or duration <= 0.05:
                raise JobError("No pudimos leer ese video.", retry=False)
            frame_w = _even(min(CLIP_FRAME_W, width))
            frame_h = _even(height * frame_w / width)
            frames_dir = base / f"{ref}-cuadros"
            shutil.rmtree(frames_dir, ignore_errors=True)
            frames_dir.mkdir(parents=True, exist_ok=True)
            ffmpeg.run(
                ["-t", f"{duration:.3f}", "-i", str(raw), "-vf", f"fps={CLIP_FPS},scale={frame_w}:{frame_h}:flags=lanczos,setsar=1", "-an", "-q:v", "3", str(frames_dir / "f-%05d.jpg")],
                duration=duration,
                what="cuadros del video",
            )
            # Nunca más que el máximo (ffmpeg puede sacar un cuadro de más por redondeo).
            files = sorted(frames_dir.glob("f-*.jpg"))[: int(CLIP_MAX_SECONDS * CLIP_FPS)]
            if not files:
                raise JobError("No pudimos sacar cuadros de ese video.", retry=False)
            per = CLIP_COLS * CLIP_ROWS
            sheets: list[dict[str, Any]] = []
            for n in range(0, len(files), per):
                ctx.check()
                sheet = Image.new("RGB", (frame_w * CLIP_COLS, frame_h * CLIP_ROWS), (0, 0, 0))
                for k, f in enumerate(files[n : n + per]):
                    with Image.open(f) as im:
                        sheet.paste(im.convert("RGB").resize((frame_w, frame_h)), ((k % CLIP_COLS) * frame_w, (k // CLIP_COLS) * frame_h))
                path = base / f"{ref}-hoja-{n // per:02d}.jpg"
                sheet.save(path, "JPEG", quality=84, optimize=True, progressive=True)
                sheet_key = f"editor/{pid}/compos/clips/{ref}-{n // per:02d}.jpg"
                ctx.app.upload(pid, sheet_key, path, "image/jpeg")
                sheets.append({"key": sheet_key, "width": sheet.width, "height": sheet.height})
            shutil.rmtree(frames_dir, ignore_errors=True)
            out.append(
                {
                    "ref": ref,
                    "clipId": clip_id,
                    "width": width,
                    "height": height,
                    "duration": round(len(files) / CLIP_FPS, 3),
                    "fps": CLIP_FPS,
                    "frames": len(files),
                    "cols": CLIP_COLS,
                    "rows": CLIP_ROWS,
                    "frameW": frame_w,
                    "frameH": frame_h,
                    "sheets": sheets,
                }
            )
            log.info("video %s dentro de la animación: %s cuadros en %s hojas", ref, len(files), len(sheets))
        except Cancelled:
            raise
        except JobError as e:
            log.warning("video %s: %s", ref, e.detail or e.user_message)
            out.append({"ref": ref, "error": e.user_message[:300]})
    return out


__all__ = ["generate_images", "stills", "eyes", "fx_mask", "clip_sheets"]
