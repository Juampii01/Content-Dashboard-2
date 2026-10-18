"""Cliente de la app (endpoints internos `/api/worker/*`, autenticados con WORKER_SECRET).

El worker no conoce el proveedor de almacenamiento: pide a la app un acceso (método, URL y cabeceras)
para cada archivo y hace la petición tal cual. Nunca se loguean las URLs firmadas.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .errors import Cancelled, JobError
from .ffmpeg import stop_event

log = logging.getLogger("worker.app")

CHUNK = 4 * 1024 * 1024


class AppClient:
    def __init__(self, app_url: str, secret: str) -> None:
        self.app_url = app_url.rstrip("/")
        self.secret = secret

    def _post(self, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.app_url}{path}",
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                body = json.loads(exc.read() or b"{}")
            except json.JSONDecodeError:
                body = {}
            message = body.get("error") or "La app no respondió bien."
            if exc.code == 401:
                raise JobError("El worker no está autorizado en la app: revisa que WORKER_SECRET sea igual en los dos.", retry=False, detail=f"{path}: 401") from exc
            if exc.code in (400, 403, 404, 422) and body.get("retry") is not True:
                raise JobError(message, retry=False, detail=f"{path}: {exc.code}") from exc
            raise JobError("La app no respondió. Vamos a reintentarlo.", detail=f"{path}: {exc.code} {message}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise JobError("No pudimos comunicarnos con la app. Vamos a reintentarlo.", detail=f"{path}: {exc}") from exc

    def transfer(self, project_id: str, key: str, op: str, content_type: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"projectId": project_id, "key": key, "op": op}
        if content_type:
            payload["contentType"] = content_type
        return self._post("/api/worker/storage", payload, timeout=60)

    def plan(self, project_id: str) -> dict[str, Any]:
        return self._post(f"/api/worker/projects/{project_id}/plan", {}, timeout=330)

    def download(self, project_id: str, key: str, dest: Path, on_progress: Callable[[float], None] | None = None) -> Path:
        """Baja un archivo a `dest` (escribe en un temporal y renombra: nunca queda un archivo a medias)."""
        access = self.transfer(project_id, key, "get")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        req = urllib.request.Request(access["url"], method="GET", headers=access.get("headers") or {})
        try:
            with urllib.request.urlopen(req, timeout=120) as res, open(tmp, "wb") as out:
                total = int(res.headers.get("content-length") or 0)
                done = 0
                last = 0.0
                while True:
                    if stop_event.is_set():
                        raise Cancelled()
                    chunk = res.read(CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if on_progress and total and time.monotonic() - last > 1:
                        on_progress(done / total)
                        last = time.monotonic()
            if total and done != total:
                raise JobError("La descarga del video se cortó. Vamos a reintentarlo.", detail=f"descarga incompleta {done}/{total}")
            os.replace(tmp, dest)
            return dest
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                raise JobError("No encontramos el video original. Puede que se haya borrado: vuelve a subirlo.", retry=exc.code == 403, detail=f"descarga {key}: {exc.code}") from exc
            raise JobError("No pudimos bajar el video. Vamos a reintentarlo.", detail=f"descarga {key}: {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise JobError("No pudimos bajar el video. Vamos a reintentarlo.", detail=f"descarga {key}: {exc}") from exc
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def upload(self, project_id: str, key: str, path: Path, content_type: str) -> None:
        access = self.transfer(project_id, key, "put", content_type)
        size = path.stat().st_size
        headers = {**(access.get("headers") or {}), "content-length": str(size)}
        headers.setdefault("content-type", content_type)
        for attempt in range(3):
            try:
                with open(path, "rb") as body:
                    req = urllib.request.Request(access["url"], data=body, method=access.get("method", "PUT"), headers=headers)
                    with urllib.request.urlopen(req, timeout=600) as res:
                        res.read()
                return
            except urllib.error.HTTPError as exc:
                if exc.code < 500 or attempt == 2:
                    raise JobError("No pudimos guardar el resultado. Vamos a reintentarlo.", detail=f"subida {key}: {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt == 2:
                    raise JobError("No pudimos guardar el resultado. Vamos a reintentarlo.", detail=f"subida {key}: {exc}") from exc
            time.sleep(2 * (attempt + 1))


def copy_atomic(src: Path, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".part")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dest)
