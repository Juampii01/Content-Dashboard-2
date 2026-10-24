"""Efectos de firma: recorte de la persona (modelo, mosaico, suavizado, guided filter, caché, tiras) y composición
(render de un efecto con el motor en Node y su capa en el grafo final). Video sintético con una persona real (la foto de
la astronauta, dominio público) cuya máscara exacta conocemos."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from video import fx, fx_mask, render

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
FONTS = HERE.parent / "fonts"
sys.path.insert(0, str(HERE.parent / "scripts"))

from make_fx_video import frames as synth_frames  # noqa: E402


def _video(tmp: Path, seconds: float = 2.0, size=(540, 960)) -> tuple[Path, list[np.ndarray]]:
    subject = cv2.imread(str(FIXTURES / "astronaut.jpg"))
    alpha = cv2.imread(str(FIXTURES / "astronaut-alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    out = tmp / "fx.mp4"
    w, h = size
    ff = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", str(out)],
        stdin=subprocess.PIPE,
    )
    gts = []
    for frame, a in synth_frames(subject, alpha, size, seconds):
        ff.stdin.write(frame.tobytes())  # type: ignore[union-attr]
        gts.append(a)
    ff.stdin.close()  # type: ignore[union-attr]
    assert ff.wait() == 0
    return out, gts


# ─── Recorte ───────────────────────────────────────────────────────────────


def test_framing_key_matches_the_app() -> None:
    assert fx_mask.framing_key(1080, 1920, "9:16", 0.3) == f"9x16-op000-{fx_mask.MASK_VERSION}"
    assert fx_mask.framing_key(1920, 1080, "9:16", -0.354) == f"9x16-om035-{fx_mask.MASK_VERSION}"
    assert fx_mask.framing_key(1920, 1080, "9:16", 0.125) == f"9x16-op013-{fx_mask.MASK_VERSION}"  # como Math.round


def test_framing_filter_is_the_render_crop() -> None:
    # 16:9 → 9:16: mismo recorte que render.framing_graph (al tamaño pedido).
    g = fx_mask.framing_filter(1920, 1080, "9:16", 0.0, 540, 960)
    full, _, _ = render.framing_graph(1920, 1080, "9:16", 0.0, None, Path("."))
    assert "crop=608:1080:656:0" in g and "crop=608:1080:656:0" in full


def test_model_finds_the_person() -> None:
    img = cv2.cvtColor(cv2.imread(str(FIXTURES / "astronaut.jpg")), cv2.COLOR_BGR2RGB)
    gt = cv2.imread(str(FIXTURES / "astronaut-alpha.png"), cv2.IMREAD_GRAYSCALE) > 127
    p = fx_mask.predict(img) > 0.5
    iou = (p & gt).sum() / (p | gt).sum()
    # En la foto original la astronauta sostiene un casco que el modelo cuenta como parte de ella (la máscara de
    # referencia no): por eso 0,7 y no más. En el video (sin casco a la vista) se exige más abajo 0,9 por cuadro.
    assert iou > 0.7, iou


def test_masks_are_accurate_and_stable(tmp_path: Path) -> None:
    video, gts = _video(tmp_path, 2.0)
    key = fx_mask.ensure_chunks(video, (540, 960), 60, "9:16", 0.0, [0, 1], tmp_path / "cache")
    preds = [cv2.resize(fx_mask.mask_at(tmp_path / "cache", key, i), (540, 960)).astype(np.float32) / 255 for i in range(60)]
    gts = [cv2.resize(g, (540, 960)) for g in gts]
    ious = [((p > 0.5) & (g > 0.5)).sum() / ((p > 0.5) | (g > 0.5)).sum() for p, g in zip(preds, gts)]
    assert min(ious) > 0.9, min(ious)
    # Parpadeo: lo que cambia la máscara entre cuadros, descontando lo que se movió de verdad (en el borde).
    flicker = []
    for i in range(1, 60):
        b = cv2.dilate((gts[i] > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)) - cv2.erode((gts[i] > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8))
        flicker.append(np.abs((preds[i] - preds[i - 1]) - (gts[i] - gts[i - 1]))[b > 0].mean())
    assert float(np.mean(flicker)) < 0.05, np.mean(flicker)
    # La caché se reutiliza: un segundo pedido no recalcula.
    mtime = fx_mask.chunk_path(tmp_path / "cache", key, 0).stat().st_mtime
    fx_mask.ensure_chunks(video, (540, 960), 60, "9:16", 0.0, [0], tmp_path / "cache")
    assert fx_mask.chunk_path(tmp_path / "cache", key, 0).stat().st_mtime == mtime


def test_temporal_filter_keeps_real_motion() -> None:
    # Un borde que se mueve de verdad no deja estela; un parpadeo aislado se apaga.
    seq = [np.zeros((10, 10), np.float32) for _ in range(5)]
    for k in range(2, 5):
        seq[k][:, :] = 1.0
    assert fx_mask.temporal(seq, 2)[0, 0] > 0.9
    blink = [np.zeros((4, 4), np.float32) for _ in range(5)]
    blink[2][:, :] = 0.3
    assert fx_mask.temporal(blink, 2)[0, 0] < 0.3


def test_preview_strip_is_white_with_alpha(tmp_path: Path) -> None:
    arr = np.zeros((30, 960, 540), np.uint8)
    arr[:, 200:700, 150:400] = 255
    key = "9x16-op000-prueba"
    (tmp_path / key).mkdir()
    np.savez_compressed(fx_mask.chunk_path(tmp_path, key, 0), m=arr)
    out = fx_mask.preview_strip(tmp_path, key, 0, "9:16", tmp_path / "tira.png")
    img = cv2.imread(str(out), cv2.IMREAD_UNCHANGED)
    assert img.shape == (320, 1800, 4)
    assert img[..., :3].min() == 255
    assert img[160, 90, 3] > 200 and img[10, 10, 3] == 0


# ─── Composición ───────────────────────────────────────────────────────────

needs_engine = [
    pytest.mark.skipif(not (FONTS / "InstrumentSerif-Regular.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)"),
    pytest.mark.skipif(not fx.enabled(), reason="falta Node o skia-canvas (cd worker/motion && npm ci)"),
]


class _Ctx:
    def check(self) -> None:
        return None


@pytest.mark.parametrize("kind", ["cover_story", "checklist", "zoom_cut"])
def test_effect_renders_over_the_video(tmp_path: Path, kind: str) -> None:
    for mark in needs_engine:
        if mark.args[0]:
            pytest.skip(mark.kwargs["reason"])
    video, _ = _video(tmp_path, 1.0, (1080, 1920))
    spec = json.loads((FIXTURES / "fx-specs.json").read_text(encoding="utf-8"))[kind]
    item = {"spec": spec, "sourceFrames": list(range(18))}
    out = fx.render_effects(_Ctx(), [item], joined=video, mezz=video, src_size=(1080, 1920), total_frames=30, fmt="9:16", offset_x=0.0, workdir=tmp_path, fonts_dir=FONTS)
    assert len(out) == 1 and out[0]["path"].exists()
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(out[0]["path"])], capture_output=True, check=True).stdout)
    v = probe["streams"][0]
    assert (int(v["width"]), int(v["height"])) == (1080, 1920)
    assert int(v["nb_frames"]) == 18
    # El efecto cambia el cuadro (no es el video tal cual).
    cap = cv2.VideoCapture(str(out[0]["path"]))
    cap.set(cv2.CAP_PROP_POS_FRAMES, 12)
    ok, drawn = cap.read()
    base = cv2.VideoCapture(str(video))
    base.set(cv2.CAP_PROP_POS_FRAMES, 12)
    _, orig = base.read()
    assert ok and np.abs(drawn.astype(int) - orig.astype(int)).mean() > 2
    # Caché: el segundo pedido no vuelve a dibujar.
    again = fx.render_effects(_Ctx(), [item], joined=video, mezz=video, src_size=(1080, 1920), total_frames=30, fmt="9:16", offset_x=0.0, workdir=tmp_path, fonts_dir=FONTS)
    assert again[0]["path"] == out[0]["path"] and again[0]["ms"] == 0


def test_effect_layer_enters_without_fade() -> None:
    from video.pipeline import FX_EDIT, fx_image_hosts

    graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, Path("."), broll=[{"input": 2, "start": 1.0, "end": 3.0, "edit": FX_EDIT}])
    assert "[2:v]format=yuva420p,setpts=PTS-STARTPTS+1.000/TB[br0]" in graph
    assert "fade" not in graph
    assert "overlay=x=0:y=0" in graph
    assert fx_image_hosts("https://cliente.com") == ("cliente.com", "public.blob.vercel-storage.com")


def test_invalid_items_are_refused() -> None:
    from comunes.errors import JobError

    with pytest.raises(JobError):
        fx.validate({"spec": {"v": 2}})
    with pytest.raises(JobError):
        fx.validate({"spec": {"v": 1, "kind": "cover_story", "duration": 2, "mask": True}})
    assert math.isclose(fx.validate({"spec": {"v": 1, "kind": "checklist", "duration": 2}})["spec"]["duration"], 2)


def test_moved_checklist_card_is_drawn_moved(tmp_path: Path) -> None:
    """Lienzo de la revisión: la tarjeta del checklist con `place` (lo arma compileFx en la app) sale corrida en el render."""
    for mark in needs_engine:
        if mark.args[0]:
            pytest.skip(mark.kwargs["reason"])
    video, _ = _video(tmp_path, 1.0, (1080, 1920))
    spec = json.loads((FIXTURES / "fx-specs.json").read_text(encoding="utf-8"))["checklist"]
    moved = {**spec, "place": {"transform": {"x": 0.0, "y": 0.2, "scale": 1}}}

    def drawn(s: dict) -> np.ndarray:
        out = fx.render_effects(_Ctx(), [{"spec": s, "sourceFrames": list(range(18))}], joined=video, mezz=video, src_size=(1080, 1920), total_frames=30, fmt="9:16", offset_x=0.0, workdir=tmp_path, fonts_dir=FONTS)
        cap = cv2.VideoCapture(str(out[0]["path"]))
        cap.set(cv2.CAP_PROP_POS_FRAMES, 15)
        ok, img = cap.read()
        assert ok
        return img.astype(int)

    base = cv2.VideoCapture(str(video))
    base.set(cv2.CAP_PROP_POS_FRAMES, 15)
    _, orig = base.read()
    a = np.abs(drawn(spec) - orig.astype(int)).sum(axis=2) > 60
    b = np.abs(drawn(moved) - orig.astype(int)).sum(axis=2) > 60
    ya, yb = np.nonzero(a)[0], np.nonzero(b)[0]
    assert ya.size > 1000 and yb.size > 1000
    # La tarjeta baja el 20 % del alto (384 px) y no cambia de tamaño.
    assert np.median(yb) - np.median(ya) == pytest.approx(384, abs=12)
    assert yb.size == pytest.approx(ya.size, rel=0.15)


def test_capas_en_orden_de_z():
    """Lo que se superpone va de abajo hacia arriba por `z` (lo calcula la app); sin `z`, por inicio como antes."""
    from video import fx as fxmod

    overlays = [
        {"input": 2, "start": 1.0, "end": 4.0, "z": 2},  # efecto encima
        {"input": 3, "start": 0.5, "end": 5.0, "z": 0},  # gráfico abajo
        {"input": 4, "start": 2.0, "end": 3.0, "z": 1},
    ]
    assert [o["input"] for o in fxmod.overlay_order(overlays)] == [3, 4, 2]
    viejos = [{"input": 2, "start": 3.0}, {"input": 3, "start": 1.0}]
    assert [o["input"] for o in fxmod.overlay_order(viejos)] == [3, 2]
    assert fxmod.layer_z({"z": "x"}) == 0.0


def test_overlapping_layers_render_in_z_order(tmp_path: Path) -> None:
    """Capas superpuestas en un render de verdad: un efecto, un b-roll y otro efecto a la vez; lo de `z` más alto se ve
    encima. Con el orden al revés, se ve el otro (igual que la vista previa)."""
    from video.pipeline import FX_EDIT

    for mark in needs_engine:
        if mark.args[0]:
            pytest.skip(mark.kwargs["reason"])
    video, _ = _video(tmp_path, 1.0, (1080, 1920))
    specs = json.loads((FIXTURES / "fx-specs.json").read_text(encoding="utf-8"))
    cover = {"spec": {**specs["cover_story"], "start": 0}, "sourceFrames": list(range(18)), "z": 2}
    check = {"spec": {**specs["checklist"], "start": 0}, "sourceFrames": list(range(18)), "z": 0}
    layers = fx.render_effects(_Ctx(), [cover, check], joined=video, mezz=video, src_size=(1080, 1920), total_frames=30, fmt="9:16", offset_x=0.0, workdir=tmp_path, fonts_dir=FONTS)
    assert [l["z"] for l in layers] == [2, 0]
    red = tmp_path / "rojo.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(red)], check=True)
    silence = tmp_path / "silencio.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", str(silence)], check=True)

    def frame_at(broll_z: float, name: str) -> np.ndarray:
        overlays = [{"input": 2, "start": 0.0, "end": 1.0, "edit": None, "z": broll_z}]
        overlays += [{"input": 3 + i, "start": l["start"], "end": l["end"], "edit": FX_EDIT, "z": l["z"]} for i, l in enumerate(layers)]
        graph, _, _ = render.framing_graph(1080, 1920, "9:16", 0.0, None, FONTS, broll=fx.overlay_order(overlays))
        out = tmp_path / f"{name}.mp4"
        render.final_encode(video, silence, graph, 1.0, out, "ultrafast", lambda _p: None, extra_inputs=[red, *[l["path"] for l in layers]])
        cap = cv2.VideoCapture(str(out))
        cap.set(cv2.CAP_PROP_POS_FRAMES, 9)
        ok, img = cap.read()
        assert ok
        cv2.imwrite(str(tmp_path / f"{name}.png"), img)
        return img

    top_fx = frame_at(1, "efecto-encima")  # rojo entre los dos efectos: arriba la portada
    top_red = frame_at(5, "rojo-encima")  # el b-roll arriba de todo
    is_red = lambda img: img[..., 2].mean() > 200 and img[..., 1].mean() < 60 and img[..., 0].mean() < 60  # noqa: E731
    assert not is_red(top_fx), "con el efecto en una capa más alta se ve el efecto"
    assert is_red(top_red), "con el b-roll arriba se ve el b-roll"
    out_dir = os.environ.get("LAYER_FRAMES_DIR")
    if out_dir:
        for n in ("efecto-encima", "rojo-encima"):
            shutil.copy(tmp_path / f"{n}.png", Path(out_dir) / f"capas-render-{n}.png")


