"""Render del video final a partir del timeline que arma la app.

1. Tramos: cada tramo se codifica por separado desde el mezzanine con `-ss` exacto y una cantidad fija de cuadros.
   El audio sale del WAV con el mismo inicio y exactamente 1600 muestras por cuadro (48 000 / 30): audio y video
   miden lo mismo en cada tramo, así no hay desfase acumulado. Fundido de 10 ms en cada borde (sin clics).
   Los tramos se guardan con un nombre que depende de sus cuadros: un segundo render reutiliza los que no cambiaron.
2. Unión con el demuxer concat (sin recodificar; el audio va en PCM, que no agrega relleno entre tramos).
3. Audio: pasa altos 80 Hz, reducción de ruido, +2 dB entre 3 y 5 kHz, de-esser, compresor 3:1, limitador y
   `loudnorm` en dos pasadas con `linear=true` a -14 LUFS y -1 dBTP (solo ganancia, sin "bombeo").
4. Video final: reencuadre (16:9 → 9:16 con recorte estático y ajuste horizontal), subtítulos ASS y
   H.264 High, yuv420p, 30 fps, CRF 18, BT.709, AAC 48 kHz 192k, `+faststart`.
5. Control de calidad: duración, tamaño, cuadros por segundo, sonoridad y sincronía.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

from comunes import ffmpeg
from comunes.errors import JobError

log = logging.getLogger("worker.render")

FPS = 30
SAMPLE_RATE = 48000
SAMPLES_PER_FRAME = SAMPLE_RATE // FPS  # 1600
FADE = 0.010

OUTPUT_SIZE = {"9:16": (1080, 1920), "16:9": (1920, 1080)}

# Cadena de voz (antes de la normalización). Sin música en el MVP: el sidechain queda para cuando haya pista.
VOICE_CHAIN = [
    "highpass=f=80",
    "afftdn=nr=10:nf=-30:tn=1",
    "equalizer=f=4000:t=o:w=1:g=2",
    "deesser=i=0.4:m=0.5:f=0.5",
    "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=1",
]


def _atomic(out: Path) -> Path:
    return out.with_name(f"{out.stem}.part{out.suffix}")


# ─── 1. Tramos ─────────────────────────────────────────────────────────────


def segment_name(start: int, end: int) -> str:
    return f"seg-{start:07d}-{end:07d}.mkv"


def render_segment(mezz: Path, wav: Path, start: int, end: int, out: Path) -> None:
    if out.exists() and out.stat().st_size > 0:
        return
    frames = end - start
    dur = frames / FPS
    samples = frames * SAMPLES_PER_FRAME
    t0 = f"{start / FPS:.6f}"
    fade_out = max(0.0, dur - FADE)
    tmp = _atomic(out)
    ffmpeg.run(
        [
            "-ss", t0, "-i", str(mezz),
            "-ss", t0, "-i", str(wav),
            "-map", "0:v:0", "-map", "1:a:0",
            "-frames:v", str(frames),
            "-vf", "setpts=PTS-STARTPTS",
            "-af", f"atrim=end_sample={samples},apad=whole_len={samples},asetpts=PTS-STARTPTS,afade=t=in:d={FADE},afade=t=out:st={fade_out:.6f}:d={FADE}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-g", str(FPS), "-pix_fmt", "yuv420p",
            "-c:a", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1",
            str(tmp),
        ],
        what="tramo",
    )
    os.replace(tmp, out)


def render_segments(mezz: Path, wav: Path, clips: list[dict[str, Any]], workdir: Path, on_progress: Callable[[float], None]) -> list[Path]:
    seg_dir = workdir / "segments"
    seg_dir.mkdir(exist_ok=True)
    total = sum(c["end"] - c["start"] for c in clips) or 1
    done = 0
    paths = []
    for clip in clips:
        path = seg_dir / segment_name(clip["start"], clip["end"])
        render_segment(mezz, wav, clip["start"], clip["end"], path)
        paths.append(path)
        done += clip["end"] - clip["start"]
        on_progress(done / total)
    return paths


def concat(segments: list[Path], out: Path) -> None:
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in segments), encoding="utf-8")
    tmp = _atomic(out)
    ffmpeg.run(["-f", "concat", "-safe", "0", "-i", str(listing), "-map", "0", "-c", "copy", str(tmp)], what="unión")
    os.replace(tmp, out)


# ─── 3. Audio ──────────────────────────────────────────────────────────────


def _loudnorm_json(stderr: str) -> dict[str, Any]:
    match = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.S)
    if not match:
        raise JobError("No pudimos medir el volumen del audio.", detail="loudnorm sin json")
    return json.loads(match[-1])


def measure(src: Path, chain: list[str], target: float, tp: float) -> dict[str, Any]:
    stderr = ffmpeg.run(["-i", str(src), "-map", "0:a:0", "-af", ",".join([*chain, f"loudnorm=I={target}:TP={tp}:LRA=18:print_format=json"]), "-f", "null", "-"], what="medición de audio")
    return _loudnorm_json(stderr)


def process_audio(src: Path, out: Path, target: float = -14.0, tp: float = -1.0) -> dict[str, Any]:
    """Tres pasadas cortas (solo audio): ganancia previa + limitador, medición y normalización lineal."""
    first = measure(src, VOICE_CHAIN, target, tp)
    measured_i = float(first["input_i"])
    if measured_i < -60:
        raise JobError("El audio está prácticamente en silencio. Revisa que el micrófono haya grabado.", retry=False, detail=f"input_i {measured_i}")
    # Ganancia para llegar cerca del objetivo y limitador a -1.5 dBFS: después loudnorm solo ajusta en modo lineal.
    gain = max(-20.0, min(30.0, target - measured_i))
    chain = [*VOICE_CHAIN, f"volume={gain:.2f}dB", "alimiter=limit=0.84:attack=5:release=60:level=disabled"]
    second = measure(src, chain, target, tp)
    # loudnorm solo usa el modo lineal si el LRA medido es mayor que 0 (un tono puro mide 0).
    lra = max(0.1, float(second["input_lra"]))
    final_filter = (
        f"loudnorm=I={target}:TP={tp}:LRA=18:measured_I={second['input_i']}:measured_TP={second['input_tp']}:"
        f"measured_LRA={lra}:measured_thresh={second['input_thresh']}:offset={second['target_offset']}:linear=true:print_format=json"
    )
    tmp = _atomic(out)
    stderr = ffmpeg.run(
        ["-i", str(src), "-map", "0:a:0", "-af", ",".join([*chain, final_filter, f"aresample={SAMPLE_RATE}"]), "-ac", "1", "-c:a", "pcm_s16le", str(tmp)],
        what="mezcla de audio",
    )
    os.replace(tmp, out)
    result = _loudnorm_json(stderr)
    return {"gain": round(gain, 2), "normalization": result.get("normalization_type"), "input_i": measured_i}


# ─── 4. Video final ────────────────────────────────────────────────────────


def framing_graph(src_w: int, src_h: int, fmt: str, offset_x: float, ass: Path | None, fonts_dir: Path) -> tuple[str, int, int]:
    out_w, out_h = OUTPUT_SIZE[fmt]
    target_ratio = out_w / out_h
    src_ratio = src_w / src_h
    if src_ratio > target_ratio * 1.02:
        # Más ancho que la salida (16:9 → 9:16): recorte estático, centrado o con el ajuste de la revisión.
        crop_w = min(src_w, int(round(src_h * target_ratio / 2)) * 2)
        free = src_w - crop_w
        x = int(round(free / 2 * (1 + max(-1.0, min(1.0, offset_x)))))
        x = max(0, min(free, x))
        graph = f"[0:v]crop={crop_w}:{src_h}:{x}:0,scale={out_w}:{out_h}:flags=lanczos,setsar=1"
    elif src_ratio < target_ratio / 1.02 and fmt == "16:9":
        # Vertical a horizontal: el video al centro sobre una versión desenfocada de sí mismo.
        graph = (
            f"[0:v]split[a][b];[a]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,crop={out_w}:{out_h},boxblur=24:2,eq=brightness=-0.08[bg];"
            f"[b]scale=-2:{out_h}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1"
        )
    else:
        graph = f"[0:v]scale={out_w}:{out_h}:force_original_aspect_ratio=increase:flags=lanczos,crop={out_w}:{out_h},setsar=1"
    if ass:
        graph += f",ass=filename={ass}:fontsdir={fonts_dir}"
    graph += ",format=yuv420p[v]"
    return graph, out_w, out_h


def final_encode(video: Path, audio: Path, graph: str, duration: float, out: Path, preset: str, on_progress: Callable[[float], None]) -> None:
    tmp = _atomic(out)
    ffmpeg.run(
        [
            "-i", str(video), "-i", str(audio),
            "-filter_complex", graph,
            "-map", "[v]", "-map", "1:a:0",
            "-r", str(FPS), "-fps_mode", "cfr",
            "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", preset, "-crf", "18",
            "-maxrate", "12M", "-bufsize", "24M", "-g", "60",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-b:a", "192k", "-ar", str(SAMPLE_RATE), "-ac", "2",
            "-t", f"{duration:.6f}",
            "-movflags", "+faststart",
            str(tmp),
        ],
        duration=duration,
        on_progress=on_progress,
        what="render final",
    )
    os.replace(tmp, out)


# ─── 5. Control de calidad ─────────────────────────────────────────────────


def loudness(path: Path) -> tuple[float, float]:
    stderr = ffmpeg.run(["-i", str(path), "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], what="medición final")
    summary = stderr[stderr.rfind("Summary:") :] if "Summary:" in stderr else stderr
    i_match = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    p_match = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    integrated = float(i_match.group(1)) if i_match else float("nan")
    peak = float(p_match.group(1)) if p_match and p_match.group(1) != "-inf" else float("-inf")
    return integrated, peak


def quality_check(path: Path, expected: float, fmt: str, target: float = -14.0) -> dict[str, Any]:
    info = ffmpeg.probe(path)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    v_dur = float(video.get("duration") or info["format"]["duration"])
    a_dur = float(audio.get("duration") or 0) if audio else 0.0
    fps = ffmpeg.fraction(video.get("avg_frame_rate"))
    width, height = int(video["width"]), int(video["height"])
    lufs, peak = loudness(path)
    out_w, out_h = OUTPUT_SIZE[fmt]
    checks = [
        {"name": "Duración", "ok": abs(v_dur - expected) <= 2 / FPS + 0.02, "detail": f"{v_dur:.2f} s (esperado {expected:.2f} s)"},
        {"name": "Tamaño", "ok": (width, height) == (out_w, out_h), "detail": f"{width}×{height}"},
        {"name": "Cuadros por segundo", "ok": abs(fps - FPS) < 0.01, "detail": f"{fps:.2f} fps"},
        {"name": "Sonoridad", "ok": abs(lufs - target) <= 1.0, "detail": f"{lufs:.1f} LUFS (objetivo {target:.0f})"},
        {"name": "Pico", "ok": peak <= -0.5, "detail": f"{peak:.1f} dBTP"},
        {"name": "Sincronía audio-video", "ok": audio is not None and abs(a_dur - v_dur) <= 0.05, "detail": f"diferencia {abs(a_dur - v_dur) * 1000:.0f} ms"},
    ]
    return {
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
        "duration": round(v_dur, 3),
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "lufs": round(lufs, 2),
        "truePeak": round(peak, 2),
        "bytes": path.stat().st_size,
    }


def clips_hash(clips: list[dict[str, Any]]) -> str:
    return hashlib.sha1(json.dumps([[c["start"], c["end"]] for c in clips]).encode()).hexdigest()[:12]
