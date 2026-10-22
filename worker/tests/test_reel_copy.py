"""REEL_COPY ("Copia este reel"): lo que el worker entrega a la app y sus validaciones (sin red ni base)."""

from __future__ import annotations

import pytest

from comunes.errors import JobError
from video import reel_copy


def test_plain_words_solo_texto_y_tiempos() -> None:
    words = [
        {"id": 0, "text": "Hola", "start": 0.1234, "end": 0.5, "confidence": 0.9},
        {"id": 1, "text": "  ", "start": 0.6, "end": 0.7},
        {"id": 2, "text": "mundo.", "start": 0.8, "end": 1.2},
    ]
    assert reel_copy.plain_words(words) == [{"text": "Hola", "start": 0.123, "end": 0.5}, {"text": "mundo.", "start": 0.8, "end": 1.2}]


def test_ids_validos() -> None:
    assert reel_copy._valid_id("0a997792-9dce-4853-9406-63c308726721")
    with pytest.raises(JobError):
        reel_copy._valid_id("../../etc")


def test_registrado_y_en_capacidades() -> None:
    from comunes.config import Config  # noqa: PLC0415
    from comunes.runner import _handlers  # noqa: PLC0415

    assert "REEL_COPY" in _handlers
    assert "REEL_COPY" in Config.__dataclass_fields__["capabilities"].default_factory()
