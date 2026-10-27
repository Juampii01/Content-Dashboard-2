"""Llamadas del worker a la app para YouTube (`/api/worker/youtube/*`, con WORKER_SECRET).

Cada pedido lleva el id del trabajo: la app comprueba que el trabajo existe, está en curso y es del tipo correcto,
y solo firma archivos de ese paquete o de esas fotos. Las credenciales de imágenes (sesión de ChatGPT o API key de
OpenAI) viajan solo en memoria: nunca se escriben en el log.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from carruseles.app import CarouselApp
from comunes.appclient import AppClient


class YoutubeApp(CarouselApp):
    """Reutiliza la descarga y la subida de Carruseles (mismas URLs firmadas), con las rutas de YouTube."""

    def __init__(self, app: AppClient, job_id: str) -> None:
        super().__init__(app, job_id)

    def _post(self, path: str, payload: dict[str, Any], timeout: float = 60) -> dict[str, Any]:
        return self.app._post(f"/api/worker/youtube/{path}", {"jobId": self.job_id, **payload}, timeout=timeout)  # noqa: SLF001

    # transfer/download/upload heredados llaman a self._post("storage", …) → /api/worker/youtube/storage

    def credentials(self) -> dict[str, Any]:
        return self._post("credenciales", {})

    def background(self, concept_id: str, key: str | None, provider: str | None, error: str | None = None) -> dict[str, Any]:
        """Fondo listo (o fallido) de un concepto de miniatura."""
        return self._post("fondo", {"conceptId": concept_id, "key": key, "provider": provider, "error": error})

    def cutout(self, photo_key: str, key: str | None, method: str, error: str | None = None) -> dict[str, Any]:
        """Foto del personaje sin fondo (o el motivo por el que no se pudo)."""
        return self._post("recorte", {"photoKey": photo_key, "key": key, "method": method, "error": error})

    def subtitles(self, content: str, language: str | None, kind: str) -> dict[str, Any]:
        """Subtítulos crudos (.vtt): la app los lee con el mismo lector que usa para los archivos que sube el cliente."""
        return self._post("subtitulos", {"content": content, "language": language, "kind": kind}, timeout=60)

    def upload_file(self, key: str, path: Path, content_type: str) -> None:
        self.upload(key, path, content_type)
