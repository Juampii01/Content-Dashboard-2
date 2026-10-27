"""Trabajo VIDEO_STYLE: baja (o recibe) el video de referencia, mide su estilo y se lo entrega a la app.

Entrada: {styleId, sourceKind: "upload" | "link", sourceKey?, url?, language?}
- "upload": el archivo ya está en el almacenamiento privado (`editor/estilos/<id>/referencia.<ext>`).
- "link": se baja con yt-dlp (Instagram, TikTok, YouTube). Si Instagram o TikTok no lo dejan bajar desde el
  servidor, se prueba con ScrapeCreators (clave del cliente); si no hay clave, error claro: que lo suba o la agregue.
La referencia nunca se guarda: la carpeta de trabajo se borra al terminar y la app borra el archivo subido.
"""

from __future__ import annotations

import logging
import re
import shutil
import urllib.parse
from pathlib import Path
from typing import Any

import psycopg

from comunes.errors import Cancelled, JobError
from comunes import ffmpeg
from comunes.ffmpeg import stop_event
from comunes.runner import JobContext, register

from . import scrapecreators, style, transcribe

log = logging.getLogger("worker.style")

LINK_ERROR = "No pudimos bajar ese link. Descarga el video y súbelo."
ALLOWED_LINK_HOSTS = ("instagram.com", "tiktok.com", "youtube.com", "youtu.be")
MAX_LINK_BYTES = 500 * 1024 * 1024
MAX_LINK_SECONDS = 15 * 60


class _QuietLogger:
    """yt-dlp escribe sus errores en stderr aunque esté en silencio; aquí van al log del worker, cortos."""

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        log.debug("yt-dlp: %s", msg[:300])

    def error(self, msg: str) -> None:
        log.info("yt-dlp: %s", msg[:300])


def link_allowed(url: str, extra_hosts: tuple[str, ...] = ()) -> bool:
    """Solo links https de Instagram, TikTok o YouTube. `extra_hosts` (pruebas con un servidor local) admite http en localhost."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if extra_hosts and host in extra_hosts and host in ("localhost", "127.0.0.1") and parts.scheme in ("http", "https"):
        return True
    return parts.scheme == "https" and any(host == h or host.endswith("." + h) for h in ALLOWED_LINK_HOSTS)


def _node_path() -> str | None:
    """El node de la imagen (copiado del stage de motion): yt-dlp lo usa para resolver los retos de JavaScript de YouTube."""
    return shutil.which("node") or next((p for p in ("/usr/local/bin/node", "/usr/bin/node") if Path(p).is_file()), None)


def download_link(
    url: str,
    dest_dir: Path,
    *,
    name: str = "referencia",
    max_seconds: float = MAX_LINK_SECONDS,
    max_bytes: int = MAX_LINK_BYTES,
    extra_hosts: tuple[str, ...] = (),
    ctx: JobContext | None = None,
) -> Path:
    """Baja el video de un link público con yt-dlp (mejor calidad hasta 1080p, en MP4). También lo usan los clips y la referencia del director.

    Si yt-dlp falla con un link de Instagram o TikTok (Instagram bloquea a ratos las IPs de servidores), se prueba con
    ScrapeCreators y la clave del cliente (`ctx` hace falta para pedirla a la app). Sin clave, el error dice qué hacer.
    """
    if not link_allowed(url, extra_hosts):
        raise JobError("Ese link no es de Instagram, TikTok ni YouTube. Descarga el video y súbelo.", retry=False)
    try:
        from yt_dlp import YoutubeDL  # noqa: PLC0415
        from yt_dlp.utils import DownloadError  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise JobError(LINK_ERROR, retry=False, detail="sin yt-dlp") from exc

    def too_long(info: dict[str, Any], *, incomplete: bool = False) -> str | None:
        duration = info.get("duration")
        return "demasiado largo" if duration and duration > max_seconds else None

    def hook(_status: dict[str, Any]) -> None:
        if stop_event.is_set():
            raise Cancelled()

    opts: dict[str, Any] = {
        "outtmpl": str(dest_dir / f"{name}.%(ext)s"),
        "format": "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "max_filesize": max_bytes,
        "socket_timeout": 30,
        "retries": 2,
        "match_filter": too_long,
        "progress_hooks": [hook],
        "cachedir": False,
        "logger": _QuietLogger(),
    }
    node = _node_path()
    if node:
        # Por defecto yt-dlp solo busca deno; con node (y yt-dlp-ejs) resuelve los retos de YouTube.
        opts["js_runtimes"] = {"node": {"path": node}}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Cancelled:
        raise
    except DownloadError as exc:
        return _plan_b(url, dest_dir, name, max_seconds, max_bytes, extra_hosts, ctx, f"yt-dlp: {str(exc)[:300]}")
    except Exception as exc:  # noqa: BLE001 — cualquier error de yt-dlp es "no se pudo bajar"
        return _plan_b(url, dest_dir, name, max_seconds, max_bytes, extra_hosts, ctx, f"yt-dlp: {exc.__class__.__name__}: {str(exc)[:200]}")
    if not info:
        raise JobError(LINK_ERROR, retry=False, detail="yt-dlp sin info (filtrado por duración)")
    files = [p for p in dest_dir.glob(f"{name}.*") if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov") and p.stat().st_size > 0]
    if not files:
        raise JobError(LINK_ERROR, retry=False, detail="yt-dlp no dejó archivo")
    return files[0]


def _plan_b(url: str, dest_dir: Path, name: str, max_seconds: float, max_bytes: int, extra_hosts: tuple[str, ...], ctx: JobContext | None, why: str) -> Path:
    """yt-dlp no pudo: con Instagram o TikTok se prueba con ScrapeCreators; con YouTube queda el error de siempre."""
    platform = scrapecreators.platform_of(url)
    if not platform:
        raise JobError(LINK_ERROR, retry=False, detail=why)
    log.info("yt-dlp no pudo bajar el link de %s; se prueba con ScrapeCreators", platform)
    api_key = ctx.app.scrapecreators_key(str(ctx.job["id"])) if ctx is not None else None
    if not api_key:
        raise JobError(scrapecreators.blocked_message(platform), retry=False, detail=f"{why} · sin clave de ScrapeCreators")
    if ctx is not None:
        ctx.check()
    base = (ctx.config.scrapecreators_base_url if ctx is not None else None) or scrapecreators.API_BASE
    direct = scrapecreators.video_url(url, platform, api_key, max_seconds=max_seconds, base=base, extra_hosts=extra_hosts)
    for stale in dest_dir.glob(f"{name}.*"):
        stale.unlink(missing_ok=True)  # restos de yt-dlp (.part, .ytdl)
    path = scrapecreators.download_video(direct, dest_dir / f"{name}.mp4", platform, max_bytes=max_bytes, extra_hosts=extra_hosts)
    duration = ffmpeg.fraction(str((ffmpeg.probe(path).get("format") or {}).get("duration") or "0"))
    if duration > max_seconds + 1:
        path.unlink(missing_ok=True)
        raise JobError(f"Ese video es demasiado largo: el máximo es de {round(max_seconds / 60)} minutos.", retry=False, detail=f"scrapecreators: {duration:.0f} s")
    log.info("link de %s bajado con ScrapeCreators", platform)
    return path


def _style_row(ctx: JobContext, style_id: str) -> dict[str, Any] | None:
    return ctx.conn.execute("SELECT * FROM video_styles WHERE id = %s", (style_id,)).fetchone()


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    style_id = (job.get("input") or {}).get("styleId")
    if style_id:
        conn.execute(
            "UPDATE video_styles SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status <> 'READY'",
            (message[:1000], style_id),
        )


@register("VIDEO_STYLE", on_fail=mark_failed)
def analyze_style(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    style_id = str(data["styleId"])
    if not re.fullmatch(r"[0-9a-f-]{36}", style_id):
        raise JobError("Estilo no válido.", retry=False)
    row = _style_row(ctx, style_id)
    if not row:
        raise JobError("El estilo ya no existe.", retry=False)
    if row["status"] != "ANALYZING":
        return {"skipped": row["status"]}
    owner = {"styleId": style_id}
    workdir = ctx.config.work_dir / "estilos" / style_id
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        ctx.stage("Bajando el video de referencia", 0.0, 0.15)
        if data.get("sourceKind") == "link":
            src = download_link(str(data.get("url") or ""), workdir, ctx=ctx)
        else:
            key = str(data.get("sourceKey") or row.get("source_key") or "")
            if not key:
                raise JobError("No encontramos el video de referencia. Vuelve a subirlo.", retry=False)
            ext = Path(key).suffix.lower() if len(Path(key).suffix) <= 5 else ".mp4"
            src = ctx.app.download(None, key, workdir / f"referencia{ext or '.mp4'}", ctx.progress, owner=owner)
        ctx.check()

        language = data.get("language") or "es"

        def transcribe_fn(ogg: Path, wav16: Path) -> list[dict]:
            _, words = transcribe.transcribe(ctx.config, ogg, language, wav16, fixture=ctx.config.test_style_transcript)
            return words

        def stage(name: str, start: float, end: float) -> None:
            ctx.stage(name, 0.15 + start * 0.75, 0.15 + end * 0.75)

        metrics = style.analyze(src, workdir, models_dir=ctx.config.models_dir, transcribe_fn=transcribe_fn, stage=stage, progress=ctx.progress)
        ctx.check()

        ctx.stage("Guardando el estilo", 0.9, 1.0)
        thumb = workdir / "miniatura.jpg"
        style.thumbnail(src, thumb, metrics["duration"])
        thumb_key = f"editor/estilos/{style_id}/miniatura.jpg"
        ctx.app.upload(None, thumb_key, thumb, "image/jpeg", owner=owner)
        result = ctx.app.style_result(style_id, {"metrics": metrics, "thumbKey": thumb_key})
        return {"status": result.get("status"), "cuts": metrics["cuts"]["count"], "captions": metrics["captions"].get("detected")}
    finally:
        # La referencia no se guarda en el worker: se copia el estilo, nunca el contenido.
        shutil.rmtree(workdir, ignore_errors=True)
