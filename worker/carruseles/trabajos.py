"""Trabajos de Carruseles en el worker.

CAROUSEL_STYLE  — copia el estilo de un carrusel de referencia: baja las imágenes (subidas o desde un link con
                  gallery-dl), mide texto y colores (Tesseract + k-means) y le pasa medidas e imágenes reducidas a la
                  app, que arma la plantilla con Claude. Las imágenes se borran al terminar: no se guardan en ningún lado.
CAROUSEL_COPY   — "Copiar un carrusel": baja los slides (link con gallery-dl o subidos), los mide si se copia el diseño
                  y le pasa a la app las imágenes reducidas, que escribe tu versión con Claude. Las imágenes se borran.
CAROUSEL_IMAGES — imágenes sin texto para los slides, con la cuenta de ChatGPT del cliente (Codex CLI) o con su API
                  key de OpenAI. La primera imagen del carrusel sirve de referencia de estilo para las siguientes. Si
                  en el slide sale el personaje, sus fotos de Mi marca van primero como referencia de la cara. Una
                  corrección edita la imagen actual del slide (y vuelve a adjuntar las fotos del personaje).
CAROUSEL_ANIMATE — video corto (MP4) de un slide ya dibujado, con un movimiento sutil (ver animar.py).
CODEX_LOGIN     — conecta la cuenta de ChatGPT del cliente con el login por código de dispositivo de Codex.
"""

from __future__ import annotations

import logging
import secrets
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError
from psycopg.types.json import Jsonb

from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import animar, codex, descarga, medidas, openai_api
from .app import CarouselApp

log = logging.getLogger("worker.carruseles")

MAX_REFERENCES = 20
CLAUDE_IMAGES = 12  # Claude ve hasta 12 slides (las medidas son de todos)
CLAUDE_WIDTH = 640
COPY_IMAGES = 20  # para leer el texto de cada slide, Claude los ve todos y más grandes
COPY_WIDTH = 1000
GENERIC = "Algo falló al procesar el carrusel. Prueba de nuevo; si sigue, avísale a soporte."


def _workdir(ctx: JobContext) -> Path:
    # Nombre que no es un UUID: la limpieza del Editor (janitor) no la toca; la borra este mismo trabajo.
    path = ctx.config.work_dir / f"carrusel-{ctx.job['id']}"
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _final(ctx: JobContext, exc: JobError) -> bool:
    return not exc.retry or int(ctx.job["attempts"]) >= int(ctx.job["max_attempts"])


def _set_output(ctx: JobContext, output: dict[str, Any]) -> None:
    """Escribe una salida parcial mientras el trabajo corre (el código de ChatGPT, por ejemplo)."""
    ctx.conn.execute(
        "UPDATE jobs SET output = %s WHERE id = %s AND locked_by = %s AND status = 'RUNNING'",
        (Jsonb(output), ctx.job["id"], ctx.config.worker_id),
    )


# ─── CAROUSEL_STYLE ───────────────────────────────────────────────────────


def _template_failed(ctx: JobContext, template_id: str, message: str) -> None:
    ctx.conn.execute(
        "UPDATE carousel_templates SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status = 'ANALYZING'",
        (message[:500], template_id),
    )


def _valid_images(paths: list[Path], dest: Path) -> list[Path]:
    """Normaliza cada referencia a JPEG RGB; descarta lo que no es una imagen."""
    out: list[Path] = []
    for i, p in enumerate(paths):
        try:
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                if im.width < 200 or im.height < 200:
                    continue
                target = dest / f"{i + 1:02d}.jpg"
                im.save(target, "JPEG", quality=92)
                out.append(target)
        except (UnidentifiedImageError, OSError):
            continue
    return out


def _for_claude(paths: list[Path], dest: Path, limit: int = CLAUDE_IMAGES, width: int = CLAUDE_WIDTH) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    out = []
    for i, p in enumerate(paths[:limit]):
        with Image.open(p) as im:
            im = im.convert("RGB")
            im.thumbnail((width, width * 2))
            target = dest / f"c{i + 1:02d}.jpg"
            im.save(target, "JPEG", quality=80)
            out.append(target)
    return out


@register("CAROUSEL_STYLE")
def carousel_style(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    template_id = str(data.get("templateId") or "")
    if not template_id:
        raise JobError("Falta la plantilla.", retry=False)
    app = CarouselApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    try:
        raw = work / "original"
        raw.mkdir()
        if data.get("source") == "link":
            ctx.stage("Bajando el carrusel", 0.0, 0.2)
            files = descarga.download_post(str(data.get("url") or ""), raw)
        else:
            keys = [str(k) for k in (data.get("keys") or [])][:MAX_REFERENCES]
            if len(keys) < 2:
                raise JobError("Sube al menos 2 imágenes del carrusel.", retry=False)
            ctx.stage("Preparando tus imágenes", 0.0, 0.2)
            files = []
            for i, key in enumerate(keys):
                ctx.check()
                files.append(app.download(key, raw / f"{i + 1:02d}{Path(key).suffix or '.jpg'}"))
                ctx.progress((i + 1) / len(keys))
        refs = _valid_images(files, work)
        if len(refs) < 2:
            raise JobError("No pudimos leer las imágenes. Súbelas en JPG o PNG (al menos 2).", retry=False)
        ctx.stage("Midiendo textos y colores", 0.2, 0.7)
        try:
            measured = medidas.measure_all(refs, ctx.progress)
        except medidas.OcrMissing as exc:
            raise JobError("Falta Tesseract en el servicio de procesamiento. Avísale a soporte.", retry=False, detail=str(exc)) from exc
        ctx.check()
        ctx.stage("Entendiendo el diseño con IA", 0.7, 0.98)
        result = app.style(measured, _for_claude(refs, work / "claude"))
        return {"templateId": template_id, "slides": len(refs), "spec": bool(result.get("ok"))}
    except JobError as exc:
        if _final(ctx, exc):
            _template_failed(ctx, template_id, exc.user_message)
        raise
    except Cancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("CAROUSEL_STYLE falló")
        error = JobError(GENERIC, retry=True, detail=exc.__class__.__name__)
        if _final(ctx, error):
            _template_failed(ctx, template_id, GENERIC)
        raise error from exc
    finally:
        # Las imágenes del original no se guardan en ningún lado.
        shutil.rmtree(work, ignore_errors=True)


# ─── CAROUSEL_COPY ────────────────────────────────────────────────────────


def _copy_failed(conn: Any, job: dict[str, Any], message: str) -> None:
    copy_id = str((job.get("input") or {}).get("copyId") or "")
    if copy_id:
        conn.execute(
            "UPDATE carousel_copies SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status = 'ANALYZING'",
            (message[:500], copy_id),
        )


@register("CAROUSEL_COPY", on_fail=_copy_failed)
def carousel_copy(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    copy_id = str(data.get("copyId") or "")
    if not copy_id:
        raise JobError("Falta la copia.", retry=False)
    app = CarouselApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    try:
        raw = work / "original"
        raw.mkdir()
        post_text: str | None = None
        if data.get("source") == "link":
            ctx.stage("Bajando el carrusel", 0.0, 0.25)
            files = descarga.download_post(str(data.get("url") or ""), raw, metadata=True)
            post_text = descarga.post_text(raw)
        else:
            keys = [str(k) for k in (data.get("keys") or [])][:MAX_REFERENCES]
            if len(keys) < 2:
                raise JobError("Sube al menos 2 slides del carrusel.", retry=False)
            ctx.stage("Preparando tus imágenes", 0.0, 0.2)
            files = []
            for i, key in enumerate(keys):
                ctx.check()
                files.append(app.download(key, raw / f"{i + 1:02d}{Path(key).suffix or '.jpg'}"))
                ctx.progress((i + 1) / len(keys))
        refs = _valid_images(files, work)
        if len(refs) < 2:
            raise JobError("No pudimos leer las imágenes. Súbelas en JPG o PNG (al menos 2).", retry=False)
        measured: dict[str, Any] | None = None
        if data.get("design") == "original":
            ctx.stage("Midiendo el diseño", 0.25, 0.5)
            try:
                measured = medidas.measure_all(refs, ctx.progress)
            except medidas.OcrMissing:
                # Sin Tesseract no se copia el diseño, pero sí el contenido (se avisa en el log).
                log.warning("CAROUSEL_COPY sin Tesseract: se sigue sin copiar el diseño")
        ctx.check()
        ctx.stage("Leyendo cada slide y escribiendo tu versión", 0.5, 0.98)
        result = app.copy(measured, _for_claude(refs, work / "claude", COPY_IMAGES, COPY_WIDTH), post_text)
        return {"copyId": copy_id, "carouselId": result.get("carouselId"), "slides": len(refs), "design": measured is not None}
    except Cancelled:
        raise
    except JobError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("CAROUSEL_COPY falló")
        raise JobError(GENERIC, retry=True, detail=exc.__class__.__name__) from exc
    finally:
        # Las imágenes del original no se guardan en ningún lado.
        shutil.rmtree(work, ignore_errors=True)


# ─── CAROUSEL_IMAGES ──────────────────────────────────────────────────────

CODEX_WRAPPER = """{prompt}

INSTRUCCIÓN TÉCNICA: no leas skills ni archivos y no ejecutes ningún comando. Llama UNA sola vez a la herramienta de generación de imágenes con todo lo anterior (formato vertical 4:5) y termina respondiendo solo 'ok'."""


def _check_image(path: Path) -> tuple[str, str]:
    """Comprueba que el archivo es una imagen y devuelve (extensión, content-type). No la recodifica: se conserva tal cual."""
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            fmt = (im.format or "PNG").upper()
    except (UnidentifiedImageError, OSError) as exc:
        raise JobError("La imagen llegó dañada. Prueba de nuevo.", retry=True, detail="imagen ilegible") from exc
    return {"JPEG": ("jpg", "image/jpeg"), "WEBP": ("webp", "image/webp")}.get(fmt, ("png", "image/png"))


def _as_jpeg(path: Path, dest: Path, max_side: int = 1600) -> Path:
    """Referencia normalizada a JPEG RGB (las fotos pueden venir en WebP o con orientación EXIF)."""
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((max_side, max_side))
            im.save(dest, "JPEG", quality=92)
        return dest
    except (UnidentifiedImageError, OSError) as exc:
        raise JobError("Una de tus fotos de referencia está dañada. Súbela de nuevo en Mi marca.", retry=False, detail="referencia ilegible") from exc


@register("CAROUSEL_IMAGES")
def carousel_images(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    carousel_id = str(data.get("carouselId") or "")
    items = [i for i in (data.get("items") or []) if i.get("slideId") and i.get("prompt")]
    if not carousel_id or not items:
        raise JobError("No hay slides para generar.", retry=False)
    app = CarouselApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    home: codex.CodexHome | None = None
    done: list[dict[str, Any]] = []
    fetched: dict[str, Path] = {}

    def fetch(key: str) -> Path:
        """Baja una referencia una sola vez por trabajo (las fotos del personaje se repiten entre slides)."""
        if key not in fetched:
            raw = app.download(key, work / "refs" / f"r{len(fetched) + 1}{Path(key).suffix or '.jpg'}")
            fetched[key] = _as_jpeg(raw, raw.with_name(f"{raw.stem}-n.jpg"))
        return fetched[key]

    try:
        ctx.stage("Preparando", 0.0, 0.05)
        creds = app.credentials()
        provider = creds.get("provider")
        if provider == "chatgpt":
            home = codex.CodexHome.create(work, creds.get("authJson"))
        style_refs: list[Path] = []
        style_key = data.get("styleRefKey")
        if style_key:
            try:
                style_refs.append(fetch(str(style_key)))
            except JobError:
                log.warning("no se pudo bajar la imagen de referencia de estilo; sigo sin ella")
        total = len(items)
        for n, item in enumerate(items):
            ctx.check()
            correcting = bool(item.get("editKey"))
            ctx.stage(f"{'Corrigiendo' if correcting else 'Generando'} imagen {n + 1} de {total}", 0.05 + 0.93 * n / total, 0.05 + 0.93 * (n + 1) / total)
            out_dir = work / f"img-{n + 1}"
            out_dir.mkdir()
            # Orden de las imágenes (el mismo que describe el prompt): fotos del personaje, imagen a corregir, estilo.
            faces = [fetch(str(k)) for k in (item.get("characterKeys") or [])[:3]]
            refs = [*faces, *([fetch(str(item["editKey"]))] if correcting else []), *([] if correcting else style_refs[:1])]
            if provider == "chatgpt" and home:
                image = codex.generate_image(
                    home,
                    out_dir,
                    CODEX_WRAPPER.format(prompt=item["prompt"]),
                    refs,
                    model=str(creds.get("model") or "gpt-5.6-terra"),
                    effort=str(creds.get("effort") or "medium"),
                    check=ctx.check,
                )
                refreshed = home.refreshed()
                if refreshed:
                    app.save_chatgpt_auth(refreshed)
                    home.mark_saved(refreshed)
            elif provider == "openai":
                image = openai_api.generate_image(creds, item["prompt"], refs, out_dir / "imagen.png", keep_face=bool(faces))
            else:
                raise JobError("Conecta tu ChatGPT o agrega una API key de OpenAI en Ajustes para generar imágenes.", retry=False)
            ext, content_type = _check_image(image)
            key = f"carruseles/{carousel_id}/{item['slideId']}-{secrets.token_hex(4)}.{ext}"
            app.upload(key, image, content_type)
            saved = app.slide_image(str(item["slideId"]), key, str(provider))
            done.append({"slideId": item["slideId"], "url": saved.get("url"), "prev": saved.get("prev"), "key": key})
            ctx.progress(1.0)
            # La primera imagen nueva de este trabajo sirve de referencia de estilo para las siguientes (consistencia).
            if not style_refs and not correcting:
                style_refs.append(image)
        return {"provider": provider, "generated": len(done), "slides": done}
    except JobError as exc:
        if done:
            exc.user_message = f"{exc.user_message} (Se generaron {len(done)} de {len(items)}.)"
        if home:
            refreshed = home.refreshed()
            if refreshed:
                try:
                    app.save_chatgpt_auth(refreshed)
                except JobError:
                    log.warning("no se pudo guardar la sesión refrescada de ChatGPT")
        raise
    finally:
        if home:
            home.cleanup()
        shutil.rmtree(work, ignore_errors=True)


# ─── CAROUSEL_ANIMATE ─────────────────────────────────────────────────────


@register("CAROUSEL_ANIMATE")
def carousel_animate(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    carousel_id = str(data.get("carouselId") or "")
    slide_id = str(data.get("slideId") or "").lower()
    source_key = str(data.get("sourceKey") or "")
    if not carousel_id or not slide_id or not source_key:
        raise JobError("Falta el slide para animar.", retry=False)
    app = CarouselApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    try:
        ctx.stage("Preparando el slide", 0.0, 0.1)
        source = app.download(source_key, work / "slide.jpg")
        ctx.stage("Animando el slide", 0.1, 0.9)
        video = animar.render(
            source,
            work / "slide.mp4",
            motion=str(data.get("motion") or "zoom"),
            fmt=str(data.get("format") or "4:5"),
            seconds=float(data.get("seconds") or 6),
            check=ctx.check,
            progress=ctx.progress,
        )
        ctx.stage("Guardando el video", 0.9, 1.0)
        key = f"carruseles/{carousel_id}/anim/{slide_id}-{secrets.token_hex(4)}.mp4"
        app.upload(key, video, "video/mp4")
        saved = app.slide_video(key)
        return {"slideId": data.get("slideId"), "url": saved.get("url")}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ─── CODEX_LOGIN ──────────────────────────────────────────────────────────


@register("CODEX_LOGIN")
def codex_login(ctx: JobContext) -> dict[str, Any]:
    app = CarouselApp(ctx.app, ctx.job["id"])
    work = _workdir(ctx)
    home = codex.CodexHome.create(work, None)
    try:
        ctx.stage("Pidiendo el código a ChatGPT", 0.0, 0.1)

        def on_code(device: codex.DeviceCode) -> None:
            _set_output(ctx, {"url": device.url, "code": device.code})
            ctx.stage("Esperando que entres con tu cuenta", 0.1, 0.9)

        auth = codex.device_login(home, work, on_code, ctx.check)
        ctx.stage("Guardando la conexión", 0.9, 1.0)
        saved = app.save_chatgpt_auth(auth)
        return {"connected": True, "label": saved.get("label")}
    finally:
        home.cleanup()
        shutil.rmtree(work, ignore_errors=True)
