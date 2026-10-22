"""YouTube en el worker: elección de subtítulos, fondo a 1280×720, recorte de la foto y el trabajo YT_THUMBNAILS
con la API de OpenAI simulada y una app falsa (sin red, sin base).

    pytest tests/test_youtube.py
El recorte necesita el modelo U²-Net (CUTOUT_MODEL o models/rembg/u2net_human_seg.onnx); si no está, se salta.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from PIL import Image

from comunes.errors import JobError
from youtube import recorte, subtitulos, trabajos

FIXTURES = Path(__file__).resolve().parent / "fixtures"
FAKES = Path(__file__).resolve().parent / "fakes"
MODELS = Path(__file__).resolve().parent.parent / "models"
has_model = recorte.model_path(MODELS).exists()


# ─── Subtítulos ───────────────────────────────────────────────────────────


def test_elige_manual_en_espanol_antes_que_automaticos():
    info = {
        "language": "es",
        "subtitles": {"en": [{"ext": "vtt", "url": "u-en"}], "es-419": [{"ext": "json3", "url": "x"}, {"ext": "vtt", "url": "u-es"}]},
        "automatic_captions": {"es-orig": [{"ext": "vtt", "url": "a-es"}]},
    }
    assert subtitulos.pick_track(info) == ("es-419", "manual", "u-es")


def test_sin_manuales_usa_el_automatico_del_idioma_original():
    info = {"language": "es", "subtitles": {}, "automatic_captions": {"fr": [{"ext": "vtt", "url": "a-fr"}], "es-orig": [{"ext": "vtt", "url": "a-es"}], "es": [{"ext": "vtt", "url": "a-es2"}]}}
    assert subtitulos.pick_track(info) == ("es", "auto", "a-es")
    assert subtitulos.pick_track({"subtitles": {}, "automatic_captions": {"de": [{"ext": "vtt", "url": "x"}]}}) is None


def test_id_de_video_no_valido():
    with pytest.raises(JobError) as err:
        subtitulos.fetch("../../etc")
    assert not err.value.retry


# ─── Fondo y recorte ──────────────────────────────────────────────────────


def test_fondo_a_1280x720_sin_deformar(tmp_path: Path):
    src = tmp_path / "f.png"
    Image.new("RGB", (1536, 1024), (10, 200, 30)).save(src)
    out = trabajos.to_thumbnail_jpeg(src, tmp_path / "f.jpg")
    with Image.open(out) as im:
        assert im.size == (1280, 720) and im.format == "JPEG"
    bad = tmp_path / "x.png"
    bad.write_bytes(b"no soy una imagen")
    with pytest.raises(JobError):
        trabajos.to_thumbnail_jpeg(bad, tmp_path / "x.jpg")


def test_sin_modelo_avisa(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CUTOUT_MODEL", str(tmp_path / "no-existe.onnx"))
    monkeypatch.setattr(recorte, "_session", None)
    with pytest.raises(recorte.CutoutUnavailable):
        recorte.cutout(FIXTURES / "astronaut.jpg", tmp_path / "r.png", tmp_path)


@pytest.mark.skipif(not has_model and not __import__("os").environ.get("CUTOUT_MODEL"), reason="sin modelo de recorte")
def test_recorta_a_la_persona(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(recorte, "_session", None)
    out = recorte.cutout(FIXTURES / "astronaut.jpg", tmp_path / "r.png", MODELS)
    with Image.open(out) as im:
        assert im.mode == "RGBA"
        alpha = np.asarray(im.getchannel("A"))
    h, w = alpha.shape
    # La cara (centro, arriba) queda opaca; la esquina de arriba a la derecha (fondo), transparente.
    assert alpha[int(h * 0.3), int(w * 0.5)] > 200
    assert alpha[2, w - 3] < 40
    assert 0.2 < (alpha > 128).mean() < 0.95


def test_una_foto_sin_persona_no_se_recorta(tmp_path: Path, monkeypatch):
    if not has_model and not __import__("os").environ.get("CUTOUT_MODEL"):
        pytest.skip("sin modelo de recorte")
    monkeypatch.setattr(recorte, "_session", None)
    flat = tmp_path / "plano.jpg"
    Image.new("RGB", (800, 800), (128, 128, 128)).save(flat)
    with pytest.raises(recorte.NoPerson):
        recorte.cutout(flat, tmp_path / "r.png", MODELS)


# ─── Trabajo YT_THUMBNAILS ────────────────────────────────────────────────


@dataclass
class FakeApp:
    creds: dict[str, Any]
    uploads: dict[str, bytes] = field(default_factory=dict)
    backgrounds: list[tuple[str, str | None, str | None, str | None]] = field(default_factory=list)
    cutouts: list[tuple[str, str | None, str, str | None]] = field(default_factory=list)

    def download(self, key: str, dest: Path) -> Path:
        dest.write_bytes((FIXTURES / "astronaut.jpg").read_bytes())
        return dest

    def upload(self, key: str, path: Path, content_type: str) -> None:
        self.uploads[key] = path.read_bytes()

    def credentials(self) -> dict[str, Any]:
        return self.creds

    def background(self, concept_id: str, key: str | None, provider: str | None, error: str | None = None) -> dict[str, Any]:
        self.backgrounds.append((concept_id, key, provider, error))
        return {"ok": True}

    def cutout(self, photo_key: str, key: str | None, method: str, error: str | None = None) -> dict[str, Any]:
        self.cutouts.append((photo_key, key, method, error))
        return {"ok": True}

    def save_chatgpt_auth(self, auth_json: str) -> dict[str, Any]:
        return {}


def ctx_for(tmp_path: Path, job_input: dict[str, Any], models: Path) -> SimpleNamespace:
    stages: list[str] = []
    return SimpleNamespace(
        job={"id": "11111111-1111-1111-1111-111111111111", "input": job_input, "attempts": 1, "max_attempts": 1},
        input=job_input,
        config=SimpleNamespace(work_dir=tmp_path / "work", models_dir=models),
        app=None,
        stage=lambda name, a, b: stages.append(name),
        progress=lambda f: None,
        check=lambda: None,
        stages=stages,
    )


@pytest.fixture()
def openai_server():
    sys.path.insert(0, str(FAKES))
    import openai_sim  # noqa: PLC0415

    server, url = openai_sim.serve()
    yield url, openai_sim
    server.shutdown()


def test_genera_fondos_con_openai_y_avisa_cada_uno(tmp_path: Path, openai_server, monkeypatch):
    url, sim = openai_server
    fake = FakeApp({"provider": "openai", "apiKey": "sk-prueba", "baseUrl": url, "model": "gpt-image-2.5-flare", "size": "1536x864", "quality": "medium"})
    monkeypatch.setattr(trabajos, "YoutubeApp", lambda app, job_id: fake)
    monkeypatch.setenv("CUTOUT_MODEL", str(tmp_path / "no-existe.onnx"))
    monkeypatch.setattr(recorte, "_session", None)
    pkg = "22222222-2222-2222-2222-222222222222"
    ctx = ctx_for(tmp_path, {"packageId": pkg, "concepts": [{"conceptId": "c1", "prompt": "Fondo uno"}, {"conceptId": "c2", "prompt": "Fondo dos"}], "photos": ["marca/fotos/a.jpg"]}, tmp_path)
    out = trabajos.yt_thumbnails(ctx)
    assert out["done"] == ["c1", "c2"]
    assert sim.last_request["size"] == "1536x864"
    assert [b[0] for b in fake.backgrounds] == ["c1", "c2"] and all(b[1] and b[1].startswith(f"miniaturas/{pkg}/") for b in fake.backgrounds)
    for key, data in fake.uploads.items():
        if key.endswith(".jpg"):
            path = tmp_path / "check.jpg"
            path.write_bytes(data)
            with Image.open(path) as im:
                assert im.size == (1280, 720)
    # Sin modelo, la foto se marca sin recorte (la app usa la foto entera).
    assert fake.cutouts == [("marca/fotos/a.jpg", None, "sin-recorte", "El recorte automático no está instalado: usamos tu foto entera con un degradado.")]
    assert not (tmp_path / "work" / f"youtube-{ctx.job['id']}").exists()


def test_si_falla_el_proveedor_marca_los_que_faltan(tmp_path: Path, openai_server, monkeypatch):
    url, _ = openai_server
    fake = FakeApp({"provider": "openai", "apiKey": "sk-sin-saldo", "baseUrl": url, "model": "m", "size": "1536x864"})
    monkeypatch.setattr(trabajos, "YoutubeApp", lambda app, job_id: fake)
    ctx = ctx_for(tmp_path, {"packageId": "p", "concepts": [{"conceptId": "c1", "prompt": "x"}, {"conceptId": "c2", "prompt": "y"}]}, tmp_path)
    with pytest.raises(JobError) as err:
        trabajos.yt_thumbnails(ctx)
    assert "sin saldo" in err.value.user_message
    assert [(b[0], b[1]) for b in fake.backgrounds] == [("c1", None), ("c2", None)]
    assert all(b[3] for b in fake.backgrounds)
