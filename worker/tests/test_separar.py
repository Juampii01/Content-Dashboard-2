"""AUDIO_SPLIT ("Sacar la música de un reel"): separación por tramos, lectura del audio y el trabajo de punta a punta,
con el modelo, la base y la app simulados (sin red). La calidad del modelo real se midió aparte (ver video/separar.py)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from comunes.errors import JobError
from video import separar


def fake_model(voice_share: float = 0.25):
    """Modelo de mentira: la voz es una parte fija de la mezcla y el resto se reparte en tres pistas."""
    calls: list[tuple[int, ...]] = []

    def run(x: np.ndarray) -> np.ndarray:
        calls.append(x.shape)
        assert x.shape == (1, 2, separar.SEGMENT) and x.dtype == np.float32
        mix = x[0]
        rest = mix * (1 - voice_share)
        return np.stack([rest * 0.5, rest * 0.3, rest * 0.2, mix * voice_share])[np.newaxis]

    return run, calls


@pytest.mark.parametrize("seconds", [0.7, 7.8, 21.3])
def test_separa_por_tramos_sin_costuras(seconds: float) -> None:
    n = int(seconds * separar.SAMPLE_RATE)
    rng = np.random.default_rng(1)
    mix = rng.uniform(-0.5, 0.5, (2, n)).astype(np.float32)
    run, calls = fake_model(0.25)
    seen: list[float] = []
    voice, rest = separar.separate(mix, Path("no-hace-falta.onnx"), run=run, on_progress=seen.append)
    assert voice.shape == rest.shape == mix.shape
    # Con un modelo lineal, el fundido entre tramos tiene que devolver exactamente la mezcla repartida.
    np.testing.assert_allclose(voice, mix * 0.25, atol=1e-5)
    np.testing.assert_allclose(rest, mix * 0.75, atol=1e-5)
    assert len(calls) == max(1, -(-n // (separar.SEGMENT - separar.OVERLAP)))
    assert seen[-1] == 1.0


def test_para_si_se_cancela() -> None:
    mix = np.zeros((2, separar.SEGMENT * 3), dtype=np.float32)
    run, _ = fake_model()

    class Stop(Exception):
        pass

    def check() -> None:
        raise Stop()

    with pytest.raises(Stop):
        separar.separate(mix, Path("x"), run=run, check=check)


def make_media(path: Path, *, audio: bool = True, seconds: float = 2.0) -> Path:
    args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s=64x64:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={seconds}", "-ac", "1", "-c:a", "aac"]
    args += ["-c:v", "libx264", "-shortest", str(path)]
    subprocess.run(args, check=True)
    return path


def test_lee_el_audio_en_estereo_44k(tmp_path: Path) -> None:
    src = make_media(tmp_path / "video.mp4", seconds=2.0)
    mix = separar.decode(src, tmp_path / "mezcla.f32")
    assert mix.shape[0] == 2 and mix.dtype == np.float32
    assert abs(mix.shape[1] / separar.SAMPLE_RATE - 2.0) < 0.1
    assert np.max(np.abs(mix)) > 0.1


def test_video_sin_sonido_da_un_error_claro(tmp_path: Path) -> None:
    src = make_media(tmp_path / "mudo.mp4", audio=False)
    with pytest.raises(JobError) as err:
        separar.decode(src, tmp_path / "mezcla.f32")
    assert err.value.retry is False and "no tiene sonido" in err.value.user_message


def test_falta_el_modelo(tmp_path: Path) -> None:
    with pytest.raises(JobError) as err:
        separar.model_path(tmp_path)
    assert "soporte" in err.value.user_message


class FakeConn:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.updates: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()) -> Any:
        if sql.startswith("UPDATE"):
            self.updates.append((sql, params))
        return SimpleNamespace(fetchone=lambda: self.row)


class FakeApp:
    def __init__(self, src: Path) -> None:
        self.src = src
        self.uploaded: dict[str, tuple[bytes, str]] = {}
        self.results: list[tuple[str, dict]] = []

    def download(self, _project: Any, key: str, dest: Path, _progress: Any = None, owner: dict | None = None) -> Path:
        assert key == "editor/musica/0a997792-9dce-4853-9406-63c308726721/original.mp4"
        assert owner == {"trackId": "0a997792-9dce-4853-9406-63c308726721"}
        dest.write_bytes(self.src.read_bytes())
        return dest

    def upload(self, _project: Any, key: str, path: Path, content_type: str, owner: dict | None = None) -> None:
        assert owner == {"trackId": "0a997792-9dce-4853-9406-63c308726721"}
        self.uploaded[key] = (path.read_bytes(), content_type)

    def music_result(self, track_id: str, payload: dict) -> dict:
        self.results.append((track_id, payload))
        return {"status": "READY"}


def run_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, voice_share: float) -> tuple[dict, FakeApp]:
    track = "0a997792-9dce-4853-9406-63c308726721"
    src = make_media(tmp_path / "subido.mp4", seconds=3.0)
    (tmp_path / "models" / "htdemucs").mkdir(parents=True)
    (tmp_path / "models" / separar.MODEL_FILE).write_bytes(b"onnx")
    run, _ = fake_model(voice_share)
    real = separar.separate
    monkeypatch.setattr(separar, "separate", lambda mix, model, **kw: real(mix, model, run=run, **kw))
    app = FakeApp(src)
    conn = FakeConn({"status": "PROCESSING", "file_key": f"editor/musica/{track}/pista.m4a", "source_key": f"editor/musica/{track}/original.mp4"})
    ctx = SimpleNamespace(
        input={"trackId": track, "sourceKind": "upload", "sourceKey": f"editor/musica/{track}/original.mp4"},
        conn=conn,
        app=app,
        config=SimpleNamespace(models_dir=tmp_path / "models", work_dir=tmp_path / "trabajo"),
        stage=lambda *_: None,
        progress=lambda *_: None,
        check=lambda: None,
    )
    out = separar.split_audio.__wrapped__(ctx) if hasattr(separar.split_audio, "__wrapped__") else separar.split_audio(ctx)
    return out, app


def test_trabajo_completo_sube_la_pista_sin_voz(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out, app = run_job(tmp_path, monkeypatch, voice_share=0.25)
    key = "editor/musica/0a997792-9dce-4853-9406-63c308726721/pista.m4a"
    assert list(app.uploaded) == [key]
    data, content_type = app.uploaded[key]
    assert content_type == "audio/mp4" and len(data) > 1000
    track, payload = app.results[0]
    assert track == "0a997792-9dce-4853-9406-63c308726721"
    assert abs(payload["duration"] - 3.0) < 0.1 and payload["bytes"] == len(data)
    assert out["status"] == "READY"
    # El video y la voz no quedan en el worker.
    assert not (tmp_path / "trabajo" / "separar" / "0a997792-9dce-4853-9406-63c308726721").exists()


def test_si_es_solo_voz_avisa(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(JobError) as err:
        run_job(tmp_path, monkeypatch, voice_share=1.0)
    assert "solo voz" in err.value.user_message


def test_marca_la_pista_como_fallida() -> None:
    conn = FakeConn(None)
    separar.mark_failed(conn, {"input": {"trackId": "abc"}}, "Ese video no tiene sonido.")
    assert conn.updates and conn.updates[0][1] == ("Ese video no tiene sonido.", "abc")


def test_registrado_y_en_capacidades() -> None:
    from comunes.config import Config  # noqa: PLC0415
    from comunes.runner import _handlers  # noqa: PLC0415

    assert "AUDIO_SPLIT" in _handlers
    assert "AUDIO_SPLIT" in Config.__dataclass_fields__["capabilities"].default_factory()
