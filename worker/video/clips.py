"""Clips desde un video largo (podcast, live, video de YouTube de 10 a 120 minutos).

LONG_VIDEO_CLIPS: {longVideoId, sourceKind: "upload" | "link", sourceKey, url?, language}
1. Baja el original (subido al almacenamiento privado, o de un link con yt-dlp; en ese caso lo guarda una vez en el
   almacenamiento para que los clips lo vuelvan a usar).
2. Transcribe por palabra (lo mismo que el Editor: Parakeet / whisper / Deepgram / Groq, bordes ajustados a la energía).
3. Pide a la app los momentos (reglas + Claude, /api/worker/clips/<id>/moments).
4. Por cada momento, sigue las caras en su ventana (reframe.py) y arma una vista previa vertical liviana.
5. Entrega el reencuadre y las vistas previas a la app (/api/worker/clips/<id>/framing).

El corte final de cada clip lo hace el análisis del proyecto del Editor que se crea desde el clip
(VIDEO_ANALYZE con `clip` en la entrada → `cut_for_project`), con el mismo camino de cámara de la vista previa.

Cada etapa se saltea si su salida ya existe (transcripción en la base, original y audio en la carpeta de trabajo).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import psycopg

from comunes import ffmpeg
from comunes.errors import JobError
from comunes.runner import JobContext, register

from . import energy, ingest, reframe, style_job, transcribe

log = logging.getLogger("worker.clips")

MIN_SECONDS = 3 * 60
MAX_SECONDS = 150 * 60
MAX_LINK_BYTES = 6 * 1024**3
PREVIEW_SIZE = (360, 640)
CLIP_SIZE = (1080, 1920)


def workdir_for(ctx: JobContext, long_video_id: str) -> Path:
    path = ctx.config.work_dir / "largos" / long_video_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _row(conn: psycopg.Connection, long_video_id: str) -> dict[str, Any] | None:
    return conn.execute("SELECT * FROM long_videos WHERE id = %s", (long_video_id,)).fetchone()


def _update(conn: psycopg.Connection, long_video_id: str, **fields: Any) -> None:
    from psycopg.types.json import Jsonb  # noqa: PLC0415

    cols, values = [], []
    for key, value in fields.items():
        cols.append(f"{key} = %s")
        values.append(Jsonb(value) if isinstance(value, (dict, list)) else value)
    values.append(long_video_id)
    conn.execute(f"UPDATE long_videos SET {', '.join(cols)}, updated_at = now() WHERE id = %s", values)


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    long_video_id = (job.get("input") or {}).get("longVideoId")
    if long_video_id:
        conn.execute("UPDATE long_videos SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status <> 'READY'", (message[:1000], long_video_id))


def _local_original(workdir: Path) -> Path | None:
    return next((p for p in sorted(workdir.glob("original.*")) if ".part" not in p.name and p.stat().st_size > 0), None)


def ensure_source(ctx: JobContext, long_video_id: str, kind: str, key: str, url: str | None, on_progress: Any = None) -> Path:
    """El original en la carpeta de trabajo: ya estaba, se baja del almacenamiento o (la primera vez) del link."""
    workdir = workdir_for(ctx, long_video_id)
    found = _local_original(workdir)
    if found:
        return found
    owner = {"longVideoId": long_video_id}
    ext = Path(key).suffix.lower() if 0 < len(Path(key).suffix) <= 5 else ".mp4"
    if kind == "link":
        # Si un intento anterior ya lo bajó y lo guardó, se usa ese (no se vuelve a bajar del link).
        try:
            return ctx.app.download(None, key, workdir / f"original{ext}", on_progress, owner=owner)
        except JobError:
            pass
        raw = style_job.download_link(str(url or ""), workdir, name="descarga", max_seconds=MAX_SECONDS, max_bytes=MAX_LINK_BYTES)
        dest = workdir / "original.mp4"
        if raw.suffix.lower() == ".mp4":
            raw.rename(dest)
        else:
            ffmpeg.run(["-i", str(raw), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(dest)], what="video bajado")
            raw.unlink(missing_ok=True)
        ctx.app.upload(None, key, dest, "video/mp4", owner=owner)
        return dest
    return ctx.app.download(None, key, workdir / f"original{ext}", on_progress, owner=owner)


def probe_long(src: Path) -> dict[str, Any]:
    return ingest.analyze_probe(
        ffmpeg.probe(src),
        max_duration=MAX_SECONDS,
        min_duration=MIN_SECONDS,
        too_long="El video dura más de 2 horas y media. Córtalo en partes y súbelas por separado.",
        too_short="El video dura menos de 3 minutos. Para un video corto, usa el Editor directamente.",
    )


@register("LONG_VIDEO_CLIPS", on_fail=mark_failed)
def find_clips(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    long_video_id = str(data.get("longVideoId") or "")
    if not re.fullmatch(r"[0-9a-f-]{36}", long_video_id):
        raise JobError("Video no válido.", retry=False)
    row = _row(ctx.conn, long_video_id)
    if not row:
        raise JobError("El video ya no existe.", retry=False)
    if row["status"] != "PROCESSING":
        return {"skipped": row["status"]}
    key = str(row["source_key"] or data.get("sourceKey") or "")
    if not key.startswith(f"editor/largos/{long_video_id}/"):
        raise JobError("No encontramos el video. Vuelve a subirlo.", retry=False)
    workdir = workdir_for(ctx, long_video_id)

    ctx.stage("Bajando el video", 0.0, 0.12)
    src = ensure_source(ctx, long_video_id, str(row["source_kind"]), key, row.get("source_url"), ctx.progress)
    ctx.check()
    info = probe_long(src)
    media = {**(row.get("media") or {}), **{k: info[k] for k in ("width", "height", "fps", "duration", "hdr", "rotation", "hasAudio")}}
    _update(ctx.conn, long_video_id, media=media)

    words: list[dict[str, Any]]
    if row.get("transcript"):
        words = row["transcript"]["words"]
    else:
        ctx.stage("Preparando el audio", 0.12, 0.2)
        wav, ogg, wav16 = workdir / "audio.wav", workdir / "asr.ogg", workdir / "asr16.wav"
        if not (ogg.exists() and wav16.exists()):
            ingest.extract_audio(src, info, wav)
            ingest.asr_audio(wav, ogg, wav16)
            wav.unlink(missing_ok=True)  # 48 kHz no hace falta: el corte final sale del original
        ctx.stage("Transcribiendo", 0.2, 0.6)
        provider, raw = transcribe.transcribe(ctx.config, ogg, data.get("language") or "es", wav16)
        ctx.check()
        if not raw:
            raise JobError("No encontramos voz en el video. Para sacar clips tiene que haber alguien hablando.", retry=False)
        db_frames, threshold = energy.load_energy(wav16)
        refined = energy.refine(raw, db_frames, threshold, info["duration"])
        words = [{"id": i, **{k: w[k] for k in ("text", "start", "end")}, **({"conf": w["conf"]} if "conf" in w else {})} for i, w in enumerate(refined)]
        _update(ctx.conn, long_video_id, transcript={"version": 1, "provider": provider, "language": data.get("language") or "es", "duration": info["duration"], "words": words})

    ctx.stage("Buscando los mejores momentos", 0.6, 0.68)
    moments = ctx.app.clip_moments(long_video_id).get("clips") or []
    if not moments:
        raise JobError("No encontramos momentos que funcionen solos como short en este video.", retry=False)

    ctx.stage("Siguiendo las caras", 0.68, 0.96)
    finder = reframe.FaceFinder(ctx.config.models_dir)
    spans = reframe.speech_spans(words)
    width, height = int(info["width"]), int(info["height"])
    results = []
    clips_dir = workdir / "clips"
    clips_dir.mkdir(exist_ok=True)
    for i, m in enumerate(moments):
        ctx.check()
        cid = str(m["id"])
        w0, w1 = float(m["windowStart"]), float(m["windowEnd"])
        share = 1 / len(moments)

        def part(a: float, b: float, i: int = i) -> Any:
            return lambda f: ctx.progress((i + a + (b - a) * f) * share)

        framing = reframe.analyze_window(src, w0, w1, width, height, finder, spans, part(0, 0.6))
        preview = clips_dir / f"{cid}-vista.mp4"
        poster = clips_dir / f"{cid}-poster.jpg"
        reframe.render(src, preview, w0, w1 - w0, framing["keyframes"], width, height, PREVIEW_SIZE, crf=30, preset="veryfast", audio_bitrate="64k", hdr=bool(info.get("hdr")), on_progress=part(0.6, 0.95))
        ingest.build_poster(preview, poster, at=max(0.0, float(m["start"]) - w0 + 0.5))
        preview_key = f"editor/largos/{long_video_id}/clips/{cid}/vista.mp4"
        poster_key = f"editor/largos/{long_video_id}/clips/{cid}/poster.jpg"
        ctx.app.upload(None, preview_key, preview, "video/mp4", owner={"longVideoId": long_video_id})
        ctx.app.upload(None, poster_key, poster, "image/jpeg", owner={"longVideoId": long_video_id})
        results.append({"id": cid, "framing": framing, "previewKey": preview_key, "posterKey": poster_key})
        preview.unlink(missing_ok=True)
        ctx.progress((i + 1) * share)

    ctx.stage("Guardando los clips", 0.96, 1.0)
    thumb = workdir / "poster.jpg"
    ingest.build_poster(src, thumb, at=min(30.0, info["duration"] / 10))
    thumb_key = f"editor/largos/{long_video_id}/poster.jpg"
    ctx.app.upload(None, thumb_key, thumb, "image/jpeg", owner={"longVideoId": long_video_id})
    ctx.app.clip_framing(long_video_id, {"posterKey": thumb_key, "clips": results})
    return {"clips": len(results), "faces": sum(1 for r in results if r["framing"]["mode"] == "face")}


def cut_for_project(ctx: JobContext, clip: dict[str, Any], dest: Path) -> Path:
    """Original del proyecto de un clip: el tramo del video largo, reencuadrado a 9:16 con el camino de la vista previa."""
    long_video_id = str(clip.get("longVideoId") or "")
    key = str(clip.get("sourceKey") or "")
    if not re.fullmatch(r"[0-9a-f-]{36}", long_video_id) or not key.startswith(f"editor/largos/{long_video_id}/"):
        raise JobError("El clip no es válido. Vuelve a crearlo desde el video largo.", retry=False)
    row = _row(ctx.conn, long_video_id)
    if not row:
        raise JobError("El video largo de este clip ya no existe. Vuelve a subirlo para sacar clips.", retry=False)
    src = ensure_source(ctx, long_video_id, "upload", key, None, ctx.progress)
    media = row.get("media") or {}
    width, height = int(media.get("width") or 0), int(media.get("height") or 0)
    if not width or not height:
        info = probe_long(src)
        width, height = int(info["width"]), int(info["height"])
    start, end = float(clip["start"]), float(clip["end"])
    points = (clip.get("framing") or {}).get("keyframes") or [[start, 0.5], [end, 0.5]]
    return reframe.render(src, dest, start, end - start, points, width, height, CLIP_SIZE, crf=16, preset="veryfast", audio_bitrate="192k", hdr=bool(media.get("hdr")), on_progress=ctx.progress)

