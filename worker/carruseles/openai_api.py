"""Respaldo: API de imágenes de OpenAI con la API key del propio cliente.

- Sin referencias: `POST /images/generations`.
- Con referencias (fotos del personaje, la imagen a corregir o la primera imagen del carrusel, para mantener el
  estilo): `POST /images/edits` con `images` como data URLs (JSON). Los modelos GPT Image devuelven siempre `b64_json`.
- Si sale el personaje, se pide `input_fidelity: "high"` (conserva mejor la cara de las imágenes de entrada). Si el
  modelo no acepta ese parámetro, se repite el pedido una vez sin él.
Modelo, tamaño y calidad los manda la app (lib/carousels/images/openai.ts) junto con la clave.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from comunes.errors import JobError

log = logging.getLogger("worker.carruseles")


def _data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _error(code: int, body: dict[str, Any]) -> JobError:
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    kind = str(err.get("code") or err.get("type") or "")
    if code == 401:
        return JobError("Tu API key de OpenAI no es válida o se borró. Revisa la clave en Ajustes → Claves de servicios.", retry=False, detail="openai 401")
    if code == 429 and "quota" in kind:
        return JobError("Tu cuenta de OpenAI se quedó sin saldo. Carga crédito en platform.openai.com y prueba de nuevo.", retry=False, detail="openai sin saldo")
    if code == 429:
        return JobError("OpenAI está limitando los pedidos de tu cuenta. Prueba de nuevo en unos minutos.", retry=True, detail="openai 429")
    if code == 403:
        return JobError("Tu cuenta de OpenAI todavía no puede usar los modelos de imágenes (pide verificar la organización en platform.openai.com).", retry=False, detail="openai 403")
    if code == 400 and ("moderation" in kind or "safety" in kind or "content_policy" in kind):
        return JobError("OpenAI rechazó esa escena por sus reglas de contenido. Cambia la descripción y prueba de nuevo.", retry=False, detail="openai moderación")
    if code == 400:
        return JobError("OpenAI no aceptó el pedido de imagen. Cambia la descripción de la escena y prueba de nuevo.", retry=False, detail=f"openai 400 {kind}")
    return JobError("OpenAI no respondió. Vamos a reintentarlo.", retry=True, detail=f"openai {code}")


class _Rejected(Exception):
    def __init__(self, code: int, body: dict[str, Any]) -> None:
        super().__init__(code)
        err = body.get("error") if isinstance(body.get("error"), dict) else {}
        self.code, self.body, self.message = code, body, str(err.get("message") or "") + " " + str(err.get("param") or "")


def _request(base: str, path: str, payload: dict[str, Any], creds: dict[str, Any], timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"authorization": f"Bearer {creds['apiKey']}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            err_body = json.loads(exc.read() or b"{}")
        except json.JSONDecodeError:
            err_body = {}
        raise _Rejected(exc.code, err_body) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise JobError("No pudimos comunicarnos con OpenAI. Vamos a reintentarlo.", retry=True, detail=f"openai red: {exc.__class__.__name__}") from exc


def generate_image(creds: dict[str, Any], prompt: str, refs: list[Path], dest: Path, timeout: int = 240, keep_face: bool = False) -> Path:
    base = str(creds.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    payload: dict[str, Any] = {
        "model": creds.get("model") or "gpt-image-2.5-flare",
        "prompt": prompt,
        "size": creds.get("size") or "1088x1360",
        "quality": creds.get("quality") or "medium",
        "output_format": "png",
        "n": 1,
    }
    path = "/images/generations"
    if refs:
        path = "/images/edits"
        payload["images"] = [{"image_url": _data_url(p)} for p in refs[:4]]
        if keep_face:
            payload["input_fidelity"] = "high"
    try:
        body = _request(base, path, payload, creds, timeout)
    except _Rejected as exc:
        # El modelo no conoce input_fidelity: se repite sin él (la cara se parece algo menos).
        if "input_fidelity" in payload and "input_fidelity" in exc.message:
            log.warning("openai no acepta input_fidelity con este modelo; repito sin él")
            payload.pop("input_fidelity")
            try:
                body = _request(base, path, payload, creds, timeout)
            except _Rejected as again:
                raise _error(again.code, again.body) from again
        else:
            raise _error(exc.code, exc.body) from exc
    data = (body.get("data") or [{}])[0]
    b64 = data.get("b64_json")
    if not b64:
        raise JobError("OpenAI no devolvió la imagen. Prueba de nuevo.", retry=True, detail="openai sin b64_json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(base64.b64decode(b64))
    return dest
