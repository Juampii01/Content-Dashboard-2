"""Carruseles en el worker: medidas (Tesseract y colores), descarga de links, Codex simulado y API de OpenAI simulada.

    pytest tests/test_carruseles.py
Las pruebas de medidas necesitan Tesseract instalado (se saltan si no está). No sale nada a la red.
"""

from __future__ import annotations

import json
import stat
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from carruseles import descarga, medidas, openai_api
from comunes.errors import JobError

FAKES = Path(__file__).resolve().parent / "fakes"
FONTS = Path(medidas.FONTS_DIR)
needs_ocr = pytest.mark.skipif(not medidas.tesseract_available(), reason="Tesseract no está instalado")


# ─── Utilidades ───────────────────────────────────────────────────────────


def wrapper(tmp: Path, name: str, script: Path) -> Path:
    """Un ejecutable `name` en tmp/bin que corre el script simulado con este mismo Python."""
    bin_dir = tmp / "bin"
    bin_dir.mkdir(exist_ok=True)
    exe = bin_dir / name
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n')
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return exe


def font(name: str, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / name), size)
    if weight:
        f.set_variation_by_axes([weight])
    return f


def slide_photo_text(path: Path, headline: list[tuple[str, tuple[int, int, int]]], body: str | None, seed: int = 1) -> None:
    """Slide sintético: foto arriba (62 %), fondo #111, titular en Anton blanco con una palabra amarilla, cuerpo gris."""
    rng = np.random.default_rng(seed)
    im = Image.new("RGB", (1080, 1350), (17, 17, 17))
    photo = Image.new("RGB", (1080, 837), (70, 90, 140))
    d = ImageDraw.Draw(photo)
    for _ in range(12):
        r = int(rng.integers(60, 220))
        cx, cy = int(rng.integers(0, 1080)), int(rng.integers(0, 837))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(int(v) for v in rng.integers(30, 230, 3)))
    photo = photo.filter(ImageFilter.GaussianBlur(10))
    arr = np.clip(np.asarray(photo).astype(float) + rng.normal(0, 9, (837, 1080, 3)), 0, 255).astype(np.uint8)
    im.paste(Image.fromarray(arr), (0, 0))
    d = ImageDraw.Draw(im)
    f = font("anton-latin-400-normal.woff2", 96)
    y = 900
    for words in [headline[:3], headline[3:]]:
        x = 80
        for text, color in words:
            d.text((x, y), text, font=f, fill=color)
            x += int(d.textlength(text + " ", font=f))
        y += 104
    if body:
        d.text((80, y + 20), body, font=font("inter-latin-wght-normal.woff2", 34, 400), fill=(160, 160, 160))
    im.save(path)


# ─── Colores ──────────────────────────────────────────────────────────────


def test_kmeans_separa_fondo_y_acento():
    img = np.zeros((100, 100, 3), np.uint8)
    img[:] = (10, 10, 10)
    img[:20, :20] = (250, 200, 20)
    centers, shares = medidas.kmeans(img, 3)
    assert medidas.to_hex(centers[0]) == "#0a0a0a"
    assert shares[0] == pytest.approx(0.96, abs=0.01)
    assert any(medidas.distance(c, (250, 200, 20)) < 5 for c in centers)


def test_palette_une_colores_casi_iguales():
    img = np.zeros((60, 60, 3), np.uint8)
    img[:, :30] = (240, 235, 224)
    img[:, 30:] = (241, 236, 225)
    pal = medidas.palette_of(img, 4)
    assert len(pal) == 1 and pal[0]["share"] == pytest.approx(1.0)


def test_acento_no_es_un_gris_oscuro():
    assert not medidas.is_colorful((17, 22, 27))
    assert medidas.is_colorful((29, 155, 240))


# ─── Medidas con Tesseract ────────────────────────────────────────────────


@needs_ocr
def test_mide_slide_foto_arriba_texto_abajo(tmp_path: Path):
    white, yellow = (255, 255, 255), (250, 204, 21)
    paths = []
    for i, (words, body) in enumerate(
        [
            ([("TRES", white), ("HÁBITOS", white), ("QUE", white), ("CAMBIARON", yellow), ("MI", white), ("MAÑANA", white)], None),
            ([("SAL", white), ("A", white), ("CAMINAR", white), ("SIN", yellow), ("TELÉFONO", yellow)], "Veinte minutos de aire antes de cualquier pantalla."),
        ]
    ):
        p = tmp_path / f"{i + 1:02d}.png"
        slide_photo_text(p, words, body, seed=i + 1)
        paths.append(p)
    m = medidas.measure_all(paths)
    s = m["summary"]
    assert s["background"] == "#111111"
    assert s["uses_photo"] is True
    assert s["fonts"]["headline"] == "anton"
    assert s["accent"] and medidas.distance(medidas.from_hex(s["accent"]), (250, 204, 21)) < 40
    first = m["slides"][0]
    assert first["photo"]["present"] and first["photo"]["y"] < 0.05 and 0.55 < first["photo"]["h"] < 0.7
    head = next(b for b in first["text_blocks"] if b["role"] == "headline")
    assert head["upper_ratio"] > 0.9 and head["align"] == "left"
    assert 80 < head["font_px"] < 115  # 96 px reales
    assert head["y"] > 0.62
    # El texto leído no sale de la función: solo geometría y color.
    assert "MAÑANA" not in json.dumps(m) and "CAMBIARON" not in json.dumps(m)


@needs_ocr
def test_mide_editorial_serif_con_linea_y_contador(tmp_path: Path):
    paths = []
    for i, (kicker, head) in enumerate([("PRIMERO", "La prisa es el enemigo"), ("SEGUNDO", "Tu ritmo no es el de nadie")]):
        im = Image.new("RGB", (1080, 1350), (241, 235, 224))
        d = ImageDraw.Draw(im)
        d.text((92, 96), kicker, font=font("jetbrains-mono-latin-wght-normal.woff2", 26, 500), fill=(60, 56, 50))
        d.rectangle([92, 160, 212, 162], fill=(28, 26, 23))
        d.text((92, 560), head, font=font("instrument-serif-latin-400-normal.woff2", 104), fill=(28, 26, 23))
        d.text((92, 720), "Cuando todo urge, nada importa. Escoge una cosa.", font=font("inter-latin-wght-normal.woff2", 38, 400), fill=(91, 84, 74))
        d.text((900, 1230), f"0{i + 1} / 04", font=font("jetbrains-mono-latin-wght-normal.woff2", 26, 500), fill=(91, 84, 74))
        p = tmp_path / f"{i + 1:02d}.png"
        im.save(p)
        paths.append(p)
    m = medidas.measure_all(paths)
    assert m["summary"]["background"] == "#f1ebe0"
    assert m["summary"]["fonts"]["headline"] == "instrument"
    assert m["summary"]["uses_photo"] is False
    s = m["slides"][0]
    assert s["background"]["kind"] == "solid"
    assert any(abs(l["y"] - 160 / 1350) < 0.01 and l["thickness"] <= 6 for l in s["ornaments"]["hlines"])
    assert s["ornaments"]["counter"] is not None
    roles = {b["role"] for b in s["text_blocks"]}
    assert {"headline", "body", "kicker"} <= roles


def test_sin_tesseract_avisa(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(medidas, "tesseract_available", lambda: False)
    with pytest.raises(medidas.OcrMissing):
        medidas.measure_all([tmp_path / "x.png"])


# ─── Descarga de links ────────────────────────────────────────────────────


def test_link_no_valido():
    with pytest.raises(JobError) as err:
        descarga.clean_link("https://example.com/p/abc")
    assert "Instagram" in err.value.user_message
    assert descarga.clean_link("https://www.instagram.com/p/DAbc123xyz/?igsh=xyz") == "https://www.instagram.com/p/DAbc123xyz/"


def test_descarga_con_gallery_dl_simulado(tmp_path: Path, monkeypatch):
    exe = wrapper(tmp_path, "gallery-dl", FAKES / "fake_gallery_dl.py")
    src = tmp_path / "post"
    src.mkdir()
    for i in range(3):
        Image.new("RGB", (1080, 1350), (i * 40, 20, 20)).save(src / f"img{i}.jpg")
    monkeypatch.setenv("GALLERY_DL_BIN", str(exe))
    monkeypatch.setenv("FAKE_GALLERY_DIR", str(src))
    files = descarga.download_post("https://www.instagram.com/p/DAbc123xyz/", tmp_path / "out")
    assert [f.name for f in files] == ["01.jpg", "02.jpg", "03.jpg"]


def test_descarga_que_pide_sesion_da_error_claro(tmp_path: Path, monkeypatch):
    exe = wrapper(tmp_path, "gallery-dl", FAKES / "fake_gallery_dl.py")
    monkeypatch.setenv("GALLERY_DL_BIN", str(exe))
    monkeypatch.setenv("FAKE_GALLERY_FAIL", "1")
    with pytest.raises(JobError) as err:
        descarga.download_post("https://www.instagram.com/p/DAbc123xyz/", tmp_path / "out")
    assert err.value.user_message == "No pudimos bajar ese link. Descarga las imágenes y súbelas."
    assert err.value.retry is False


# ─── API de OpenAI simulada ───────────────────────────────────────────────


@pytest.fixture()
def openai_server():
    sys.path.insert(0, str(FAKES))
    import openai_sim  # noqa: PLC0415

    server, url = openai_sim.serve()
    yield url, openai_sim
    server.shutdown()


def test_openai_genera_y_edita(tmp_path: Path, openai_server):
    url, sim = openai_server
    creds = {"apiKey": "sk-prueba", "baseUrl": url, "model": "gpt-image-2.5-flare", "size": "1088x1360", "quality": "medium"}
    img = openai_api.generate_image(creds, "Escena", [], tmp_path / "a.png")
    assert Image.open(img).size == (1088, 1360)
    assert sim.last_request["path"].endswith("/images/generations") and sim.last_request["model"] == "gpt-image-2.5-flare"
    openai_api.generate_image(creds, "Otra", [img], tmp_path / "b.png")
    assert sim.last_request["path"].endswith("/images/edits") and sim.last_request["images"] == 1


@pytest.mark.parametrize(("key", "fragment", "retry"), [("sk-invalida", "no es válida", False), ("sk-sin-saldo", "sin saldo", False)])
def test_openai_errores(tmp_path: Path, openai_server, key: str, fragment: str, retry: bool):
    url, _ = openai_server
    with pytest.raises(JobError) as err:
        openai_api.generate_image({"apiKey": key, "baseUrl": url}, "x", [], tmp_path / "a.png")
    assert fragment in err.value.user_message and err.value.retry is retry
