"""Genera un video de referencia sintético para probar "Edita como este" (estilos), sin red ni APIs.

    python scripts/make_style_reference.py SALIDA_DIR [--no-music] [--seconds-per-shot 2]

Deja en SALIDA_DIR:
- referencia.mp4 (1080×1920, 30 fps): 8 tomas de 2 s con cortes conocidos. Tomas con cara (foto de la
  astronauta Eileen Collins, NASA, dominio público) y tomas de b-roll sin cara (patrones de prueba). Una toma
  con zoom suave (1 → 1,25 en 1,5 s) y un punch-in (corte a la misma toma al 120 %). Subtítulos amarillos
  (#FFE600) en mayúsculas, 3 palabras por bloque, con borde negro, centrados al 78 % de la altura. Voz con
  espeak-ng y, salvo --no-music, una "música" de fondo (acorde suave) que suena también en las pausas.
- referencia.transcript.json: transcripción por palabra (para WORKER_TEST_STYLE_TRANSCRIPT).
- referencia.expected.json: lo que el análisis debería medir.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_test_video import RATE, speak  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FACE = HERE / "tests" / "fixtures" / "astronaut.jpg"
FONT = HERE / "fonts" / "Montserrat-ExtraBold.ttf"
W, H, FPS = 1080, 1920, 30

# F: cara · B: b-roll sin cara · Z: cara con zoom suave · P: punch-in de la toma anterior (misma cara al 120 %).
SHOTS = ["F", "B", "Z", "B", "F", "P", "B", "F"]
BROLL_SOURCES = ["testsrc2", "rgbtestsrc", "smptebars"]
CAPTION_COLOR = "FFE600"
CAPTION_SIZE = 64
CAPTION_Y = 0.78

PHRASES = [
    "Hoy te muestro cómo editar como un profesional.",
    "Primero cortas cada pausa larga.",
    "Después agregas zooms en los momentos clave.",
    "Y al final subtítulos grandes y amarillos.",
    "Comenta ESTILO y te mando la guía.",
]


def run(cmd: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *cmd], check=True)


def still(tmp: Path) -> Path:
    """Fondo azul con la foto de la cara arriba al centro (como un talking head)."""
    out = tmp / "face.png"
    run(["-f", "lavfi", "-i", f"color=c=0x1b2b55:s={W}x{H}", "-i", str(FACE), "-filter_complex", "[1:v]scale=900:900[f];[0:v][f]overlay=90:300", "-frames:v", "1", str(out)])
    return out


def shot(kind: str, index: int, seconds: float, face: Path, tmp: Path, broll_i: int) -> Path:
    out = tmp / f"shot{index}.mp4"
    frames = int(round(seconds * FPS))
    enc = ["-frames:v", str(frames), "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(out)]
    if kind == "F":
        run(["-loop", "1", "-i", str(face), "-vf", f"noise=alls=4:allf=t,fps={FPS}", *enc])
    elif kind == "P":
        run(["-loop", "1", "-i", str(face), "-vf", f"crop=iw/1.2:ih/1.2,scale={W}:{H},noise=alls=4:allf=t,fps={FPS}", *enc])
    elif kind == "Z":
        ramp = int(1.5 * FPS)
        # Zoom suave hacia el centro: de 1 a 1,25 en 1,5 s y se queda (sobre una versión 2× para que no tiemble).
        z = f"1+0.25*min(on\\,{ramp})/{ramp}"
        run(["-i", str(face), "-vf", f"scale={W * 2}:{H * 2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS}", *enc])
    else:
        src = BROLL_SOURCES[broll_i % len(BROLL_SOURCES)]
        size = f"s={W}x{H}" if src != "smptebars" else f"s={W}x{H}"
        run(["-f", "lavfi", "-i", f"{src}={size}:r={FPS}", "-t", f"{seconds:.3f}", *enc])
    return out


def voice(tmp: Path, total: float, music: bool) -> tuple[Path, list[dict]]:
    """Voz frase por frase con pausas y tiempos por palabra (igual que make_test_video), más música opcional."""
    rng = np.random.default_rng(3)
    chunks: list[np.ndarray] = [np.zeros(int(0.35 * RATE), dtype=np.float32)]
    t = 0.35
    words: list[dict] = []
    for p_i, phrase in enumerate(PHRASES):
        pa = speak(phrase, tmp / f"p{p_i}.wav")
        tokens = phrase.split()
        lens = [max(0.08, len(speak(tok, tmp / f"p{p_i}w{w_i}.wav")) / RATE) for w_i, tok in enumerate(tokens)]
        dur = len(pa) / RATE
        scale = dur / sum(lens)
        cursor = t
        for tok, length in zip(tokens, lens):
            span = length * scale
            words.append({"text": tok, "start": round(cursor, 3), "end": round(cursor + span * 0.92, 3)})
            cursor += span
        pause = 0.55
        chunks += [pa, np.zeros(int(pause * RATE), dtype=np.float32)]
        t += dur + pause
    signal = np.concatenate(chunks)
    n = int(total * RATE)
    signal = np.pad(signal, (0, max(0, n - len(signal))))[:n] * 0.8
    if music:
        tt = np.arange(n) / RATE
        chord = sum(np.sin(2 * np.pi * f * tt) for f in (220.0, 277.18, 329.63)) / 3
        signal = signal + 0.05 * chord.astype(np.float32)  # unos -26 dBFS bajo la voz
    signal = signal + rng.normal(0, 0.002, n).astype(np.float32)
    path = tmp / "audio.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())
    return path, [w for w in words if w["end"] <= total]


def caption_filters(words: list[dict]) -> str:
    """Bloques de 3 palabras en mayúsculas, amarillos con borde negro, centrados al 78 % de la altura."""
    parts = []
    for i in range(0, len(words), 3):
        block = words[i : i + 3]
        text = " ".join(w["text"] for w in block).upper().replace("'", "").replace(":", "").replace(",", "").replace(".", "")
        start = block[0]["start"]
        end = words[i + 3]["start"] if i + 3 < len(words) else block[-1]["end"] + 0.3
        parts.append(
            f"drawtext=fontfile={FONT}:text='{text}':fontsize={CAPTION_SIZE}:fontcolor=0x{CAPTION_COLOR}:borderw=6:bordercolor=black:"
            f"x=(w-tw)/2:y={CAPTION_Y}*h-th/2:enable='between(t,{start:.3f},{end:.3f})'"
        )
    return ",".join(parts)


def build(out_dir: Path, seconds_per_shot: float = 2.0, music: bool = True) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    face = still(tmp)
    broll_i = 0
    paths = []
    for i, kind in enumerate(SHOTS):
        paths.append(shot(kind, i, seconds_per_shot, face, tmp, broll_i))
        if kind == "B":
            broll_i += 1
    listing = tmp / "list.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in paths))
    joined = tmp / "joined.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])
    total = len(SHOTS) * seconds_per_shot
    audio, words = voice(tmp, total, music)
    out = out_dir / "referencia.mp4"
    run(["-i", str(joined), "-i", str(audio), "-vf", caption_filters(words), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", str(out)])
    (out_dir / "referencia.transcript.json").write_text(json.dumps({"words": words}, ensure_ascii=False, indent=1), encoding="utf-8")
    broll = sum(1 for k in SHOTS if k == "B")
    expected = {
        "duration": total,
        "cuts": [round(seconds_per_shot * i, 3) for i in range(1, len(SHOTS))],
        "punchIns": 1,
        "smoothZooms": 1,
        "brollShots": broll,
        "brollRatio": broll / len(SHOTS),
        "caption": {"color": f"#{CAPTION_COLOR}", "position": CAPTION_Y, "size": CAPTION_SIZE / H, "uppercase": True, "wordsPerBlock": 3, "box": False},
        "music": music,
        "words": len(words),
    }
    (out_dir / "referencia.expected.json").write_text(json.dumps(expected, indent=1), encoding="utf-8")
    print(f"{out} · {total:.0f} s · {len(words)} palabras")
    return expected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--no-music", action="store_true")
    parser.add_argument("--seconds-per-shot", type=float, default=2.0)
    args = parser.parse_args()
    build(args.out_dir, args.seconds_per_shot, not args.no_music)
