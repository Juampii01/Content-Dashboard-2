"""Ingesta: del original del teléfono a archivos de trabajo predecibles.

- ffprobe: tamaño, rotación, cuadros por segundo (variable o fijo), HDR, audio.
- Mezzanine 1080p a 30 cuadros fijos en SDR (tonemap si es HDR, BT.709): base del render.
- Audio WAV 48 kHz mono alineado con el video (si el audio arranca corrido, se compensa).
- Audio para transcribir: Opus mono 32 kbps (cabe en 25 MB hasta ~100 min) y WAV 16 kHz para medir energía.
- Proxy 540p liviano con un cuadro clave cada medio segundo (saltos rápidos en la vista previa) y póster.

Cada paso escribe en un temporal y renombra: si se corta, se rehace; si ya está, se saltea.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Callable

from comunes import ffmpeg
from comunes.errors import JobError

log = logging.getLogger("worker.ingest")

FPS = 30
MAX_DURATION = 20 * 60
MIN_DURATION = 2.0
HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}


def analyze_probe(probe: dict[str, Any], *, max_duration: float = MAX_DURATION, min_duration: float = MIN_DURATION, too_long: str | None = None, too_short: str | None = None) -> dict[str, Any]:
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video:
        raise JobError("El archivo no tiene video. Sube un video MP4 o MOV.", retry=False)
    rotation = 0
    for side in video.get("side_data_list", []) or []:
        if "rotation" in side:
            rotation = int(round(float(side["rotation"])))
    if not rotation and video.get("tags", {}).get("rotate"):
        rotation = -int(video["tags"]["rotate"])
    rotation = ((rotation + 180) % 360) - 180
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if abs(rotation) == 90:
        width, height = height, width
    r_fps = ffmpeg.fraction(video.get("r_frame_rate"))
    avg_fps = ffmpeg.fraction(video.get("avg_frame_rate"))
    vfr = bool(r_fps and avg_fps and abs(r_fps - avg_fps) / r_fps > 0.01)
    transfer = (video.get("color_transfer") or "").lower()
    primaries = (video.get("color_primaries") or "").lower()
    hdr = transfer in HDR_TRANSFERS or (primaries == "bt2020" and transfer not in ("bt709", ""))
    duration = float(probe.get("format", {}).get("duration") or video.get("duration") or 0)
    info = {
        "width": width,
        "height": height,
        "fps": round(avg_fps or r_fps, 3),
        "vfr": vfr,
        "hdr": hdr,
        "rotation": rotation,
        "codec": video.get("codec_name", ""),
        "hasAudio": audio is not None,
        "duration": round(duration, 3),
        "videoStart": float(video.get("start_time") or 0),
        "audioStart": float(audio.get("start_time") or 0) if audio else 0.0,
    }
    if not info["hasAudio"]:
        raise JobError("El video no tiene audio. El editor trabaja con lo que dices: sube un video con sonido.", retry=False)
    if duration < min_duration:
        raise JobError(too_short or "El video es demasiado corto (menos de 2 segundos).", retry=False)
    if duration > max_duration:
        raise JobError(too_long or "El video dura más de 20 minutos. Córtalo en partes más cortas y súbelas por separado.", retry=False)
    if width < 160 or height < 160:
        raise JobError("La resolución del video es demasiado baja.", retry=False)
    return info


def probe_duration(probe: dict[str, Any]) -> float:
    """Duración que trae la cabecera (0 si no la trae)."""
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    for raw in (probe.get("format", {}).get("duration"), video.get("duration")):
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


def needs_remux(probe: dict[str, Any]) -> bool:
    """Las grabaciones del navegador (MediaRecorder: WebM de Chrome y Firefox) no escriben la duración en la cabecera."""
    return probe_duration(probe) <= 0 and any(s.get("codec_type") == "video" for s in probe.get("streams", []))


def remux_for_duration(src: Path, out: Path) -> Path:
    """Re-empaqueta sin recodificar (copia de pistas) a MKV, que sí escribe la duración y un índice para buscar.

    Si la grabación quedó cortada al final (se cerró la pestaña a mitad), se conserva hasta el último cuadro bueno.
    """
    if _done(out):
        return out
    tmp = _atomic(out)
    ffmpeg.run(
        ["-fflags", "+genpts+discardcorrupt", "-err_detect", "ignore_err", "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", str(tmp)],
        what="duración de la grabación",
    )
    os.replace(tmp, out)
    return out


def even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


def mezzanine_size(width: int, height: int) -> tuple[int, int]:
    """El lado corto queda en 1080 y el largo, como mucho, en 1920. Un video de menos de 720 no se agranda."""
    short, long_ = min(width, height), max(width, height)
    target_short = 1080 if short >= 720 else even(short)
    scale = target_short / short
    new_long = long_ * scale
    if new_long > 1920:
        scale = 1920 / long_
    w, h = even(width * scale), even(height * scale)
    return w, h


def _atomic(out: Path) -> Path:
    return out.with_name(f"{out.stem}.part{out.suffix}")


def _done(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0


def build_mezzanine(src: Path, info: dict[str, Any], out: Path, on_progress: Callable[[float], None]) -> tuple[int, int]:
    w, h = mezzanine_size(info["width"], info["height"])
    if _done(out):
        return w, h
    chain = []
    if info["hdr"]:
        # HDR de iPhone (HLG/PQ) → SDR BT.709 con tonemap: sin esto sale lavado.
        chain += ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:r=tv"]
    chain += [f"scale={w}:{h}:flags=lanczos", "setsar=1", f"fps={FPS}", "setpts=PTS-STARTPTS", "format=yuv420p"]
    tmp = _atomic(out)
    ffmpeg.run(
        [
            "-i", str(src),
            "-map", "0:v:0",
            "-vf", ",".join(chain),
            "-fps_mode", "cfr",
            "-r", str(FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", str(FPS), "-bf", "2",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-an", "-movflags", "+faststart",
            str(tmp),
        ],
        duration=info["duration"],
        on_progress=on_progress,
        what="mezzanine",
    )
    os.replace(tmp, out)
    return w, h


def extract_audio(src: Path, info: dict[str, Any], out: Path) -> None:
    """WAV 48 kHz mono, alineado con el cuadro 0 del mezzanine."""
    if _done(out):
        return
    offset = info["audioStart"] - info["videoStart"]
    filters = []
    if offset > 0.001:
        filters.append(f"adelay={int(round(offset * 1000))}:all=1")
    elif offset < -0.001:
        filters.append(f"atrim=start={-offset:.4f}")
    filters += ["asetpts=PTS-STARTPTS", "aresample=48000:async=1:first_pts=0"]
    tmp = _atomic(out)
    ffmpeg.run(
        ["-i", str(src), "-map", "0:a:0", "-af", ",".join(filters), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-t", f"{info['duration']:.3f}", str(tmp)],
        what="audio",
    )
    os.replace(tmp, out)


def asr_audio(wav: Path, ogg: Path, wav16: Path) -> None:
    if not _done(ogg):
        tmp = _atomic(ogg)
        ffmpeg.run(["-i", str(wav), "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", str(tmp)], what="audio para transcribir")
        os.replace(tmp, ogg)
    if not _done(wav16):
        tmp = _atomic(wav16)
        ffmpeg.run(["-i", str(wav), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)], what="audio 16 kHz")
        os.replace(tmp, wav16)


def proxy_size(width: int, height: int) -> tuple[int, int]:
    scale = 540 / min(width, height)
    return even(width * scale), even(height * scale)


def build_proxy(mezz: Path, wav: Path, size: tuple[int, int], duration: float, out: Path, on_progress: Callable[[float], None]) -> None:
    if _done(out):
        return
    w, h = proxy_size(*size)
    tmp = _atomic(out)
    ffmpeg.run(
        [
            "-i", str(mezz), "-i", str(wav),
            "-map", "0:v:0", "-map", "1:a:0",
            "-vf", f"scale={w}:{h}:flags=bilinear,format=yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
            "-c:a", "aac", "-b:a", "96k", "-ac", "1",
            "-shortest", "-movflags", "+faststart",
            str(tmp),
        ],
        duration=duration,
        on_progress=on_progress,
        what="proxy",
    )
    os.replace(tmp, out)


def build_poster(video: Path, out: Path, at: float = 1.0) -> None:
    if _done(out):
        return
    tmp = _atomic(out)
    ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "4", str(tmp)], what="póster")
    os.replace(tmp, out)
