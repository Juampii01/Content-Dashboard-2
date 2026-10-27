"""Genera un "podcast" sintético en 16:9 para probar Clips desde un video largo de punta a punta, sin red ni APIs.

    python scripts/make_podcast_video.py SALIDA_DIR

Deja en SALIDA_DIR:
- podcast.mp4 (1920×1080, unos 4 minutos): primero 20 s de una lámina sin caras (prueba "sin cara → centro"),
  después dos personas (la foto de prueba tests/fixtures/astronaut.jpg y su espejo) a los dos lados del cuadro.
  Quien habla mueve la boca (un rectángulo oscuro que se abre y se cierra mientras dice sus palabras), así el
  reencuadre tiene que cambiar de persona. El tiempo del original va impreso arriba (sirve para mirar cuadros).
- transcript.json: transcripción por palabra (para WORKER_TEST_TRANSCRIPT).
- turns.json: quién habla en cada tramo y dónde está su cara (centro x relativo), para verificar el reencuadre.

El audio se arma con espeak-ng (dos voces) frase por frase; los tiempos de cada palabra se reparten en proporción a lo
que dura cada palabra sola, como en make_test_video.py.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from make_test_video import RATE, trim

HERE = Path(__file__).resolve().parent.parent
FIXTURE = HERE / "tests" / "fixtures" / "astronaut.jpg"
FONT = HERE / "fonts" / "Inter-Bold.ttf"
W, H = 1920, 1080
FACE = 640  # lado de cada foto
POS = [(300, 260), (980, 260)]  # esquina de cada foto (A a la izquierda, B a la derecha)
# Boca dentro de la foto (relativa): YuNet ve la cara en x 0,35–0,52, y 0,12–0,35.
MOUTH = (0.44, 0.305)
INTRO = 20.0

# (quién, texto). 0 = A (izquierda), 1 = B (derecha). Hay charla floja y momentos fuertes con preguntas y cifras.
TURNS: list[tuple[int, str]] = [
    (0, "Bueno, hola a todos, bienvenidos a un nuevo episodio. Hoy tenemos una charla larga sobre cómo conseguir clientes."),
    (1, "Hola, gracias por invitarme. Sí, la verdad que es un tema que me encanta y del que hablo todo el tiempo."),
    (0, "Y bueno, entonces, cuéntanos un poco, eh, cómo empezaste con todo esto, así para ubicarnos."),
    (1, "Empecé hace unos años, más o menos, probando cosas, y bueno, como todos, equivocándome bastante al principio."),
    (0, "¿Por qué la mayoría de las clínicas pierde pacientes en la primera llamada? Porque dan el precio antes de escuchar. Una clínica en Houston cambió solo eso y pasó de 3 a 6 citas de cada 10 llamadas en un mes. Lo que funciona es preguntar qué le pasa y desde cuándo, repetir lo que dijo con sus palabras y recién ahí hablar de la solución. Haz eso mañana mismo y mide cuántas citas agendas."),
    (1, "Totalmente de acuerdo. Y eso que dices de escuchar primero es justo lo que casi nadie hace."),
    (1, "El error número uno de los anuncios es hablarle a todo el mundo. Si tu anuncio sirve para cualquiera, no le sirve a nadie. Nosotros bajamos el costo por cliente de 40 a 12 dólares solo nombrando el problema exacto en los primeros 3 segundos. ¿Quieres probarlo? Escribe en una hoja el dolor de tu cliente con sus palabras y úsalo como primera frase del anuncio."),
    (0, "Claro, claro. Bueno, sí, es así, es como que, no sé, a veces uno se complica de más con esas cosas."),
    (1, "Sí, sí, pasa mucho, pasa todo el tiempo, la verdad."),
    (0, "¿Sabes cuál es la pregunta que más me hacen? Cuánto hay que publicar para crecer. Y la respuesta no es publicar más. En 90 días pasamos de 2 mil a 15 mil seguidores publicando 3 veces por semana, pero cada video respondía una sola pregunta de un cliente real. La constancia gana, pero solo si cada pieza resuelve algo concreto."),
    (1, "Ese dato es muy bueno. Y además se puede medir, que es lo importante."),
    (1, "Y otra cosa que quería decir, eh, bueno, no sé si viene al caso, pero el otro día justo hablábamos de esto con unos amigos y nada, quedó ahí la charla."),
    (0, "Sí, sí, me acuerdo, me acuerdo. Es así, uno siempre vuelve a lo mismo, a lo básico, digamos."),
    (1, "Tres cosas que haría si hoy empezara de cero. Primero, elegir un solo tipo de cliente y hablarle solo a él. Segundo, publicar una respuesta por día a una pregunta real de ese cliente. Tercero, pedir cada semana una llamada a 5 personas que comentaron. Con eso solo, en 2 meses tienes tus primeros 3 clientes sin pagar anuncios."),
    (0, "Me encanta eso, súper concreto. Bueno, y ahora, eh, pasemos a otra cosa, a ver, déjame ver mis notas un segundo."),
    (0, "Bueno, se nos fue el tiempo. Gracias por venir, nos vemos en el próximo episodio."),
]


def speak(text: str, out: Path, voice: str, pitch: int) -> np.ndarray:
    subprocess.run(["espeak-ng", "-v", voice, "-s", "165", "-p", str(pitch), "-w", str(out), text], check=True)
    raw = out.with_suffix(".48k.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(out), "-ar", str(RATE), "-ac", "1", str(raw)], check=True)
    with wave.open(str(raw), "rb") as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return trim(data)


def build(out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    voices = [("es-419", 38), ("es-419+f3", 70)]
    rng = np.random.default_rng(11)
    t = INTRO
    audio: list[np.ndarray] = [np.zeros(int(INTRO * RATE), dtype=np.float32)]
    words: list[dict] = []
    turns: list[dict] = []
    for k, (who, text) in enumerate(TURNS):
        voice, pitch = voices[who]
        turn_start = t
        # Frase por frase, así las pausas entre frases son naturales.
        for p_i, phrase in enumerate([p.strip() for p in text.replace("? ", "?|").replace(". ", ".|").split("|") if p.strip()]):
            pa = speak(phrase, tmp / f"t{k}p{p_i}.wav", voice, pitch)
            tokens = phrase.split()
            lens = [max(0.08, len(speak(tok, tmp / f"t{k}p{p_i}w{i}.wav", voice, pitch)) / RATE) for i, tok in enumerate(tokens)]
            dur = len(pa) / RATE
            scale = dur / sum(lens)
            cursor = t
            for tok, L in zip(tokens, lens):
                span = L * scale
                words.append({"text": tok, "start": round(cursor, 3), "end": round(cursor + span * 0.92, 3), "speaker": who})
                cursor += span
            pause = 0.35 + float(rng.uniform(0, 0.25))
            audio += [pa, np.zeros(int(pause * RATE), dtype=np.float32)]
            t += dur + pause
        turns.append({"speaker": who, "start": round(turn_start, 3), "end": round(t, 3), "faceX": round((POS[who][0] + FACE * (MOUTH[0] if who == 0 else 1 - MOUTH[0])) / W, 4)})
        gap = 0.5
        audio.append(np.zeros(int(gap * RATE), dtype=np.float32))
        t += gap
    audio.append(np.zeros(int(1.0 * RATE), dtype=np.float32))
    signal = np.concatenate(audio) * 0.7 + rng.normal(0, 0.003, sum(len(a) for a in audio)).astype(np.float32)
    total = len(signal) / RATE
    wav_path = tmp / "voz.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())

    mw, mh = int(FACE * 0.075), int(FACE * 0.03)
    boxes = []
    for who in (0, 1):
        talk = "+".join(f"between(t,{w['start']:.2f},{w['end']:.2f})" for w in words if w["speaker"] == who)
        mx = POS[who][0] + int(FACE * (MOUTH[0] if who == 0 else 1 - MOUTH[0])) - mw // 2
        my = POS[who][1] + int(FACE * MOUTH[1]) - mh // 2
        # La boca se abre y se cierra (cada 0,24 s) mientras dice sus palabras.
        boxes.append(f"drawbox=x={mx}:y={my}:w={mw}:h={mh}:color=0x3a0d0d@1:t=fill:enable='({talk})*lt(mod(t,0.24),0.12)'")
    graph = (
        "[1:v]scale=640:640,split[a][b0];[b0]hflip,hue=h=25[b];"
        f"[0:v][a]overlay=x={POS[0][0]}:y={POS[0][1]}:enable='gte(t,{INTRO})'[v1];"
        f"[v1][b]overlay=x={POS[1][0]}:y={POS[1][1]}:enable='gte(t,{INTRO})'[v2];"
        f"[v2]{boxes[0]},{boxes[1]},"
        f"drawtext=fontfile={FONT}:text='Episodio 12 · Cómo conseguir clientes':x=(w-tw)/2:y=(h-th)/2:fontsize=64:fontcolor=white:enable='lt(t,{INTRO})',"
        f"drawtext=fontfile={FONT}:text='%{{pts\\:hms}}':x=(w-tw)/2:y=30:fontsize=34:fontcolor=white@0.85:box=1:boxcolor=black@0.4:boxborderw=10[v]"
    )
    out = out_dir / "podcast.mp4"
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"gradients=s={W}x{H}:c0=0x1b2b55:c1=0x0a1530:n=2:speed=0.01:d={total:.3f}:r=30",
            "-loop", "1", "-i", str(FIXTURE),
            "-i", str(wav_path),
            "-filter_complex", graph,
            "-map", "[v]", "-map", "2:a", "-t", f"{total:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            str(out),
        ],
        check=True,
    )
    (out_dir / "transcript.json").write_text(json.dumps({"words": [{k: w[k] for k in ("text", "start", "end")} for w in words]}, ensure_ascii=False, indent=1), encoding="utf-8")
    info = {"duration": round(total, 2), "intro": INTRO, "turns": turns, "words": len(words)}
    (out_dir / "turns.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out} · {total:.1f} s · {len(words)} palabras")
    return info


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir", type=Path)
    build(parser.parse_args().out_dir)
