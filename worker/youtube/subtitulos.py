"""Subtítulos públicos de un video de YouTube del propio cliente, con yt-dlp (sin bajar el video).

La API de YouTube que usa la app (solo lectura) no permite bajar subtítulos: `captions.download` pide el permiso
`youtube.force-ssl`, que deja editar el canal. Por eso se leen los subtítulos públicos que YouTube muestra en el video,
como haría cualquier persona: primero los manuales en español, después los del idioma del video, y si no hay, los
automáticos. Se manda el .vtt crudo a la app, que lo lee con el mismo lector que usa para los archivos subidos.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from comunes.errors import JobError

log = logging.getLogger("worker.youtube")

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
MSG_BLOCKED = "YouTube no nos dejó leer los subtítulos desde el servidor. Descárgalos de YouTube Studio → Subtítulos (.srt o .vtt) y súbelos aquí."
MSG_NONE = "Este video no tiene subtítulos en YouTube (ni automáticos). Súbelos desde YouTube Studio o usa el video del Editor."
MSG_PRIVATE = "El video no es público o ya no existe en YouTube."


def pick_track(info: dict[str, Any]) -> tuple[str, str, str] | None:
    """Elige (idioma, kind, url del .vtt): manual en español > manual en el idioma del video > automático original > automático en español."""
    language = str(info.get("language") or "").lower()

    def vtt(formats: list[dict[str, Any]] | None) -> str | None:
        for f in formats or []:
            if f.get("ext") == "vtt" and f.get("url"):
                return str(f["url"])
        return None

    manual: dict[str, Any] = info.get("subtitles") or {}
    auto: dict[str, Any] = info.get("automatic_captions") or {}
    order: list[tuple[dict[str, Any], str, str]] = []
    for lang in sorted(manual, key=lambda k: (not k.lower().startswith("es"), k != language)):
        order.append((manual, lang, "manual"))
    for lang in sorted(auto, key=lambda k: (not k.endswith("-orig"), not (language and k.startswith(language)), not k.startswith("es"))):
        if lang.endswith("-orig") or (language and lang.split("-")[0] == language.split("-")[0]) or lang.startswith("es"):
            order.append((auto, lang, "auto"))
    for source, lang, kind in order:
        url = vtt(source.get(lang))
        if url:
            return lang.replace("-orig", ""), kind, url
    return None


def fetch(video_id: str) -> tuple[str, str, str]:
    """Devuelve (vtt, idioma, kind). Lanza JobError con un mensaje claro si no se puede."""
    if not VIDEO_ID.match(video_id):
        raise JobError("El id del video no es válido.", retry=False, detail=video_id)
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:  # pragma: no cover — viene en la imagen
        raise JobError("Falta yt-dlp en el servicio de procesamiento. Avísale a soporte.", retry=False) from exc
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "socket_timeout": 20}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            track = pick_track(info or {})
            if not track:
                raise JobError(MSG_NONE, retry=False, detail="sin pistas")
            lang, kind, url = track
            with ydl.urlopen(url) as res:
                content = res.read().decode("utf-8", errors="replace")
    except DownloadError as exc:
        text = str(exc).lower()
        if "sign in" in text or "bot" in text or "429" in text:
            raise JobError(MSG_BLOCKED, retry=False, detail="yt-dlp bloqueado") from exc
        if "private" in text or "unavailable" in text or "removed" in text:
            raise JobError(MSG_PRIVATE, retry=False, detail="no disponible") from exc
        raise JobError("No pudimos leer el video en YouTube. Vamos a reintentarlo.", retry=True, detail=exc.__class__.__name__) from exc
    if "-->" not in content:
        raise JobError(MSG_NONE, retry=False, detail="vtt sin tiempos")
    return content, lang, kind
