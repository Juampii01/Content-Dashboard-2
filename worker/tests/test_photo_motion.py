"""Fotos con movimiento: la cámara que recorre una imagen de la biblioteca (acercar, alejar y los cuatro recorridos) y
el fondo desenfocado. Con ffmpeg real sobre imágenes sintéticas (sin red ni base).

Los recorridos son los que arma `motionPath` en lib/video/broll-edit.ts (con intensidad 0,15) y los números de
`motion_at` son los mismos que prueba tests/video-photo-motion.test.mts, para que la vista previa y el render no se
separen. La suavidad se mide siguiendo una mancha: su posición cuadro a cuadro tiene que caer donde dice la cuenta
(sin los saltos de píxel entero que deja `zoompan`) y avanzar sin tirones.
"""

import math
import subprocess
from pathlib import Path

import numpy as np
import pytest

from video import broll_edit, render

FPS = 30
BOX = (360, 640)  # marco 9:16 chico para que la prueba sea rápida (la cuenta es la misma que a 1080×1920)
SECONDS = 1.5
S = 1.15
NEAR, FAR = 0.5 / S, 1 - 0.5 / S
CENTER = {"scale": 1.0, "x": 0.5, "y": 0.5}


def at(scale: float, x: float = 0.5, y: float = 0.5) -> dict[str, float]:
    return {"scale": scale, "x": x, "y": y}


# Lo que arma motionPath({ kind, amount: 0.15, ease: "linear" }).
PATHS = {
    "zoom_in": (at(1), at(S)),
    "zoom_out": (at(S), at(1)),
    "pan_left": (at(S, FAR), at(S, NEAR)),
    "pan_right": (at(S, NEAR), at(S, FAR)),
    "pan_up": (at(S, 0.5, FAR), at(S, 0.5, NEAR)),
    "pan_down": (at(S, 0.5, NEAR), at(S, 0.5, FAR)),
}

# Manchas del dibujo de prueba (en fracciones de la foto): fuera del centro, así se mueven también al acercar.
BLOBS = [(0.3, 0.35), (0.7, 0.65)]


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def blob_image(path: Path, size: tuple[int, int]) -> Path:
    """Fondo gris oscuro con dos manchas gaussianas blancas (su centro se mide con precisión de fracción de píxel)."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    img = np.full((h, w), 20.0)
    sigma = min(w, h) * 0.035
    for bx, by in BLOBS:
        img += 220 * np.exp(-(((xx - bx * w) ** 2 + (yy - by * h) ** 2) / (2 * sigma**2)))
    rgb = np.repeat(np.clip(img, 0, 255).astype(np.uint8)[:, :, None], 3, axis=2)
    raw = path.with_suffix(".rgb")
    raw.write_bytes(rgb.tobytes())
    ffmpeg("-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", str(raw), "-frames:v", "1", str(path))
    return path


def frames(path: Path, size: tuple[int, int]) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    w, h = size
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w).astype(np.float64)


def centroid(img: np.ndarray, cx: float, cy: float, r: float) -> tuple[float, float]:
    """Centro de masa de la mancha alrededor de (cx, cy), sin el fondo."""
    h, w = img.shape
    x0, x1 = max(0, int(cx - r)), min(w, int(cx + r) + 1)
    y0, y1 = max(0, int(cy - r)), min(h, int(cy + r) + 1)
    win = np.clip(img[y0:y1, x0:x1] - 40, 0, None)
    total = win.sum()
    assert total > 0, "no se encontró la mancha"
    yy, xx = np.mgrid[y0:y1, x0:x1]
    return float((xx * win).sum() / total), float((yy * win).sum() / total)


def expected(path: dict, t: float, bx: float, by: float) -> tuple[float, float]:
    """Dónde cae un punto del cuadro base en la salida: (p − centro)·escala + 0,5 (lo mismo que `motionTransform`)."""
    m = broll_edit.motion_at(path, t)
    return ((bx - m["x"]) * m["scale"] + 0.5) * BOX[0], ((by - m["y"]) * m["scale"] + 0.5) * BOX[1]


def photo(kind: str, ease: str = "linear", fit: str = "cover") -> dict:
    a, b = PATHS[kind]
    return {"fit": fit, "motion": {"from": a, "to": b, "ease": ease}, "blur": dict(broll_edit.DEFAULT_BLUR)}


# ─── La cuenta (la misma que la app) ───────────────────────────────────────


def test_motion_at_igual_que_la_app():
    # Mismos números que tests/video-photo-motion.test.mts.
    zoom = {"from": at(1), "to": at(1.2), "ease": "smooth"}
    m = broll_edit.motion_at(zoom, 0.5)
    assert m["scale"] == pytest.approx(math.sqrt(1.2), abs=1e-9)
    assert broll_edit.motion_at(zoom, 0)["scale"] == pytest.approx(1)
    assert broll_edit.motion_at(zoom, 1)["scale"] == pytest.approx(1.2)
    assert broll_edit.motion_at(zoom, 0.25)["scale"] == pytest.approx(1.2 ** ((1 - math.cos(math.pi * 0.25)) / 2), abs=1e-9)
    pan = {"from": at(1.15, FAR), "to": at(1.15, NEAR), "ease": "linear"}
    assert broll_edit.motion_at(pan, 0.5)["x"] == pytest.approx(0.5)
    assert broll_edit.motion_at(pan, 0.25)["x"] == pytest.approx(FAR + (NEAR - FAR) * 0.25)
    # Fuera de [0, 1] se queda en el borde.
    assert broll_edit.motion_at(pan, 2)["x"] == pytest.approx(NEAR)


def test_photo_of_respeta_los_planes_de_antes():
    assert broll_edit.photo_of(None) is None
    assert broll_edit.photo_of({"layout": "full"}) is None
    # Recortada y sin movimiento: igual que antes (no pasa por el camino nuevo).
    assert broll_edit.photo_of({"photo": {"fit": "cover", "motion": None}}) is None
    p = broll_edit.photo_of({"photo": {"fit": "blur", "motion": None}})
    assert p and p["fit"] == "blur" and p["motion"] is None
    # Valores fuera de rango se acotan (el worker no confía a ciegas).
    p = broll_edit.photo_of({"photo": {"fit": "x", "motion": {"from": {"scale": 9, "x": -3}, "to": {"scale": "a"}, "ease": "raro"}}})
    assert p and p["fit"] == "cover" and p["motion"]["from"]["scale"] == broll_edit.MAX_MOTION_SCALE and p["motion"]["from"]["x"] == 0
    assert p["motion"]["to"]["scale"] == 1 and p["motion"]["ease"] == "smooth"


def test_la_cache_de_los_broll_de_antes_no_cambia():
    edit = {"layout": "full", "box": {"x": 0, "y": 0, "w": 1080, "h": 1920}, "frame": {"x": 0, "y": 0, "zoom": 1}}
    import hashlib
    import json

    old = hashlib.sha1(json.dumps({k: edit.get(k) for k in ("layout", "box", "card", "frame", "color", "zoom", "clipStart")}, sort_keys=True).encode()).hexdigest()[:12]
    assert broll_edit.edit_key(edit) == old
    assert broll_edit.edit_key({**edit, "photo": {"fit": "blur", "motion": None}}) != old


# ─── El render ─────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def blobs(tmp_path_factory: pytest.TempPathFactory) -> Path:
    # Misma forma que el marco: "cover" no recorta y la mancha cae en (bx, by) del cuadro base.
    return blob_image(tmp_path_factory.mktemp("foto") / "manchas.png", (720, 1280))


@pytest.mark.parametrize("kind", list(PATHS))
def test_cada_movimiento_es_suave_y_cae_donde_dice_la_cuenta(blobs: Path, tmp_path: Path, kind: str):
    p = photo(kind)
    out = render.prepare_photo(blobs, tmp_path / f"{kind}.mp4", SECONDS, BOX, p)
    fr = frames(out, BOX)
    n = round(SECONDS * FPS)
    assert len(fr) >= n
    # Los cuadros cambian: el primero y el último del tramo no son iguales.
    assert np.abs(fr[0] - fr[n - 1]).mean() > 0.5

    for bx, by in BLOBS:
        pos = []
        for i in range(n):
            ex, ey = expected(p["motion"], i / (SECONDS * FPS), bx, by)
            cx, cy = centroid(fr[i], ex, ey, BOX[0] * 0.09)
            # Cae donde dice la cuenta (la misma que la vista previa), con error de menos de medio píxel.
            assert abs(cx - ex) < 0.5 and abs(cy - ey) < 0.5, (kind, i, (cx, cy), (ex, ey))
            pos.append((cx, cy))
        pos = np.array(pos)
        steps = np.diff(pos, axis=0)
        want = np.diff(np.array([expected(p["motion"], i / (SECONDS * FPS), bx, by) for i in range(n)]), axis=0)
        # Sin saltos: cada paso de un cuadro al siguiente es el que dice la cuenta (con el ruido del códec y de la
        # medición). Un redondeo a píxel entero (lo de zoompan) daría pasos de 0 y de 1 píxel alternados.
        assert np.abs(steps - want).max() < 0.6, (kind, np.abs(steps - want).max())
        # Y nunca vuelve para atrás.
        main = 0 if abs(pos[-1, 0] - pos[0, 0]) >= abs(pos[-1, 1] - pos[0, 1]) else 1
        direction = np.sign(pos[-1, main] - pos[0, main])
        assert (steps[:, main] * direction > -0.05).all(), (kind, steps[:, main].round(3).tolist())


def test_curva_suave_arranca_y_termina_quieta(blobs: Path, tmp_path: Path):
    p = photo("pan_right", ease="smooth")
    out = render.prepare_photo(blobs, tmp_path / "suave.mp4", SECONDS, BOX, p)
    fr = frames(out, BOX)
    n = round(SECONDS * FPS)
    bx, by = BLOBS[0]
    xs = [centroid(fr[i], *expected(p["motion"], i / (SECONDS * FPS), bx, by), BOX[0] * 0.09)[0] for i in range(n)]
    v = np.abs(np.diff(xs))
    # Lento al principio y al final, rápido en el medio (el ruido de la medición es de unas décimas de píxel).
    assert v[:3].mean() < v[n // 2 - 2 : n // 2 + 2].mean() * 0.35
    assert v[-3:].mean() < v[n // 2 - 2 : n // 2 + 2].mean() * 0.35
    # La velocidad cambia de a poco: la mitad que más acelera nunca da un salto grande entre cuadros vecinos.
    assert np.abs(np.diff(v)).max() < 0.6


def test_hacia_la_izquierda_la_foto_se_desliza_a_la_derecha(blobs: Path, tmp_path: Path):
    fr = frames(render.prepare_photo(blobs, tmp_path / "izq.mp4", SECONDS, BOX, photo("pan_left")), BOX)
    bx, by = BLOBS[0]
    first = centroid(fr[0], *expected(photo("pan_left")["motion"], 0, bx, by), BOX[0] * 0.09)
    last = centroid(fr[int(SECONDS * FPS) - 1], *expected(photo("pan_left")["motion"], 1, bx, by), BOX[0] * 0.09)
    assert last[0] > first[0] + 10


def test_fondo_desenfocado_foto_entera_sobre_su_copia(tmp_path: Path):
    """Una foto horizontal en un marco vertical: entera en la franja del medio y, arriba y abajo, su copia desenfocada
    y oscurecida (sin negro ni bordes duros)."""
    src = tmp_path / "horizontal.png"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1600x900", "-frames:v", "1", str(src))
    p = {"fit": "blur", "motion": None, "blur": dict(broll_edit.DEFAULT_BLUR)}
    fr = frames(render.prepare_photo(src, tmp_path / "blur.mp4", 1.0, BOX, p), BOX)[0]
    w, h = BOX
    fh = broll_edit.contain_size(1600, 900, w, h)[1]
    top = fr[: (h - fh) // 2 - 4]
    middle = fr[(h - fh) // 2 + 4 : (h + fh) // 2 - 4]
    assert top.mean() > 15, "el fondo no puede quedar negro"
    # Desenfocado: casi sin detalle fino comparado con la foto del medio.
    detail = lambda a: np.abs(np.diff(a, axis=1)).mean()
    assert detail(top) < detail(middle) * 0.25
    # Sin movimiento, todos los cuadros iguales.
    still = frames(tmp_path / "blur.mp4", BOX)
    assert np.abs(still[0] - still[-1]).mean() < 0.5


def test_foto_con_movimiento_pasa_por_prepare_broll(blobs: Path, tmp_path: Path):
    """El camino completo del worker: la foto con movimiento y después el b-roll listo para superponer (tarjeta con
    alfa incluida), con la duración exacta del tramo."""
    p = photo("zoom_in", ease="smooth")
    clip = render.prepare_photo(blobs, tmp_path / "zoom.mp4", 1.0, (320, 568), p)
    edit = {"layout": "card", "box": {"x": 100, "y": 200, "w": 320, "h": 568}, "card": {"radius": 20, "shadowY": 8, "shadowBlur": 20, "shadowAlpha": 0.5, "border": 2, "borderAlpha": 0.2}, "frame": dict(broll_edit.DEFAULT_FRAME), "color": None, "zoom": None, "photo": p}
    ready = render.prepare_broll(clip, tmp_path / "ready.mp4", 1.0, (1080, 1920), 0.0, edit)
    assert ready.suffix == ".mkv"
    info = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(ready)], capture_output=True, text=True, check=True).stdout
    assert int(info.strip()) == 30
