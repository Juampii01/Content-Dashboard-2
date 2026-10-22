"""Trabajos de YouTube en el worker.

YT_THUMBNAILS      — miniaturas de un paquete de "Títulos y miniaturas": recorta las fotos del personaje que falten
                     (U²-Net, sin fondo) y genera los fondos sin texto de los conceptos pedidos, con la cuenta de
                     ChatGPT del cliente (Codex) o su API key de OpenAI, igual que Carruseles. El texto lo dibuja la
                     plantilla en la app: el modelo nunca escribe letras.
YOUTUBE_TRANSCRIPT — subtítulos públicos de un video del cliente (yt-dlp, sin bajar el video) para cruzarlos con la
                     curva de retención.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from carruseles import codex, openai_api
from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import recorte, subtitulos
from .app import YoutubeApp

log = logging.getLogger("worker.youtube")

WIDTH, HEIGHT = 1280, 720
GENERIC = "Algo falló al preparar las miniaturas. Prueba de nuevo; si sigue, avísale a soporte."

CODEX_WRAPPER = """{prompt}

INSTRUCCIÓN TÉCNICA: no leas skills ni archivos y no ejecutes ningún comando. Llama UNA sola vez a la herramienta de generación de imágenes con todo lo anterior (formato horizontal 16:9) y termina respondiendo solo 'ok'."""


def _workdir(ctx: JobContext) -> Path:
    # Nombre que no es un UUID: la limpieza del Editor (janitor) no la toca; la borra este mismo trabajo.
    path = ctx.config.work_dir / f"youtube-{ctx.job['id']}"
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    return path


def to_thumbnail_jpeg(src: Path, dest: Path) -> Path:
    """Fondo a 1280×720 exacto (recorte centrado, sin deformar) en JPEG. Valida que sea una imagen."""
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im = ImageOps.fit(im, (WIDTH, HEIGHT), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
            im.save(dest, "JPEG", quality=88, optimize=True, progressive=True)
    except (UnidentifiedImageError, OSError) as exc:
        raise JobError("La imagen llegó dañada. Prueba de nuevo.", retry=False, detail="imagen ilegible") from exc
    return dest


def cutout_key(photo_key: str) -> str:
    digest = hashlib.sha256(photo_key.encode()).hexdigest()[:16]
    return f"miniaturas/recortes/{digest}-{secrets.token_hex(4)}.png"


def _cutouts(ctx: JobContext, app: YoutubeApp, work: Path, photos: list[str], start: float, end: float) -> int:
    done = 0
    for i, key in enumerate(photos):
        ctx.check()
        ctx.stage(f"Recortando tu foto {i + 1} de {len(photos)}", start + (end - start) * i / len(photos), start + (end - start) * (i + 1) / len(photos))
        try:
            src = app.download(key, work / f"foto-{i}{Path(key).suffix or '.jpg'}")
            out = recorte.cutout(src, work / f"recorte-{i}.png", ctx.config.models_dir)
            dest = cutout_key(key)
            app.upload(dest, out, "image/png")
            app.cutout(key, dest, recorte.MODEL_NAME)
            done += 1
        except recorte.CutoutUnavailable:
            log.warning("sin modelo de recorte: se usa la foto entera")
            app.cutout(key, None, "sin-recorte", "El recorte automático no está instalado: usamos tu foto entera con un degradado.")
        except recorte.NoPerson:
            app.cutout(key, None, recorte.MODEL_NAME, "No encontramos a una persona en esta foto. Prueba con una foto tuya de frente, con el fondo despejado.")
        except (UnidentifiedImageError, OSError) as exc:
            log.warning("foto ilegible: %s", exc.__class__.__name__)
            app.cutout(key, None, recorte.MODEL_NAME, "No pudimos leer esta foto. Súbela otra vez en JPG o PNG.")
        ctx.progress(1.0)
    return done


@register("YT_THUMBNAILS")
def yt_thumbnails(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    package_id = str(data.get("packageId") or "")
    concepts = [c for c in (data.get("concepts") or []) if c.get("conceptId") and c.get("prompt")]
    photos = [str(p) for p in (data.get("photos") or [])][:8]
    if not concepts and not photos:
        raise JobError("No hay nada que generar.", retry=False)
    app = YoutubeApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    home: codex.CodexHome | None = None
    done: list[str] = []
    pending = [str(c["conceptId"]) for c in concepts]
    try:
        cut_end = 0.25 if concepts else 1.0
        cutouts = _cutouts(ctx, app, work, photos, 0.0, cut_end) if photos else 0
        if not concepts:
            return {"packageId": package_id, "done": [], "cutouts": cutouts}

        ctx.stage("Preparando", cut_end, cut_end + 0.03)
        creds = app.credentials()
        provider = creds.get("provider")
        if provider == "chatgpt":
            home = codex.CodexHome.create(work, creds.get("authJson"))
        total = len(concepts)
        base = cut_end + 0.03
        for n, item in enumerate(concepts):
            ctx.check()
            ctx.stage(f"Generando el fondo {n + 1} de {total}", base + (0.98 - base) * n / total, base + (0.98 - base) * (n + 1) / total)
            out_dir = work / f"fondo-{n + 1}"
            out_dir.mkdir()
            if provider == "chatgpt" and home:
                image = codex.generate_image(
                    home,
                    out_dir,
                    CODEX_WRAPPER.format(prompt=item["prompt"]),
                    [],
                    model=str(creds.get("model") or "gpt-5.6-terra"),
                    effort=str(creds.get("effort") or "medium"),
                    check=ctx.check,
                )
                refreshed = home.refreshed()
                if refreshed:
                    app.save_chatgpt_auth(refreshed)
                    home.mark_saved(refreshed)
            elif provider == "openai":
                image = openai_api.generate_image(creds, item["prompt"], [], out_dir / "imagen.png")
            else:
                raise JobError("Conecta tu ChatGPT o agrega una API key de OpenAI en Ajustes para generar los fondos.", retry=False)
            jpg = to_thumbnail_jpeg(image, out_dir / "fondo.jpg")
            key = f"miniaturas/{package_id}/{item['conceptId']}-{secrets.token_hex(4)}.jpg"
            app.upload(key, jpg, "image/jpeg")
            app.background(str(item["conceptId"]), key, str(provider))
            done.append(str(item["conceptId"]))
            pending.remove(str(item["conceptId"]))
            ctx.progress(1.0)
        return {"packageId": package_id, "provider": provider, "done": done, "cutouts": cutouts}
    except JobError as exc:
        # Los fondos que faltan quedan como fallidos con el motivo (la persona puede volver a pedirlos).
        for concept_id in pending:
            try:
                app.background(concept_id, None, None, exc.user_message)
            except JobError:
                log.warning("no se pudo marcar el fondo fallido")
        if done:
            exc.user_message = f"{exc.user_message} (Se generaron {len(done)} de {len(concepts)} fondos.)"
        if home:
            refreshed = home.refreshed()
            if refreshed:
                try:
                    app.save_chatgpt_auth(refreshed)
                except JobError:
                    log.warning("no se pudo guardar la sesión refrescada de ChatGPT")
        raise
    except Cancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("YT_THUMBNAILS falló")
        for concept_id in pending:
            try:
                app.background(concept_id, None, None, GENERIC)
            except JobError:
                pass
        raise JobError(GENERIC, retry=False, detail=exc.__class__.__name__) from exc
    finally:
        if home:
            home.cleanup()
        shutil.rmtree(work, ignore_errors=True)


@register("YOUTUBE_TRANSCRIPT")
def youtube_transcript(ctx: JobContext) -> dict[str, Any]:
    video_id = str(ctx.input.get("videoId") or "")
    app = YoutubeApp(ctx.app, ctx.job["id"])
    ctx.stage("Buscando los subtítulos en YouTube", 0.0, 0.7)
    content, language, kind = subtitulos.fetch(video_id)
    ctx.check()
    ctx.stage("Guardando lo que decías en cada momento", 0.7, 1.0)
    saved = app.subtitles(content, language, kind)
    return {"segments": saved.get("segments"), "language": language, "kind": kind}
