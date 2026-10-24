"""Lo que se trajo de carrusel-creator-pro al worker: copiar un carrusel, tu cara en las imágenes (fotos de referencia
en orden), corregir una imagen, la API de OpenAI con input_fidelity y animar un slide a MP4.

    pytest tests/test_carruseles_creator.py
Usa los simuladores de Codex, gallery-dl y OpenAI de tests/fakes. No sale nada a la red.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from PIL import Image, ImageDraw

from carruseles import animar, codex, descarga, openai_api, trabajos
from comunes.errors import JobError

FAKES = Path(__file__).resolve().parent / "fakes"
needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg no está instalado")


def wrapper(tmp: Path, name: str, script: Path) -> Path:
    bin_dir = tmp / "bin"
    bin_dir.mkdir(exist_ok=True)
    exe = bin_dir / name
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
    exe.chmod(0o755)
    return exe


def slide(path: Path, color: tuple[int, int, int] = (20, 30, 80), size: tuple[int, int] = (1080, 1350)) -> Path:
    im = Image.new("RGB", size, color)
    d = ImageDraw.Draw(im)
    d.rectangle([80, 900, 1000, 1000], fill=(240, 240, 240))
    d.ellipse([400, 200, 680, 480], fill=(0, 112, 248))
    im.save(path, "JPEG", quality=90)
    return path


class FakeApp:
    """Hace de la app (rutas /api/worker/carruseles/*) para correr un trabajo entero sin servidor."""

    def __init__(self, files: dict[str, Path], creds: dict[str, Any]) -> None:
        self.files = files
        self.creds = creds
        self.uploaded: dict[str, bytes] = {}
        self.slides: list[dict[str, Any]] = []
        self.copied: dict[str, Any] | None = None
        self.video: str | None = None

    def credentials(self) -> dict[str, Any]:
        return self.creds

    def download(self, key: str, dest: Path) -> Path:
        if key not in self.files:
            raise JobError("No encontramos una de las imágenes. Vuelve a subirlas.", retry=False)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.files[key], dest)
        return dest

    def upload(self, key: str, path: Path, content_type: str) -> None:
        self.uploaded[key] = path.read_bytes()

    def slide_image(self, slide_id: str, key: str, provider: str) -> dict[str, Any]:
        self.slides.append({"slideId": slide_id, "key": key, "provider": provider})
        return {"url": f"/api/carruseles/archivos/{key}", "prev": None}

    def save_chatgpt_auth(self, auth: str) -> dict[str, Any]:
        return {"label": "x"}

    def copy(self, measurements: Any, images: list[Path], post_text: str | None) -> dict[str, Any]:
        self.copied = {"measurements": measurements, "images": [Image.open(p).size for p in images], "post": post_text}
        return {"ok": True, "carouselId": "c-1"}

    def slide_video(self, key: str) -> dict[str, Any]:
        self.video = key
        return {"url": f"/api/carruseles/archivos/{key}"}


def ctx_for(tmp: Path, job_type: str, data: dict[str, Any]) -> SimpleNamespace:
    stages: list[str] = []
    return SimpleNamespace(
        input=data,
        job={"id": "11111111-2222-3333-4444-555555555555", "type": job_type, "attempts": 1, "max_attempts": 2},
        config=SimpleNamespace(work_dir=tmp / "work", worker_id="w-test"),
        app=None,
        conn=None,
        stage=lambda name, a, b: stages.append(name),
        progress=lambda f: None,
        check=lambda: None,
        stages=stages,
    )


@pytest.fixture
def fake_codex(tmp_path: Path, monkeypatch) -> Path:
    exe = wrapper(tmp_path, "codex", FAKES / "fake_codex.py")
    monkeypatch.setenv("CODEX_BIN", str(exe))
    calls = tmp_path / "calls.jsonl"
    monkeypatch.setenv("FAKE_CODEX_CALLS", str(calls))
    monkeypatch.setenv("FAKE_CODEX_DELAY", "0")
    return calls


AUTH = json.dumps({"tokens": {"access_token": "a", "refresh_token": "r", "id_token": "x.e30.y"}})


# ─── Tu cara en las imágenes ──────────────────────────────────────────────


def test_imagenes_con_personaje_mandan_las_fotos_primero(tmp_path: Path, fake_codex: Path, monkeypatch):
    """Con personaje: fotos (en el orden que eligió la app) + referencia de estilo. Las fotos se bajan una vez."""
    (tmp_path / "work").mkdir()
    files = {
        "marca/fotos/aaaaaaaaaaaaaaaa.jpg": slide(tmp_path / "f1.jpg", (200, 150, 120), (900, 1200)),
        "marca/fotos/bbbbbbbbbbbbbbbb.png": slide(tmp_path / "f2.jpg", (180, 140, 110), (800, 800)),
    }
    app = FakeApp(files, {"provider": "chatgpt", "authJson": AUTH, "model": "gpt-5.6-terra", "effort": "medium"})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    data = {
        "carouselId": "0d0d0d0d-0000-0000-0000-000000000000",
        "items": [
            {"slideId": "s1", "prompt": "PERSONAJE: el de las imágenes 1 y 2", "characterKeys": list(files)},
            {"slideId": "s2", "prompt": "Sin personas", "characterKeys": []},
            {"slideId": "s3", "prompt": "PERSONAJE: el de la imagen 1", "characterKeys": ["marca/fotos/bbbbbbbbbbbbbbbb.png"]},
        ],
        "styleRefKey": None,
    }
    out = trabajos.carousel_images(ctx_for(tmp_path, "CAROUSEL_IMAGES", data))
    assert out["generated"] == 3
    calls = [json.loads(line) for line in fake_codex.read_text().splitlines()]
    # 1: dos fotos, sin estilo todavía. 2: solo la referencia de estilo (la primera imagen). 3: una foto + estilo.
    assert [c["refs"] for c in calls] == [2, 1, 2]
    assert all(k.startswith("carruseles/0d0d0d0d-0000-0000-0000-000000000000/s") for k in app.uploaded)


def test_corregir_edita_la_imagen_actual_con_las_fotos(tmp_path: Path, fake_codex: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    files = {
        "marca/fotos/aaaaaaaaaaaaaaaa.jpg": slide(tmp_path / "f1.jpg", (200, 150, 120)),
        "carruseles/0d0d0d0d-0000-0000-0000-000000000000/s1-abcdef12.png": slide(tmp_path / "actual.jpg"),
        "carruseles/0d0d0d0d-0000-0000-0000-000000000000/s9-abcdef12.png": slide(tmp_path / "estilo.jpg"),
    }
    app = FakeApp(files, {"provider": "chatgpt", "authJson": AUTH})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    data = {
        "carouselId": "0d0d0d0d-0000-0000-0000-000000000000",
        "items": [{"slideId": "s1", "prompt": "Edita la imagen 2", "characterKeys": ["marca/fotos/aaaaaaaaaaaaaaaa.jpg"], "editKey": "carruseles/0d0d0d0d-0000-0000-0000-000000000000/s1-abcdef12.png"}],
        # Una corrección no usa la referencia de estilo aunque venga.
        "styleRefKey": "carruseles/0d0d0d0d-0000-0000-0000-000000000000/s9-abcdef12.png",
    }
    ctx = ctx_for(tmp_path, "CAROUSEL_IMAGES", data)
    trabajos.carousel_images(ctx)
    calls = [json.loads(line) for line in fake_codex.read_text().splitlines()]
    assert calls[0]["refs"] == 2  # foto del personaje + la imagen a corregir
    assert any(s.startswith("Corrigiendo") for s in ctx.stages)


def test_foto_danada_da_error_claro(tmp_path: Path, fake_codex: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    bad = tmp_path / "rota.jpg"
    bad.write_bytes(b"no es una imagen")
    app = FakeApp({"marca/fotos/aaaaaaaaaaaaaaaa.jpg": bad}, {"provider": "chatgpt", "authJson": AUTH})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    data = {"carouselId": "0d0d0d0d-0000-0000-0000-000000000000", "items": [{"slideId": "s1", "prompt": "x", "characterKeys": ["marca/fotos/aaaaaaaaaaaaaaaa.jpg"]}]}
    with pytest.raises(JobError) as err:
        trabajos.carousel_images(ctx_for(tmp_path, "CAROUSEL_IMAGES", data))
    assert "Mi marca" in err.value.user_message and not err.value.retry


# ─── OpenAI: input_fidelity ───────────────────────────────────────────────


@pytest.fixture
def openai_server():
    sys.path.insert(0, str(FAKES))
    import openai_sim  # noqa: PLC0415

    srv, base = openai_sim.serve(0)
    yield base, openai_sim
    srv.shutdown()


def test_openai_pide_fidelidad_alta_con_personaje(tmp_path: Path, openai_server):
    base, sim = openai_server
    ref = slide(tmp_path / "foto.jpg")
    openai_api.generate_image({"apiKey": "sk-ok", "baseUrl": base}, "con cara", [ref], tmp_path / "o.png", keep_face=True)
    assert sim.last_request["path"].endswith("/images/edits") and sim.last_request["input_fidelity"] == "high"
    openai_api.generate_image({"apiKey": "sk-ok", "baseUrl": base}, "sin cara", [ref], tmp_path / "o2.png")
    assert sim.last_request["input_fidelity"] is None


def test_openai_sin_fidelidad_reintenta_sin_el_parametro(tmp_path: Path, openai_server):
    base, sim = openai_server
    out = openai_api.generate_image({"apiKey": "sk-sin-fidelidad", "baseUrl": base}, "con cara", [slide(tmp_path / "f.jpg")], tmp_path / "o.png", keep_face=True)
    assert out.exists() and sim.last_request["input_fidelity"] is None


# ─── Copiar un carrusel ───────────────────────────────────────────────────


def test_copia_desde_link_baja_lee_y_manda_el_texto_del_post(tmp_path: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    src = tmp_path / "ig"
    src.mkdir()
    for i in range(3):
        slide(src / f"{i + 1}.jpg", (10 * i, 40, 90))
    # gallery-dl simulado que además deja los metadatos (como --write-metadata).
    script = tmp_path / "gdl.py"
    script.write_text(
        "import json, os, shutil, sys\n"
        "from pathlib import Path\n"
        f"sys.argv[0] = 'gallery-dl'\n"
        "a = sys.argv[1:]\n"
        "d = Path(a[a.index('-D') + 1]); d.mkdir(parents=True, exist_ok=True)\n"
        "assert '--write-metadata' in a\n"
        "for i, f in enumerate(sorted(Path(os.environ['SRC']).iterdir())):\n"
        "    shutil.copyfile(f, d / f'{i+1:02d}.jpg')\n"
        "    (d / f'{i+1:02d}.jpg.json').write_text(json.dumps({'description': '5 AI tools. 50M users.'}))\n"
    )
    monkeypatch.setenv("GALLERY_DL_BIN", str(wrapper(tmp_path, "gallery-dl", script)))
    monkeypatch.setenv("SRC", str(src))
    app = FakeApp({}, {})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    out = trabajos.carousel_copy(ctx_for(tmp_path, "CAROUSEL_COPY", {"copyId": "c0", "source": "link", "url": "https://www.instagram.com/p/ABCDEFG/", "design": "plantilla"}))
    assert out["carouselId"] == "c-1" and out["slides"] == 3 and out["design"] is False
    assert app.copied and app.copied["post"] == "5 AI tools. 50M users." and app.copied["measurements"] is None
    # Claude los ve más grandes que en "Copiar un estilo" (para leer el texto).
    assert all(w == 1000 for w, _h in app.copied["images"])
    assert not (tmp_path / "work" / f"carrusel-{ctx_for(tmp_path, 'x', {}).job['id']}").exists()


def test_copia_que_instagram_no_deja_bajar(tmp_path: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    monkeypatch.setenv("GALLERY_DL_BIN", str(wrapper(tmp_path, "gallery-dl", FAKES / "fake_gallery_dl.py")))
    monkeypatch.setenv("FAKE_GALLERY_FAIL", "1")
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: FakeApp({}, {}))
    with pytest.raises(JobError) as err:
        trabajos.carousel_copy(ctx_for(tmp_path, "CAROUSEL_COPY", {"copyId": "c0", "source": "link", "url": "https://www.instagram.com/p/ABCDEFG/", "design": "original"}))
    assert "súbelas" in err.value.user_message and not err.value.retry


def test_copia_falla_marca_la_copia(monkeypatch):
    executed: list[tuple[str, tuple]] = []
    conn = SimpleNamespace(execute=lambda sql, params: executed.append((sql, params)))
    trabajos._copy_failed(conn, {"input": {"copyId": "abc"}}, "No pudimos bajar ese link.")
    assert "carousel_copies" in executed[0][0] and executed[0][1] == ("No pudimos bajar ese link.", "abc")


def test_post_text_sin_metadatos(tmp_path: Path):
    assert descarga.post_text(tmp_path) is None


def test_copia_con_imagenes_subidas_mide_el_diseno(tmp_path: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    files = {f"carruseles-ref/c0/{i:02d}.jpg": slide(tmp_path / f"r{i}.jpg", (30, 30, 30 + i * 20)) for i in range(1, 4)}
    app = FakeApp(files, {})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    monkeypatch.setattr(trabajos.medidas, "measure_all", lambda refs, progress: {"slides": [{"index": i} for i in range(len(refs))], "summary": {}})
    out = trabajos.carousel_copy(ctx_for(tmp_path, "CAROUSEL_COPY", {"copyId": "c0", "source": "upload", "keys": list(files), "design": "original"}))
    assert out["design"] is True and app.copied and len(app.copied["measurements"]["slides"]) == 3


# ─── Animar un slide ──────────────────────────────────────────────────────


def test_movimientos_suaves_y_en_bucle():
    for motion in animar.MOTIONS:
        values = [animar.transform_at(motion, i / 30, 6.0) for i in range(181)]
        scales = [v[0] for v in values]
        assert 1.0 <= min(scales) and max(scales) <= 1.05, motion  # nunca achica ni recorta de más
        steps = [abs(values[i + 1][1] - values[i][1]) for i in range(180)]
        assert max(steps) < 1.0, motion  # menos de un píxel por cuadro: no salta
    a, b = animar.transform_at("deriva", 0, 6.0), animar.transform_at("deriva", 6.0, 6.0)
    assert abs(a[1] - b[1]) < 1e-6 and abs(a[2] - b[2]) < 1e-6  # vuelve al inicio


def probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt,nb_frames,codec_name", "-show_entries", "format=duration", "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    return {**data["streams"][0], "duration": float(data["format"]["duration"])}


@needs_ffmpeg
@pytest.mark.parametrize(("fmt", "size"), [("4:5", (1080, 1350)), ("9:16", (1080, 1920))])
def test_animar_hace_un_mp4_que_se_puede_subir(tmp_path: Path, fmt: str, size: tuple[int, int]):
    src = slide(tmp_path / "s.jpg")
    out = animar.render(src, tmp_path / "s.mp4", motion="zoom", fmt=fmt, seconds=2)
    info = probe(out)
    assert (info["width"], info["height"]) == size
    assert info["codec_name"] == "h264" and info["pix_fmt"] == "yuv420p" and abs(info["duration"] - 2) < 0.15
    # +faststart: el índice (moov) va al principio, así el navegador lo reproduce mientras baja.
    head = out.read_bytes()[:4096]
    assert head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat"))


@needs_ffmpeg
def test_9_16_deja_el_slide_al_centro_sobre_su_fondo(tmp_path: Path):
    src = slide(tmp_path / "s.jpg", (250, 250, 250))
    out = animar.render(src, tmp_path / "s.mp4", motion="latido", fmt="9:16", seconds=2)
    first = tmp_path / "f.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-frames:v", "1", str(first)], check=True)
    im = Image.open(first).convert("RGB")
    top, middle = im.getpixel((540, 60)), im.getpixel((540, 700))
    assert sum(top) < sum(middle)  # arriba, el fondo oscurecido; al medio, el slide claro


def test_animar_rechaza_formato_raro(tmp_path: Path):
    with pytest.raises(JobError):
        animar.render(slide(tmp_path / "s.jpg"), tmp_path / "s.mp4", motion="zoom", fmt="1:1", seconds=2)


@needs_ffmpeg
def test_trabajo_animar_sube_el_video_del_slide(tmp_path: Path, monkeypatch):
    (tmp_path / "work").mkdir()
    key = "carruseles/0d0d0d0d-0000-0000-0000-000000000000/anim/s1-abcdef12.jpg"
    app = FakeApp({key: slide(tmp_path / "s.jpg")}, {})
    monkeypatch.setattr(trabajos, "CarouselApp", lambda *_a, **_k: app)
    data = {"carouselId": "0d0d0d0d-0000-0000-0000-000000000000", "slideId": "s1", "sourceKey": key, "format": "4:5", "motion": "deriva", "seconds": 2}
    out = trabajos.carousel_animate(ctx_for(tmp_path, "CAROUSEL_ANIMATE", data))
    assert app.video and app.video.startswith("carruseles/0d0d0d0d-0000-0000-0000-000000000000/anim/s1-") and app.video.endswith(".mp4")
    assert out["url"].endswith(".mp4") and app.uploaded[app.video][:12].find(b"ftyp") != -1


def test_codex_recibe_todas_las_referencias(tmp_path: Path, fake_codex: Path):
    home = codex.CodexHome.create(tmp_path, AUTH)
    refs = [slide(tmp_path / f"r{i}.jpg") for i in range(3)]
    codex.generate_image(home, tmp_path, "x", refs, model="m", effort="low", check=lambda: None)
    assert json.loads(fake_codex.read_text().splitlines()[-1])["refs"] == 3
