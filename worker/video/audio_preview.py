"""Muestra de "Audio de estudio" para la revisión: 10 s de la toma tal cual y los mismos 10 s con Suave y con Fuerte.

Se hace al analizar el video (después de transcribir, antes del plan): cuesta unos segundos de máquina y así, cuando
la persona abre la revisión, "Escuchar antes y después" suena al instante, sin encender el worker ni esperar un
trabajo. Si algo falla, el análisis sigue (la muestra no es imprescindible) y la revisión lo dice.

Las tres versiones quedan a la misma sonoridad (-14 LUFS, como el video final): así se compara la limpieza y no el
volumen. La original solo se normaliza; las otras pasan por la misma cadena que el render (`render.process_audio`).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from comunes import ffmpeg

from . import render, studio

log = logging.getLogger("worker.audio_preview")

LENGTH = 10.0
LEVELS = ("soft", "strong")


def pick_window(words: list[dict[str, Any]], duration: float, length: float = LENGTH) -> tuple[float, float]:
    """Inicio y largo de la ventana de `length` s con más voz (segundos de palabras dentro), empezando en una palabra.
    Si el video es más corto, todo el video."""
    if duration <= length or not words:
        return 0.0, max(0.0, min(duration, length))
    best, best_start = -1.0, 0.0
    for w in words:
        start = max(0.0, float(w["start"]) - 0.15)
        if start + length > duration:
            start = duration - length
        end = start + length
        spoken = sum(max(0.0, min(end, float(x["end"])) - max(start, float(x["start"]))) for x in words if float(x["end"]) > start and float(x["start"]) < end)
        if spoken > best + 1e-6:
            best, best_start = spoken, start
    return round(best_start, 3), length


def normalize(src: Path, out: Path, target: float = -14.0) -> None:
    """Solo ganancia (loudnorm lineal en dos pasadas): la toma original al mismo volumen que las procesadas."""
    first = render.measure(src, [], target, -1.0)
    lra = max(0.1, float(first["input_lra"]))
    flt = (
        f"loudnorm=I={target}:TP=-1:LRA=18:measured_I={first['input_i']}:measured_TP={first['input_tp']}:"
        f"measured_LRA={lra}:measured_thresh={first['input_thresh']}:offset={first['target_offset']}:linear=true"
    )
    ffmpeg.run(["-i", str(src), "-af", f"{flt},aresample={render.SAMPLE_RATE}", "-ac", "1", "-c:a", "pcm_s16le", str(out)], what="muestra de audio")


def encode(src: Path, out: Path, length: float) -> None:
    fade = 0.08
    ffmpeg.run(
        ["-i", str(src), "-af", f"afade=t=in:d={fade},afade=t=out:st={max(0.0, length - fade):.3f}:d={fade}", "-ac", "1", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)],
        what="muestra de audio",
    )


def build(wav: Path, words: list[dict[str, Any]], duration: float, workdir: Path, models_dir: Path) -> dict[str, Any] | None:
    """Arma los tres archivos (m4a) en `workdir/muestra-audio`. None si no hay modelo o la toma es muy corta."""
    if not studio.model_available(models_dir):
        log.warning("muestra de audio: no está el modelo en %s", models_dir)
        return None
    start, length = pick_window(words, duration)
    if length < 2.0:
        return None
    out_dir = workdir / "muestra-audio"
    out_dir.mkdir(exist_ok=True)
    frag = out_dir / "fragmento.wav"
    ffmpeg.run(["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(wav), "-ac", "1", "-ar", str(render.SAMPLE_RATE), "-c:a", "pcm_s16le", str(frag)], what="muestra de audio")
    files: dict[str, Path] = {}
    plain = out_dir / "original.wav"
    normalize(frag, plain)
    files["original"] = plain
    for level in LEVELS:
        processed = out_dir / f"{level}.wav"
        render.process_audio(frag, processed, studio_level=level, models_dir=models_dir)
        files[level] = processed
    encoded = {}
    for name, path in files.items():
        m4a = out_dir / f"{name}.m4a"
        encode(path, m4a, length)
        encoded[name] = m4a
    return {"start": start, "duration": length, "files": encoded}


def make(ctx: Any, pid: str, workdir: Path, words: list[dict[str, Any]], duration: float) -> dict[str, Any] | None:
    """Muestra de la revisión: la arma, la sube (`editor/<id>/audio-estudio/…`) y devuelve lo que va en `media`."""
    built = build(workdir / "audio.wav", words, duration, workdir, ctx.config.models_dir)
    if not built:
        return None
    keys = {}
    for name, path in built["files"].items():
        key = f"editor/{pid}/audio-estudio/v{studio.VERSION}-{name}.m4a"
        ctx.app.upload(pid, key, path, "audio/mp4")
        keys[name] = key
    return {"version": studio.VERSION, "start": built["start"], "duration": built["duration"], "keys": keys}
