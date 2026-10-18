"""Transcripción por palabra detrás de una sola interfaz.

Proveedores, en orden de preferencia:
1. Deepgram Nova-3 (`DEEPGRAM_API_KEY`): `filler_words=true` y transcripción literal, conserva repeticiones
   y arranques en falso (justo lo que hay que detectar).
2. Groq whisper-large-v3-turbo (`GROQ_API_KEY`): respaldo barato. Whisper tiende a "limpiar" repeticiones.
   Adjuntos de hasta 25 MB: se manda el audio comprimido en Opus mono.
3. Prueba (`WORKER_TEST_TRANSCRIPT`): lee una transcripción JSON de un archivo. Solo para tests locales;
   en Fly nunca se activa.

Todos devuelven palabras `{text, start, end, conf?}` en segundos del audio.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Protocol

from comunes.errors import JobError

log = logging.getLogger("worker.transcribe")

GROQ_MAX_BYTES = 25 * 1024 * 1024


class Provider(Protocol):
    name: str

    def transcribe(self, audio: Path, language: str) -> list[dict]: ...


def _request(req: urllib.request.Request, what: str, timeout: float = 600) -> dict:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode("utf-8", "replace")
        if exc.code in (401, 403):
            raise JobError(f"La clave de {what} no es válida. Revisa la configuración del worker.", retry=False, detail=f"{what} {exc.code}: {detail}") from exc
        if exc.code == 413:
            raise JobError("El audio es demasiado largo para transcribirlo. Sube un video más corto.", retry=False, detail=f"{what} 413") from exc
        raise JobError("El servicio de transcripción no respondió. Vamos a reintentarlo.", detail=f"{what} {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise JobError("No pudimos conectarnos con el servicio de transcripción. Vamos a reintentarlo.", detail=f"{what}: {exc}") from exc


class Deepgram:
    name = "deepgram"

    def __init__(self, key: str) -> None:
        self.key = key

    def transcribe(self, audio: Path, language: str) -> list[dict]:
        params = urllib.parse.urlencode(
            {"model": "nova-3", "language": language, "punctuate": "true", "smart_format": "true", "filler_words": "true"}
        )
        req = urllib.request.Request(
            f"https://api.deepgram.com/v1/listen?{params}",
            data=audio.read_bytes(),
            method="POST",
            headers={"authorization": f"Token {self.key}", "content-type": "audio/ogg"},
        )
        return parse_deepgram(_request(req, "Deepgram"))


def parse_deepgram(body: dict) -> list[dict]:
    try:
        words = body["results"]["channels"][0]["alternatives"][0].get("words", [])
    except (KeyError, IndexError, TypeError) as exc:
        raise JobError("La transcripción llegó incompleta. Vamos a reintentarlo.", detail="deepgram sin words") from exc
    return [
        {"text": w.get("punctuated_word") or w["word"], "start": float(w["start"]), "end": float(w["end"]), "conf": round(float(w.get("confidence", 1)), 3)}
        for w in words
        if str(w.get("word", "")).strip()
    ]


class Groq:
    name = "groq"

    def __init__(self, key: str) -> None:
        self.key = key

    def transcribe(self, audio: Path, language: str) -> list[dict]:
        data = audio.read_bytes()
        if len(data) > GROQ_MAX_BYTES:
            raise JobError("El audio es demasiado largo para transcribirlo. Sube un video más corto.", retry=False, detail="groq > 25 MB")
        boundary = uuid.uuid4().hex
        fields = [
            ("model", "whisper-large-v3-turbo"),
            ("response_format", "verbose_json"),
            ("timestamp_granularities[]", "word"),
            ("timestamp_granularities[]", "segment"),
            ("language", language),
            ("temperature", "0"),
        ]
        parts: list[bytes] = []
        for name, value in fields:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg\r\n\r\n'.encode())
        parts.append(data)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            data=b"".join(parts),
            method="POST",
            headers={"authorization": f"Bearer {self.key}", "content-type": f"multipart/form-data; boundary={boundary}"},
        )
        return parse_groq(_request(req, "Groq"))


def parse_groq(body: dict) -> list[dict]:
    """Groq da las palabras sin puntuación; se toma la escritura de los segmentos cuando calzan uno a uno."""
    words = [{"text": str(w["word"]).strip(), "start": float(w["start"]), "end": float(w["end"])} for w in body.get("words", []) if str(w.get("word", "")).strip()]
    for seg in body.get("segments", []) or []:
        tokens = str(seg.get("text", "")).split()
        inside = [w for w in words if w["start"] >= float(seg["start"]) - 0.01 and w["end"] <= float(seg["end"]) + 0.01]
        if tokens and len(tokens) == len(inside):
            for w, token in zip(inside, tokens):
                w["text"] = token
    return words


class Fixture:
    """Proveedor de prueba: lee `{"words": [{text, start, end}]}` de un archivo."""

    name = "prueba"

    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def transcribe(self, audio: Path, language: str) -> list[dict]:
        body = json.loads(self.path.read_text(encoding="utf-8"))
        return [{"text": w["text"], "start": float(w["start"]), "end": float(w["end"])} for w in body["words"]]


def providers(config) -> list[Provider]:
    if config.test_transcript:
        return [Fixture(config.test_transcript)]
    out: list[Provider] = []
    if config.deepgram_api_key:
        out.append(Deepgram(config.deepgram_api_key))
    if config.groq_api_key:
        out.append(Groq(config.groq_api_key))
    return out


def transcribe(config, audio: Path, language: str) -> tuple[str, list[dict]]:
    """Prueba los proveedores en orden. Si el preferido falla con un error temporal, usa el siguiente."""
    chain = providers(config)
    if not chain:
        raise JobError("Falta configurar la transcripción en el worker (DEEPGRAM_API_KEY o GROQ_API_KEY). Avísale a soporte.", retry=False)
    last: JobError | None = None
    for provider in chain:
        started = time.monotonic()
        try:
            words = provider.transcribe(audio, language)
            log.info("transcripción con %s: %s palabras en %.1f s", provider.name, len(words), time.monotonic() - started)
            return provider.name, sanitize(words)
        except JobError as exc:
            log.warning("transcripción con %s falló: %s", provider.name, exc.detail or exc.user_message)
            last = exc
    assert last is not None
    raise last


def sanitize(words: list[dict]) -> list[dict]:
    """Ordena, descarta palabras vacías o con tiempos imposibles y numera."""
    clean = sorted((w for w in words if w["text"].strip() and w["end"] >= w["start"] >= 0), key=lambda w: (w["start"], w["end"]))
    out = []
    for w in clean:
        if out and w["start"] < out[-1]["start"]:
            continue
        out.append({**w, "text": w["text"].strip()})
    return out
