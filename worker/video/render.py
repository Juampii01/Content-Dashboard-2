"""Render del video final a partir del timeline que arma la app.

1. Tramos: cada tramo se codifica por separado desde el mezzanine con `-ss` exacto y una cantidad fija de cuadros.
   El audio sale del WAV con el mismo inicio y exactamente 1600 muestras por cuadro (48 000 / 30): audio y video
   miden lo mismo en cada tramo, así no hay desfase acumulado. Fundido de 10 ms en cada borde (sin clics).
   Los tramos se guardan con un nombre que depende de sus cuadros: un segundo render reutiliza los que no cambiaron.
2. Unión con el demuxer concat (sin recodificar; el audio va en PCM, que no agrega relleno entre tramos).
3. Audio: con "Audio de estudio" (Suave o Fuerte), ruido y eco fuera con DeepFilterNet3 (`studio.py`) y después
   ecualización de voz, de-esser y compresión; apagado (y en los planes de antes), la cadena de siempre (pasa altos
   80 Hz, reducción de ruido de ffmpeg, +2 dB entre 3 y 5 kHz, de-esser, compresor 3:1). Luego ganancia y
   limitador, medición con `loudnorm` y ganancia final exacta a -14 LUFS con techo de -1,5 dBFS (solo ganancia,
   sin "bombeo"). El retraso que
   agregan los filtros (afftdn corre la voz 25 ms) se mide y se compensa: la voz queda alineada con el video.
4. Video final: reencuadre (16:9 → 9:16 con recorte estático y ajuste horizontal), subtítulos ASS y
   H.264 High, yuv420p, 30 fps, CRF 18, BT.709, AAC 48 kHz 192k, `+faststart`.
5. Control de calidad: duración, tamaño, cuadros por segundo, sonoridad y sincronía.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from comunes import ffmpeg
from comunes.errors import JobError

from . import broll_edit, studio

log = logging.getLogger("worker.render")

FPS = 30
SAMPLE_RATE = 48000
SAMPLES_PER_FRAME = SAMPLE_RATE // FPS  # 1600
FADE = 0.010

OUTPUT_SIZE = {"9:16": (1080, 1920), "16:9": (1920, 1080)}

# Cadena de voz (antes de la normalización). La música y los efectos se suman después (mix_audio).
# Audio de estudio apagado (y planes de antes): la de siempre, con la reducción de ruido de ffmpeg.
VOICE_CHAIN = [
    "highpass=f=80",
    "afftdn=nr=10:nf=-30:tn=1",
    "equalizer=f=4000:t=o:w=1:g=2",
    "deesser=i=0.4:m=0.5:f=0.5",
    "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=1",
]
# Audio de estudio: el ruido y el eco ya los quitó studio.enhance, así que aquí no se reduce ruido otra vez. Corte de
# graves (rumor, golpes en la mesa), menos "caja" de habitación en 250 Hz, presencia en 3,5 kHz, un poco de aire
# arriba de 10 kHz, de-esser (después del realce, que es donde las eses suben) y compresión.
STUDIO_CHAINS = {
    "soft": [
        "highpass=f=80",
        "equalizer=f=250:t=q:w=1:g=-2",
        "equalizer=f=3500:t=q:w=0.9:g=2",
        "highshelf=f=10000:g=1.5",
        "deesser=i=0.4:m=0.5:f=0.5",
        "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=1",
    ],
    "strong": [
        "highpass=f=90",
        "equalizer=f=250:t=q:w=1:g=-3",
        "equalizer=f=3500:t=q:w=0.9:g=3",
        "highshelf=f=10000:g=2",
        "deesser=i=0.5:m=0.5:f=0.5",
        "acompressor=threshold=-22dB:ratio=4:attack=6:release=100:makeup=1",
    ],
}


def voice_chain(level: str = "off") -> list[str]:
    return list(STUDIO_CHAINS.get(level, VOICE_CHAIN))


@functools.lru_cache(maxsize=16)
def chain_latency(chain: tuple[str, ...]) -> int:
    """Retraso (muestras a 48 kHz) que agrega una cadena de filtros, medido con una señal de prueba: ráfagas de ruido
    con silencios entre medio, correlación cruzada entre la entrada y la salida (hasta 100 ms). Depende de la versión de
    ffmpeg (por eso se mide y no se fija a mano); se mide una vez por proceso."""
    import numpy as np

    rng = np.random.default_rng(1)
    n = int(2.5 * SAMPLE_RATE)
    probe = np.zeros(n, dtype=np.float32)
    for k in range(5):
        a = int((0.2 + k * 0.45) * SAMPLE_RATE)
        probe[a : a + int(0.25 * SAMPLE_RATE)] = rng.standard_normal(int(0.25 * SAMPLE_RATE)).astype(np.float32) * 0.1
    with tempfile.TemporaryDirectory(prefix="latencia-") as tmp:
        src, dst = Path(tmp) / "in.wav", Path(tmp) / "out.wav"
        studio.write_wav(src, probe)
        ffmpeg.run(["-i", str(src), "-af", ",".join(chain) or "anull", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_f32le", str(dst)], what="medición de retraso")
        out = studio.read_audio(dst)
    m = min(len(out), n)
    corr = np.fft.irfft(np.fft.rfft(out[:m], 2 * m) * np.conj(np.fft.rfft(probe[:m], 2 * m)))
    window = int(0.1 * SAMPLE_RATE)
    lag = int(np.argmax(np.abs(corr[: window + 1])))
    return lag if lag > 1 else 0


def aligned_chain(chain: list[str]) -> list[str]:
    """La cadena con su retraso compensado: se descartan las primeras muestras y se rellena el final (mismo largo)."""
    lag = chain_latency(tuple(chain))
    if not lag:
        return chain
    return [*chain, f"atrim=start_sample={lag}", "asetpts=PTS-STARTPTS", f"apad=pad_len={lag}"]


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


def process_audio(src: Path, out: Path, target: float = -14.0, tp: float = -1.0, studio_level: str = "off", models_dir: Path | None = None) -> dict[str, Any]:
    """Audio de estudio (si está encendido) y tres pasadas cortas (solo audio): ganancia previa + limitador, medición y
    normalización lineal. La salida queda alineada muestra a muestra con `src`."""
    level = studio.level_of(studio_level)
    studio_info: dict[str, Any] | None = None
    if level != "off":
        if models_dir is not None and studio.model_available(models_dir):
            clean = out.with_name(f"{out.stem}-estudio.wav")
            studio_info = studio.enhance(src, clean, level, models_dir)
            src = clean
        else:
            # Sin el modelo (solo pasa en desarrollo): el video sale con el procesado de siempre, y queda anotado.
            log.warning("audio de estudio %s sin el modelo en %s: se usa la cadena de siempre", level, models_dir)
            studio_info = {"level": level, "applied": False, "reason": "sin modelo"}
            level = "off"
    chain = voice_chain(level)
    if studio_info and studio_info.get("hum"):
        chain = [*studio.hum_filters(studio_info["hum"]), *chain]
    voice = aligned_chain(chain)
    first = measure(src, voice, target, tp)
    measured_i = float(first["input_i"])
    if measured_i < -60:
        raise JobError("El audio está prácticamente en silencio. Revisa que el micrófono haya grabado.", retry=False, detail=f"input_i {measured_i}")
    # Ganancia para llegar cerca del objetivo y limitador a -2.5 dBFS: después loudnorm solo ajusta en modo lineal.
    # El limitador baja un poco la sonoridad (~1 dB) y la pasada final la recupera: con el techo en -1.5 dBFS no
    # quedaba lugar para esa ganancia sin pasar el pico de -1 dBTP y loudnorm caía al modo dinámico (con "bombeo").
    gain = max(-20.0, min(30.0, target - measured_i))
    # latency=1: el limitador mira 5 ms adelante y lo compensa (sin eso, la voz se corría 5 ms respecto del video).
    chain = [*voice, f"volume={gain:.2f}dB", "alimiter=limit=0.75:attack=5:release=60:level=disabled:latency=1"]
    second = measure(src, chain, target, tp)
    # Ganancia final exacta (lo que haría loudnorm en modo lineal) y un limitador a -1,5 dBFS (≈ -1 dBTP) que solo
    # toca algún pico suelto. loudnorm con linear=true caía al modo dinámico (con "bombeo") casi siempre: le
    # alcanzaba con que la ganancia final llevara el pico verdadero medido apenas por encima de -1 dBTP.
    final_gain = max(-10.0, min(10.0, target - float(second["input_i"])))
    tmp = _atomic(out)
    for attempt in range(2):
        ffmpeg.run(
            [
                "-i", str(src), "-map", "0:a:0",
                "-af", ",".join([*chain, f"volume={final_gain:.2f}dB", "alimiter=limit=0.84:attack=5:release=60:level=disabled:latency=1", f"aresample={SAMPLE_RATE}"]),
                "-ac", "1", "-c:a", "pcm_s16le", str(tmp),
            ],
            what="mezcla de audio",
        )
        # El limitador puede comerse unas décimas de sonoridad: si quedó lejos del objetivo, una vuelta más corregida.
        got, _peak = loudness(tmp)
        if attempt or not (got == got) or abs(got - target) <= 0.25:
            break
        final_gain = max(-10.0, min(10.0, final_gain + (target - got)))
    os.replace(tmp, out)
    if studio_info and studio_info.get("applied"):
        clean.unlink(missing_ok=True)
    return {"gain": round(gain + final_gain, 2), "normalization": "linear", "input_i": measured_i, **({"studio": studio_info} if studio_info else {})}


# Efectos de sonido (worker/assets/sfx, generados con scripts/make_sfx.py) y música de fondo bajo la voz.
SFX_DIR = Path(__file__).resolve().parent.parent / "assets" / "sfx"
# Los 40 de la biblioteca (lib/video/sfx-library.ts; las pruebas comparan las dos listas).
SFX_NAMES = (
    "whoosh",
    "whoosh_soft",
    "swipe",
    "swipe_up",
    "swish",
    "air",
    "riser",
    "riser_long",
    "downlifter",
    "reverse_hit",
    "impact",
    "boom",
    "thud",
    "punch",
    "slam",
    "sub_drop",
    "pop",
    "pop_soft",
    "click",
    "tap",
    "ding",
    "ding_double",
    "notification",
    "success",
    "error",
    "typing",
    "switch",
    "bubble",
    "glitch",
    "glitch_soft",
    "digital",
    "camera",
    "shimmer",
    "sparkle",
    "magic",
    "coin",
    "cash",
    "heartbeat",
    "tick",
    "record_scratch",
)
# Ducking: con la voz a -14 LUFS (≈ -17 dBFS RMS al hablar) la música baja unos 9 dB mientras hablas y vuelve en
# las pausas (ataque 20 ms, salida 450 ms: sin "bombeo" entre palabras).
DUCKING = "sidechaincompress=threshold=0.04:ratio=2:attack=20:release=450:knee=4:makeup=1"
MUSIC_FADE_IN = 0.8
MUSIC_FADE_OUT = 1.5


def mix_audio(
    voice: Path,
    out: Path,
    duration: float,
    sfx: list[dict[str, Any]] | None = None,
    music: Path | None = None,
    music_db: float = -16.0,
    target: float = -14.0,
    sfx_dir: Path = SFX_DIR,
) -> dict[str, Any]:
    """Voz (ya normalizada) + efectos + música con ducking. La voz no se toca: los efectos y la música van debajo.

    `sfx`: [{"name": uno de SFX_NAMES, "at": segundos del inicio del archivo, "gain": dB}].
    `music_db`: sonoridad de la música respecto del objetivo de la voz (la pista se mide y se lleva a target + db).
    El resultado pasa por un limitador a -1 dBFS que la voz sola no activa (los efectos no pueden recortar).
    """
    cues = [c for c in sfx or [] if c.get("name") in SFX_NAMES and 0 <= float(c.get("at", -1)) < duration][:60]
    inputs: list[str] = ["-i", str(voice)]
    parts: list[str] = [f"[0:a]aformat=sample_rates={SAMPLE_RATE}:channel_layouts=mono,apad,atrim=0:{duration:.6f}" + (",asplit=2[voice][key]" if music else "[voice]")]
    mix = ["[voice]"]
    names = sorted({c["name"] for c in cues})
    for j, name in enumerate(names):
        mine = [c for c in cues if c["name"] == name]
        inputs += ["-i", str(sfx_dir / f"{name}.wav")]
        idx = 1 + j
        labels = [f"[{name}{k}]" for k in range(len(mine))]
        parts.append(f"[{idx}:a]aformat=sample_rates={SAMPLE_RATE}:channel_layouts=mono" + (f",asplit={len(mine)}" if len(mine) > 1 else "") + "".join(labels))
        for k, c in enumerate(mine):
            delay = round(float(c["at"]) * 1000)
            gain = max(-40.0, min(0.0, float(c.get("gain", -16))))
            parts.append(f"{labels[k]}volume={gain:.1f}dB,adelay={delay}:all=1[{name}d{k}]")
            mix.append(f"[{name}d{k}]")
    music_info: dict[str, Any] | None = None
    if music:
        try:
            measured = measure(music, [], -23.0, -1.0)
        except JobError as exc:
            raise JobError("No pudimos leer la música elegida. Súbela de nuevo (MP3 o M4A) o quítala en la revisión.", retry=False, detail=str(exc)) from exc
        music_i = float(measured["input_i"])
        if music_i < -60:
            raise JobError("La música elegida está en silencio. Elige otra pista en la revisión.", retry=False, detail=f"input_i {music_i}")
        gain = max(-40.0, min(20.0, target + music_db - music_i))
        idx = 1 + len(names)
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        fade_out = max(0.0, duration - MUSIC_FADE_OUT)
        parts.append(
            f"[{idx}:a]aformat=sample_rates={SAMPLE_RATE}:channel_layouts=mono,atrim=0:{duration:.6f},asetpts=PTS-STARTPTS,volume={gain:.2f}dB,"
            f"afade=t=in:d={MUSIC_FADE_IN},afade=t=out:st={fade_out:.3f}:d={MUSIC_FADE_OUT}[music]"
        )
        parts.append(f"[music][key]{DUCKING}[ducked]")
        mix.append("[ducked]")
        music_info = {"input_i": music_i, "gain": round(gain, 2), "db": music_db}
    if len(mix) == 1:
        parts.append("[voice]anull[mixed]")
    else:
        parts.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0:dropout_transition=0[mixed]")
    # Limitador al techo de la voz (-1 dBFS, el pico que deja loudnorm): la voz sola nunca lo toca, solo actúa si un
    # efecto o la música suman por encima. latency=1: mira 5 ms adelante y lo compensa (la mezcla no se corre).
    parts.append("[mixed]alimiter=limit=0.891:attack=5:release=60:level=disabled:latency=1[a]")
    tmp = _atomic(out)
    ffmpeg.run([*inputs, "-filter_complex", ";".join(parts), "-map", "[a]", "-t", f"{duration:.6f}", "-ac", "1", "-c:a", "pcm_s16le", str(tmp)], what="mezcla de música y efectos")
    os.replace(tmp, out)
    return {"sfx": len(cues), "music": music_info}


# ─── 4. Video final ────────────────────────────────────────────────────────


MAX_ZOOM = 1.35
BROLL_FADE = 0.2


def zoom_expr(zooms: list[dict[str, Any]]) -> str | None:
    """Expresión de zoom por tiempo de entrada (`it`) para zoompan: 1 fuera de los tramos y la escala de cada tramo
    dentro, con una rampa corta al entrar (suave) o de golpe (punch-in en un corte). Los tramos no se superponen."""
    terms = []
    last_end = -1.0
    for z in sorted(zooms, key=lambda z: float(z["start"]))[:40]:
        start, end = float(z["start"]), float(z["end"])
        scale = max(1.0, min(MAX_ZOOM, float(z.get("scale", 1.1))))
        ramp = max(0.0, min(1.0, float(z.get("ramp", 0.0))))
        if end - start < 0.2 or scale <= 1.001 or start < last_end:
            continue
        last_end = end
        amount = f"{scale - 1:.4f}"
        if ramp > 0:
            terms.append(f"gte(it,{start:.3f})*lt(it,{end:.3f})*{amount}*min(1,(it-{start:.3f})/{ramp:.3f})")
        else:
            # Medio abierto [inicio, fin): dos punch-ins pegados (1,15 → 1,3) no se suman en el cuadro del cambio.
            terms.append(f"gte(it,{start:.3f})*lt(it,{end:.3f})*{amount}")
    return f"1+{'+'.join(terms)}" if terms else None


def prepare_broll(src: Path, out: Path, duration: float, size: tuple[int, int], offset: float = 0.0, edit: dict[str, Any] | None = None) -> Path:
    """Clip de b-roll listo para superponer, con la duración exacta del tramo (si el clip es más corto, se repite),
    30 fps y sin audio. Sin edición: a pantalla completa (`size`), recortado al centro, como siempre.

    Con la edición de la revisión (`edit`, ver `broll_edit.py`): al tamaño de su marco (`edit.box`), con el encuadre
    (zoom y recorte corrido), el look (LUT 3D) y el zoom de entrada. Una tarjeta sale como capa con alfa (esquinas
    redondeadas, sombra y borde) en MKV con FFV1; el resto, en H.264. Devuelve la ruta del archivo (la extensión puede
    cambiar a .mkv)."""
    card = edit.get("card") if edit and edit.get("layout") == "card" else None
    if card:
        out = out.with_suffix(".mkv")
    if out.exists() and out.stat().st_size > 0:
        return out
    if edit and edit.get("box"):
        bw, bh = int(edit["box"]["w"]), int(edit["box"]["h"])
    else:
        bw, bh = size
    frames = max(1, int(round(duration * FPS)))
    info = ffmpeg.probe(src)
    clip_dur = float(info.get("format", {}).get("duration") or 0)
    vstream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    src_w, src_h = int(vstream.get("width") or 0), int(vstream.get("height") or 0)
    rotation = abs(int(float((vstream.get("tags") or {}).get("rotate") or 0))) % 180
    if rotation == 90:
        src_w, src_h = src_h, src_w
    offset = max(0.0, min(offset, max(0.0, clip_dur - duration))) if clip_dur else 0.0
    loop = ["-stream_loop", "-1"] if clip_dur and clip_dur - offset < duration else []
    sw, sh, cx, cy = broll_edit.frame_crop(src_w, src_h, bw, bh, (edit or {}).get("frame"))
    chain = [f"scale={sw}:{sh}:flags=lanczos", f"crop={bw}:{bh}:{cx}:{cy}", f"fps={FPS}", "setsar=1"]
    zoom = broll_edit.zoom_filter((edit or {}).get("zoom"), bw, bh)
    if zoom:
        chain.append(zoom)
    color = (edit or {}).get("color")
    if broll_edit.is_finite_matrix(color):
        cube = broll_edit.write_cube(color, out.parent / broll_edit.lut_name(color))
        chain.append(f"lut3d=file='{cube}':interp=trilinear")
    tmp = _atomic(out)
    if card:
        mask, shadow, border, pad = broll_edit.card_assets(card, bw, bh, out.parent)
        graph = (
            f"[0:v]{','.join(chain)},format=rgba[c];[1:v]format=gray[m];[c][m]alphamerge[cm];"
            f"[2:v]format=rgba[sh];[sh][cm]overlay={pad}:{pad}:format=auto[s];[s][3:v]overlay=0:0:format=auto,format=yuva420p[v]"
        )
        ffmpeg.run(
            [
                *loop, "-ss", f"{offset:.3f}", "-i", str(src),
                "-loop", "1", "-i", str(mask), "-loop", "1", "-i", str(shadow), "-loop", "1", "-i", str(border),
                "-filter_complex", graph, "-map", "[v]", "-an",
                "-frames:v", str(frames), "-r", str(FPS),
                "-c:v", "ffv1", "-level", "3", "-pix_fmt", "yuva420p",
                str(tmp),
            ],
            what="b-roll",
        )
    else:
        ffmpeg.run(
            [
                *loop, "-ss", f"{offset:.3f}", "-i", str(src),
                "-an", "-map", "0:v:0",
                "-vf", ",".join([*chain, "format=yuv420p"]) if edit else f"scale={bw}:{bh}:force_original_aspect_ratio=increase:flags=lanczos,crop={bw}:{bh},fps={FPS},setsar=1,format=yuv420p",
                "-frames:v", str(frames),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", str(FPS),
                str(tmp),
            ],
            what="b-roll",
        )
    os.replace(tmp, out)
    return out


def framing_graph(
    src_w: int,
    src_h: int,
    fmt: str,
    offset_x: float,
    ass: Path | None,
    fonts_dir: Path,
    zooms: list[dict[str, Any]] | None = None,
    focus_y: float = 0.42,
    broll: list[dict[str, Any]] | None = None,
    stickers: list[dict[str, Any]] | None = None,
) -> tuple[str, int, int]:
    """Grafo del video final. `broll`: [{"input": índice de la entrada de ffmpeg, "start", "end", "edit"?}] en segundos del
    final; `edit` (de la app) trae la ubicación, la persona en pantalla dividida, la opacidad y el fundido."""
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
    expr = zoom_expr(zooms or [])
    if expr:
        # Zoom hacia la cara (centro horizontal, `focus_y` vertical). Con d=1 cada cuadro entra y sale una vez.
        fy = max(0.2, min(0.8, focus_y))
        graph += (
            f",zoompan=z='{expr}':x='iw/2-iw/zoom/2':y='max(0,min(ih-ih/zoom,ih*{fy:.3f}-ih/zoom/2))'"
            f":d=1:s={out_w}x{out_h}:fps={FPS}"
        )
    label = "base"
    graph += f"[{label}]"
    for i, b in enumerate(broll or []):
        start, end = float(b["start"]), float(b["end"])
        dur = end - start
        edit = b.get("edit")
        fade_in, fade_out = broll_edit.fades_of(edit, dur, BROLL_FADE)
        opacity = broll_edit.opacity_of(edit)
        on = f"enable='between(t,{start:.3f},{end:.3f})'"
        person = (edit or {}).get("person")
        if person:
            # Pantalla dividida o a un lado: la persona pasa a su mitad (un corte) y el resto queda con el fondo de la marca.
            f, t = person["from"], person["to"]
            graph += (
                f";[{label}]split[pa{i}][pb{i}];[pa{i}]drawbox=x=0:y=0:w=iw:h=ih:color={broll_edit.ground_hex(edit.get('ground'))}@1:t=fill:{on}[pg{i}];"
                f"[pb{i}]crop={int(f['w'])}:{int(f['h'])}:{int(f['x'])}:{int(f['y'])}[pc{i}];"
                f"[pg{i}][pc{i}]overlay={int(t['x'])}:{int(t['y'])}:{on}[ps{i}]"
            )
            label = f"ps{i}"
        clip = f"br{i}"
        steps = ["format=yuva420p"]
        if opacity < 0.999:
            steps.append(f"lutyuv=a='val*{opacity:.3f}'")
        if fade_in > 0:
            steps.append(f"fade=t=in:st=0:d={fade_in:.3f}:alpha=1")
        if fade_out > 0:
            steps.append(f"fade=t=out:st={max(0.0, dur - fade_out):.3f}:d={fade_out:.3f}:alpha=1")
        steps.append(f"setpts=PTS-STARTPTS+{start:.3f}/TB")
        graph += f";[{int(b['input'])}:v]{','.join(steps)}[{clip}]"
        x, y = broll_edit.placement(edit)
        nxt = f"ov{i}"
        graph += f";[{label}][{clip}]overlay=x={x}:y={y}:eof_action=pass:{on}[{nxt}]"
        label = nxt
    graph += f";[{label}]"
    if ass:
        graph += f"ass=filename={ass}:fontsdir={fonts_dir},"
    if stickers:
        # Emojis de los subtítulos (PNG con alfa, entradas con -loop 1): encima del texto, con su fundido de entrada.
        graph += "format=yuv420p[subs]"
        label = "subs"
        for i, st in enumerate(stickers):
            size = max(8, int(round(float(st["size"]) / 2)) * 2)
            start, end = float(st["start"]), float(st["end"])
            fade = max(0.0, float(st.get("fadeIn") or 0))
            graph += (
                f";[{int(st['input'])}:v]trim=duration={max(0.05, end - start):.3f},setpts=PTS-STARTPTS+{start:.3f}/TB,"
                f"scale={size}:{size}:flags=lanczos,format=rgba" + (f",fade=t=in:st={start:.3f}:d={fade:.3f}:alpha=1" if fade > 0 else "") + f"[em{i}]"
            )
            graph += f";[{label}][em{i}]overlay=x={float(st['x']):.1f}:y={float(st['y']):.1f}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[eo{i}]"
            label = f"eo{i}"
        graph += f";[{label}]"
    graph += "format=yuv420p[v]"
    return graph, out_w, out_h


def final_encode(
    video: Path,
    audio: Path,
    graph: str,
    duration: float,
    out: Path,
    preset: str,
    on_progress: Callable[[float], None],
    extra_inputs: list[Path] | None = None,
    image_inputs: list[Path] | None = None,
) -> None:
    """`extra_inputs` (b-roll) van como entradas 2…; `image_inputs` (emojis, en bucle) a continuación."""
    tmp = _atomic(out)
    extra = [arg for p in extra_inputs or [] for arg in ("-i", str(p))]
    extra += [arg for p in image_inputs or [] for arg in ("-loop", "1", "-framerate", str(FPS), "-i", str(p))]
    ffmpeg.run(
        [
            "-i", str(video), "-i", str(audio), *extra,
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
