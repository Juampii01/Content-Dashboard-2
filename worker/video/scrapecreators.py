"""Plan B para bajar links de Instagram y TikTok con ScrapeCreators (clave del cliente, pago por crédito).

Instagram bloquea a ratos las descargas anónimas desde IPs de servidores ("empty media response"). Cuando yt-dlp
falla con un link de Instagram o TikTok, `download_link` (style_job.py) pide aquí la URL directa del video a
ScrapeCreators y la baja con los mismos límites de tamaño y duración, y la misma cancelación.

Seguridad:
- La clave la da la app (`/api/worker/scrapecreators`) solo mientras corre el trabajo; viaja en la cabecera
  `x-api-key`, nunca en la URL, y no se guarda ni se loguea.
- La URL que devuelve ScrapeCreators solo se sigue si es https y de un CDN conocido de Instagram o TikTok, y lo
  mismo cada redirección (nada de URLs arbitrarias: SSRF). Tampoco se conecta a direcciones privadas.
- Se baja por partes con tope de bytes; se corta si el servidor anuncia más de la cuenta.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from comunes.errors import Cancelled, JobError
from comunes.ffmpeg import stop_event

log = logging.getLogger("worker.scrapecreators")

API_BASE = "https://api.scrapecreators.com"
ENDPOINTS = {"instagram": "/v1/instagram/post", "tiktok": "/v2/tiktok/video"}
# CDNs donde Instagram y TikTok sirven sus videos (se acepta el dominio y sus subdominios).
CDN_HOSTS = {
    "instagram": ("cdninstagram.com", "fbcdn.net"),
    "tiktok": ("tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu", "tiktok.com"),
}
NAMES = {"instagram": "Instagram", "tiktok": "TikTok"}
MAX_REDIRECTS = 5
CHUNK = 1024 * 1024
API_TIMEOUT = 60
DOWNLOAD_TIMEOUT = 60
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
LOCAL_HOSTS = ("localhost", "127.0.0.1")


def platform_of(url: str) -> str | None:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    for platform, domain in (("instagram", "instagram.com"), ("tiktok", "tiktok.com")):
        if host == domain or host.endswith("." + domain):
            return platform
    return None


def blocked_message(platform: str) -> str:
    """Lo que ve la persona cuando la red bloquea la descarga y no hay clave de ScrapeCreators."""
    return f"{NAMES[platform]} no deja bajar este link desde el servidor. Sube el video o agrega tu clave de ScrapeCreators en Ajustes → Claves de servicios."


def _host_matches(host: str, domains: tuple[str, ...]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def cdn_allowed(url: str, platform: str, extra_hosts: tuple[str, ...] = ()) -> bool:
    """Solo https y de un CDN conocido de la red. `extra_hosts` (pruebas locales) admite http en localhost."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.username or parts.password:
        return False
    if host in extra_hosts and host in LOCAL_HOSTS and parts.scheme in ("http", "https"):
        return True
    if parts.scheme != "https" or parts.port not in (None, 443):
        return False
    return _host_matches(host, CDN_HOSTS.get(platform, ()))


def _public_address(host: str) -> bool:
    """El host resuelve solo a direcciones públicas (evita que un DNS apunte a la red interna de la máquina)."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
            return False
    return bool(infos)


def api_base_allowed(base: str, extra_hosts: tuple[str, ...]) -> bool:
    parts = urllib.parse.urlsplit(base)
    host = (parts.hostname or "").lower()
    if host in extra_hosts and host in LOCAL_HOSTS:
        return parts.scheme in ("http", "https")
    return base.rstrip("/") == API_BASE


# ─── API ─────────────────────────────────────────────────────────────────────


def _api_error(platform: str, status: int, body: dict[str, Any]) -> JobError:
    name = NAMES[platform]
    if status in (401, 403):
        return JobError("ScrapeCreators no aceptó tu clave. Revísala en Ajustes → Claves de servicios.", retry=False, detail=f"scrapecreators: {status}")
    if status == 402:
        return JobError("Te quedaste sin créditos en ScrapeCreators. Carga más en su sitio o sube el video.", retry=False, detail="scrapecreators: 402")
    if status == 404:
        return JobError(f"{name} no encontró ese video: puede ser privado o haberse borrado. Revisa el link o sube el video.", retry=False, detail="scrapecreators: 404")
    if status == 429:
        return JobError("ScrapeCreators está recibiendo demasiados pedidos. Prueba de nuevo en un minuto o sube el video.", retry=False, detail="scrapecreators: 429")
    message = str(body.get("message") or body.get("error") or "")[:200]
    return JobError("Tampoco pudimos bajarlo con ScrapeCreators. Sube el video.", retry=False, detail=f"scrapecreators: {status} {message}")


def _get_json(url: str, api_key: str, platform: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"x-api-key": api_key, "accept": "application/json", "user-agent": "content-studio-worker"})
    # Sin redirecciones: la API responde directo; si redirige, no se manda la clave a otro lado.
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(req, timeout=API_TIMEOUT) as res:
            raw = res.read(8 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read(64 * 1024) or b"{}")
        except (json.JSONDecodeError, ValueError):
            body = {}
        raise _api_error(platform, exc.code, body if isinstance(body, dict) else {}) from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        raise JobError("No pudimos comunicarnos con ScrapeCreators. Prueba de nuevo en unos minutos o sube el video.", retry=False, detail=f"scrapecreators: {exc.__class__.__name__}") from None
    if len(raw) > 8 * 1024 * 1024:
        raise JobError("ScrapeCreators respondió algo inesperado. Sube el video.", retry=False, detail="scrapecreators: respuesta enorme")
    try:
        data = json.loads(raw or b"{}")
    except (json.JSONDecodeError, ValueError):
        raise JobError("ScrapeCreators respondió algo inesperado. Sube el video.", retry=False, detail="scrapecreators: no es JSON") from None
    if not isinstance(data, dict):
        raise JobError("ScrapeCreators respondió algo inesperado. Sube el video.", retry=False, detail="scrapecreators: no es un objeto")
    if data.get("success") is False:
        raise _api_error(platform, 400, data)
    return data


def _dig(data: Any, *path: str | int) -> Any:
    for key in path:
        if isinstance(key, int):
            data = data[key] if isinstance(data, list) and len(data) > key else None
        else:
            data = data.get(key) if isinstance(data, dict) else None
        if data is None:
            return None
    return data


def _instagram_candidates(data: dict[str, Any]) -> tuple[list[str], float | None, bool | None]:
    media = _dig(data, "data", "xdt_shortcode_media") or _dig(data, "data", "shortcode_media") or {}
    urls: list[str] = []
    if isinstance(media.get("video_url"), str):
        urls.append(media["video_url"])
    # Otra forma que devuelve a veces (API móvil): items[0].video_versions[].url
    for version in _dig(data, "items", 0, "video_versions") or _dig(data, "data", "items", 0, "video_versions") or []:
        if isinstance(version, dict) and isinstance(version.get("url"), str):
            urls.append(version["url"])
    duration = media.get("video_duration")
    is_video = media.get("is_video") if isinstance(media.get("is_video"), bool) else None
    return urls, float(duration) if isinstance(duration, (int, float)) else None, is_video


def _tiktok_candidates(data: dict[str, Any]) -> tuple[list[str], float | None, bool | None]:
    video = _dig(data, "aweme_detail", "video") or _dig(data, "data", "aweme_detail", "video") or {}
    urls: list[str] = []
    for field in ("download_no_watermark_addr", "play_addr", "download_addr"):
        for url in _dig(video, field, "url_list") or []:
            if isinstance(url, str):
                urls.append(url)
    raw = video.get("duration")
    duration = None
    if isinstance(raw, (int, float)) and raw > 0:
        duration = raw / 1000  # TikTok la da en milisegundos; igual se mide con ffprobe después de bajar
    return urls, duration, (bool(urls) if video else None)


def video_url(link: str, platform: str, api_key: str, *, max_seconds: float, base: str = API_BASE, extra_hosts: tuple[str, ...] = ()) -> str:
    """La URL directa del video en el CDN de la red (ya validada contra la lista de CDNs)."""
    if not api_base_allowed(base, extra_hosts):
        raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail="scrapecreators: base no permitida")
    query = urllib.parse.urlencode({"url": link, "trim": "false"})
    data = _get_json(f"{base.rstrip('/')}{ENDPOINTS[platform]}?{query}", api_key, platform)
    urls, duration, is_video = (_instagram_candidates if platform == "instagram" else _tiktok_candidates)(data)
    if is_video is False or (not urls and is_video is None and platform == "instagram"):
        raise JobError("Ese link no tiene un video (es una foto o un carrusel). Usa el link de un reel o sube el video.", retry=False, detail="scrapecreators: sin video")
    if duration and duration > max_seconds:
        raise JobError(f"Ese video es demasiado largo: el máximo es de {round(max_seconds / 60)} minutos.", retry=False, detail=f"scrapecreators: {duration:.0f} s")
    for url in urls:
        if cdn_allowed(url, platform, extra_hosts):
            return url
    hosts = sorted({(urllib.parse.urlsplit(u).hostname or "?") for u in urls})[:3]
    raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail=f"scrapecreators: CDN no permitido ({', '.join(hosts) or 'sin URL'})")


# ─── Descarga del CDN ────────────────────────────────────────────────────────


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201, PLR0913
        return None


class _CheckedRedirect(urllib.request.HTTPRedirectHandler):
    """Sigue redirecciones solo hacia CDNs permitidos de la misma red."""

    max_redirections = MAX_REDIRECTS

    def __init__(self, platform: str, extra_hosts: tuple[str, ...]) -> None:
        super().__init__()
        self.platform, self.extra_hosts = platform, extra_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201, PLR0913
        newurl = urllib.parse.urljoin(req.full_url, newurl)
        if not _safe_target(newurl, self.platform, self.extra_hosts):
            raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail=f"scrapecreators: redirección no permitida ({urllib.parse.urlsplit(newurl).hostname})")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _safe_target(url: str, platform: str, extra_hosts: tuple[str, ...]) -> bool:
    if not cdn_allowed(url, platform, extra_hosts):
        return False
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return host in extra_hosts and host in LOCAL_HOSTS or _public_address(host)


def download_video(url: str, dest: Path, platform: str, *, max_bytes: int, extra_hosts: tuple[str, ...] = ()) -> Path:
    """Baja el MP4 del CDN por partes, con tope de bytes y cancelación. Nunca deja un archivo a medias."""
    if not _safe_target(url, platform, extra_hosts):
        raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail="scrapecreators: CDN no permitido")
    opener = urllib.request.build_opener(_CheckedRedirect(platform, extra_hosts))
    req = urllib.request.Request(url, headers={"user-agent": USER_AGENT, "accept": "video/*,*/*;q=0.5"})
    part = dest.with_name(dest.name + ".part")
    too_big = JobError(f"Ese video pesa demasiado: el máximo es de {max_bytes // (1024 * 1024)} MB.", retry=False, detail="scrapecreators: tope de bytes")
    try:
        with opener.open(req, timeout=DOWNLOAD_TIMEOUT) as res:
            kind = (res.headers.get("content-type") or "").split(";")[0].strip().lower()
            if kind and not (kind.startswith("video/") or kind in ("application/octet-stream", "binary/octet-stream")):
                raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail=f"scrapecreators: tipo {kind[:60]}")
            length = res.headers.get("content-length")
            if length and length.isdigit() and int(length) > max_bytes:
                raise too_big
            total = 0
            with part.open("wb") as out:
                while True:
                    if stop_event.is_set():
                        raise Cancelled()
                    chunk = res.read(CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise too_big
                    out.write(chunk)
    except (JobError, Cancelled):
        part.unlink(missing_ok=True)
        raise
    except urllib.error.HTTPError as exc:
        part.unlink(missing_ok=True)
        raise JobError("El video ya no está disponible en el link que dio ScrapeCreators. Prueba de nuevo o sube el video.", retry=False, detail=f"scrapecreators cdn: {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        part.unlink(missing_ok=True)
        raise JobError("Se cortó la descarga del video. Prueba de nuevo o sube el video.", retry=False, detail=f"scrapecreators cdn: {exc.__class__.__name__}") from None
    if total == 0:
        part.unlink(missing_ok=True)
        raise JobError("No pudimos bajar ese link. Sube el video.", retry=False, detail="scrapecreators cdn: vacío")
    part.replace(dest)
    return dest
