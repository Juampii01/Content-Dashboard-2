"""Transcripción local (Parakeet y faster-whisper): mapeo de la salida de cada librería a palabras.

Aquí no se cargan los modelos (no hay red hacia HuggingFace en las pruebas): se simulan las salidas con la
misma forma que devuelven `onnx-asr` (TimestampedSegmentResult) y `faster-whisper` (Segment.words).
La corrida real con los modelos queda para la imagen de Docker (ver docs/worker.md).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from comunes.errors import JobError
from video import transcribe


@dataclass
class Seg:
    """Igual que onnx_asr.vad.TimestampedSegmentResult: start/end del tramo y tokens con su inicio relativo."""

    start: float
    end: float
    text: str
    timestamps: list[float]
    tokens: list[str]
    logprobs: list[float] | None = None


def test_parakeet_tokens_become_words_with_offsets_and_punctuation() -> None:
    # "Hoy te voy, ¿quieres?" en subpalabras: los tokens con espacio adelante abren palabra.
    seg = Seg(
        start=1.20,
        end=3.10,
        text="Hoy te voy, ¿quieres?",
        tokens=[" Hoy", " te", " v", "oy", ",", " ¿", "qui", "eres", "?"],
        timestamps=[0.0, 0.32, 0.56, 0.64, 0.72, 1.04, 1.12, 1.28, 1.44],
        logprobs=[-0.01, -0.02, -0.2, -0.1, -0.05, -0.3, -0.1, -0.1, -0.01],
    )
    words = transcribe.words_from_token_segments([seg])
    assert [w["text"] for w in words] == ["Hoy", "te", "voy,", "¿quieres?"]
    assert words[0]["start"] == pytest.approx(1.20)
    assert words[1]["start"] == pytest.approx(1.52)
    # Una palabra termina donde empieza la siguiente…
    assert words[0]["end"] == pytest.approx(1.52)
    # …y la última, con un tope desde su último token, sin pasarse del tramo.
    assert words[-1]["end"] == pytest.approx(min(3.10, 1.20 + 1.44 + transcribe.MAX_WORD_TAIL))
    # Confianza: exp(media del logprob de los tokens de la palabra).
    assert words[2]["conf"] == pytest.approx(round(math.exp((-0.2 - 0.1 - 0.05) / 3), 3))
    for a, b in zip(words, words[1:]):
        assert a["end"] <= b["start"] + 1e-9


def test_parakeet_keeps_fillers_and_repetitions_across_segments() -> None:
    a = Seg(0.5, 1.6, "Eh, hoy hoy", tokens=[" Eh", ",", " hoy", " hoy"], timestamps=[0.0, 0.08, 0.4, 0.8])
    b = Seg(2.4, 3.0, "mm", tokens=[" mm"], timestamps=[0.0])
    words = transcribe.words_from_token_segments([a, b])
    assert [w["text"] for w in words] == ["Eh,", "hoy", "hoy", "mm"]
    assert words[3]["start"] == pytest.approx(2.4)
    assert words[3]["end"] <= 3.0
    assert "conf" not in words[0]  # sin logprobs no se inventa la confianza


def test_parakeet_ignores_broken_segments() -> None:
    bad = Seg(0, 1, "x", tokens=[" x", " y"], timestamps=[0.0])  # tokens y tiempos no calzan
    empty = Seg(0, 1, "", tokens=[], timestamps=[])
    assert transcribe.words_from_token_segments([bad, empty]) == []


@dataclass
class WWord:
    start: float
    end: float
    word: str
    probability: float


@dataclass
class WSeg:
    start: float
    end: float
    text: str
    words: list[WWord] = field(default_factory=list)


def test_whisper_words_mapping() -> None:
    segs = [
        WSeg(0.0, 1.0, " Eh, hola", [WWord(0.1, 0.3, " Eh,", 0.61), WWord(0.4, 0.9, " hola", 0.98)]),
        WSeg(1.0, 2.0, " mundo.", [WWord(1.1, 1.5, " mundo.", 0.9), WWord(1.6, 1.6, " ", 0.1)]),
    ]
    words = transcribe.words_from_whisper(segs)
    assert words == [
        {"text": "Eh,", "start": 0.1, "end": 0.3, "conf": 0.61},
        {"text": "hola", "start": 0.4, "end": 0.9, "conf": 0.98},
        {"text": "mundo.", "start": 1.1, "end": 1.5, "conf": 0.9},
    ]


def test_local_providers_are_skipped_without_models(tmp_path: Path) -> None:
    class Cfg:
        test_transcript = None
        deepgram_api_key = None
        groq_api_key = "g"
        models_dir = tmp_path
        transcribe_order = ("parakeet", "whisper", "deepgram", "groq")
        whisper_model = "small"

    assert [p.name for p in transcribe.providers(Cfg())] == ["groq"]


def test_order_and_fallback_to_next_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / transcribe.PARAKEET_DIR).mkdir()
    (tmp_path / transcribe.SILERO_DIR).mkdir()
    (tmp_path / "whisper-small").mkdir()

    class Cfg:
        test_transcript = None
        deepgram_api_key = None
        groq_api_key = None
        models_dir = tmp_path
        transcribe_order = ("parakeet", "whisper")
        whisper_model = "small"

    names = [p.name for p in transcribe.providers(Cfg())]
    assert names == ["parakeet", "whisper"]

    def parakeet_fails(self, audio, language, wav16=None):
        raise JobError("La transcripción falló. Vamos a reintentarlo.", detail="sin memoria")

    def whisper_ok(self, audio, language, wav16=None):
        return [{"text": "hola", "start": 0.2, "end": 0.5}]

    monkeypatch.setattr(transcribe.Parakeet, "transcribe", parakeet_fails)
    monkeypatch.setattr(transcribe.FasterWhisper, "transcribe", whisper_ok)
    name, words = transcribe.transcribe(Cfg(), tmp_path / "a.ogg", "es", tmp_path / "a.wav")
    assert name == "whisper" and words[0]["text"] == "hola"


def test_parakeet_needs_wav(tmp_path: Path) -> None:
    with pytest.raises(JobError):
        transcribe.Parakeet(tmp_path).transcribe(tmp_path / "a.ogg", "es", None)
