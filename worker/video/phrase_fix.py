"""Frases corregidas con la voz clonada (revisión del Editor → "Corregir esta frase").

La app genera la frase bien dicha con la voz clonada del cliente (HeyGen) y la guarda. Aquí se pone en el video:

- `patch_audio`: reemplaza el audio del original (WAV de 48 kHz, en segundos del original) en la ventana de cada frase.
  La voz nueva se recorta a lo hablado, se acelera si la app lo pidió (hasta ×1,2, con `atempo`, sin cambiar el tono),
  se iguala en volumen a la voz original de esa ventana y se apoya sobre el "ambiente" de la sala (el tramo más
  silencioso de alrededor, en bucle), para que no quede un hueco de silencio digital. Fundidos de 15 ms en los bordes.
- `patch_video`: si la frase tiene labios sincronizados por HeyGen, pone ese tramo encima del mezzanine.
- `patch_sources`: lo usa el render antes de cortar las tomas. Devuelve el mezzanine y el WAV parchados y una
  carpeta propia para los tramos (así los tramos sin corrección de un render anterior no se mezclan).
- VIDEO_PHRASE_CLIP: recorta el tramo de una frase (video sin audio + la voz nueva sobre el ambiente) para mandarlo a
  la sincronía de labios de HeyGen. Lo sube a `editor/<id>/frases/<fix>/tramo.mp4` y `tramo-voz.wav`.

Todo en archivos aparte: no toca `render.py` ni el audio de estudio.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from comunes import db, ffmpeg
from comunes.errors import JobError
from comunes.runner import JobContext, register

from .studio import read_audio, write_wav

log = logging.getLogger("worker.phrase_fix")

SR = 48000
FADE = 0.015
MAX_TEMPO = 1.25  # la app no pide más de 1,2; aquí un poco de margen


def fixes_hash(fixes: list[dict[str, Any]]) -> str:
    keys = ("id", "start", "end", "audioKey", "speechStart", "speechEnd", "tempo", "lipsync")
    norm = [{k: f.get(k) for k in keys} for f in fixes]
    return hashlib.sha1(json.dumps(norm, sort_keys=True).encode()).hexdigest()[:12]


def decode_speech(path: Path, start: float, end: float, tempo: float) -> np.ndarray:
    """La voz nueva entre `start` y `end` (lo hablado), acelerada si hace falta, a 48 kHz mono float."""
    tempo = max(1.0, min(MAX_TEMPO, float(tempo or 1.0)))
    af = [f"atrim=start={max(0.0, start):.3f}:end={max(start + 0.05, end):.3f}", "asetpts=PTS-STARTPTS"]
    if tempo > 1.001:
        af.append(f"atempo={tempo:.4f}")
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0", "-af", ",".join(af), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise JobError("No pudimos leer la voz nueva de una frase corregida. Bórrala y vuelve a crearla.", retry=False, detail=proc.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32)


def _frame_rms(x: np.ndarray, size: int) -> np.ndarray:
    n = len(x) // size
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    frames = x[: n * size].reshape(n, size)
    return np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12).astype(np.float32)


def voice_level(x: np.ndarray) -> float:
    """Nivel de la voz (RMS de los cuadros de 20 ms más fuertes, la mitad de arriba): ignora pausas y respiraciones."""
    rms = _frame_rms(x, int(SR * 0.02))
    if rms.size == 0:
        return 0.0
    top = np.sort(rms)[rms.size // 2 :]
    return float(np.sqrt(np.mean(top.astype(np.float64) ** 2))) if top.size else 0.0


def room_tone(x: np.ndarray, a: int, b: int, length: int) -> np.ndarray:
    """El tramo más silencioso de 300 ms a menos de 5 s de la ventana (fuera de ella), repetido hasta `length`."""
    span = int(SR * 0.3)
    lo, hi = max(0, a - SR * 5), min(len(x), b + SR * 5)
    best, best_rms = None, None
    step = int(SR * 0.05)
    for s in range(lo, max(lo, hi - span), step):
        if s < b and s + span > a:
            continue
        rms = float(np.sqrt(np.mean(x[s : s + span].astype(np.float64) ** 2) + 1e-12))
        if best_rms is None or rms < best_rms:
            best, best_rms = s, rms
    if best is None or length <= 0:
        return np.zeros(max(0, length), dtype=np.float32)
    piece = x[best : best + span].astype(np.float32).copy()
    # Fundido cruzado entre repeticiones para que el bucle no haga clic.
    fade = int(SR * 0.02)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)
    piece[:fade] *= ramp
    piece[-fade:] *= ramp[::-1]
    out = np.zeros(length + span, dtype=np.float32)
    pos = 0
    while pos < length:
        out[pos : pos + span] += piece
        pos += span - fade
    return out[:length]


def patch_audio(x: np.ndarray, fixes: list[dict[str, Any]], voices: dict[str, Path]) -> np.ndarray:
    """Devuelve una copia de `x` con cada ventana reemplazada por su voz nueva (mismo largo: el video no se mueve)."""
    out = x.astype(np.float32).copy()
    fade = int(SR * FADE)
    for fix in sorted(fixes, key=lambda f: float(f["start"])):
        a = max(0, int(round(float(fix["start"]) * SR)))
        b = min(len(out), int(round(float(fix["end"]) * SR)))
        if b - a < SR * 0.1:
            continue
        slot = b - a
        speech = decode_speech(voices[fix["id"]], float(fix.get("speechStart") or 0), float(fix.get("speechEnd") or 0), float(fix.get("tempo") or 1))
        if speech.size > slot:
            # No debería pasar (la app ya comprobó que entra); por las dudas, se corta con un fundido.
            speech = speech[:slot].copy()
            speech[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        original = x[a:b]
        target, current = voice_level(original), voice_level(speech)
        gain = float(np.clip(target / current, 0.1, 10.0)) if current > 1e-5 and target > 1e-5 else 1.0
        block = room_tone(x, a, b, slot)
        lead = min(int(SR * 0.08), max(0, slot - speech.size))
        block[lead : lead + speech.size] += speech * gain
        # Fundidos cruzados con el original en los dos bordes.
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        block[:fade] = block[:fade] * ramp + original[:fade] * ramp[::-1]
        block[-fade:] = block[-fade:] * ramp[::-1] + original[-fade:] * ramp
        out[a:b] = np.clip(block, -1.0, 1.0)
    return out


def patch_video(mezz: Path, overlays: list[dict[str, Any]], out: Path, size: tuple[int, int]) -> None:
    """Pone cada tramo con los labios sincronizados encima del mezzanine, en su lugar exacto (mismo tamaño y 30 fps)."""
    if out.exists() and out.stat().st_size > 0:
        return
    w, h = size
    inputs: list[str] = ["-i", str(mezz)]
    chains: list[str] = []
    last = "0:v"
    for i, ov in enumerate(overlays, start=1):
        s, e = float(ov["start"]), float(ov["end"])
        inputs += ["-i", str(ov["path"])]
        chains.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps=30,setpts=PTS-STARTPTS+{s:.3f}/TB[l{i}]")
        chains.append(f"[{last}][l{i}]overlay=enable='between(t,{s:.3f},{e - 0.001:.3f})':eof_action=pass[v{i}]")
        last = f"v{i}"
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    ffmpeg.run(
        [*inputs, "-filter_complex", ";".join(chains), "-map", f"[{last}]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-g", "30", "-pix_fmt", "yuv420p", str(tmp)],
        what="labios sincronizados",
    )
    os.replace(tmp, out)


def _download_voices(ctx: JobContext, pid: str, workdir: Path, fixes: list[dict[str, Any]]) -> dict[str, Path]:
    cache = workdir / "frases"
    cache.mkdir(exist_ok=True)
    voices: dict[str, Path] = {}
    for fix in fixes:
        key = str(fix.get("audioKey") or "")
        if not key.startswith(f"editor/{pid}/frases/{fix['id']}/"):
            raise JobError("Una frase corregida no es válida. Bórrala y vuelve a crearla.", retry=False, detail=f"clave {key}")
        path = cache / f"{fix['id']}{Path(key).suffix or '.mp3'}"
        if not path.exists():
            ctx.app.download(pid, key, path)
        voices[fix["id"]] = path
    return voices


def patch_sources(ctx: JobContext, pid: str, workdir: Path, mezz: Path, wav: Path, fixes: list[dict[str, Any]]) -> tuple[Path, Path, Path]:
    """Mezzanine y WAV con las frases corregidas, y la carpeta para sus tramos. Se reutiliza si no cambió nada."""
    tag = fixes_hash(fixes)
    seg_root = workdir / f"frases-{tag}"
    seg_root.mkdir(exist_ok=True)
    wav2 = seg_root / "audio.wav"
    voices = _download_voices(ctx, pid, workdir, fixes)
    if not (wav2.exists() and wav2.stat().st_size > 0):
        write_wav(wav2, patch_audio(read_audio(wav), fixes, voices))
    lips = [f for f in fixes if isinstance(f.get("lipsync"), dict) and f["lipsync"].get("key")]
    if not lips:
        return mezz, wav2, seg_root
    overlays = []
    for fix in lips:
        key = str(fix["lipsync"]["key"])
        if not key.startswith(f"editor/{pid}/frases/{fix['id']}/"):
            raise JobError("Una frase con labios sincronizados no es válida. Vuelve a pedir los labios.", retry=False, detail=f"clave {key}")
        path = workdir / "frases" / f"{fix['id']}-labios.mp4"
        if not path.exists():
            ctx.app.download(pid, key, path)
        overlays.append({"path": path, "start": fix["lipsync"]["start"], "end": fix["lipsync"]["end"]})
    probe = ffmpeg.probe(mezz)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    mezz2 = seg_root / "mezz.mp4"
    patch_video(mezz, overlays, mezz2, (int(v["width"]), int(v["height"])))
    return mezz2, wav2, seg_root


@register("VIDEO_PHRASE_CLIP")
def phrase_clip_job(ctx: JobContext) -> dict[str, Any]:
    """Tramo de una frase para la sincronía de labios: video del mezzanine sin audio y la voz nueva (WAV PCM)."""
    from .pipeline import prepare  # aquí y no arriba: pipeline importa este módulo

    data = ctx.input
    project = db.get_project(ctx.conn, data["projectId"])
    if not project:
        raise JobError("El proyecto ya no existe.", retry=False)
    pid = str(project["id"])
    fix = data["fix"]
    start, end = float(data["clipStart"]), float(data["clipEnd"])
    for key in (data["clipKey"], data["clipAudioKey"]):
        if not str(key).startswith(f"editor/{pid}/frases/{fix['id']}/"):
            raise JobError("El tramo pedido no es válido.", retry=False, detail=f"clave {key}")

    prepare(ctx, project, 0.0, 0.5, need_proxy=False)
    workdir = ctx.workdir(pid)
    mezz, wav = workdir / "mezz.mp4", workdir / "audio.wav"

    ctx.stage("Preparando la voz nueva", 0.5, 0.7)
    voices = _download_voices(ctx, pid, workdir, [fix])
    x = read_audio(wav)
    patched = patch_audio(x, [fix], voices)
    a, b = int(round(start * SR)), min(len(patched), int(round(end * SR)))
    out_dir = workdir / "frases" / fix["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / "tramo-voz-f32.wav"
    write_wav(raw, patched[a:b])
    voice = out_dir / "tramo-voz.wav"
    ffmpeg.run(["-i", str(raw), "-c:a", "pcm_s16le", "-ar", str(SR), "-ac", "1", str(voice)], what="voz del tramo")

    ctx.stage("Recortando el tramo", 0.7, 0.9)
    clip = out_dir / "tramo.mp4"
    frames = max(1, int(round((end - start) * 30)))
    ffmpeg.run(
        ["-ss", f"{start:.3f}", "-i", str(mezz), "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip)],
        what="tramo de la frase",
    )
    ctx.stage("Guardando el tramo", 0.9, 1.0)
    ctx.app.upload(pid, data["clipKey"], clip, "video/mp4")
    ctx.app.upload(pid, data["clipAudioKey"], voice, "audio/wav")
    return {"clipKey": data["clipKey"], "clipAudioKey": data["clipAudioKey"], "seconds": round(end - start, 3)}
