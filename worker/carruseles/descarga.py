"""Descarga de un carrusel de Instagram a partir de su link, con gallery-dl (open source).

Instagram suele pedir sesión para bajar publicaciones: en ese caso (o si el link no es un carrusel) se corta con un
mensaje claro para que la persona suba las imágenes a mano. No se usa ninguna sesión ni cuenta de Instagram.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

from comunes.errors import JobError

log = logging.getLogger("worker.carruseles")

LINK_RE = re.compile(r"^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]{5,40}/?(\?.*)?$")
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
FAIL = "No pudimos bajar ese link. Descarga las imágenes y súbelas."
MAX_IMAGES = 20


def gallery_dl_bin() -> str:
    return os.environ.get("GALLERY_DL_BIN") or "gallery-dl"


def clean_link(url: str) -> str:
    """Solo links de publicaciones de Instagram, sin parámetros de rastreo."""
    url = url.strip()
    if not LINK_RE.match(url):
        raise JobError("Ese link no es de una publicación de Instagram. Copia el link del carrusel (instagram.com/p/…).", retry=False)
    return url.split("?")[0].rstrip("/") + "/"


def download_post(url: str, dest: Path, timeout: int = 150, metadata: bool = False) -> list[Path]:
    """Baja las imágenes del carrusel a `dest` (01.jpg, 02.jpg…). Los slides que son video se omiten.

    Con `metadata`, gallery-dl deja además un `.json` por imagen (de ahí sale el texto del post: ver post_text).
    """
    link = clean_link(url)
    exe = shutil.which(gallery_dl_bin())
    if not exe:
        raise JobError(FAIL, retry=False, detail="gallery-dl no está instalado")
    dest.mkdir(parents=True, exist_ok=True)
    cmd = [
        exe,
        "--no-mtime",
        "--no-part",
        "-D",
        str(dest),
        "-f",
        "{num:>02}.{extension}",
        "--range",
        f"1-{MAX_IMAGES}",
        "--filter",
        "extension in ('jpg', 'jpeg', 'png', 'webp')",
        *(["--write-metadata"] if metadata else []),
        link,
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env={**os.environ, "HOME": str(dest.parent)})
    except subprocess.TimeoutExpired as exc:
        raise JobError(FAIL, retry=False, detail="gallery-dl tardó demasiado") from exc
    files = sorted(p for p in dest.iterdir() if p.suffix.lower() in IMAGE_EXT and p.stat().st_size > 0)
    if res.returncode != 0 or not files:
        # El detalle (sin el link) va solo al log: suele ser "login required" o "HTTP 429".
        detail = (res.stderr or res.stdout or "").strip().splitlines()[-1:] or ["sin salida"]
        raise JobError(FAIL, retry=False, detail=f"gallery-dl código {res.returncode}: {detail[0][:200]}")
    if len(files) < 2:
        raise JobError("Ese link tiene una sola imagen. Para copiar un estilo necesitamos un carrusel de al menos 2 slides.", retry=False)
    return files[:MAX_IMAGES]


def post_text(dest: Path) -> str | None:
    """El texto del post (la descripción debajo del carrusel), si gallery-dl lo dejó en los metadatos."""
    for meta in sorted(dest.glob("*.json")):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        text = data.get("description") if isinstance(data, dict) else None
        if isinstance(text, str) and text.strip():
            return text.strip()[:5000]
    return None
