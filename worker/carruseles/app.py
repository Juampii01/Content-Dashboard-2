"""Llamadas del worker a la app para Carruseles (`/api/worker/carruseles/*`, con WORKER_SECRET).

Cada pedido lleva el id del trabajo: la app comprueba que el trabajo existe, está en curso y es del tipo correcto,
y solo firma archivos de ese carrusel o de esa plantilla. Las credenciales (sesión de ChatGPT o API key de OpenAI)
las descifra la app y viajan solo en memoria: nunca se escriben en el log.
"""

from __future__ import annotations

import base64
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from comunes.appclient import AppClient
from comunes.errors import JobError


class CarouselApp:
    def __init__(self, app: AppClient, job_id: str) -> None:
        self.app = app
        self.job_id = str(job_id)

    def _post(self, path: str, payload: dict[str, Any], timeout: float = 60) -> dict[str, Any]:
        # Reutiliza el manejo de errores del cliente común (401, reintentos, mensajes en español).
        return self.app._post(f"/api/worker/carruseles/{path}", {"jobId": self.job_id, **payload}, timeout=timeout)  # noqa: SLF001

    # ─── Archivos ──────────────────────────────────────────────────────────

    def transfer(self, key: str, op: str, content_type: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"key": key, "op": op}
        if content_type:
            payload["contentType"] = content_type
        return self._post("storage", payload)

    def download(self, key: str, dest: Path) -> Path:
        access = self.transfer(key, "get")
        req = urllib.request.Request(access["url"], method="GET", headers=access.get("headers") or {})
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        try:
            with urllib.request.urlopen(req, timeout=120) as res, open(tmp, "wb") as out:
                while chunk := res.read(1 << 20):
                    out.write(chunk)
            os.replace(tmp, dest)
            return dest
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                raise JobError("No encontramos una de las imágenes. Vuelve a subirlas.", retry=False, detail=f"descarga {key}: {exc.code}") from exc
            raise JobError("No pudimos bajar una imagen. Vamos a reintentarlo.", detail=f"descarga {key}: {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise JobError("No pudimos bajar una imagen. Vamos a reintentarlo.", detail=f"descarga {key}: {exc}") from exc
        finally:
            tmp.unlink(missing_ok=True)

    def upload(self, key: str, path: Path, content_type: str) -> None:
        access = self.transfer(key, "put", content_type)
        data = path.read_bytes()
        headers = {**(access.get("headers") or {}), "content-length": str(len(data))}
        headers.setdefault("content-type", content_type)
        for attempt in range(3):
            try:
                req = urllib.request.Request(access["url"], data=data, method=access.get("method", "PUT"), headers=headers)
                with urllib.request.urlopen(req, timeout=120) as res:
                    res.read()
                return
            except urllib.error.HTTPError as exc:
                if exc.code < 500 or attempt == 2:
                    raise JobError("No pudimos guardar la imagen. Vamos a reintentarlo.", detail=f"subida {key}: {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt == 2:
                    raise JobError("No pudimos guardar la imagen. Vamos a reintentarlo.", detail=f"subida {key}: {exc}") from exc

    # ─── Plantillas desde referencia ───────────────────────────────────────

    def style(self, measurements: dict[str, Any], images: list[Path]) -> dict[str, Any]:
        """Manda las medidas y las imágenes (reducidas) a la app, que arma la plantilla con Claude."""
        encoded = [base64.b64encode(p.read_bytes()).decode("ascii") for p in images]
        return self._post("estilo", {"measurements": measurements, "images": encoded}, timeout=330)

    # ─── Copiar un carrusel ────────────────────────────────────────────────

    def copy(self, measurements: dict[str, Any] | None, images: list[Path], post_text: str | None) -> dict[str, Any]:
        """Manda los slides reducidos (y sus medidas) a la app, que escribe tu versión con Claude y arma el carrusel."""
        encoded = [base64.b64encode(p.read_bytes()).decode("ascii") for p in images]
        return self._post("copia", {"measurements": measurements, "images": encoded, "postText": post_text}, timeout=330)

    # ─── Video de un slide ─────────────────────────────────────────────────

    def slide_video(self, key: str) -> dict[str, Any]:
        return self._post("video", {"key": key})

    # ─── Imágenes ──────────────────────────────────────────────────────────

    def credentials(self) -> dict[str, Any]:
        return self._post("credenciales", {})

    def slide_image(self, slide_id: str, key: str, provider: str) -> dict[str, Any]:
        return self._post("imagen", {"slideId": slide_id, "key": key, "provider": provider})
