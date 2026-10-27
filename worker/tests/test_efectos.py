"""Mis efectos: la muestra (cuadro + clip en bucle) que el worker saca de la capa ya dibujada en el render y sube a
`editor/efectos/<id>/`. Una muestra que falla no corta el render; los ids raros se ignoran."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from video import efectos

EFFECT = "0b9f6f0e-6c2b-4a53-9a40-7f0b7f3f1a11"


def _clip(path: Path, seconds: float = 4.0) -> Path:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=1080x1920:rate=30:duration={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


def _probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


class _App:
    def __init__(self, fail: bool = False) -> None:
        self.uploads: list[tuple[str, str, dict[str, str] | None]] = []
        self.posts: list[tuple[str, dict[str, Any]]] = []
        self.fail = fail

    def upload(self, project_id: str | None, key: str, path: Path, content_type: str, owner: dict[str, str] | None = None) -> None:
        if self.fail:
            raise RuntimeError("sin red")
        assert path.exists() and path.stat().st_size > 0
        self.uploads.append((key, content_type, owner))

    def _post(self, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        self.posts.append((path, payload))
        return {"ok": True}


class _Ctx:
    def __init__(self, app: _App) -> None:
        self.app = app

    def check(self) -> None:
        return None


def test_muestra_corta_vp9_y_cuadro(tmp_path: Path) -> None:
    poster, sample = efectos.sample_files(_clip(tmp_path / "fx.mp4"), 4.0, tmp_path / "out")
    info = _probe(sample)
    assert info["streams"][0]["codec_name"] == "vp9"
    assert info["streams"][0]["width"] == efectos.SAMPLE_WIDTH
    assert float(info["format"]["duration"]) <= efectos.SAMPLE_SECONDS + 0.1
    assert poster.stat().st_size > 1000


def test_sube_a_las_claves_del_efecto_y_avisa(tmp_path: Path) -> None:
    clip = _clip(tmp_path / "fx.mp4", 2.0)
    app = _App()
    layers = [{"path": clip, "id": "cm1", "start": 1.0, "end": 3.0}]
    n = efectos.save_samples(_Ctx(app), [{"effectId": EFFECT, "compId": "cm1"}, {"effectId": "../otro", "compId": "cm1"}, {"effectId": EFFECT, "compId": "no-esta"}], layers, tmp_path)
    assert n == 1
    assert [u[0] for u in app.uploads] == [f"editor/efectos/{EFFECT}/poster.jpg", f"editor/efectos/{EFFECT}/muestra.webm"]
    assert all(u[2] == {"effectId": EFFECT} for u in app.uploads)
    assert app.posts == [(f"/api/worker/efectos/{EFFECT}/muestra", {"posterKey": f"editor/efectos/{EFFECT}/poster.jpg", "sampleKey": f"editor/efectos/{EFFECT}/muestra.webm"})]


def test_si_falla_la_subida_no_corta(tmp_path: Path) -> None:
    clip = _clip(tmp_path / "fx.mp4", 1.0)
    assert efectos.save_samples(_Ctx(_App(fail=True)), [{"effectId": EFFECT, "compId": "cm1"}], [{"path": clip, "id": "cm1", "start": 0, "end": 1}], tmp_path) == 0


@pytest.mark.parametrize("dur", [0.3, 12.0])
def test_duracion_de_la_muestra(tmp_path: Path, dur: float) -> None:
    _, sample = efectos.sample_files(_clip(tmp_path / "fx.mp4", max(1.0, min(dur, 5.0))), dur, tmp_path / "o")
    assert float(_probe(sample)["format"]["duration"]) <= efectos.SAMPLE_SECONDS + 0.1
