"""Referencia de edición para el director ("Edítalo así: como este video" y el link del brief).

La persona pega un link (Instagram, TikTok, YouTube) o sube un video. Antes de dirigir, el worker:
1. Lo baja (el mismo yt-dlp de "Edita como este") o baja el archivo subido.
2. Lo mide con el mismo camino de "Edita como este" (video/style.py): cortes, zooms, b-roll, subtítulos con Tesseract,
   habla y música.
3. Saca cuadros en cada corte (y en las tomas largas), mira en cada uno si está la persona y si hay texto, anota lo
   que se dice en ese momento y arma hojas de contacto marcadas "R#n" (para no confundirlas con las del video).
4. Se lo entrega a la app (paso "reference" del director). Si no se pudo bajar, el aviso es claro: que lo suba.

La referencia nunca se guarda: la carpeta de trabajo se borra al terminar y la app borra el archivo subido. Solo
quedan las medidas y las hojas (para que el director y el crítico las miren). Se copia la edición, nunca el contenido.
"""

from __future__ import annotations

import logging
import secrets
import shutil
from pathlib import Path
from typing import Any, Callable

import numpy as np

from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext

from . import eyes, style, transcribe
from .style_job import LINK_ERROR, download_link

log = logging.getLogger("worker.reference")

MAX_FRAMES = 24
MAX_SECONDS = 10 * 60
MAX_BYTES = 500 * 1024 * 1024


def pending_reference(project: dict[str, Any]) -> dict[str, Any] | None:
    """La referencia que hay que medir: la del pedido en curso o el link del brief (si todavía no se miró)."""
    director = project.get("director") or {}
    pending = director.get("pending") or {}
    current = director.get("reference") or {}
    ref = pending.get("reference")
    if ref:
        return ref if current.get("id") == ref.get("id") and current.get("status") == "pending" else None
    if pending:
        return None
    url = str((project.get("brief") or {}).get("reference") or "").strip()
    if not url:
        return None
    src = current.get("source") or {}
    if src.get("kind") == "link" and src.get("url") == url and current.get("status") in ("ready", "failed"):
        return None
    return {"id": "r" + secrets.token_hex(6), "source": {"kind": "link", "url": url}}


def moment_times(cuts: list[float], duration: float, max_frames: int = MAX_FRAMES) -> list[float]:
    """Instantes a mirar: el arranque, justo después de cada corte y el medio de las tomas largas, sin pasar del tope."""
    duration = max(0.5, duration)
    bounds = [0.0, *[c for c in cuts if 0 < c < duration], duration]
    times: list[float] = []
    for a, b in zip(bounds, bounds[1:]):
        times.append(min(b - 0.05, a + 0.35))
        if b - a > 4:
            times.append((a + b) / 2)
    times = sorted(t for t in times if 0 <= t < duration)
    out: list[float] = []
    for t in times:
        if not out or t - out[-1] >= 0.6:
            out.append(round(t, 2))
    if len(out) > max_frames:
        # Parejo en el tiempo: se queda con max_frames repartidos.
        idx = np.linspace(0, len(out) - 1, max_frames).round().astype(int)
        out = [out[i] for i in sorted(set(idx.tolist()))]
    return out


def said_at(words: list[dict], t: float, span: float = 1.2) -> str:
    near = [w["text"] for w in words if w["end"] >= t - span / 2 and w["start"] <= t + span]
    return " ".join(near)[:180]


def analyze(
    src: Path,
    workdir: Path,
    *,
    models_dir: Path,
    fonts_dir: Path | None,
    transcribe_fn: Callable[[Path, Path], list[dict]] | None,
    stage: Callable[[str, float, float], None] | None = None,
    progress: Callable[[float], None] | None = None,
    max_frames: int = MAX_FRAMES,
) -> tuple[dict[str, Any], list[tuple[Path, list[int]]]]:
    """Mide la referencia y arma sus hojas. Devuelve (lo que va a la app, hojas como (ruta, cuadros))."""
    stage = stage or (lambda name, a, b: None)
    heard: list[dict] = []

    def keep_words(ogg: Path, wav: Path) -> list[dict]:
        words = transcribe_fn(ogg, wav) if transcribe_fn else []
        heard.extend(words)
        return words

    metrics = style.analyze(src, workdir, models_dir=models_dir, transcribe_fn=keep_words, stage=lambda n, a, b: stage(n, a * 0.8, b * 0.8), progress=progress)
    stage("Mirando cada momento de la referencia", 0.8, 1.0)
    seconds = min(float(metrics["duration"]), style.MAX_SECONDS)
    cuts = [float(c) for c in metrics["cuts"].get("times") or []]
    times = moment_times(cuts, seconds, max_frames)
    width, height = int(metrics["width"]), int(metrics["height"])
    frames = eyes.frames_at(src, times, (width, height))
    try:
        detector: style.FaceDetector | None = style.FaceDetector(models_dir)
    except JobError:
        detector = None
    langs = style.tesseract_langs()
    tmp = workdir / "ocr.png"
    moments = []
    for i, (t, frame) in enumerate(zip(times, frames)):
        face = bool(detector.detect(frame)) if detector is not None else False
        try:
            text, _ = eyes.read_text(frame, tmp, langs, full_frame=False)
        except Exception:  # noqa: BLE001 — sin Tesseract, sin texto
            text = ""
        moments.append({"t": round(t, 2), "frame": i + 1, "cut": any(abs(t - c) < 0.6 for c in cuts), "face": face, "text": text[:150], "said": said_at(heard, t)})
        if progress:
            progress(min(1.0, (i + 1) / max(1, len(times))))
    layout = eyes.layout_for(width, height)
    tiles = [(i + 1, t, eyes.fit_tile(f, layout)) for i, (t, f) in enumerate(zip(times, frames))]
    sheets = eyes.save_sheets(tiles, layout, workdir / "hojas", fonts_dir, prefix="hoja", mark="R#")[:4]
    transcript = " ".join(w["text"] for w in heard)[:4000]
    return {"metrics": metrics, "moments": moments, "transcript": transcript}, sheets


def fetch(ctx: JobContext, pid: str, source: dict[str, Any], dest: Path) -> Path:
    """Baja la referencia: el link con yt-dlp o el archivo que subió la persona."""
    if source.get("kind") == "upload":
        key = str(source.get("key") or "")
        if not key.startswith(f"editor/{pid}/referencia/"):
            raise JobError("No encontramos el video de referencia. Vuelve a subirlo.", retry=False, detail=f"clave {key}")
        ext = Path(key).suffix.lower() if 1 < len(Path(key).suffix) <= 5 else ".mp4"
        return ctx.app.download(pid, key, dest / f"referencia{ext}", ctx.progress)
    url = str(source.get("url") or "")
    return download_link(url, dest, name="referencia", max_seconds=MAX_SECONDS, max_bytes=MAX_BYTES, extra_hosts=ctx.config.broll_extra_hosts)


def ensure(ctx: JobContext, project: dict[str, Any], start: float, end: float) -> bool:
    """Si hay una referencia por mirar, la mide y se la entrega a la app. Nunca corta el pedido: si falla, avisa."""
    ref = pending_reference(project)
    if not ref:
        return False
    pid = str(project["id"])
    span = end - start
    workdir = ctx.workdir(pid) / "referencia"
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {"step": "reference", "id": ref["id"]}
    try:
        ctx.stage("Bajando la referencia", start, start + span * 0.2)
        src = fetch(ctx, pid, ref.get("source") or {}, workdir)
        ctx.check()
        language = ctx.input.get("language") or "es"

        def transcribe_fn(ogg: Path, wav16: Path) -> list[dict]:
            _, words = transcribe.transcribe(ctx.config, ogg, language, wav16, fixture=ctx.config.test_style_transcript)
            return words

        def stage(name: str, a: float, b: float) -> None:
            ctx.stage("Mirando la referencia" if not name.startswith("Mirando") else name, start + span * (0.2 + a * 0.8), start + span * (0.2 + b * 0.8))

        data, sheets = analyze(src, workdir, models_dir=ctx.config.models_dir, fonts_dir=ctx.config.fonts_dir, transcribe_fn=transcribe_fn, stage=stage, progress=ctx.progress)
        uploaded = []
        from PIL import Image  # noqa: PLC0415

        for n, (path, frames) in enumerate(sheets):
            key = f"editor/{pid}/referencia/hoja-{n + 1:02d}.jpg"
            ctx.app.upload(pid, key, path, "image/jpeg")
            with Image.open(path) as img:
                w, h = img.size
            uploaded.append({"key": key, "width": w, "height": h, "frames": frames})
        payload.update({"ok": True, **data, "sheets": uploaded})
    except Cancelled:
        raise
    except JobError as exc:
        log.info("referencia de %s sin mirar: %s", pid, exc.detail or exc.user_message)
        message = exc.user_message if exc.user_message != LINK_ERROR else "No pudimos bajar ese link (puede ser privado o pedir iniciar sesión). Descarga el video y súbelo."
        payload.update({"ok": False, "error": message[:380]})
    except Exception as exc:  # noqa: BLE001 — la referencia es opcional: el pedido sigue sin ella
        log.warning("no se pudo mirar la referencia de %s", pid, exc_info=True)
        payload.update({"ok": False, "error": f"No pudimos mirar la referencia ({exc.__class__.__name__}). Prueba subiendo el video."[:380]})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    ctx.app.director(pid, payload)
    return True
