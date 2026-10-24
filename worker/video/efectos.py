"""Mis efectos: la muestra de cada animación guardada (lib/video/compos/library-service.ts).

Cuando un video con animaciones se renderiza, la app guarda solas las animaciones en Mis efectos y le pide al worker
la muestra de las que todavía no tienen: un cuadro (`poster.jpg`) y un clip corto en bucle (`muestra.webm`, VP9 sin
audio, 3 s como mucho, 360 px de ancho). Salen del mismo clip que se dibujó para el render (la animación sobre el video
real), así no se dibuja nada dos veces. Se guardan en `editor/efectos/<id>/` y se avisan a la app. Si algo falla, el
video ya está entregado: solo queda sin muestra.
"""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path
from typing import Any

from comunes.errors import Cancelled

log = logging.getLogger("worker.efectos")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SAMPLE_SECONDS = 3.0
SAMPLE_WIDTH = 360


def sample_files(clip: Path, duration: float, out_dir: Path) -> tuple[Path, Path]:
    """Cuadro y clip en bucle de una animación ya dibujada (`clip`: el MP4 de la capa del render)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    poster = out_dir / "poster.jpg"
    sample = out_dir / "muestra.webm"
    length = max(0.5, min(SAMPLE_SECONDS, duration))
    mid = max(0.0, min(duration - 0.05, duration * 0.45))
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{mid:.3f}", "-i", str(clip), "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", str(poster)],
        check=True,
        timeout=60,
    )
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(clip), "-t", f"{length:.3f}", "-an",
            "-vf", f"scale={SAMPLE_WIDTH}:-2,fps=24", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
            str(sample),
        ],
        check=True,
        timeout=120,
    )
    return poster, sample


def save_samples(ctx: Any, samples: list[dict[str, Any]], fx_layers: list[dict[str, Any]], out_dir: Path) -> int:
    """Muestras de los efectos pedidos (`samples`: [{effectId, compId}]). Devuelve cuántas se guardaron."""
    done = 0
    for item in samples[:8]:
        effect_id = str(item.get("effectId") or "")
        comp_id = str(item.get("compId") or "")
        if not UUID_RE.match(effect_id) or not comp_id:
            continue
        layer = next((f for f in fx_layers if str(f.get("id")) == comp_id and Path(f["path"]).exists()), None)
        if not layer:
            continue
        try:
            ctx.check()
            poster, sample = sample_files(Path(layer["path"]), float(layer["end"]) - float(layer["start"]), out_dir / f"efecto-{effect_id[:8]}")
            owner = {"effectId": effect_id}
            poster_key = f"editor/efectos/{effect_id}/poster.jpg"
            sample_key = f"editor/efectos/{effect_id}/muestra.webm"
            ctx.app.upload(None, poster_key, poster, "image/jpeg", owner=owner)
            ctx.app.upload(None, sample_key, sample, "video/webm", owner=owner)
            ctx.app._post(f"/api/worker/efectos/{effect_id}/muestra", {"posterKey": poster_key, "sampleKey": sample_key}, timeout=30)  # noqa: SLF001
            done += 1
        except Cancelled:
            raise
        except Exception:  # noqa: BLE001 — una muestra que falla no afecta el video
            log.warning("no se pudo guardar la muestra del efecto %s", effect_id, exc_info=True)
    return done
