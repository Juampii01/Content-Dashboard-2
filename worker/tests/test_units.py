"""Pruebas sin red ni base: energía, subtítulos ASS, transcripción y lectura de ffprobe."""

import json
import math
import wave
from pathlib import Path

import numpy as np
import pytest

from comunes.db import backoff_seconds
from comunes.errors import JobError
from video import ass, energy, ingest, transcribe


def write_wav(path: Path, segments: list[tuple[float, float]], total: float, rate: int = 16000, noise: float = 0.002) -> None:
    """Tono de 220 Hz en los tramos indicados, ruido suave en el resto."""
    rng = np.random.default_rng(1)
    t = np.arange(int(total * rate)) / rate
    signal = rng.normal(0, noise, len(t))
    for a, b in segments:
        mask = (t >= a) & (t < b)
        signal[mask] += 0.3 * np.sin(2 * math.pi * 220 * t[mask])
    data = (np.clip(signal, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


def test_energy_moves_edges_to_the_voice(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    write_wav(wav, [(1.00, 1.50), (2.00, 2.60)], 3.5)
    db, threshold = energy.load_energy(wav)
    # El proveedor se equivocó: la primera palabra empieza tarde y termina antes; la segunda incluye silencio.
    words = [{"text": "hola", "start": 1.08, "end": 1.30}, {"text": "mundo", "start": 1.90, "end": 2.50}]
    out = energy.refine(words, db, threshold, 3.5)
    assert abs(out[0]["start"] - 1.00) <= 0.02
    assert abs(out[0]["end"] - 1.48) <= 0.03  # se estiró hasta la cola real (dentro del máximo de 0.18 s)
    assert abs(out[1]["start"] - 2.00) <= 0.02
    assert abs(out[1]["end"] - 2.60) <= 0.03
    assert out[0]["end"] <= out[1]["start"]


def test_energy_never_overlaps(tmp_path: Path) -> None:
    wav = tmp_path / "b.wav"
    write_wav(wav, [(0.5, 2.0)], 2.5)
    db, threshold = energy.load_energy(wav)
    words = [{"text": w, "start": 0.5 + i * 0.3, "end": 0.5 + i * 0.3 + 0.25} for i, w in enumerate("uno dos tres cuatro cinco".split())]
    out = energy.refine(words, db, threshold, 2.5)
    for a, b in zip(out, out[1:]):
        assert a["end"] <= b["start"] + 1e-9
        assert a["end"] > a["start"]


def test_ass_colors_and_times() -> None:
    assert ass.ass_color("#FF8800") == "&H000088FF"
    assert ass.ass_time(3723.456) == "1:02:03.46"


def captions(preset: str) -> dict:
    return {
        "preset": preset,
        "accent": "#00AAFF",
        "blocks": [
            {"start": 0.0, "end": 1.2, "words": [{"text": "Hoy", "start": 0, "end": 0.3, "emphasis": False}, {"text": "te", "start": 0.35, "end": 0.5, "emphasis": False}, {"text": "cuento", "start": 0.55, "end": 1.2, "emphasis": True}]},
        ],
    }


def test_ass_classic_one_event_per_active_word() -> None:
    text = ass.build_ass(captions("clasico"), 1080, 1920, "9:16")
    events = [l for l in text.splitlines() if l.startswith("Dialogue:")]
    assert len(events) == 3
    assert "PlayResY: 1920" in text and "Montserrat ExtraBold" in text
    assert "{\\c&H00FFAA00" in events[2]  # la palabra activa en el color de acento
    margin_v = int(next(l for l in text.splitlines() if l.startswith("Style:")).split(",")[-2])
    assert margin_v >= 0.2 * 1920  # fuera del 20 % inferior


def test_ass_pop_uppercase_with_scale() -> None:
    text = ass.build_ass(captions("pop"), 1080, 1920, "9:16")
    events = [l for l in text.splitlines() if l.startswith("Dialogue:")]
    assert len(events) == 1 and "HOY TE" in events[0] and "\\t(0,90" in events[0]


def test_parse_deepgram_and_groq() -> None:
    dg = {"results": {"channels": [{"alternatives": [{"words": [{"word": "hola", "punctuated_word": "Hola,", "start": 0.1, "end": 0.4, "confidence": 0.98}]}]}]}}
    assert transcribe.parse_deepgram(dg) == [{"text": "Hola,", "start": 0.1, "end": 0.4, "conf": 0.98}]
    groq = {"words": [{"word": "hola", "start": 0.1, "end": 0.4}, {"word": "mundo", "start": 0.5, "end": 0.9}], "segments": [{"start": 0.0, "end": 1.0, "text": " Hola, mundo."}]}
    assert [w["text"] for w in transcribe.parse_groq(groq)] == ["Hola,", "mundo."]
    with pytest.raises(JobError):
        transcribe.parse_deepgram({"results": {}})


def test_fixture_provider_and_sanitize(tmp_path: Path) -> None:
    path = tmp_path / "t.json"
    path.write_text(json.dumps({"words": [{"text": "b", "start": 1, "end": 1.2}, {"text": " ", "start": 0, "end": 0.1}, {"text": "a", "start": 0.2, "end": 0.5}]}))

    class Cfg:
        test_transcript = str(path)
        deepgram_api_key = "x"
        groq_api_key = None

    name, words = transcribe.transcribe(Cfg(), tmp_path / "audio.ogg", "es")
    assert name == "prueba" and [w["text"] for w in words] == ["a", "b"]


def test_transcribe_without_providers_fails_clearly() -> None:
    class Cfg:
        test_transcript = None
        deepgram_api_key = None
        groq_api_key = None

    with pytest.raises(JobError) as exc:
        transcribe.transcribe(Cfg(), Path("x"), "es")
    assert exc.value.retry is False


def probe(**video) -> dict:
    base = {"codec_type": "video", "codec_name": "hevc", "width": 1920, "height": 1080, "r_frame_rate": "30/1", "avg_frame_rate": "30/1", "start_time": "0"}
    base.update(video)
    return {"streams": [base, {"codec_type": "audio", "start_time": "0.02"}], "format": {"duration": "12.5"}}


def test_probe_rotation_hdr_vfr() -> None:
    info = ingest.analyze_probe(probe(side_data_list=[{"rotation": -90}], color_transfer="arib-std-b67", color_primaries="bt2020", r_frame_rate="600/1", avg_frame_rate="2997/100"))
    assert (info["width"], info["height"]) == (1080, 1920)
    assert info["hdr"] is True and info["vfr"] is True and info["rotation"] == -90
    assert info["audioStart"] == pytest.approx(0.02)


def test_probe_rejects_bad_inputs() -> None:
    with pytest.raises(JobError):
        ingest.analyze_probe({"streams": [probe()["streams"][0]], "format": {"duration": "10"}})  # sin audio
    with pytest.raises(JobError):
        ingest.analyze_probe({**probe(), "format": {"duration": "4000"}})  # más de 20 min


def test_mezzanine_and_proxy_sizes() -> None:
    assert ingest.mezzanine_size(3840, 2160) == (1920, 1080)
    assert ingest.mezzanine_size(2160, 3840) == (1080, 1920)
    assert ingest.mezzanine_size(1280, 720) == (1920, 1080)
    assert ingest.mezzanine_size(640, 360) == (640, 360)
    assert ingest.mezzanine_size(1440, 1080) == (1440, 1080)
    assert ingest.proxy_size(1080, 1920) == (540, 960)


def test_backoff_grows() -> None:
    assert [backoff_seconds(n) for n in (1, 2, 3)] == [30, 120, 480]
    assert backoff_seconds(10) == 1800

