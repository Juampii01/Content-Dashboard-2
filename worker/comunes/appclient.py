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
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .errors import Cancelled, JobError
from .ffmpeg import stop_event

log = logging.getLogger("worker.app")

CHUNK = 4 * 1024 * 1024
# Lo más que se espera un paso del director en segundo plano (la función de la app corta a los 800 s).
DIRECTOR_MAX_S = 16 * 60


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

    def transfer(self, project_id: str | None, key: str, op: str, content_type: str | None = None, owner: dict[str, str] | None = None) -> dict[str, Any]:
        """`owner` cambia el dueño del archivo: {"styleId": …} (estilos), {"clipId": …} (biblioteca de b-roll) o {"longVideoId": …} (clips)."""
        payload: dict[str, Any] = {**(owner or {"projectId": project_id}), "key": key, "op": op}
        if content_type:
            payload["contentType"] = content_type
        return self._post("/api/worker/storage", payload, timeout=60)

    def notify(self) -> None:
        """Avisa a la app que terminó un trabajo (arma los avisos y correos). Nunca tira error."""
        try:
            self._post("/api/worker/avisos", {}, timeout=10)
        except Exception:  # noqa: BLE001 — el cron de la app barre lo que falte
            pass

    def plan(self, project_id: str) -> dict[str, Any]:
        return self._post(f"/api/worker/projects/{project_id}/plan", {}, timeout=330)

    def director(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Un paso del director de edición (la app responde cuál sigue). Con razonamiento y visión puede tardar minutos,
        así que se pide en segundo plano: la app contesta enseguida con un id y aquí se pregunta cada pocos segundos hasta
        que esté (una conexión abierta varios minutos se cortaba). Si la app es vieja y contesta el paso directo, sirve igual."""
        path = f"/api/worker/projects/{project_id}/director"
        res = self._post(path, {**payload, "async": True}, timeout=120)
        call = res.get("pending")
        if not call:
            return res
        started = time.monotonic()
        wait = 3.0
        misses = 0
        while True:
            stop_event.wait(wait)
            if stop_event.is_set():
                raise Cancelled()
            try:
                res = self._post(path, {"step": "poll", "call": call}, timeout=60)
                misses = 0
            except JobError as exc:
                # Un corte suelto al preguntar no pierde el paso: se vuelve a preguntar (hasta 5 seguidos).
                if not exc.retry:
                    raise
                misses += 1
                if misses >= 5:
                    raise
                log.warning("director %s: no respondió al preguntar (%s), reintento", call, exc.detail)
                continue
            if res.get("done"):
                return res
            if time.monotonic() - started > DIRECTOR_MAX_S:
                raise JobError("El director de edición tardó demasiado. Vamos a reintentarlo.", detail=f"{path}: {call} sin terminar")
            wait = min(10.0, wait + 1.0)

    def clip_moments(self, long_video_id: str) -> dict[str, Any]:
        """Clips desde un video largo: la app elige los momentos (reglas + Claude) y devuelve sus tramos."""
        return self._post(f"/api/worker/clips/{long_video_id}/moments", {}, timeout=330)

    def clip_framing(self, long_video_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Entrega el reencuadre y la vista previa de cada clip; el video queda listo para elegir."""
        return self._post(f"/api/worker/clips/{long_video_id}/framing", payload, timeout=120)

    def style_result(self, style_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Entrega lo medido en la referencia; la app arma y valida el preset y borra la referencia subida."""
        return self._post(f"/api/worker/styles/{style_id}/result", payload, timeout=120)

    def reel_copy_result(self, copy_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """"Copia este reel": entrega lo medido y la transcripción; la app escribe la versión propia (Claude, hasta 2 llamadas)."""
        return self._post(f"/api/worker/copias/{copy_id}/result", payload, timeout=330)

    def look_result(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """«Mira este video»: entrega lo medido de la referencia (o el aviso); la app sigue con Claude en segundo plano."""
        return self._post(f"/api/worker/projects/{project_id}/mirar", payload, timeout=120)

    def music_result(self, track_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """"Sacar la música de un reel": la pista sin voz ya está subida; la app la deja lista y borra el archivo subido."""
        return self._post(f"/api/worker/musica/{track_id}/result", payload, timeout=120)

    def download(self, project_id: str | None, key: str, dest: Path, on_progress: Callable[[float], None] | None = None, owner: dict[str, str] | None = None) -> Path:
        """Baja un archivo a `dest` (escribe en un temporal y renombra: nunca queda un archivo a medias)."""
        access = self.transfer(project_id, key, "get", owner=owner)
        return self._fetch(access["url"], access.get("headers") or {}, dest, on_progress, key)

    def download_url(self, url: str, dest: Path, allowed_hosts: tuple[str, ...], max_bytes: int = 600 * 1024 * 1024) -> Path:
        """Baja un archivo público (b-roll de stock) directo de su CDN, solo desde los hosts permitidos."""
        host = (urllib.parse.urlsplit(url).hostname or "").lower()
        scheme = urllib.parse.urlsplit(url).scheme
        ok_host = any(host == h or host.endswith("." + h) for h in allowed_hosts)
        if not ok_host or scheme not in ("https", "http") or (scheme == "http" and host not in ("localhost", "127.0.0.1")):
            raise JobError("Un clip de b-roll tiene una dirección no permitida. Cámbialo en la revisión.", retry=False, detail=f"host {host}")
        # Algunos CDN (Pixabay) rechazan el agente por defecto de urllib.
        return self._fetch(url, {"User-Agent": "ContentStudio-Worker/1.0"}, dest, None, host, max_bytes=max_bytes)

    def _fetch(self, url: str, headers: dict[str, str], dest: Path, on_progress: Callable[[float], None] | None, what: str, max_bytes: int | None = None) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        key = what
        req = urllib.request.Request(url, method="GET", headers=headers)
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
                    if max_bytes and done > max_bytes:
                        raise JobError("Un clip de b-roll es demasiado pesado. Cámbialo por otro en la revisión.", retry=False, detail=f"{key}: más de {max_bytes} bytes")
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

    def upload(self, project_id: str | None, key: str, path: Path, content_type: str, owner: dict[str, str] | None = None) -> None:
        access = self.transfer(project_id, key, "put", content_type, owner=owner)
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
