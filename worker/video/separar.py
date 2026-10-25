"""Trabajo AUDIO_SPLIT ("Sacar la música de un reel"): separa la voz del resto y guarda la música sin la voz.

Entrada: {trackId, sourceKind: "link" | "upload", url?, sourceKey?}
1. Baja el reel con yt-dlp (lo mismo que "Edita como este") o el archivo subido (`editor/musica/<id>/original.<ext>`).
2. Lo pasa a audio estéreo de 44,1 kHz y lo separa con HT-Demucs (Meta, MIT) en ONNX, en la CPU y sin PyTorch: el
   modelo da cuatro pistas (batería, bajo, otros y voz); la música con sus efectos es la suma de las tres primeras.
3. Sube la pista sin voz en M4A (`editor/musica/<id>/pista.m4a`) y avisa a la app, que la deja lista en la biblioteca
   y borra el archivo subido. La voz no se guarda.

Medido con una mezcla de voz y música conocidas: la voz sale con 18 dB de SDR y la música con 21 dB (la voz que queda
en la música está 21 dB por debajo). En 4 núcleos tarda ~4 s por cada 7,8 s de audio y usa ~1,4 GB de memoria.
La separación de cada tramo sigue `infer.py` de huggingface.co/adowu/htdemucs-onnx (MIT): ventanas de 7,8 s que se
pisan un cuarto y se mezclan con un fundido (aquí sin fundido en el principio y el final del audio, que allá quedaban
en silencio).
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

import numpy as np
import psycopg

from comunes import ffmpeg
from comunes.errors import Cancelled, JobError
from comunes.runner import JobContext, register

from . import style_job

log = logging.getLogger("worker.separar")

MODEL_FILE = Path("htdemucs") / "htdemucs_fp16weights.onnx"
SAMPLE_RATE = 44100
SEGMENT = int(7.8 * SAMPLE_RATE)  # 343.980 muestras: lo que recibe el modelo de una vez
OVERLAP = SEGMENT // 4
MAX_SECONDS = 10 * 60
NO_AUDIO = "Ese video no tiene sonido."
TOO_LONG = "Ese audio dura más de 10 minutos. Con un reel o una canción alcanza."
SILENT_REST = "En ese video casi no hay música ni sonidos: solo voz. Prueba con otro."


def model_path(models_dir: Path) -> Path:
    path = models_dir / MODEL_FILE
    if not path.exists():
        raise JobError("Falta el modelo para separar la voz en el servicio de procesamiento. Avísale a soporte.", retry=False, detail=str(path))
    return path


def decode(src: Path, dest: Path, on_progress: Callable[[float], None] | None = None) -> np.ndarray:
    """El audio del archivo en estéreo, 44,1 kHz, float32 (canales, muestras). Si no tiene audio, error claro."""
    info = ffmpeg.probe(src)
    streams = info.get("streams") or []
    if not any(s.get("codec_type") == "audio" for s in streams):
        raise JobError(NO_AUDIO, retry=False)
    duration = float((info.get("format") or {}).get("duration") or 0)
    if duration > MAX_SECONDS + 1:
        raise JobError(TOO_LONG, retry=False)
    ffmpeg.run(["-i", str(src), "-map", "0:a:0", "-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-t", str(MAX_SECONDS), "-f", "f32le", str(dest)], duration=duration or None, on_progress=on_progress, what="audio para separar")
    raw = np.fromfile(dest, dtype=np.float32)
    if raw.size < SAMPLE_RATE:  # menos de medio segundo
        raise JobError(NO_AUDIO, retry=False)
    return raw.reshape(-1, 2).T.copy()


def _window(n: int, overlap: int) -> np.ndarray:
    w = np.ones(n, dtype=np.float32)
    fade = np.linspace(0, 1, overlap, dtype=np.float32)
    w[:overlap] = fade
    w[-overlap:] = fade[::-1]
    return w


def separate(mix: np.ndarray, model: Path, *, run: Callable[[np.ndarray], np.ndarray] | None = None, check: Callable[[], None] = lambda: None, on_progress: Callable[[float], None] | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Separa `mix` (2, muestras) en (voz, resto). `run` reemplaza al modelo en las pruebas: recibe (1, 2, SEGMENT) y
    devuelve (1, 4, 2, SEGMENT) con batería, bajo, otros y voz."""
    if run is None:
        import onnxruntime as ort  # noqa: PLC0415

        opts = ort.SessionOptions()
        # Sin optimizar el grafo y sin la arena de memoria: con las optimizaciones el modelo ocupa más de 6 GB al cargar
        # (la máquina tiene 8 y el worker ya usa parte); así queda en ~1,4 GB de pico y tarda ~20 % más (medido).
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        session = ort.InferenceSession(str(model), sess_options=opts, providers=["CPUExecutionProvider"])

        def run(x: np.ndarray) -> np.ndarray:
            return session.run(["stems"], {"mix": x})[0]

    total = mix.shape[1]
    stride = SEGMENT - OVERLAP
    chunks = max(1, (total + stride - 1) // stride)
    window = _window(SEGMENT, OVERLAP)
    voice = np.zeros((2, total), dtype=np.float32)
    rest = np.zeros((2, total), dtype=np.float32)
    weight = np.zeros(total, dtype=np.float32)
    for i in range(chunks):
        check()
        start = i * stride
        end = min(start + SEGMENT, total)
        chunk = mix[:, start:end]
        if chunk.shape[1] < SEGMENT:
            chunk = np.pad(chunk, ((0, 0), (0, SEGMENT - chunk.shape[1])))
        stems = run(chunk[np.newaxis].astype(np.float32, copy=False))[0]
        n = end - start
        w = window[:n].copy()
        # Sin fundido en los bordes del audio (ahí no hay otro tramo que lo complete: quedaba en silencio).
        if i == 0:
            w[:OVERLAP] = 1.0
        if i == chunks - 1:
            w[OVERLAP if i > 0 else 0 :] = 1.0
        voice[:, start:end] += stems[3, :, :n] * w
        rest[:, start:end] += stems[:3, :, :n].sum(axis=0) * w
        weight[start:end] += w
        if on_progress:
            on_progress((i + 1) / chunks)
    weight = np.maximum(weight, 1e-8)
    return voice / weight, rest / weight


def rms_db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-9))


def encode_m4a(audio: np.ndarray, raw: Path, dest: Path) -> None:
    """La pista en M4A (AAC 192 kbps), con un tope de pico para que no sature."""
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.99:
        audio = audio * (0.99 / peak)
    audio.T.astype(np.float32).tofile(raw)
    ffmpeg.run(["-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", str(raw), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(dest)], what="pista sin voz")


def mark_failed(conn: psycopg.Connection, job: dict[str, Any], message: str) -> None:
    track_id = (job.get("input") or {}).get("trackId")
    if track_id:
        conn.execute(
            "UPDATE music_tracks SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s AND status = 'PROCESSING'",
            (message[:1000], track_id),
        )


@register("AUDIO_SPLIT", on_fail=mark_failed)
def split_audio(ctx: JobContext) -> dict[str, Any]:
    data = ctx.input
    track_id = str(data.get("trackId") or "")
    if not re.fullmatch(r"[0-9a-f-]{36}", track_id):
        raise JobError("Pista no válida.", retry=False)
    row = ctx.conn.execute("SELECT status, file_key, source_key FROM music_tracks WHERE id = %s", (track_id,)).fetchone()
    if not row:
        return {"skipped": "sin pista"}
    status, file_key, source_key = row["status"], row["file_key"], row["source_key"]
    if status != "PROCESSING":
        return {"skipped": status}
    model = model_path(ctx.config.models_dir)
    owner = {"trackId": track_id}
    workdir = ctx.config.work_dir / "separar" / track_id
    shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        ctx.stage("Bajando el video", 0.0, 0.15)
        if data.get("sourceKind") == "link":
            src = style_job.download_link(str(data.get("url") or ""), workdir, name="video", max_seconds=MAX_SECONDS)
        else:
            key = str(data.get("sourceKey") or source_key or "")
            if not key:
                raise JobError("No encontramos el archivo. Vuelve a subirlo.", retry=False)
            ext = Path(key).suffix.lower() if 1 < len(Path(key).suffix) <= 5 else ".mp4"
            src = ctx.app.download(None, key, workdir / f"original{ext}", ctx.progress, owner=owner)
        ctx.check()

        ctx.stage("Preparando el audio", 0.15, 0.2)
        mix = decode(src, workdir / "mezcla.f32", ctx.progress)
        seconds = mix.shape[1] / SAMPLE_RATE
        src.unlink(missing_ok=True)

        ctx.stage("Separando la voz de la música", 0.2, 0.9)
        voice, rest = separate(mix, model, check=ctx.check, on_progress=ctx.progress)
        del mix
        rest_db, voice_db = rms_db(rest), rms_db(voice)
        log.info("separada %.1f s: resto %.1f dBFS, voz %.1f dBFS", seconds, rest_db, voice_db)
        if rest_db < -50:
            raise JobError(SILENT_REST, retry=False)

        ctx.stage("Guardando la pista", 0.9, 1.0)
        out = workdir / "pista.m4a"
        encode_m4a(rest, workdir / "resto.f32", out)
        ctx.app.upload(None, file_key, out, "audio/mp4", owner=owner)
        result = ctx.app.music_result(track_id, {"duration": round(seconds, 2), "bytes": out.stat().st_size})
        return {"status": result.get("status"), "seconds": round(seconds, 1), "rest_db": round(rest_db, 1), "voice_db": round(voice_db, 1)}
    except (Cancelled, JobError):
        raise
    except subprocess.SubprocessError as exc:
        raise JobError("No pudimos leer el audio de ese archivo. Prueba con otro.", retry=False, detail=str(exc)[:300]) from exc
    finally:
        # El video y la voz no se guardan en el worker.
        shutil.rmtree(workdir, ignore_errors=True)
