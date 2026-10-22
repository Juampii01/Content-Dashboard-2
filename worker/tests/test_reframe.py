"""Reencuadre que sigue la cara (Clips desde un video largo): suavizado, cambios de persona y corte con ffmpeg.

Las funciones de la cámara virtual son puras y se prueban con datos armados a mano. Las pruebas con ffmpeg y
YuNet usan un video sintético con la foto de prueba (tests/fixtures/astronaut.jpg) y se saltan si falta algo.
"""

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import reframe
from video.reframe import Face, Sample

HERE = Path(__file__).resolve().parent.parent
MODELS = HERE / "models"
FIXTURE = HERE / "tests" / "fixtures" / "astronaut.jpg"
CROP_W = 608 / 1920  # recorte 9:16 de un video 1920×1080


def times(seconds: float) -> list[float]:
    return [round(i / reframe.SAMPLE_FPS, 3) for i in range(int(seconds * reframe.SAMPLE_FPS))]


def max_step(positions: list[float]) -> float:
    return max(abs(b - a) for a, b in zip(positions, positions[1:]))


# ─── Cámara virtual ────────────────────────────────────────────────────────


def test_crop_size() -> None:
    assert reframe.crop_size(1920, 1080) == (608, 1080)
    assert reframe.crop_size(3840, 2160) == (1216, 2160)
    assert reframe.crop_size(1080, 1920) == (1080, 1920)  # ya vertical: todo el cuadro
    assert reframe.crop_size(1080, 1080) == (608, 1080)


def test_jitter_does_not_move_the_camera() -> None:
    ts = times(20)
    rng = np.random.default_rng(1)
    targets = [0.4 + float(rng.normal(0, 0.008)) for _ in ts]
    pos = reframe.smooth_path(ts, targets, [False] * len(ts), CROP_W)
    assert max(pos) - min(pos) < 0.01
    points = reframe.keyframes(ts, pos, [False] * len(ts))
    assert len(points) <= 4  # casi quieta: pocos puntos clave


def test_step_moves_smoothly_without_jumps() -> None:
    ts = times(10)
    targets = [0.3 if t < 4 else 0.7 for t in ts]
    pos = reframe.smooth_path(ts, targets, [False] * len(ts), CROP_W)
    # Nunca más rápido que la velocidad máxima (por muestra de 0,2 s) y llega al destino.
    assert max_step(pos) <= reframe.MAX_SPEED / reframe.SAMPLE_FPS + 1e-6
    assert pos[0] == pytest.approx(0.3, abs=1e-6)
    assert pos[-1] == pytest.approx(0.7, abs=0.01)
    # Arranca y frena suave: el primer paso después del cambio es chico.
    i = ts.index(4.0)
    first = next(k for k in range(1, len(pos)) if abs(pos[k] - pos[k - 1]) > 1e-6)
    assert abs(pos[first] - pos[first - 1]) < 0.5 * abs(pos[first + 3] - pos[first + 2])


def test_hard_cut_jumps_at_once() -> None:
    ts = times(6)
    targets = [0.25 if t < 3 else 0.75 for t in ts]
    hard = [t == 3.0 for t in ts]
    pos = reframe.smooth_path(ts, targets, hard, CROP_W)
    i = ts.index(3.0)
    assert pos[i - 1] == pytest.approx(0.25, abs=1e-6) and pos[i] == pytest.approx(0.75, abs=1e-6)
    points = reframe.keyframes(ts, pos, hard)
    # El corte queda como dos puntos casi en el mismo instante (sin paneo entre las dos personas).
    assert reframe.position_at(points, 2.99) == pytest.approx(0.25, abs=1e-3)
    assert reframe.position_at(points, 3.0) == pytest.approx(0.75, abs=1e-3)


def test_clamped_to_the_frame() -> None:
    ts = times(4)
    pos = reframe.smooth_path(ts, [0.02] * len(ts), [False] * len(ts), CROP_W)
    assert min(pos) == pytest.approx(CROP_W / 2, abs=1e-6)
    pos = reframe.smooth_path(ts, [0.99] * len(ts), [False] * len(ts), CROP_W)
    assert max(pos) == pytest.approx(1 - CROP_W / 2, abs=1e-6)


def test_no_face_holds_then_centers() -> None:
    ts = times(8)
    targets: list[float | None] = [0.3 if t < 2 else None for t in ts]
    filled = reframe.fill_gaps(ts, targets)
    assert filled[ts.index(3.0)] == pytest.approx(0.3)  # 1 s sin cara: se mantiene
    assert filled[ts.index(4.0)] == 0.5  # más de 1,5 s: centro
    assert reframe.fill_gaps(ts, [None] * len(ts)) == [0.5] * len(ts)
    pos = reframe.smooth_path(ts, targets, [False] * len(ts), CROP_W)
    assert pos[-1] == pytest.approx(0.5, abs=0.02) and max_step(pos) <= reframe.MAX_SPEED / reframe.SAMPLE_FPS + 1e-6


def test_keyframes_match_the_path_and_ffmpeg_expression() -> None:
    ts = [10 + t for t in times(12)]
    targets = [0.3 + 0.3 * math.sin(t / 2) for t in ts]
    pos = reframe.smooth_path(ts, targets, [False] * len(ts), CROP_W)
    points = reframe.keyframes(ts, pos, [False] * len(ts))
    assert len(points) < len(ts)
    for t, x in zip(ts, pos):
        assert reframe.position_at(points, t) == pytest.approx(x, abs=reframe.RDP_EPSILON * 2)
    expr = reframe.crop_x_expression(points, 10, 1920, 608)
    assert expr.count("if(") == len(points)


# ─── A quién mirar ─────────────────────────────────────────────────────────


def two_people(seconds: float, speaker: callable, cut_at: float | None = None) -> list[Sample]:
    """Dos caras quietas a los lados; la que habla mueve la boca (actividad alta)."""
    samples = []
    rng = np.random.default_rng(3)
    for t in times(seconds):
        who = speaker(t)
        faces = [
            Face(cx=0.25, cy=0.4, w=0.12, h=0.2, activity=(6.0 if who == 0 else 0.5) + float(rng.uniform(0, 0.4))),
            Face(cx=0.75, cy=0.4, w=0.12, h=0.2, activity=(6.0 if who == 1 else 0.5) + float(rng.uniform(0, 0.4))),
        ]
        samples.append(Sample(t=t, faces=faces, cut=cut_at is not None and abs(t - cut_at) < 1e-6))
    return samples


def test_switches_to_the_person_who_talks() -> None:
    samples = two_people(12, lambda t: 0 if t < 6 else 1)
    reframe.assign_tracks(samples)
    assert len({f.track for s in samples for f in s.faces}) == 2
    targets, hard, switches = reframe.choose_targets(samples, CROP_W, [(0.0, 12.0)])
    assert switches == 1
    i = next(k for k, h in enumerate(hard) if h)
    # El cambio se adelanta a cuando empezó a hablar la otra persona (no 1 s después).
    assert 5.8 <= samples[i].t <= 6.4
    assert targets[i - 2] == pytest.approx(0.25) and targets[i + 2] == pytest.approx(0.75)


def test_no_switch_without_voice_or_for_a_blip() -> None:
    samples = two_people(10, lambda t: 1 if 4 <= t < 4.4 else 0)  # la otra persona "habla" 0,4 s
    reframe.assign_tracks(samples)
    _, _, switches = reframe.choose_targets(samples, CROP_W, [(0.0, 10.0)])
    assert switches == 0
    samples = two_people(10, lambda t: 1)  # la de la derecha mueve la boca, pero no hay voz
    reframe.assign_tracks(samples)
    targets, _, switches = reframe.choose_targets(samples, CROP_W, [])
    assert switches == 0 and all(x == pytest.approx(0.25) for x in targets)  # se queda en la más grande (empate → primera)


def test_close_faces_are_framed_together() -> None:
    samples = [Sample(t=t, faces=[Face(cx=0.45, cy=0.4, w=0.08, h=0.15, activity=5), Face(cx=0.56, cy=0.4, w=0.08, h=0.15, activity=1)]) for t in times(4)]
    reframe.assign_tracks(samples)
    targets, _, _ = reframe.choose_targets(samples, CROP_W, [(0.0, 4.0)])
    assert all(x == pytest.approx((0.41 + 0.60) / 2) for x in targets)


def test_shot_cut_starts_new_tracks() -> None:
    samples = two_people(6, lambda t: 0, cut_at=3.0)
    reframe.assign_tracks(samples)
    before = {f.track for f in samples[0].faces}
    after = {f.track for f in samples[-1].faces}
    assert before.isdisjoint(after)


def test_speech_spans() -> None:
    spans = reframe.speech_spans([{"start": 0, "end": 0.4}, {"start": 0.6, "end": 1.0}, {"start": 3, "end": 3.5}])
    assert spans == [(0, 1.0), (3, 3.5)]
    assert reframe.speaking_at(spans, 0.5) and reframe.speaking_at(spans, 3.6) and not reframe.speaking_at(spans, 2.0)


# ─── Con ffmpeg y YuNet ────────────────────────────────────────────────────

needs_tools = pytest.mark.skipif(not ((MODELS / "face_detection_yunet_2023mar.onnx").exists() and shutil.which("ffmpeg") and FIXTURE.exists()), reason="faltan ffmpeg o el modelo YuNet")


def moving_face_video(path: Path, seconds: float = 6.0) -> None:
    """1920×1080: la foto de prueba (una cara) cruza de izquierda a derecha, con audio."""
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"color=c=0x203050:s=1920x1080:d={seconds}:r=30",
            "-loop", "1", "-i", str(FIXTURE),
            "-f", "lavfi", "-i", f"sine=f=220:d={seconds}",
            "-filter_complex", f"[1:v]scale=700:700[f];[0:v][f]overlay=x='100+1100*t/{seconds}':y=150:shortest=1[v]",
            "-map", "[v]", "-map", "2:a", "-t", str(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(path),
        ],
        check=True,
    )


@needs_tools
def test_follows_a_moving_face_end_to_end(tmp_path: Path) -> None:
    
    src = tmp_path / "cara.mp4"
    moving_face_video(src)
    framing = reframe.analyze_window(src, 0.0, 6.0, 1920, 1080, reframe.FaceFinder(MODELS), [(0.0, 6.0)])
    assert framing["mode"] == "face" and framing["faceRatio"] > 0.9 and framing["maxFaces"] == 1
    xs = [reframe.position_at(framing["keyframes"], t) for t in (0.5, 5.5)]
    assert xs[1] - xs[0] > 0.3  # la cámara la sigue de izquierda a derecha
    out = tmp_path / "vertical.mp4"
    reframe.render(src, out, 1.0, 4.0, framing["keyframes"], 1920, 1080, (360, 640), crf=30, preset="ultrafast", audio_bitrate="64k")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height,codec_type", "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout
    assert "360,640" in probe and "audio" in probe
    # En el resultado, la cara está en el cuadro: YuNet la encuentra cerca del centro en un cuadro del medio.
    frame = tmp_path / "f.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "2", "-i", str(out), "-frames:v", "1", str(frame)], check=True)
    import cv2  # noqa: PLC0415

    faces = reframe.FaceFinder(MODELS).detect(cv2.imread(str(frame)))
    assert faces, "no hay cara en el cuadro vertical"
    x, _, w, _, _ = max(faces, key=lambda f: f[2] * f[3])
    assert 0.2 < x + w / 2 < 0.8
