"""Genera un "talking head" sintético para probar el Editor de punta a punta, sin red ni APIs.

    python scripts/make_test_video.py SALIDA_DIR [--size 1080x1920|1920x1080]

Deja en SALIDA_DIR:
- talking-head-<w>x<h>.mp4: fondo con movimiento, una "cara" que se mueve y una boca que se abre mientras habla,
  y el tiempo del original impreso en una esquina (sirve para verificar los cortes mirando cuadros).
- transcript.json: transcripción por palabra (como la daría un proveedor) para WORKER_TEST_TRANSCRIPT.
- guion.txt: el guion "limpio" que se quería decir.

El audio se arma con espeak-ng frase por frase; los tiempos de cada palabra salen de sintetizar cada palabra
sola y repartir la duración real de la frase en proporción. El guion incluye a propósito una toma repetida,
un arranque en falso, muletillas y silencios largos.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

RATE = 48000

# (texto, pausa después en segundos). Lo que el detector tiene que encontrar va comentado.
PHRASES: list[tuple[str, float]] = [
    ("Hoy te voy a contar el error", 0.45),  # toma fallida…
    ("no, perdón.", 0.8),
    ("Hoy te voy a contar el error que cometen casi todas las clínicas en la primera llamada.", 0.45),  # …y la buena
    ("Eh", 0.45),  # muletilla
    ("Contestan el teléfono y lo primero que hacen es dar el precio.", 1.7),  # silencio largo
    ("Esto es", 0.5),  # arranque en falso
    ("Esto es lo que funciona de verdad:", 0.3),
    ("primero preguntas qué le pasa y desde cuándo.", 0.45),
    ("Em", 0.45),  # muletilla
    ("Una clínica en Houston pasó de tres a seis citas por cada diez llamadas.", 0.6),
    ("¿Quieres el guion exacto? Comenta LLAMADA y te lo mando.", 0.8),
]

SCRIPT = (
    "Hoy te voy a contar el error que cometen casi todas las clínicas en la primera llamada. "
    "Contestan el teléfono y lo primero que hacen es dar el precio. "
    "Esto es lo que funciona de verdad: primero preguntas qué le pasa y desde cuándo. "
    "Una clínica en Houston pasó de tres a seis citas por cada diez llamadas. "
    "¿Quieres el guion exacto? Comenta LLAMADA y te lo mando."
)


def speak(text: str, out: Path) -> np.ndarray:
    subprocess.run(["espeak-ng", "-v", "es-419", "-s", "158", "-p", "45", "-w", str(out), text], check=True)
    raw = out.with_suffix(".48k.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(out), "-ar", str(RATE), "-ac", "1", str(raw)], check=True)
    with wave.open(str(raw), "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return trim(data)


def trim(x: np.ndarray, thresh: float = 0.01) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    return x[idx[0] : idx[-1] + 1] if len(idx) else x


def build(out_dir: Path, size: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    rng = np.random.default_rng(7)
    audio: list[np.ndarray] = [np.zeros(int(0.6 * RATE), dtype=np.float32)]
    t = 0.6
    words: list[dict] = []
    for p_i, (phrase, pause) in enumerate(PHRASES):
        pa = speak(phrase, tmp / f"p{p_i}.wav")
        tokens = phrase.split()
        lens = []
        for w_i, tok in enumerate(tokens):
            lens.append(max(0.08, len(speak(tok, tmp / f"p{p_i}w{w_i}.wav")) / RATE))
        dur = len(pa) / RATE
        scale = dur / sum(lens)
        cursor = t
        for tok, L in zip(tokens, lens):
            span = L * scale
            # Un proveedor real se equivoca un poco en los bordes: se agrega un error chico a propósito.
            jitter_a, jitter_b = rng.uniform(-0.03, 0.03), rng.uniform(-0.05, 0.02)
            words.append({"text": tok, "start": round(max(0, cursor + jitter_a), 3), "end": round(cursor + span * 0.92 + jitter_b, 3)})
            cursor += span
        audio.append(pa)
        audio.append(np.zeros(int(pause * RATE), dtype=np.float32))
        t += dur + pause
    audio.append(np.zeros(int(0.8 * RATE), dtype=np.float32))
    signal = np.concatenate(audio)
    # Ruido de sala suave y un poco de "aire".
    signal = signal * 0.7 + rng.normal(0, 0.003, len(signal)).astype(np.float32)
    total = len(signal) / RATE
    wav_path = tmp / "voice.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())

    width, height = (int(v) for v in size.split("x"))
    # Cara: elipse de piel con pelo y ojos, dibujada con numpy (RGBA) y convertida a PNG con ffmpeg.
    fw, fh = (int(min(width, height) * 0.42), int(min(width, height) * 0.56))
    yy, xx = np.mgrid[0:fh, 0:fw]
    cx, cy = fw / 2, fh / 2
    face = np.zeros((fh, fw, 4), dtype=np.uint8)
    inside = ((xx - cx) / (fw * 0.45)) ** 2 + ((yy - cy) / (fh * 0.47)) ** 2 <= 1
    face[inside] = [224, 172, 140, 255]
    hair = inside & (yy < fh * 0.28)
    face[hair] = [52, 34, 26, 255]
    for ex in (0.34, 0.66):
        eye = ((xx - fw * ex) / (fw * 0.06)) ** 2 + ((yy - fh * 0.42) / (fh * 0.035)) ** 2 <= 1
        face[eye] = [30, 30, 40, 255]
    (tmp / "face.rgba").write_bytes(face.tobytes())
    face_png = tmp / "face.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{fw}x{fh}", "-i", str(tmp / "face.rgba"), str(face_png)], check=True)

    talking = "+".join(f"between(t,{w['start']:.2f},{w['end']:.2f})" for w in words)
    mouth_w, mouth_h = int(fw * 0.28), int(fh * 0.07)
    face_y = int(height * 0.22) if height > width else int(height * 0.16)
    mouth_y = f"{face_y}+{int(fh * 0.70)}+6*sin(t*1.3)"
    font = Path(__file__).resolve().parent.parent / "fonts" / "Inter-Bold.ttf"
    graph = (
        f"[0:v]format=yuv420p[bg];"
        f"[bg][1:v]overlay=x='(W-w)/2+{int(width * 0.02)}*sin(t*0.7)':y='{face_y}+6*sin(t*1.3)'[f];"
        f"[f]drawbox=x='(iw-{mouth_w})/2+{int(width * 0.02)}*sin(t*0.7)':y='{mouth_y}':w={mouth_w}:h={mouth_h}:color=0x5a1e1e@1:t=fill:enable='{talking}',"
        f"drawtext=fontfile={font}:text='%{{pts\\:hms}}':x=(w-tw)/2:y=40:fontsize={int(height * 0.03)}:fontcolor=white@0.85:box=1:boxcolor=black@0.4:boxborderw=12[v]"
    )
    out = out_dir / f"talking-head-{width}x{height}.mp4"
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"gradients=s={width}x{height}:c0=0x1b2b55:c1=0x0a1530:c2=0x22406e:n=3:speed=0.015:d={total:.3f}:r=30",
            "-loop", "1", "-i", str(face_png),
            "-i", str(wav_path),
            "-filter_complex", graph,
            "-map", "[v]", "-map", "2:a",
            "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k",
            str(out),
        ],
        check=True,
    )
    (out_dir / "transcript.json").write_text(json.dumps({"words": words}, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "guion.txt").write_text(SCRIPT, encoding="utf-8")
    print(f"{out} · {total:.1f} s · {len(words)} palabras")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--size", default="1080x1920")
    args = parser.parse_args()
    build(args.out_dir, args.size)
