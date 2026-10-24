"""Trabajos del Editor de video.

VIDEO_ANALYZE: ingesta → transcripción por palabra (bordes ajustados a la energía) → plan (lo arma la app con Claude).
VIDEO_RENDER: tramos → unión → audio → video final con subtítulos → control de calidad → subida.

Cada etapa deja su salida (en la base o en la carpeta de trabajo) y se saltea si ya está: un reintento
retoma donde quedó. Si la carpeta de trabajo se perdió (otra máquina), se rehace a partir del original.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from comunes import db, ffmpeg
from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import ass, audio_preview, broll_edit, director, energy, eyes, fx, ingest, library, motion, render, style_job, transcribe  # library y style_job registran VIDEO_CLIP y VIDEO_STYLE
from . import clips as long_clips  # registra LONG_VIDEO_CLIPS (clips desde un video largo)
from . import phrase_fix  # registra VIDEO_PHRASE_CLIP y reemplaza las frases corregidas antes de cortar

log = logging.getLogger("worker.video")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
EMOJI_DIR = ASSETS_DIR / "emoji"


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
        if not src.exists() and ctx.input.get("clip"):
            # Proyecto creado desde un clip de un video largo: el original es el tramo ya reencuadrado a 9:16.
            ctx.stage("Recortando y reencuadrando el clip", start, start + span * 0.15)
            long_clips.cut_for_project(ctx, ctx.input["clip"], src)
            ctx.app.upload(pid, key, src, "video/mp4")
        elif not src.exists():
            ctx.stage("Bajando el video", start, start + span * 0.15)
            ctx.app.download(pid, key, src, ctx.progress)
        ctx.stage("Preparando el video", start + span * 0.15, start + span * (0.75 if need_proxy else 0.95))
        probe = ffmpeg.probe(src)
        if ingest.needs_remux(probe):
            # Grabado en el navegador (WebM sin duración): se re-empaqueta sin recodificar antes de seguir.
            src = ingest.remux_for_duration(src, workdir / "original.fixed.mkv")
            probe = ffmpeg.probe(src)
        info = ingest.analyze_probe(probe)
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

    if ctx.input.get("mode") == "edit":
        # "Edítalo así" o un arreglo de la revisión final: el director corrige con el pedido y vuelve a mirar.
        try:
            result = director.run(ctx, project, "start", 0.0, 1.0)
        except Cancelled:
            raise
        except JobError as exc:
            ctx.app.director(pid, {"step": "abort", "error": exc.user_message[:300]})
            return {"edit": "abort"}
        return {"edit": result.get("status")}

    media = prepare(ctx, project, 0.0, 0.45, need_proxy=True)
    workdir = ctx.workdir(pid)

    if not project.get("transcript"):
        ctx.stage("Transcribiendo", 0.45, 0.65)
        wav, ogg, wav16 = workdir / "audio.wav", workdir / "asr.ogg", workdir / "asr16.wav"
        ingest.asr_audio(wav, ogg, wav16)
        ctx.progress(0.2)
        language = ctx.input.get("language") or "es"
        provider, words = transcribe.transcribe(ctx.config, ogg, language, wav16)
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
        project["transcript"] = transcript

    if not media.get("audioPreview") and project.get("transcript"):
        # Muestra de "Audio de estudio" (10 s antes y después). Si falla, el análisis sigue: no es imprescindible.
        ctx.stage("Preparando la muestra de audio", 0.65, 0.67)
        try:
            preview = audio_preview.make(ctx, pid, workdir, project["transcript"].get("words") or [], float(media["duration"]))
            if preview:
                media = {**media, "audioPreview": preview}
                db.update_project(ctx.conn, pid, media=media)
        except Cancelled:
            raise
        except Exception:  # noqa: BLE001
            log.warning("no se pudo armar la muestra de audio de %s", pid, exc_info=True)

    # Ojos y director de edición: mira el video, lo entiende, dirige la edición y la revisa antes de entregarla.
    director.see(ctx, project, workdir, media, 0.67, 0.75)
    result = director.run(ctx, project, "start", 0.75, 1.0)
    return {"status": result.get("status")}


# Un efecto entra como capa a pantalla completa y sin fundido (ya trae su entrada y su salida).
FX_EDIT = {"fade": 0, "box": {"x": 0, "y": 0}}


def fx_image_hosts(app_url: str) -> tuple[str, ...]:
    """Desde dónde se pueden bajar las miniaturas de tus reels: la app (las de demostración) y el Blob público."""
    from urllib.parse import urlsplit

    host = (urlsplit(app_url).hostname or "").lower()
    return tuple(h for h in (host, "public.blob.vercel-storage.com") if h)


# Bancos de videos de stock y los hosts desde donde se bajan sus archivos.
STOCK_HOSTS = {"pexels": ("pexels.com",), "pixabay": ("pixabay.com",)}


def prepare_broll(ctx: JobContext, pid: str, workdir: Path, items: list[dict[str, Any]], size: tuple[int, int], expected: float) -> list[Path]:
    """Deja cada b-roll listo para superponer: baja los clips (stock de Pixabay o Pexels directo de su CDN; la biblioteca,
    del almacenamiento privado) y dibuja los gráficos con la marca (motor de motion graphics, worker/video/motion.py,
    con Pillow de respaldo para los gráficos v1). Todo se guarda en la
    carpeta del proyecto por hash: un segundo render no repite lo que no cambió."""
    cache = workdir / "broll"
    cache.mkdir(exist_ok=True)
    out: list[Path] = []
    for i, item in enumerate(items):
        ctx.check()
        source = item.get("source")
        start, end = float(item["start"]), min(float(item["end"]), expected)
        if source == "graphic":
            # Ya sale a la medida del tramo (tamaño, 30 fps y duración): no pasa por render.prepare_broll.
            path = motion.render_graphic(item.get("spec"), end - start, size, cache, ctx.config.fonts_dir)
            out.append(path)
            ctx.progress((i + 1) / len(items))
            continue
        if source in STOCK_HOSTS:
            url = str(item.get("url") or "")
            name = hashlib.sha1(url.encode()).hexdigest()[:16]
            raw = cache / f"{source}-{name}.mp4"
            if not raw.exists():
                ctx.app.download_url(url, raw, (*STOCK_HOSTS[source], *ctx.config.broll_extra_hosts))
        elif source == "library":
            clip_id, key = str(item.get("clipId") or ""), str(item.get("key") or "")
            if not key.startswith(f"editor/biblioteca/{clip_id}/"):
                raise JobError("Un clip de la biblioteca ya no está disponible. Cámbialo en la revisión.", retry=False)
            raw = cache / f"lib-{clip_id}{Path(key).suffix or '.mp4'}"
            if not raw.exists():
                ctx.app.download(None, key, raw, owner={"clipId": clip_id})
        else:
            raise JobError("Un b-roll tiene un origen desconocido. Cámbialo en la revisión.", retry=False)
        edit = item.get("edit") or None
        offset = float((edit or {}).get("clipStart", item.get("offset") or 0) or 0)
        ready = cache / f"ready-{raw.stem}-{size[0]}x{size[1]}-{offset:.2f}-{end - start:.3f}-{broll_edit.edit_key(edit)}.mp4"
        out.append(render.prepare_broll(raw, ready, end - start, size, offset, edit))
        ctx.progress((i + 1) / len(items))
    return out


def mix_extras(ctx: JobContext, pid: str, workdir: Path, out_dir: Path, voice: Path, audio_cfg: dict[str, Any], duration: float, info: dict[str, Any]) -> Path:
    """Efectos de sonido y música de fondo debajo de la voz. Sin ninguno de los dos, la voz queda tal cual."""
    sfx = [c for c in audio_cfg.get("sfx") or [] if isinstance(c, dict)]
    music_cfg = audio_cfg.get("music") if isinstance(audio_cfg.get("music"), dict) else None
    if not sfx and not music_cfg:
        return voice
    music_path = None
    if music_cfg:
        track_id, key = str(music_cfg.get("trackId") or ""), str(music_cfg.get("key") or "")
        if not key.startswith(f"editor/musica/{track_id}/"):
            raise JobError("La música elegida no es válida. Elígela de nuevo en la revisión.", retry=False, detail=f"clave {key}")
        cache = workdir / "musica"
        cache.mkdir(exist_ok=True)
        music_path = cache / f"{track_id}{Path(key).suffix or '.mp3'}"
        if not music_path.exists():
            ctx.app.download(None, key, music_path, owner={"trackId": track_id})
    mixed = out_dir / "mix.wav"
    result = render.mix_audio(voice, mixed, duration, sfx=sfx, music=music_path, music_db=float((music_cfg or {}).get("db", -16)), target=float(audio_cfg.get("targetLufs", -14)))
    info.update(result)
    return mixed


def compose(ctx: JobContext, project: dict[str, Any], data: dict[str, Any], *, preview: bool = False) -> dict[str, Any]:
    """Todo lo del render menos la codificación final: tramos, unión, audio (no en la vista previa), b-roll, subtítulos
    y el grafo de ffmpeg. Lo usan el render y la vista previa de la segunda mirada del director (que solo saca cuadros)."""
    pid = str(project["id"])
    clips = data["clips"]
    if not clips:
        raise JobError("No quedó nada para renderizar. Restaura algunas palabras y vuelve a intentarlo.", retry=False)
    fmt = data["format"]
    expected = sum(c["end"] - c["start"] for c in clips) / render.FPS
    stages = (
        {"prepare": (0.0, 0.1), "cut": (0.1, 0.35), "audio": (0.35, 0.45), "broll": (0.45, 0.55), "fx": (0.55, 0.65)}
        if not preview
        else {"prepare": (0.0, 0.1), "cut": (0.1, 0.4), "broll": (0.4, 0.6), "fx": (0.6, 0.8)}
    )

    media = prepare(ctx, project, *stages["prepare"], need_proxy=False)
    workdir = ctx.workdir(pid)
    mezz, wav = workdir / "mezz.mp4", workdir / "audio.wav"

    # Frases corregidas con la voz clonada (y labios, si los hay): se aplican sobre el original, en su carpeta propia.
    fixes = [f for f in data.get("phraseFixes") or [] if isinstance(f, dict)]
    seg_mezz, seg_wav, seg_dir = (phrase_fix.patch_sources(ctx, pid, workdir, mezz, wav, fixes) if fixes else (mezz, wav, workdir))

    ctx.stage("Cortando las tomas" if not preview else "Armando la vista previa", *stages["cut"])
    segments = render.render_segments(seg_mezz, seg_wav, clips, seg_dir, ctx.progress)

    out_dir = workdir / f"render-{render.clips_hash(clips)}"
    out_dir.mkdir(exist_ok=True)
    joined = out_dir / "joined.mkv"
    render.concat(segments, joined)

    voice = joined
    audio_info: dict[str, Any] = {}
    audio_cfg = data.get("audio") or {}
    if not preview:
        ctx.stage("Mezclando el audio", *stages["audio"])
        voice = out_dir / "voice.wav"
        audio_info = render.process_audio(
            joined, voice, float(audio_cfg.get("targetLufs", -14)), float(audio_cfg.get("truePeak", -1)), studio_level=str(audio_cfg.get("studio") or "off"), models_dir=ctx.config.models_dir
        )
        voice = mix_extras(ctx, pid, workdir, out_dir, voice, audio_cfg, expected, audio_info)

    captions = data.get("captions") or {}
    ass_path = None
    out_w, out_h = render.OUTPUT_SIZE[fmt]
    broll_items = [b for b in data.get("broll") or [] if float(b["end"]) - float(b["start"]) >= 0.5 and float(b["start"]) < expected]
    broll_inputs: list[Path] = []
    if broll_items:
        ctx.stage("Preparando el b-roll", *stages["broll"])
        broll_inputs = prepare_broll(ctx, pid, workdir, broll_items, (out_w, out_h), expected)

    # Efectos de la biblioteca: cada uno se dibuja aparte (con el recorte de la persona si va detrás) y entra al grafo
    # como una capa a pantalla completa, sin fundido.
    fx_items = [e for e in data.get("effects") or [] if isinstance(e, dict)]
    fx_layers: list[dict[str, Any]] = []
    if fx_items:
        ctx.stage("Dibujando los efectos", *stages["fx"])
        fx_layers = fx.render_effects(
            ctx,
            fx_items,
            joined=joined,
            mezz=seg_mezz,
            src_size=(int(media["width"]), int(media["height"])),
            total_frames=int(round(float(media["duration"]) * render.FPS)),
            fmt=fmt,
            offset_x=float((data.get("framing") or {}).get("offsetX", 0)),
            workdir=workdir,
            fonts_dir=ctx.config.fonts_dir,
            image_hosts=fx_image_hosts(ctx.config.app_url),
            on_progress=ctx.progress,
        )
        fx_layers = [f for f in fx_layers if f["start"] < expected]

    stickers: list[dict[str, Any]] = []
    if ass.is_look(captions):
        # Galería de estilos animados: el ASS y los emojis (imágenes) que van encima.
        ass_path = out_dir / "captions.ass"
        text, stickers = ass.build_look_ass(captions, out_w, out_h, ctx.config.fonts_dir)
        ass_path.write_text(text, encoding="utf-8")
        stickers = [s for s in stickers if (EMOJI_DIR / f"{s['name']}.png").exists()][:24]
    elif (captions.get("preset") in ass.PRESETS or (captions.get("preset") == "estilo" and captions.get("style"))) and captions.get("blocks"):
        ass_path = out_dir / "captions.ass"
        ass_path.write_text(ass.build_ass(captions, out_w, out_h, fmt), encoding="utf-8")
    # Una entrada por emoji en pantalla (en ffmpeg cada entrada se usa una sola vez; son pocos: solo palabras clave).
    emoji_files = [s["name"] for s in stickers]
    overlays = [{"input": 2 + i, "start": float(b["start"]), "end": min(float(b["end"]), expected), "edit": b.get("edit")} for i, b in enumerate(broll_items)]
    overlays += [{"input": 2 + len(broll_items) + i, "start": f["start"], "end": min(f["end"], expected), "edit": FX_EDIT} for i, f in enumerate(fx_layers)]
    overlays.sort(key=lambda o: o["start"])
    emoji_base = 2 + len(broll_items) + len(fx_layers)
    graph, _, _ = render.framing_graph(
        media["width"],
        media["height"],
        fmt,
        float((data.get("framing") or {}).get("offsetX", 0)),
        ass_path,
        ctx.config.fonts_dir,
        zooms=data.get("zooms") or [],
        focus_y=float((data.get("framing") or {}).get("focusY", 0.42)),
        broll=overlays,
        stickers=[{**s, "input": emoji_base + i} for i, s in enumerate(stickers)],
    )
    return {
        "joined": joined,
        "voice": voice,
        "graph": graph,
        "expected": expected,
        "out_dir": out_dir,
        "broll_inputs": [*broll_inputs, *[f["path"] for f in fx_layers]],
        "broll_items": broll_items,
        "fx_layers": fx_layers,
        "image_inputs": [EMOJI_DIR / f"{n}.png" for n in emoji_files],
        "audio_info": audio_info,
        "fmt": fmt,
        # Lo que se usó para cortar (con las frases corregidas, si las hay): contra esto se mide la sincronía final.
        "source_wav": seg_wav,
        "segments": segments,
    }


@register("VIDEO_RENDER")
def render_job(ctx: JobContext) -> dict[str, Any]:
    project = _project(ctx)
    pid = str(project["id"])
    if project["status"] != "RENDERING":
        log.info("proyecto %s en estado %s: no se renderiza", pid, project["status"])
        return {"skipped": project["status"]}
    data = ctx.input
    built = compose(ctx, project, data)
    fmt, expected, out_dir, voice, audio_info, broll_items = built["fmt"], built["expected"], built["out_dir"], built["voice"], built["audio_info"], built["broll_items"]
    joined = built["joined"]

    ctx.stage("Renderizando", 0.55 if broll_items else 0.45, 0.9)
    final = out_dir / "final.mp4"
    if final.exists():
        final.unlink()
    render.final_encode(joined, voice, built["graph"], expected, final, ctx.config.x264_preset, ctx.progress, extra_inputs=built["broll_inputs"], image_inputs=built["image_inputs"])

    ctx.stage("Revisando la calidad", 0.9, 0.95)
    qc = render.quality_check(final, expected, fmt, float(data.get("audio", {}).get("targetLufs", -14)))
    if not next(c for c in qc["checks"] if c["name"] == "Duración")["ok"] or not next(c for c in qc["checks"] if c["name"] == "Sincronía audio-video")["ok"]:
        raise JobError("El video salió con un problema de duración o sincronía. Vamos a reintentarlo.", detail=str(qc["checks"]))
    # Sincronía real: el audio del MP4 tiene que ser el del original en el lugar que dice el timeline (el mismo de la
    # vista previa). Si no, no se entrega: se borran los tramos de este render (por si alguno quedó viejo en la caché)
    # y el reintento los rehace desde el original.
    sync = render.sync_check(final, built["source_wav"], data["clips"])
    qc["checks"].append({k: sync[k] for k in ("name", "ok", "detail")})
    if not sync["ok"]:
        for seg in built["segments"]:
            seg.unlink(missing_ok=True)
        log.error("sincronía fuera de lugar en %s: %s · %s", pid, sync["detail"], sync["points"])
        raise JobError(
            "El audio del video final no quedó alineado con la imagen. No lo entregamos así: vamos a rehacerlo desde el original. Si vuelve a pasar, escríbenos.",
            detail=f"sincronía: {sync['detail']}",
        )
    if not qc["ok"]:
        log.warning("control de calidad con avisos: %s", [c for c in qc["checks"] if not c["ok"]])

    ctx.stage("Guardando el video", 0.95, 0.97)
    poster = out_dir / "poster.jpg"
    ingest.build_poster(final, poster, at=min(1.0, expected / 3))
    srt = out_dir / "subtitulos.srt"
    srt.write_text(data.get("srt") or "", encoding="utf-8")
    ctx.app.upload(pid, data["outputKey"], final, "video/mp4")
    ctx.app.upload(pid, data["srtKey"], srt, "application/x-subrip")
    ctx.app.upload(pid, data["posterKey"], poster, "image/jpeg")
    if data.get("credits") and data.get("creditsKey"):
        # Atribución del b-roll de stock (Pexels la pide), junto a la descarga.
        credits = out_dir / "creditos.txt"
        credits.write_text(data["credits"], encoding="utf-8")
        ctx.app.upload(pid, data["creditsKey"], credits, "text/plain; charset=utf-8")
    ctx.check()
    if data.get("finalFrames"):
        # Revisión final del director: cuadros del MP4 en los momentos clave. Si falla, el video igual queda listo.
        ctx.stage("Revisando el video final", 0.97, 1.0)
        try:
            director.final_review(ctx, pid, final, data["finalFrames"], out_dir)
        except Cancelled:
            raise
        except Exception:  # noqa: BLE001
            log.warning("no se pudo hacer la revisión final de %s", pid, exc_info=True)
    meta = {
        **{k: qc[k] for k in ("duration", "width", "height", "fps", "lufs", "truePeak", "bytes")},
        "posterKey": data["posterKey"],
        **({"creditsKey": data["creditsKey"]} if data.get("credits") and data.get("creditsKey") else {}),
        "broll": len(broll_items),
        "graphics": sum(1 for b in broll_items if b.get("source") == "graphic"),
        "zooms": len(data.get("zooms") or []),
        "effects": [{"kind": f["kind"], "ms": f["ms"], "maskMs": f["maskMs"]} for f in built.get("fx_layers") or []],
        "qc": {"ok": qc["ok"], "checks": qc["checks"]},
        "audio": audio_info,
        "replaced": [k for k in data.get("previousKeys") or [] if k],
    }
    db.update_project(ctx.conn, pid, output_key=data["outputKey"], srt_key=data["srtKey"], output_meta=meta, status="DONE", error_message=None)
    # Los archivos intermedios de este render ya no hacen falta (los tramos se conservan para el próximo).
    shutil.rmtree(out_dir, ignore_errors=True)
    return {"outputKey": data["outputKey"], "duration": qc["duration"], "lufs": qc["lufs"]}


@register("VIDEO_FX")
def fx_job(ctx: JobContext) -> dict[str, Any]:
    """Recorte de la persona para la vista previa de los efectos: los segundos pedidos del original (bloques de 1 s),
    con el encuadre del plan. Sube una tira de máscaras chicas por segundo y anota en `media.fxMasks` cuáles hay."""
    project = _project(ctx)
    pid = str(project["id"])
    if project["status"] not in ("AWAITING_REVIEW", "PROCESSING", "RENDERING", "DONE"):
        return {"skipped": project["status"]}
    fmt = "16:9" if ctx.input.get("format") == "16:9" else "9:16"
    offset_x = max(-1.0, min(1.0, float(ctx.input.get("offsetX") or 0)))
    chunks = sorted({int(k) for k in ctx.input.get("chunks") or [] if isinstance(k, int) and 0 <= k < 7200})[:600]
    if not chunks:
        return {"chunks": 0}
    media = prepare(ctx, project, 0.0, 0.2, need_proxy=False)
    workdir = ctx.workdir(pid)
    ctx.stage("Recortándote del fondo", 0.2, 1.0)
    result = fx.preview_masks(
        ctx,
        workdir / "mezz.mp4",
        (int(media["width"]), int(media["height"])),
        int(round(float(media["duration"]) * render.FPS)),
        fmt,
        offset_x,
        chunks,
        workdir,
        upload=lambda path, key: ctx.app.upload(pid, key, path, "image/png"),
        prefix=f"editor/{pid}/fx",
        on_progress=ctx.progress,
    )
    # Se vuelve a leer el proyecto: la persona pudo seguir editando mientras tanto (solo se toca media.fxMasks).
    fresh = db.get_project(ctx.conn, pid) or project
    current = dict(fresh.get("media") or media)
    masks = dict(current.get("fxMasks") or {})
    prev = masks.get(result["key"]) or {}
    from datetime import datetime, timezone

    masks[result["key"]] = {
        "chunks": sorted(set(prev.get("chunks") or []) | set(result["chunks"])),
        "fps": result["fps"],
        "tile": result["tile"],
        "at": datetime.now(timezone.utc).isoformat(),
    }
    current["fxMasks"] = masks
    db.update_project(ctx.conn, pid, media=current)
    return {"key": result["key"], "chunks": len(result["chunks"])}
