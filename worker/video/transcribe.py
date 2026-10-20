"""Transcripción por palabra detrás de una sola interfaz.

Por defecto, todo open source y en la CPU del worker (sin claves ni costo por uso):
1. Parakeet TDT 0.6b v3 (NVIDIA, CC-BY-4.0) en ONNX con `onnx-asr`, cuantizado a int8, con Silero VAD para
   trocear el audio. Multilingüe (25 idiomas europeos, incluidos español e inglés) y literal: conserva
   muletillas, repeticiones y arranques en falso, justo lo que hay que detectar.
2. faster-whisper (CTranslate2, int8, `word_timestamps=True`): respaldo local si Parakeet no está o falla.
   Whisper tiende a "limpiar" repeticiones; se le da un prompt con muletillas para que las conserve.
Los modelos se bajan al construir la imagen (scripts/fetch_models.py), nunca en cada trabajo.

Opcionales, solo si hay clave:
3. Deepgram Nova-3 (`DEEPGRAM_API_KEY`), con `filler_words=true`.
4. Groq whisper-large-v3-turbo (`GROQ_API_KEY`). Adjuntos de hasta 25 MB (Opus mono).

El orden se cambia con `TRANSCRIBE_ORDER` (por ejemplo `deepgram,parakeet`).
Prueba (`WORKER_TEST_TRANSCRIPT`): lee una transcripción JSON de un archivo. Solo para tests locales;
en Fly nunca se activa.

Todos devuelven palabras `{text, start, end, conf?}` en segundos del audio.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

from comunes.errors import JobError

log = logging.getLogger("worker.transcribe")

GROQ_MAX_BYTES = 25 * 1024 * 1024


class Provider(Protocol):
    name: str

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]: ...


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


# ─── Proveedores locales (open source) ─────────────────────────────────────

PARAKEET_DIR = "parakeet-tdt-0.6b-v3"
SILERO_DIR = "silero-vad"
# Parakeet da el instante en que empieza cada token (rejilla de 80 ms), no el final: una palabra termina
# donde empieza la siguiente, con un tope. Después, energy.refine ajusta los bordes a la voz real.
TOKEN_STEP = 0.08
MAX_WORD_TAIL = 0.42

_models: dict[str, Any] = {}
_models_lock = threading.Lock()


def _cached(key: str, factory: Callable[[], Any]) -> Any:
    """Los modelos se cargan una vez por proceso (cargarlos tarda segundos y ocupa RAM)."""
    with _models_lock:
        if key not in _models:
            _models[key] = factory()
        return _models[key]


class Parakeet:
    """NVIDIA Parakeet TDT 0.6b v3 en ONNX (onnx-asr), con Silero VAD."""

    name = "parakeet"

    def __init__(self, models_dir: Path, quantization: str | None = "int8") -> None:
        self.model_dir = models_dir / PARAKEET_DIR
        self.vad_dir = models_dir / SILERO_DIR
        self.quantization = quantization

    def available(self) -> bool:
        if not (self.model_dir.is_dir() and self.vad_dir.is_dir()):
            return False
        try:
            import onnx_asr  # noqa: F401, PLC0415
        except ImportError:
            return False
        return True

    def _adapter(self) -> Any:
        import onnx_asr  # noqa: PLC0415

        def load() -> Any:
            opts = None
            try:
                import onnxruntime as ort  # noqa: PLC0415

                opts = ort.SessionOptions()
                opts.intra_op_num_threads = max(1, os.cpu_count() or 1)
            except ImportError:
                pass
            model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", self.model_dir, quantization=self.quantization, sess_options=opts)
            vad = onnx_asr.load_vad("silero", self.vad_dir)
            # Tramos de hasta 25 s cortados en silencios de 0,4 s: las muletillas cortas no se pierden.
            return model.with_vad(vad, max_speech_duration_s=25, min_silence_duration_ms=400, min_speech_duration_ms=120, speech_pad_ms=120).with_timestamps()

        return _cached(f"parakeet:{self.model_dir}:{self.quantization}", load)

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]:
        if wav16 is None:
            raise JobError("Falta el audio en WAV para transcribir.", detail="parakeet sin wav16")
        try:
            segments = list(self._adapter().recognize(str(wav16)))
        except Exception as exc:  # noqa: BLE001 — cualquier fallo del modelo pasa al siguiente proveedor
            raise JobError("La transcripción falló. Vamos a reintentarlo.", detail=f"parakeet: {exc.__class__.__name__}: {exc}") from exc
        return words_from_token_segments(segments)


def _is_punct(text: str) -> bool:
    """Signos que se pegan a la palabra anterior ("," "." "?"). Los de apertura (¿ ¡) abren palabra."""
    return all(not ch.isalnum() for ch in text) and not any(ch in "¿¡" for ch in text)


def words_from_token_segments(segments: Iterable[Any]) -> list[dict]:
    """Une los tokens de Parakeet (subpalabras; las que empiezan con espacio abren palabra) en palabras.

    Cada segmento (de la VAD) trae `start`, `end`, `tokens`, `timestamps` (inicio de cada token, relativo al
    segmento) y `logprobs`. La confianza de la palabra es exp(media del logprob de sus tokens).
    """
    out: list[dict] = []
    for seg in segments:
        tokens = list(getattr(seg, "tokens", None) or [])
        stamps = list(getattr(seg, "timestamps", None) or [])
        logprobs = list(getattr(seg, "logprobs", None) or [])
        if not tokens or len(stamps) != len(tokens):
            continue
        base = float(getattr(seg, "start", 0.0) or 0.0)
        seg_end = float(getattr(seg, "end", 0.0) or 0.0) or base + float(stamps[-1]) + MAX_WORD_TAIL
        words: list[dict] = []
        for i, token in enumerate(tokens):
            text = str(token)
            clean = text.strip()
            if not clean:
                continue
            opens = (text.startswith(" ") or not words) and not (words and _is_punct(clean))
            if opens:
                words.append({"parts": [clean], "first": float(stamps[i]), "last": float(stamps[i]), "lp": [logprobs[i]] if i < len(logprobs) else []})
            else:
                w = words[-1]
                w["parts"].append(clean)
                w["last"] = float(stamps[i])
                if i < len(logprobs):
                    w["lp"].append(logprobs[i])
        for j, w in enumerate(words):
            start = base + w["first"]
            nxt = base + words[j + 1]["first"] if j + 1 < len(words) else seg_end
            end = max(min(nxt, base + w["last"] + MAX_WORD_TAIL, seg_end), start + TOKEN_STEP)
            item: dict[str, Any] = {"text": "".join(w["parts"]), "start": round(start, 3), "end": round(end, 3)}
            if w["lp"]:
                item["conf"] = round(max(0.0, min(1.0, math.exp(sum(w["lp"]) / len(w["lp"])))), 3)
            out.append(item)
    return out


WHISPER_PROMPTS = {
    "es": "Eh, este... o sea, mmm, ¿sabes? Bueno, eh, lo que te quiero decir es que...",
    "en": "Um, uh, so... like, you know, I mean, uh...",
}


class FasterWhisper:
    """faster-whisper (CTranslate2) en CPU, int8, con tiempos por palabra."""

    name = "whisper"

    def __init__(self, models_dir: Path, model: str = "small") -> None:
        self.model = model
        self.dir = models_dir / f"whisper-{model}"

    def available(self) -> bool:
        if not self.dir.is_dir():
            return False
        try:
            import faster_whisper  # noqa: F401, PLC0415
        except ImportError:
            return False
        return True

    def _model(self) -> Any:
        from faster_whisper import WhisperModel  # noqa: PLC0415

        return _cached(f"whisper:{self.dir}", lambda: WhisperModel(str(self.dir), device="cpu", compute_type="int8", cpu_threads=max(1, os.cpu_count() or 1)))

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]:
        try:
            segments, _info = self._model().transcribe(
                str(wav16 or audio),
                language=language,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 400},
                condition_on_previous_text=False,
                initial_prompt=WHISPER_PROMPTS.get(language),
                beam_size=5,
            )
            return words_from_whisper(segments)
        except Exception as exc:  # noqa: BLE001
            raise JobError("La transcripción falló. Vamos a reintentarlo.", detail=f"whisper: {exc.__class__.__name__}: {exc}") from exc


def words_from_whisper(segments: Iterable[Any]) -> list[dict]:
    """Segmentos de faster-whisper (cada uno con `.words`: word, start, end, probability) → palabras."""
    out: list[dict] = []
    for seg in segments:
        for w in getattr(seg, "words", None) or []:
            text = str(getattr(w, "word", "")).strip()
            if not text:
                continue
            item: dict[str, Any] = {"text": text, "start": round(float(w.start), 3), "end": round(float(w.end), 3)}
            prob = getattr(w, "probability", None)
            if prob is not None:
                item["conf"] = round(float(prob), 3)
            out.append(item)
    return out


# ─── Proveedores por API (opcionales) ──────────────────────────────────────


class Deepgram:
    name = "deepgram"

    def __init__(self, key: str) -> None:
        self.key = key

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]:
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

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]:
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

    def transcribe(self, audio: Path, language: str, wav16: Path | None = None) -> list[dict]:
        body = json.loads(self.path.read_text(encoding="utf-8"))
        return [{"text": w["text"], "start": float(w["start"]), "end": float(w["end"])} for w in body["words"]]


# ─── Cadena ────────────────────────────────────────────────────────────────


def providers(config: Any, fixture: str | None = None) -> list[Provider]:
    """Proveedores disponibles, en el orden configurado. Con transcripción de prueba, solo esa."""
    test = fixture if fixture is not None else getattr(config, "test_transcript", None)
    if test:
        return [Fixture(test)]
    models_dir = Path(getattr(config, "models_dir", None) or Path(__file__).resolve().parent.parent / "models")
    order = getattr(config, "transcribe_order", None) or ("parakeet", "whisper", "deepgram", "groq")
    out: list[Provider] = []
    for name in order:
        if name == "parakeet":
            parakeet = Parakeet(models_dir)
            if parakeet.available():
                out.append(parakeet)
        elif name == "whisper":
            whisper = FasterWhisper(models_dir, getattr(config, "whisper_model", None) or "small")
            if whisper.available():
                out.append(whisper)
        elif name == "deepgram" and getattr(config, "deepgram_api_key", None):
            out.append(Deepgram(config.deepgram_api_key))
        elif name == "groq" and getattr(config, "groq_api_key", None):
            out.append(Groq(config.groq_api_key))
    return out


def transcribe(config: Any, audio: Path, language: str, wav16: Path | None = None, *, fixture: str | None = None) -> tuple[str, list[dict]]:
    """Prueba los proveedores en orden. Si el preferido falla con un error temporal, usa el siguiente."""
    chain = providers(config, fixture)
    if not chain:
        raise JobError("Falta configurar la transcripción en el worker (modelos locales o DEEPGRAM_API_KEY / GROQ_API_KEY). Avísale a soporte.", retry=False)
    last: JobError | None = None
    for provider in chain:
        started = time.monotonic()
        try:
            words = provider.transcribe(audio, language, wav16)
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
