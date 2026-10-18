"""Trabajos del Editor de video.

VIDEO_ANALYZE: ingesta → transcripción por palabra (bordes ajustados a la energía) → plan (lo arma la app con Claude).
VIDEO_RENDER: tramos → unión → audio → video final con subtítulos → control de calidad → subida.

Cada etapa deja su salida (en la base o en la carpeta de trabajo) y se saltea si ya está: un reintento
retoma donde quedó. Si la carpeta de trabajo se perdió (otra máquina), se rehace a partir del original.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any

from comunes import db, ffmpeg
from comunes.errors import JobError
from comunes.runner import JobContext, register

from . import ass, energy, ingest, render, transcribe

log = logging.getLogger("worker.video")


def _project(ctx: JobContext) -> dict[str, Any]:
    project = db.get_project(ctx.conn, ctx.input["projectId"])
    if not project:
        raise JobError("El proyecto ya no existe.", retry=False)
    return project


def _source_path(workdir: Path, key: str) -> Path:
    ext = os.path.splitext(key.split("?")[0])[1].lower() or ".mp4"
    return workdir / f"original{ext if len(ext) <= 5 else '.mp4'}"


def prepare(ctx: JobContext, project: dict[str, Any], start: float, end: float, *, need_proxy: bool) -> dict[str, Any]:
    """Asegura original, mezzanine, WAV (y proxy/póster). Devuelve la info de media."""
    pid = str(project["id"])
    workdir = ctx.workdir(pid)
    span = end - start
    key = project["source_key"]
    if not key:
        raise JobError("Este proyecto no tiene video original.", retry=False)
    src = _source_path(workdir, key)
    mezz, wav = workdir / "mezz.mp4", workdir / "audio.wav"

    if not (mezz.exists() and wav.exists()):
        if not src.exists():
            ctx.stage("Bajando el video", start, start + span * 0.15)
            ctx.app.download(pid, key, src, ctx.progress)
        ctx.stage("Preparando el video", start + span * 0.15, start + span * (0.75 if need_proxy else 0.95))
        info = ingest.analyze_probe(ffmpeg.probe(src))
        ingest.build_mezzanine(src, info, mezz, ctx.progress)
        ingest.extract_audio(src, info, wav)
    else:
        info = (project.get("media") or {}).get("source")

    mprobe = ffmpeg.probe(mezz)
    vstream = next(s for s in mprobe["streams"] if s["codec_type"] == "video")
    width, height = int(vstream["width"]), int(vstream["height"])
    duration = float(vstream.get("duration") or mprobe["format"]["duration"])
    media = dict(project.get("media") or {})
    media.update({"duration": round(duration, 3), "width": width, "height": height, "mezzanine": {"width": width, "height": height, "fps": ingest.FPS}})
    if info:
        media["source"] = {k: info[k] for k in ("width", "height", "fps", "vfr", "hdr", "rotation", "codec", "hasAudio")}

    if need_proxy and not media.get("proxyKey"):
        proxy, poster = workdir / "proxy.mp4", workdir / "poster.jpg"
        ctx.stage("Preparando la vista previa", start + span * 0.75, end)
        ingest.build_proxy(mezz, wav, (width, height), duration, proxy, ctx.progress)
        ingest.build_poster(proxy, poster, at=min(1.0, duration / 3))
        pw, ph = ingest.proxy_size(width, height)
        ctx.app.upload(pid, f"editor/{pid}/proxy.mp4", proxy, "video/mp4")
        ctx.app.upload(pid, f"editor/{pid}/poster.jpg", poster, "image/jpeg")
        media.update({"proxyKey": f"editor/{pid}/proxy.mp4", "proxyWidth": pw, "proxyHeight": ph, "posterKey": f"editor/{pid}/poster.jpg"})
    db.update_project(ctx.conn, pid, media=media)
    project["media"] = media
    return media


@register("VIDEO_ANALYZE")
def analyze(ctx: JobContext) -> dict[str, Any]:
    project = _project(ctx)
    pid = str(project["id"])
    if project["status"] not in ("PROCESSING",):
        log.info("proyecto %s en estado %s: nada que analizar", pid, project["status"])
        return {"skipped": project["status"]}

    media = prepare(ctx, project, 0.0, 0.55, need_proxy=True)
    workdir = ctx.workdir(pid)

    if not project.get("transcript"):
        ctx.stage("Transcribiendo", 0.55, 0.85)
        wav, ogg, wav16 = workdir / "audio.wav", workdir / "asr.ogg", workdir / "asr16.wav"
        ingest.asr_audio(wav, ogg, wav16)
        ctx.progress(0.2)
        language = ctx.input.get("language") or "es"
        provider, words = transcribe.transcribe(ctx.config, ogg, language)
        ctx.check()
        if not words:
            raise JobError("No encontramos voz en el video. El editor trabaja con lo que dices: revisa que el audio se escuche.", retry=False)
        ctx.progress(0.8)
        db_frames, threshold = energy.load_energy(wav16)
        words = energy.refine(words, db_frames, threshold, media["duration"])
        transcript = {
            "version": 1,
            "provider": provider,
            "language": language,
            "duration": media["duration"],
            "words": [{"id": i, **{k: w[k] for k in ("text", "start", "end")}, **({"conf": w["conf"]} if "conf" in w else {})} for i, w in enumerate(words)],
        }
        db.update_project(ctx.conn, pid, transcript=transcript)

    ctx.stage("Armando el plan de edición", 0.85, 1.0)
    result = ctx.app.plan(pid)
    return {"plan": result.get("plannedBy"), "status": result.get("status")}


@register("VIDEO_RENDER")
def render_job(ctx: JobContext) -> dict[str, Any]:
    project = _project(ctx)
    pid = str(project["id"])
    if project["status"] != "RENDERING":
        log.info("proyecto %s en estado %s: no se renderiza", pid, project["status"])
        return {"skipped": project["status"]}
    data = ctx.input
    clips = data["clips"]
    if not clips:
        raise JobError("No quedó nada para renderizar. Restaura algunas palabras y vuelve a intentarlo.", retry=False)
    fmt = data["format"]
    expected = sum(c["end"] - c["start"] for c in clips) / render.FPS

    media = prepare(ctx, project, 0.0, 0.1, need_proxy=False)
    workdir = ctx.workdir(pid)
    mezz, wav = workdir / "mezz.mp4", workdir / "audio.wav"

    ctx.stage("Cortando las tomas", 0.1, 0.35)
    segments = render.render_segments(mezz, wav, clips, workdir, ctx.progress)

    out_dir = workdir / f"render-{render.clips_hash(clips)}"
    out_dir.mkdir(exist_ok=True)
    joined = out_dir / "joined.mkv"
    render.concat(segments, joined)

    ctx.stage("Mezclando el audio", 0.35, 0.45)
    voice = out_dir / "voice.wav"
    audio_info = render.process_audio(joined, voice, float(data.get("audio", {}).get("targetLufs", -14)), float(data.get("audio", {}).get("truePeak", -1)))

    ctx.stage("Renderizando", 0.45, 0.9)
    captions = data.get("captions") or {}
    ass_path = None
    out_w, out_h = render.OUTPUT_SIZE[fmt]
    if captions.get("preset") in ass.PRESETS and captions.get("blocks"):
        ass_path = out_dir / "captions.ass"
        ass_path.write_text(ass.build_ass(captions, out_w, out_h, fmt), encoding="utf-8")
    graph, _, _ = render.framing_graph(media["width"], media["height"], fmt, float((data.get("framing") or {}).get("offsetX", 0)), ass_path, ctx.config.fonts_dir)
    final = out_dir / "final.mp4"
    if final.exists():
        final.unlink()
    render.final_encode(joined, voice, graph, expected, final, ctx.config.x264_preset, ctx.progress)

    ctx.stage("Revisando la calidad", 0.9, 0.95)
    qc = render.quality_check(final, expected, fmt, float(data.get("audio", {}).get("targetLufs", -14)))
    if not next(c for c in qc["checks"] if c["name"] == "Duración")["ok"] or not next(c for c in qc["checks"] if c["name"] == "Sincronía audio-video")["ok"]:
        raise JobError("El video salió con un problema de duración o sincronía. Vamos a reintentarlo.", detail=str(qc["checks"]))
    if not qc["ok"]:
        log.warning("control de calidad con avisos: %s", [c for c in qc["checks"] if not c["ok"]])

    ctx.stage("Guardando el video", 0.95, 1.0)
    poster = out_dir / "poster.jpg"
    ingest.build_poster(final, poster, at=min(1.0, expected / 3))
    srt = out_dir / "subtitulos.srt"
    srt.write_text(data.get("srt") or "", encoding="utf-8")
    ctx.app.upload(pid, data["outputKey"], final, "video/mp4")
    ctx.app.upload(pid, data["srtKey"], srt, "application/x-subrip")
    ctx.app.upload(pid, data["posterKey"], poster, "image/jpeg")
    ctx.check()
    meta = {
        **{k: qc[k] for k in ("duration", "width", "height", "fps", "lufs", "truePeak", "bytes")},
        "posterKey": data["posterKey"],
        "qc": {"ok": qc["ok"], "checks": qc["checks"]},
        "audio": audio_info,
        "replaced": [k for k in data.get("previousKeys") or [] if k],
    }
    db.update_project(ctx.conn, pid, output_key=data["outputKey"], srt_key=data["srtKey"], output_meta=meta, status="DONE", error_message=None)
    # Los archivos intermedios de este render ya no hacen falta (los tramos se conservan para el próximo).
    shutil.rmtree(out_dir, ignore_errors=True)
    return {"outputKey": data["outputKey"], "duration": qc["duration"], "lufs": qc["lufs"]}
