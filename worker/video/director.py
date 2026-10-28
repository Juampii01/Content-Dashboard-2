"""Director de edición en el worker: los ojos, la vista previa para la segunda mirada y la revisión del video final.

La IA vive en la app (lib/video/director). El worker:
1. Mide el video y arma las hojas de contacto (video/eyes.py) al analizar.
2. Maneja al director paso a paso (POST /api/worker/projects/<id>/director): cada respuesta dice qué sigue.
3. Cuando el director pide una vista previa, arma el plan con el mismo grafo del render (tramos, b-roll, gráficos,
   subtítulos y zooms) pero sin codificar: solo saca los cuadros clave y los junta en hojas para el crítico.
4. Después del render, saca cuadros del MP4 final para la revisión final.
"""

from __future__ import annotations

import contextlib

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from comunes import db
from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext

from . import eyes, render

log = logging.getLogger("worker.director")

# Lo que ve la persona en la barra de progreso mientras trabaja el director.
STEP_LABELS = {
    "understand": "Entendiendo el video",
    "direct": "Dirigiendo la edición",
    "edit": "Aplicando tus cambios",
    "revise": "Corrigiendo lo que encontró la revisión",
    "finalize": "Dejando todo listo",
}
# Un pedido puede llevar hasta 3 vueltas del director, cada una con su segunda mirada; "Copiar edición" suma la receta,
# la adaptación y unas 5 llamadas por animación (hasta 14).
MAX_STEPS = 160


def see(ctx: JobContext, project: dict[str, Any], workdir: Path, media: dict[str, Any], start: float, end: float) -> None:
    """Ojos: mide el video y sube las hojas de contacto. Si ya están, no repite. Si falla, el análisis sigue sin ojos."""
    if project.get("eyes"):
        return
    pid = str(project["id"])
    ctx.stage("Mirando el video", start, end)
    wav16 = workdir / "asr16.wav"
    db_frames = None
    if wav16.exists():
        from .energy import load_energy  # noqa: PLC0415

        db_frames, _ = load_energy(wav16)
    out_dir = workdir / "ojos"
    try:
        result = eyes.analyze(
            workdir / "mezz.mp4",
            int(media["width"]),
            int(media["height"]),
            float(media["duration"]),
            out_dir,
            models_dir=ctx.config.models_dir,
            fonts_dir=ctx.config.fonts_dir,
            db_frames=db_frames,
            max_frames=int(ctx.input.get("eyesMaxFrames") or eyes.MAX_FRAMES),
            on_progress=ctx.progress,
            check=ctx.check,
        )
    except Cancelled:
        raise
    except Exception:  # noqa: BLE001 — sin ojos el director trabaja solo con la transcripción
        log.warning("no se pudieron medir los cuadros de %s", pid, exc_info=True)
        return
    sheets = []
    for n, (path, frames) in enumerate(result.sheets):
        key = f"editor/{pid}/ojos/hoja-{n + 1:02d}.jpg"
        ctx.app.upload(pid, key, path, "image/jpeg")
        from PIL import Image  # noqa: PLC0415

        with Image.open(path) as img:
            w, h = img.size
        sheets.append({"key": key, "frames": frames, "width": w, "height": h})
    data = {**result.eyes, "sheets": sheets}
    db.update_project(ctx.conn, pid, eyes=data)
    project["eyes"] = data
    shutil.rmtree(out_dir, ignore_errors=True)


def run(ctx: JobContext, project: dict[str, Any], first: str, start: float, end: float, extra: dict[str, Any] | None = None, heavy: Any = None) -> dict[str, Any]:
    """Maneja al director hasta que termina. Devuelve la última respuesta de la app.

    `extra` va en cada llamada (por ejemplo `workId`: un pedido de animación del Estudio). `heavy`: un candado para los
    pasos pesados del worker (imágenes con la única cuenta de ChatGPT, cuadros armando el video), cuando corren varios
    pedidos a la vez en hilos; los pasos de IA (en la app) sí van en paralelo."""
    pid = str(project["id"])
    span = end - start
    extra = extra or {}
    lock = heavy if heavy is not None else contextlib.nullcontext()
    res = ctx.app.director(pid, {"step": first, **extra})
    for k in range(MAX_STEPS):
        nxt = res.get("next")
        if not nxt:
            return res
        # El progreso avanza más despacio cuantos más pasos (Copiar edición tiene muchos).
        a = start + span * min(0.92, 1 - 0.85 ** (k + 1) + 0.0)
        b = start + span * min(0.96, 1 - 0.85 ** (k + 2))
        step = nxt.get("step")
        ctx.check()
        if step == "preview":
            round_ = int(nxt.get("round") or 1)
            ctx.stage(f"Revisando la edición (vuelta {round_})", a, b)
            sheets = preview(ctx, project, nxt.get("render") or {}, nxt.get("frames") or [], round_)
            res = ctx.app.director(pid, {"step": "critique", "round": round_, "sheets": sheets, **extra})
        elif step == "compos-images":
            from . import compos  # noqa: PLC0415

            ctx.stage(str(nxt.get("label") or "Generando imágenes con IA")[:120], a, b)
            with lock:
                results = compos.generate_images(ctx, pid, nxt.get("items") or [], ctx.workdir(pid))
            res = ctx.app.director(pid, {"step": "compos-images-done", "results": results, **extra})
        elif step == "compos-stills":
            from . import compos  # noqa: PLC0415

            ctx.stage(str(nxt.get("label") or "Mirando las animaciones")[:120], a, b)
            with lock:
                sheets = compos.stills(ctx, project, nxt.get("render") or {}, nxt.get("items") or [])
            res = ctx.app.director(pid, {"step": "compos-look", "sheets": sheets, **extra})
        elif step == "compos-ai":
            from . import claude_api  # noqa: PLC0415

            # El código de una pieza larga (o de una que se cortó en la app): la llamada a Claude la hace el worker, sin
            # el límite de 13 minutos de la función. Corre en paralelo con otros pedidos (no toma el candado).
            ctx.stage(str(nxt.get("label") or "Programando la animación")[:120], a, b)
            try:
                done = claude_api.run_call(ctx, pid, nxt, extra)
            except Cancelled as exc:
                _report_cut_usage(ctx, pid, nxt, extra, getattr(exc, "usage", None))
                raise
            res = ctx.app.director(pid, {"step": "compos-ai-done", "remote": done, **extra})
        else:
            ctx.stage(str(nxt.get("label") or STEP_LABELS.get(step, "Dirigiendo la edición"))[:120], a, b)
            res = ctx.app.director(pid, {"step": step, **extra})
    raise JobError("El director de edición no terminó. Vamos a reintentarlo.", detail="demasiados pasos")


def _report_cut_usage(ctx: Any, pid: str, nxt: dict[str, Any], extra: dict[str, Any], usage: dict[str, int] | None) -> None:
    """Una llamada larga a Claude cortada por un apagado (deploy) o una cancelación: se le manda a la app lo que alcanzó
    a generar para que quede en el consumo y en el tope del video. Nunca frena el apagado."""
    if not usage or not usage.get("output_tokens"):
        return
    remote = {"taskId": str(nxt.get("taskId") or ""), "call": str(nxt.get("call") or ""), "error": {"source": "network", "message": "El servicio se reinició a mitad de la respuesta.", "usage": usage}}
    try:
        ctx.app.director(pid, {"step": "compos-ai-done", "remote": remote, **extra})
    except Exception:  # noqa: BLE001
        log.exception("no se pudo registrar el consumo de una llamada cortada")


def _sheets_from_frames(frames_bgr: list[np.ndarray], times: list[float], size: tuple[int, int], out_dir: Path, fonts_dir: Path, prefix: str) -> list[tuple[Path, list[int]]]:
    layout = eyes.layout_for(*size)
    tiles = [(i + 1, t, eyes.fit_tile(f, layout)) for i, (f, t) in enumerate(zip(frames_bgr, times))]
    return eyes.save_sheets(tiles, layout, out_dir, fonts_dir, prefix=prefix)


def _upload_sheets(ctx: JobContext, pid: str, sheets: list[tuple[Path, list[int]]], name: str) -> list[dict[str, Any]]:
    from PIL import Image  # noqa: PLC0415

    out = []
    for n, (path, _) in enumerate(sheets):
        key = f"editor/{pid}/director/{name}-{n + 1:02d}.jpg"
        ctx.app.upload(pid, key, path, "image/jpeg")
        with Image.open(path) as img:
            w, h = img.size
        out.append({"key": key, "width": w, "height": h})
    return out


def grab_frames(built: dict[str, Any], frame_numbers: list[int], out_dir: Path, scale_w: int) -> list[Path]:
    """Los cuadros pedidos del video armado (el mismo grafo del render), sin codificar el video."""
    numbers = sorted(set(max(0, n) for n in frame_numbers))
    if not numbers:
        return []
    for old in out_dir.glob("pv-*.jpg"):
        old.unlink()
    expr = "+".join(f"eq(n\\,{n})" for n in numbers)
    graph = f"{built['graph']};[v]select='{expr}',scale={scale_w}:-2[pv]"
    inputs = ["-i", str(built["joined"]), "-i", str(built["joined"])]
    for p in built["broll_inputs"]:
        inputs += ["-i", str(p)]
    for p in built["image_inputs"]:
        inputs += ["-loop", "1", "-framerate", str(render.FPS), "-i", str(p)]
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", *inputs,
        "-filter_complex", graph, "-map", "[pv]", "-fps_mode", "passthrough", "-t", f"{float(built['expected']):.3f}",
        "-frames:v", str(len(numbers)), "-q:v", "4", str(out_dir / "pv-%03d.jpg"),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if res.returncode != 0:
        raise JobError("No pudimos armar la vista previa para la revisión.", detail=res.stderr[-800:])
    return sorted(out_dir.glob("pv-*.jpg"))


def preview(ctx: JobContext, project: dict[str, Any], data: dict[str, Any], frames: list[dict[str, Any]], round_: int) -> list[dict[str, Any]]:
    """Segunda mirada: arma el plan (sin codificar), saca los cuadros clave y los sube en hojas."""
    import cv2  # noqa: PLC0415

    from .pipeline import compose  # noqa: PLC0415 — evita el import circular

    pid = str(project["id"])
    built = compose(ctx, project, data, preview=True)
    out_dir = Path(built["out_dir"]) / f"vista-{round_}"
    out_dir.mkdir(parents=True, exist_ok=True)
    times = [float(f.get("t") or 0) for f in frames][:40]
    numbers = [int(round(t * render.FPS)) for t in times]
    out_w, out_h = render.OUTPUT_SIZE[built["fmt"]]
    paths = grab_frames(built, numbers, out_dir, 540 if out_w < out_h else 768)
    # Cada cuadro pedido toma la imagen de su número (si dos pedían el mismo, comparten).
    unique = sorted(set(numbers))
    images = {n: cv2.imread(str(p)) for n, p in zip(unique, paths)}
    blank = np.zeros((out_h // 2, out_w // 2, 3), dtype=np.uint8)
    frames_bgr = [images.get(n) if images.get(n) is not None else blank for n in numbers]
    sheets = _sheets_from_frames(frames_bgr, times, (out_w, out_h), out_dir, ctx.config.fonts_dir, "vuelta")
    uploaded = _upload_sheets(ctx, pid, sheets, f"vuelta-{round_}")
    shutil.rmtree(out_dir, ignore_errors=True)
    return uploaded


def final_review(ctx: JobContext, pid: str, final: Path, frames: list[dict[str, Any]], out_dir: Path) -> None:
    """Revisión final: cuadros del MP4 exportado en los momentos clave → hojas → la app los mira con visión."""
    import cv2  # noqa: PLC0415

    times = [float(f.get("t") or 0) for f in frames][:30]
    if not times:
        return
    cap = cv2.VideoCapture(str(final))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1080)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1920)
    cap.release()
    imgs = eyes.frames_at(final, times, (w, h))
    sheet_dir = out_dir / "revision-final"
    sheets = _sheets_from_frames(imgs, times, (w, h), sheet_dir, ctx.config.fonts_dir, "final")
    uploaded = _upload_sheets(ctx, pid, sheets, "final")
    shutil.rmtree(sheet_dir, ignore_errors=True)
    ctx.app.director(pid, {"step": "final", "sheets": uploaded, "frames": [{"t": t, "label": str(f.get("label") or "")[:300]} for t, f in zip(times, frames)]})
