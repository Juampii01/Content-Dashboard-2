"""Sincronía de punta a punta: el MP4 final tiene que mostrar y sonar, en cada momento, el instante del original que dice
el timeline de la app (el mismo que usa la vista previa del Estudio).

Se renderiza con el trabajo VIDEO_RENDER de verdad (`pipeline.render_job`, sin base ni red: la base y la app se
simulan) un original sintético cuya imagen y cuyo audio codifican el tiempo (ver `sync_media.py`), y se mide:
- Imagen: el cuadro del original que se ve en cada cuadro del final, contra el que dice el timeline (exacto).
- Audio: el desfase del audio final contra el original en el lugar esperado, en puntos repartidos (±40 ms).

- `test_sync_short_*` (siempre): ~20 s, gancho movido al principio, pausas acortadas, un bloque movido, zooms,
  efectos de sonido y música.
- `test_sync_full_*` (lentas, `pytest --slow`): el caso de worker/tests/fixtures/sync-plan.json, que arma la app con
  sus funciones (scripts/make-sync-fixture.mts): ~65 s, gancho movido, 13 cortes de pausa, un bloque movido, zooms,
  6 gráficos con marca, un b-roll en pantalla dividida, 6 efectos de la biblioteca (portada de revista, checklist,
  vértigo, zoom en el corte, zoom digital, giro 3D), efectos de sonido, música y audio de estudio Suave y Fuerte.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from comunes import db
from comunes.runner import JobContext
from video import fx, motion, pipeline, render, studio

from tests import sync_media as sm

FIXTURES = Path(__file__).resolve().parent / "fixtures"
WORKER = Path(__file__).resolve().parent.parent
FONTS = WORKER / "fonts"
MODELS = WORKER / "models"
TOLERANCE = 0.040


class FakeApp:
    """La app simulada: las descargas salen de archivos locales y las subidas quedan en una carpeta."""

    def __init__(self, files: dict[str, Path], out: Path) -> None:
        self.files, self.out = files, out

    def download(self, project_id: str | None, key: str, dest: Path, on_progress: Any = None, owner: Any = None) -> Path:
        shutil.copyfile(self.files[key], dest)
        return dest

    def download_url(self, url: str, dest: Path, allowed_hosts: tuple[str, ...], max_bytes: int = 0) -> Path:
        shutil.copyfile(self.files[url], dest)
        return dest

    def upload(self, project_id: str | None, key: str, path: Path, content_type: str, owner: Any = None) -> None:
        target = self.out / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)

    def director(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        return {}


@pytest.fixture(scope="module")
def assets(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    work = tmp_path_factory.mktemp("sync-assets")
    music, stock = work / "musica.wav", work / "stock.mp4"
    sm.make_music(music)
    sm.make_stock(stock)
    return {"music": music, "stock": stock}


def render_case(tmp: Path, words: list[dict[str, Any]], seconds: float, data: dict[str, Any], assets: dict[str, Path], monkeypatch: pytest.MonkeyPatch, source: Path | None = None) -> tuple[Path, Path, dict[str, Any]]:
    """Renderiza con `pipeline.render_job`. Devuelve el MP4 final, el WAV del original (contra el que se mide) y lo
    que el trabajo guardó en el proyecto (control de calidad incluido)."""
    pid = data["projectId"]
    work = tmp / "work"
    workdir = work / pid
    workdir.mkdir(parents=True, exist_ok=True)
    if source is None:
        source = tmp / "original.mp4"
        sm.make_source(source, words, seconds, tmp)
    shutil.copyfile(source, workdir / "original.mp4")
    project = {"id": pid, "status": "RENDERING", "source_key": "editor/original.mp4", "media": {}, "transcript": {"words": words}}
    saved: dict[str, Any] = {}
    monkeypatch.setattr(db, "get_project", lambda conn, project_id: project)
    monkeypatch.setattr(db, "update_project", lambda conn, project_id, **kw: saved.update(kw))
    files: dict[str, Path] = {}
    music = (data.get("audio") or {}).get("music")
    if music:
        files[music["key"]] = assets["music"]
    for b in data.get("broll") or []:
        if b.get("url"):
            files[b["url"]] = assets["stock"]
    out = tmp / "subidas"
    config = SimpleNamespace(work_dir=work, models_dir=MODELS, fonts_dir=FONTS, x264_preset="ultrafast", app_url="http://localhost:3000", broll_extra_hosts=())
    ctx = JobContext(job={"input": data}, config=config, conn=None, app=FakeApp(files, out), _progress=lambda v, s: None)  # type: ignore[arg-type]
    pipeline.render_job(ctx)
    return out / data["outputKey"], workdir / "audio.wav", saved


def assert_in_sync(final: Path, source_wav: Path, clips: list[dict[str, Any]], *, min_read: float) -> dict[str, Any]:
    video = sm.video_report(final, clips)
    audio = render.sync_offsets(final, source_wav, clips, points=24)
    confident = [p for p in audio if p["r"] >= render.SYNC_CONFIDENT]
    off = [p for p in confident if abs(p["lag"]) > TOLERANCE]
    report = {"video": video, "audio_points": len(audio), "audio_confident": len(confident), "audio_max_ms": round(max((abs(p["lag"]) for p in confident), default=0) * 1000, 1), "audio_off": off[:6]}
    print(json.dumps(report, ensure_ascii=False))
    assert video["frames"] == video["expected"], report
    assert video["wrong"] == 0, f"la imagen no es la del timeline: {report}"
    assert video["read"] >= min_read * video["expected"], f"se leyeron pocos cuadros: {report}"
    assert audio and len(confident) >= 0.8 * len(audio), f"el audio no coincide con el original en el lugar esperado: {report}"
    assert not off, f"el audio está corrido más de {TOLERANCE * 1000:.0f} ms: {report}"
    return report


# ─── Versión corta (siempre) ───────────────────────────────────────────────


def short_case() -> tuple[list[dict[str, Any]], float, dict[str, Any]]:
    """~20 s de "voz": 60 palabras con dos pausas largas. Gancho (palabras 30–41) al principio, pausas acortadas
    (tramos partidos), un bloque movido (palabras 12–19 después de la 50), zooms, efectos de sonido y música."""
    words, t = [], 0.3
    for i in range(60):
        d = 0.16 + 0.13 * ((i * 7) % 5) / 4
        words.append({"id": i, "text": "palabra." if i % 10 == 9 else "palabra", "start": round(t, 3), "end": round(t + d, 3)})
        t += d + (0.9 if i in (24, 44) else 0.25 if i % 10 == 9 else 0.05)
    seconds = round(t + 0.6, 2)

    def frames(a: int, b: int) -> dict[str, int]:
        return {"start": int(round((words[a]["start"] - 0.08) * 30)), "end": int(round((words[b]["end"] + 0.12) * 30))}

    # El orden del timeline: gancho, cuerpo hasta la 11, de la 20 a la 24, (pausa larga acortada) 25–29, 42–44,
    # 45–50, el bloque movido 12–19 y el resto.
    clips = [
        {**frames(30, 41), "role": "hook"},
        {**frames(0, 11), "role": "body"},
        {**frames(20, 24), "role": "body"},
        {**frames(25, 29), "role": "body"},
        {**frames(42, 44), "role": "body"},
        {**frames(45, 50), "role": "body"},
        {**frames(12, 19), "role": "body"},
        {**frames(51, 59), "role": "body"},
    ]
    duration = sum(c["end"] - c["start"] for c in clips) / 30
    data = {
        "projectId": "00000000-0000-4000-8000-0000000005c7",
        "format": "9:16",
        "fps": 30,
        "clips": clips,
        "expectedDuration": duration,
        "framing": {"offsetX": 0, "focusY": 0.42},
        "captions": {"preset": "ninguno", "blocks": []},
        "zooms": [{"start": 1.0, "end": 2.6, "scale": 1.25, "ramp": 0}, {"start": 5.2, "end": 7.0, "scale": 1.15, "ramp": 0.35}, {"start": 9.0, "end": 10.4, "scale": 1.3, "ramp": 0}],
        "broll": [],
        "effects": [],
        "srt": "",
        "audio": {
            "targetLufs": -14,
            "truePeak": -1,
            "sfx": [{"name": "whoosh", "at": 0.9, "gain": -14}, {"name": "riser", "at": 2.0, "gain": -16}, {"name": "pop", "at": 8.0, "gain": -14}],
            "music": {"trackId": "00000000-0000-4000-8000-000000000001", "key": "editor/musica/00000000-0000-4000-8000-000000000001/pista.wav", "db": -16},
            "studio": "off",
        },
        "phraseFixes": [],
        "outputKey": "prueba/corto.mp4",
        "srtKey": "prueba/corto.srt",
        "posterKey": "prueba/corto.jpg",
    }
    return words, seconds, data


@pytest.fixture(scope="module")
def short_render(tmp_path_factory: pytest.TempPathFactory, assets: dict[str, Path]) -> tuple[Path, Path, dict[str, Any], dict[str, Any]]:
    words, seconds, data = short_case()
    with pytest.MonkeyPatch.context() as mp:
        final, wav, saved = render_case(tmp_path_factory.mktemp("sync-short"), words, seconds, data, assets, mp)
    return final, wav, saved, data


def test_sync_short_hook_pauses_moves_zooms_sfx_music(short_render: Any) -> None:
    final, wav, saved, data = short_render
    assert_in_sync(final, wav, data["clips"], min_read=0.95)
    checks = {c["name"]: c for c in saved["output_meta"]["qc"]["checks"]}
    assert checks["Sincronía con el original"]["ok"], checks


def test_sync_check_catches_a_render_that_does_not_follow_the_timeline(short_render: Any) -> None:
    """Un audio que no sigue el timeline queda como aviso; un desfase grande y repetido no se entrega."""
    final, wav, _, data = short_render
    clips = data["clips"]
    # El mismo MP4 medido contra un timeline sin el gancho al principio: no coincide → aviso.
    wrong = render.sync_check(final, wav, clips[1:] + clips[:1])
    assert wrong["warn"], wrong
    # Corrido 3 cuadros (100 ms): se detecta y se avisa, pero no frena la entrega.
    shifted = [{**c, "start": c["start"] + 3, "end": c["end"] + 3} for c in clips]
    late = render.sync_check(final, wav, shifted)
    assert late["warn"] and late["ok"] and "corrido" in late["detail"], late
    # Corrido 10 cuadros (333 ms): se nota a simple vista → no se entrega.
    far = [{**c, "start": c["start"] + 10, "end": c["end"] + 10} for c in clips]
    bad = render.sync_check(final, wav, far)
    assert not bad["ok"], bad


# ─── Versión completa (lenta) ──────────────────────────────────────────────

slow = [
    pytest.mark.slow,
    pytest.mark.skipif(not (FONTS / "Inter-Black.ttf").exists(), reason="faltan las fuentes (scripts/fetch_fonts.sh)"),
    pytest.mark.skipif(not motion.enabled() or not fx.enabled(), reason="falta Node o skia-canvas (cd worker/motion && npm ci)"),
]


@pytest.fixture(scope="module")
def full_case(tmp_path_factory: pytest.TempPathFactory) -> tuple[list[dict[str, Any]], float, dict[str, Any], Path]:
    case = json.loads((FIXTURES / "sync-plan.json").read_text(encoding="utf-8"))
    tmp = tmp_path_factory.mktemp("sync-full-src")
    source = tmp / "original.mp4"
    sm.make_source(source, case["words"], case["duration"], tmp)
    return case["words"], case["duration"], case["input"], source


@pytest.mark.slow
@pytest.mark.parametrize("studio_level", ["soft", "strong"])
def test_sync_full_owner_like_plan(studio_level: str, tmp_path: Path, assets: dict[str, Path], full_case: Any, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    for mark in slow:
        if mark.name == "skipif" and mark.args[0]:
            pytest.skip(mark.kwargs["reason"])
    if not studio.model_available(MODELS):
        pytest.skip("falta el modelo de audio de estudio (python scripts/fetch_models.py models --only deepfilternet)")
    words, seconds, data, source = full_case
    data = {**data, "audio": {**data["audio"], "studio": studio_level}}
    final, wav, saved = render_case(tmp_path, words, seconds, data, assets, monkeypatch, source=source)
    report = assert_in_sync(final, wav, data["clips"], min_read=0.5)
    checks = {c["name"]: c for c in saved["output_meta"]["qc"]["checks"]}
    assert checks["Sincronía con el original"]["ok"], checks
    assert report["video"]["read"] > 0


def test_cut_voice_exact_samples(tmp_path):
    """La voz cortada sale directo del WAV: cada tramo con sus muestras exactas, sin corrimientos entre tramos."""
    import wave

    import numpy as np

    from video import render

    n = 90 * render.SAMPLES_PER_FRAME
    ramp = (np.arange(n) % 30000).astype("<i2")  # cada muestra dice dónde está
    src = tmp_path / "audio.wav"
    with wave.open(str(src), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(render.SAMPLE_RATE)
        w.writeframes(ramp.tobytes())
    clips = [{"start": 3, "end": 30}, {"start": 40, "end": 85}, {"start": 88, "end": 95}]  # el último pasa del final
    out = tmp_path / "cut.wav"
    render.cut_voice(src, clips, out)
    with wave.open(str(out), "rb") as w:
        got = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    spf = render.SAMPLES_PER_FRAME
    assert len(got) == sum(c["end"] - c["start"] for c in clips) * spf
    fade = int(render.FADE * render.SAMPLE_RATE)
    # Lejos de los bordes, cada muestra es la del original en su lugar.
    mid = 10 * spf
    assert got[mid] == ramp[3 * spf + mid]
    second = 27 * spf
    assert got[second + mid] == ramp[40 * spf + mid]
    assert got[second + fade - fade] == 0  # empieza en silencio por el fundido
    # Lo que pasa del final del original es silencio.
    assert not got[-spf:].any()
