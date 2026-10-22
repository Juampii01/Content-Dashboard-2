"""Genera un anuncio sintético con varias escenas para probar el director de edición de punta a punta (sin red).

    python scripts/make_director_video.py SALIDA_DIR [--size 1080x1920]

Escenas (cada frase tiene la suya):
- Persona hablando a cámara (una foto real con cara, para que YuNet la detecte) con el gancho.
- Un "producto": el panel de una app en pantalla, con texto quemado ("PANEL FM ADS") y sin cara. No se puede tapar.
- Una toma mala: la persona fuera de cuadro y borrosa, con un arranque en falso.
- Una toma repetida (la misma frase dos veces).
- El llamado a la acción al final, con un texto quemado abajo ("COMENTA PANEL").

Deja `anuncio-<w>x<h>.mp4`, `transcript.json` (para WORKER_TEST_TRANSCRIPT) y `escenas.json` (qué hay en cada tramo,
para verificar el resultado mirando cuadros). La hora del original va impresa arriba a la izquierda.
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
FPS = 30
HERE = Path(__file__).resolve().parent.parent

# (texto, pausa después, escena)
PHRASES: list[tuple[str, float, str]] = [
    ("¿Sabías que el ochenta por ciento de los anuncios pierde plata en los primeros tres segundos?", 0.5, "talk"),
    ("Hoy te muestro cómo lo arreglamos.", 0.6, "talk"),
    ("Mira, este es el panel: aquí ves cada anuncio con su costo por cliente.", 0.5, "product"),
    ("Y esto, eh, esto no", 0.9, "bad"),
    ("Y esto es lo que cambia todo: el panel te dice qué anuncio apagar.", 0.5, "talk"),
    ("Con esto bajamos el costo por cliente de cuarenta a doce dólares.", 0.6, "talk"),
    ("Con esto bajamos el costo por cliente de cuarenta a doce dólares.", 0.6, "talk"),
    ("Comenta PANEL y te mando el acceso gratis.", 1.0, "cta"),
]


def speak(text: str, out: Path) -> np.ndarray:
    subprocess.run(["espeak-ng", "-v", "es-419", "-s", "165", "-p", "45", "-w", str(out), text], check=True)
    raw = out.with_suffix(".48k.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(out), "-ar", str(RATE), "-ac", "1", str(raw)], check=True)
    with wave.open(str(raw), "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    idx = np.where(np.abs(data) > 0.01)[0]
    return data[idx[0] : idx[-1] + 1] if len(idx) else data


def build(out_dir: Path, size: str) -> None:
    import cv2

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    rng = np.random.default_rng(3)
    audio: list[np.ndarray] = [np.zeros(int(0.4 * RATE), dtype=np.float32)]
    t = 0.4
    words: list[dict] = []
    spans: list[tuple[float, float, str]] = []
    for p_i, (phrase, pause, scene) in enumerate(PHRASES):
        pa = speak(phrase, tmp / f"p{p_i}.wav")
        tokens = phrase.split()
        lens = [max(0.08, len(speak(tok, tmp / f"p{p_i}w{w_i}.wav")) / RATE) for w_i, tok in enumerate(tokens)]
        dur = len(pa) / RATE
        scale = dur / sum(lens)
        cursor = t
        for tok, length in zip(tokens, lens):
            span = length * scale
            words.append({"text": tok, "start": round(max(0, cursor + rng.uniform(-0.02, 0.02)), 3), "end": round(cursor + span * 0.92, 3)})
            cursor += span
        spans.append((t - (0.4 if p_i == 0 else PHRASES[p_i - 1][1] / 2), t + dur + pause / 2, scene))
        audio.append(pa)
        audio.append(np.zeros(int(pause * RATE), dtype=np.float32))
        t += dur + pause
    signal = np.concatenate(audio) * 0.7 + rng.normal(0, 0.003, sum(len(a) for a in audio)).astype(np.float32)
    total = len(signal) / RATE
    spans[-1] = (spans[-1][0], total, spans[-1][2])
    wav_path = tmp / "voice.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())

    width, height = (int(v) for v in size.split("x"))
    photo = cv2.imread(str(HERE / "tests" / "fixtures" / "astronaut.jpg"))
    side = int(min(width, height) * 0.9)
    photo = cv2.resize(photo, (side, side), interpolation=cv2.INTER_CUBIC)
    yy = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    bg = (np.array([60, 30, 14], np.float32) * (1 - yy) + np.array([110, 64, 30], np.float32) * yy).repeat(width, axis=1).astype(np.uint8)

    def talk(k: int, offset_x: int = 0) -> np.ndarray:
        img = bg.copy()
        x = (width - side) // 2 + int(10 * np.sin(k / 20)) + offset_x
        y = int(height * 0.18) + int(6 * np.sin(k / 13))
        x0, x1 = max(0, x), min(width, x + side)
        y0, y1 = max(0, y), min(height, y + side)
        if x1 > x0 and y1 > y0:
            img[y0:y1, x0:x1] = photo[y0 - y : y1 - y, x0 - x : x1 - x]
        return img

    def product(k: int) -> np.ndarray:
        img = np.full((height, width, 3), (34, 18, 8), np.uint8)
        m = int(width * 0.08)
        cv2.rectangle(img, (m, int(height * 0.12)), (width - m, int(height * 0.88)), (70, 40, 18), -1)
        cv2.putText(img, "PANEL FM ADS", (m + 40, int(height * 0.2)), cv2.FONT_HERSHEY_DUPLEX, width / 600, (255, 255, 255), 4, cv2.LINE_AA)
        rows = [("Anuncio A", "$40"), ("Anuncio B", "$12"), ("Anuncio C", "$27")]
        for i, (a, b) in enumerate(rows):
            y = int(height * (0.32 + i * 0.14))
            hl = i == 1 and (k // 15) % 2 == 0
            cv2.rectangle(img, (m + 30, y - 70), (width - m - 30, y + 40), (248, 112, 0) if hl else (110, 70, 40), -1)
            cv2.putText(img, a, (m + 60, y), cv2.FONT_HERSHEY_DUPLEX, width / 900, (255, 255, 255), 3, cv2.LINE_AA)
            cv2.putText(img, b, (width - m - 260, y), cv2.FONT_HERSHEY_DUPLEX, width / 800, (255, 255, 255), 3, cv2.LINE_AA)
        return img

    def bad(k: int) -> np.ndarray:
        return cv2.GaussianBlur(talk(k, offset_x=int(width * 0.62)), (0, 0), 22)

    def cta(k: int) -> np.ndarray:
        img = talk(k)
        y = int(height * 0.78)
        cv2.rectangle(img, (int(width * 0.1), y - 90), (int(width * 0.9), y + 40), (0, 200, 255), -1)
        cv2.putText(img, "COMENTA PANEL", (int(width * 0.16), y), cv2.FONT_HERSHEY_DUPLEX, width / 520, (20, 20, 20), 5, cv2.LINE_AA)
        return img

    draw = {"talk": talk, "product": product, "bad": bad, "cta": cta}
    out = out_dir / f"anuncio-{width}x{height}.mp4"
    enc = subprocess.Popen(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-",
            "-i", str(wav_path),
            "-map", "0:v", "-map", "1:a", "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            str(out),
        ],
        stdin=subprocess.PIPE,
    )
    assert enc.stdin is not None
    for k in range(int(total * FPS)):
        tt = k / FPS
        scene = next((s for a, b, s in spans if a <= tt < b), "talk")
        frame = draw[scene](k)
        cv2.putText(frame, f"{tt:05.2f}", (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3, cv2.LINE_AA)
        enc.stdin.write(frame.tobytes())
    enc.stdin.close()
    enc.wait()
    (out_dir / "transcript.json").write_text(json.dumps({"words": words}, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "escenas.json").write_text(json.dumps([{"start": round(a, 2), "end": round(b, 2), "scene": s} for a, b, s in spans], indent=1), encoding="utf-8")
    print(f"{out} · {total:.1f} s · {len(words)} palabras")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--size", default="1080x1920")
    args = parser.parse_args()
    build(args.out_dir, args.size)
