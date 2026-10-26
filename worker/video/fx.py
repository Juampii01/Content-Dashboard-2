"""Efectos "de firma" en el render: cada efecto se dibuja aparte, cuadro a cuadro, con el motor de efectos (el mismo de
la vista previa, `worker/motion/fx.mjs` + `fx-engine.mjs`) y entra al grafo final como una capa a pantalla completa
(como un b-roll, sin fundido: el efecto ya trae su entrada y su salida).

Por efecto:
1. **Tramo**: los cuadros del video unido (`joined.mkv`) en el tiempo del efecto, con el mismo encuadre del video final
   y sin zooms (los efectos traen su propia cámara).
2. **Máscara** (si el efecto va detrás de la persona): los bloques de `fx_mask` de los cuadros del original que se ven
   (la app manda la lista: `sourceFrames`), en un archivo crudo al tamaño de trabajo.
3. **Dibujo**: Node + skia-canvas → H.264. Caché por hash del spec, de los cuadros y de la versión del motor.

Composiciones (kind "composition", lib/video/compos): animaciones escritas por Claude. El código corre en el sandbox
de `compos-engine.mjs` (hilo con memoria acotada, vm sin generación de código, tiempo por cuadro). Si una falla en el
render, se descarta con un aviso (`warnings`) y el video sale igual: una composición rota nunca rompe el render.

Las miniaturas de "tus reels" (Giro 3D, Pared de capturas, Ventana de tu app) se bajan del almacenamiento público de
la app; si alguna no se puede bajar, el motor dibuja una tarjeta con la marca.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import numpy as np

from comunes import ffmpeg
from comunes.errors import JobError

from . import fx_mask, motion

log = logging.getLogger("worker.video.fx")

FX_SCRIPT = motion.MOTION_DIR / "fx.mjs"
FX_ENGINE = motion.MOTION_DIR / "fx-engine.mjs"
FPS = 30
TIMEOUT = 900
# Efectos (hasta 40) y transiciones (hasta 24) del plan.
MAX_EFFECTS = 64


COMPOS_ENGINE = motion.MOTION_DIR / "compos-engine.mjs"
# Igual que COMPOS_LIMITS.longCodeChars (lib/video/compos/contract.ts): una pieza única puede tener hasta 90 mil.
COMPOS_MAX_CODE = 90_000
# Duración máxima de un efecto: 30 s; una animación (pieza única de «Animar todo») hasta 180 s.
FX_MAX_SECONDS = 30
COMPOS_MAX_SECONDS = 180


class ComposFailed(JobError):
    """Una composición no se pudo dibujar (se descarta; el render sigue)."""


def enabled() -> bool:
    return bool(motion.node_bin()) and FX_SCRIPT.exists() and FX_ENGINE.exists() and (motion.MOTION_DIR / "node_modules" / "skia-canvas").exists()


@lru_cache(maxsize=1)
def engine_hash() -> str:
    try:
        extra = COMPOS_ENGINE.read_bytes() if COMPOS_ENGINE.exists() else b""
        return hashlib.sha1(FX_ENGINE.read_bytes() + FX_SCRIPT.read_bytes() + extra).hexdigest()[:10]
    except OSError:
        return "sin-motor"


def layer_z(item: dict[str, Any]) -> float:
    """Lugar en el orden de dibujo (lo calcula la app: lib/video/layers.ts); sin el campo, 0 (planes viejos)."""
    try:
        return float(item.get("z", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def overlay_order(overlays: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Las capas de abajo hacia arriba: por `z` (b-roll, gráficos, efectos y transiciones juntos) y, con el mismo `z`,
    por inicio (como antes de las capas). Las que se superponen se dibujan una encima de otra, sin recortarse."""
    return sorted(overlays, key=lambda o: (float(o.get("z", 0) or 0), float(o["start"])))


def validate(item: Any) -> dict[str, Any]:
    """Revisión defensiva (la app ya validó y compiló el efecto)."""
    if not isinstance(item, dict) or not isinstance(item.get("spec"), dict):
        raise JobError("Un efecto del video no es válido. Quítalo en la revisión.", retry=False)
    spec = item["spec"]
    max_s = COMPOS_MAX_SECONDS if spec.get("kind") == "composition" else FX_MAX_SECONDS
    if spec.get("v") != 1 or not isinstance(spec.get("kind"), str) or not (0 < float(spec.get("duration") or 0) <= max_s):
        raise JobError("Un efecto del video no es válido. Quítalo en la revisión.", retry=False)
    if spec.get("kind") == "composition":
        compos = spec.get("compos")
        if not isinstance(compos, dict) or not isinstance(compos.get("code"), str) or not (0 < len(compos["code"]) <= COMPOS_MAX_CODE) or not isinstance(compos.get("env"), dict):
            raise ComposFailed("Una animación del video no es válida.", retry=False)
    frames = item.get("sourceFrames")
    if spec.get("mask") and (not isinstance(frames, list) or not all(isinstance(f, int) and f >= 0 for f in frames)):
        raise JobError("Un efecto con recorte no trae sus cuadros. Vuelve a guardar la revisión.", retry=False)
    return item


def base_clip(joined: Path, start: float, frames: int, src_size: tuple[int, int], fmt: str, offset_x: float, out: Path) -> Path:
    """Los cuadros del video final en el tramo del efecto, encuadrados y sin zooms (H.264 casi sin pérdida)."""
    if out.exists() and out.stat().st_size > 0:
        return out
    w, h = fx_mask.output_size(fmt)
    graph = fx_mask.framing_filter(src_size[0], src_size[1], fmt, offset_x, w, h)
    tmp = out.with_name(f"{out.stem}.part{out.suffix}")
    ffmpeg.run(
        ["-ss", f"{start:.6f}", "-i", str(joined), "-filter_complex", graph, "-map", "[v]", "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", str(tmp)],
        what="tramo del efecto",
    )
    os.replace(tmp, out)
    return out


def mask_file(cache: Path, key: str, source_frames: list[int], out: Path) -> tuple[Path, int, int]:
    """Las máscaras de los cuadros del efecto, una detrás de otra (un byte por píxel)."""
    first = fx_mask.mask_at(cache, key, source_frames[0])
    h, w = first.shape
    if not (out.exists() and out.stat().st_size == w * h * len(source_frames)):
        tmp = out.with_name(out.name + ".part")
        with open(tmp, "wb") as fh:
            for f in source_frames:
                fh.write(np.ascontiguousarray(fx_mask.mask_at(cache, key, f)).tobytes())
        os.replace(tmp, out)
    return out, w, h


def run_node(payload: dict[str, Any], timeout: int = TIMEOUT) -> dict[str, Any]:
    node = motion.node_bin()
    if not node:
        raise JobError("Falta Node en el servicio de procesamiento para dibujar los efectos.", retry=False)
    try:
        proc = subprocess.run([node, str(FX_SCRIPT)], input=json.dumps(payload).encode(), capture_output=True, timeout=timeout, cwd=str(motion.MOTION_DIR))
    except subprocess.TimeoutExpired as e:
        raise JobError("Dibujar un efecto tardó demasiado.", detail=str(e)) from e
    try:
        result = json.loads(proc.stdout.decode(errors="replace").strip().splitlines()[-1] or "{}")
    except (ValueError, IndexError):
        result = {}
    if proc.returncode != 0 or not result.get("ok"):
        detail = (result.get("error") or proc.stderr.decode(errors="replace"))[-800:]
        if result.get("compos") or (payload.get("spec") or {}).get("kind") == "composition":
            raise ComposFailed("Una animación no se pudo dibujar y se quitó del video.", retry=False, detail=detail)
        raise JobError("No pudimos dibujar un efecto del video.", detail=detail)
    return result


def fetch_images(ctx: Any, item: dict[str, Any], cache: Path, hosts: tuple[str, ...]) -> dict[str, str]:
    """Baja las miniaturas de tus reels (si alguna falla, el motor dibuja una tarjeta con la marca)."""
    out: dict[str, str] = {}
    # Imágenes de las composiciones (generadas con IA, guardadas en el almacenamiento del proyecto): por su clave.
    pid = str(item.get("projectId") or "")
    for key, skey in (item.get("imageKeys") or {}).items():
        if not isinstance(skey, str) or not pid or not skey.startswith(f"editor/{pid}/compos/"):
            continue
        path = cache / f"img-{hashlib.sha1(skey.encode()).hexdigest()[:16]}{Path(skey).suffix[:5] or '.png'}"
        try:
            if not path.exists():
                ctx.app.download(pid, skey, path)
            out[str(key)] = str(path)
        except JobError as e:  # noqa: PERF203
            log.warning("no se pudo bajar la imagen %s: %s", key, e.detail or e)
    for key, url in (item.get("images") or {}).items():
        if not isinstance(url, str) or not url:
            continue
        name = hashlib.sha1(url.encode()).hexdigest()[:16]
        path = cache / f"thumb-{name}{Path(url.split('?')[0]).suffix[:5] or '.jpg'}"
        try:
            if not path.exists():
                ctx.app.download_url(url, path, hosts, max_bytes=8 * 1024 * 1024)
            out[str(key)] = str(path)
        except JobError as e:  # noqa: PERF203
            log.warning("no se pudo bajar la miniatura %s: %s", key, e.detail or e)
    return out


def render_effects(
    ctx: Any,
    items: list[dict[str, Any]],
    *,
    joined: Path,
    mezz: Path,
    src_size: tuple[int, int],
    total_frames: int,
    fmt: str,
    offset_x: float,
    workdir: Path,
    fonts_dir: Path,
    image_hosts: tuple[str, ...] = (),
    on_progress: Callable[[float], None] | None = None,
    warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Dibuja cada efecto. Devuelve [{"path", "start", "end", "kind", "ms", "maskMs"}] en el orden del video.

    Una composición que falla (código, tiempo o memoria) se salta y se anota en `warnings`."""
    if not items:
        return []
    if not enabled():
        raise JobError("Este video tiene efectos y el motor de efectos no está disponible en el servicio de procesamiento.", retry=False)
    cache = workdir / "fx"
    cache.mkdir(exist_ok=True)
    mask_cache = workdir / "fx-mask"
    out: list[dict[str, Any]] = []
    checked: list[dict[str, Any]] = []
    for raw in items[:MAX_EFFECTS]:
        try:
            checked.append(validate(raw))
        except ComposFailed as e:
            log.warning("composición descartada: %s", e.user_message)
            if warnings is not None:
                warnings.append(e.user_message)
    items = checked
    for n, item in enumerate(items):
        if hasattr(ctx, "check"):
            ctx.check()
        spec = item["spec"]
        start = float(spec["start"])
        frames = max(1, round(float(spec["duration"]) * FPS))
        source_frames = [min(max(0, int(f)), max(0, total_frames - 1)) for f in (item.get("sourceFrames") or [])][:frames]
        while source_frames and len(source_frames) < frames:
            source_frames.append(source_frames[-1])
        key_obj = {"spec": spec, "src": source_frames, "fmt": fmt, "off": round(offset_x, 3), "engine": engine_hash(), "mask": fx_mask.MASK_VERSION, "img": sorted((item.get("images") or {}).items()), "ik": sorted((item.get("imageKeys") or {}).items())}
        h = hashlib.sha1(json.dumps(key_obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        final = cache / f"fx-{h}.mp4"
        mask_ms = 0
        draw_ms = 0
        if not (final.exists() and final.stat().st_size > 0):
            base = base_clip(joined, start, frames, src_size, fmt, offset_x, cache / f"base-{h}.mkv")
            payload: dict[str, Any] = {"spec": spec, "base": str(base), "out": str(final.with_name(final.stem + ".part.mp4")), "fps": FPS, "fontsDir": str(fonts_dir)}
            if spec.get("mask"):
                t0 = time.monotonic()
                key = fx_mask.ensure_chunks(mezz, src_size, total_frames, fmt, offset_x, fx_mask.chunks_for_frames(source_frames), mask_cache, check=getattr(ctx, "check", None))
                mpath, mw, mh = mask_file(mask_cache, key, source_frames, cache / f"mask-{h}.raw")
                mask_ms = round((time.monotonic() - t0) * 1000)
                payload["mask"] = {"path": str(mpath), "width": mw, "height": mh}
            if item.get("images") or item.get("imageKeys"):
                payload["images"] = fetch_images(ctx, item, cache, image_hosts)
            t0 = time.monotonic()
            try:
                run_node(payload)
            except ComposFailed as e:
                name = str((spec.get("text") or "")[:60])
                log.warning("composición %s descartada en el render: %s", spec.get("id"), e.detail)
                if warnings is not None:
                    warnings.append(f"La animación «{name}» no se pudo dibujar y el video salió sin ella." if name else e.user_message)
                for tmp in (cache / f"base-{h}.mkv", cache / f"mask-{h}.raw", final.with_name(final.stem + ".part.mp4")):
                    tmp.unlink(missing_ok=True)
                continue
            draw_ms = round((time.monotonic() - t0) * 1000)
            os.replace(final.with_name(final.stem + ".part.mp4"), final)
            for tmp in (cache / f"base-{h}.mkv", cache / f"mask-{h}.raw"):
                tmp.unlink(missing_ok=True)
            log.info("efecto %s (%s): %s cuadros, máscara %s ms, dibujo %s ms", spec.get("id"), spec.get("kind"), frames, mask_ms, draw_ms)
        out.append({"path": final, "id": str(spec.get("id") or ""), "start": start, "end": start + frames / FPS, "kind": spec.get("kind"), "ms": draw_ms, "maskMs": mask_ms, "z": layer_z(item)})
        if on_progress:
            on_progress((n + 1) / len(items))
    return out


def preview_masks(ctx: Any, mezz: Path, src_size: tuple[int, int], total_frames: int, fmt: str, offset_x: float, chunks: list[int], workdir: Path, upload: Callable[[Path, str], None], prefix: str, on_progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    """Trabajo VIDEO_FX: calcula los bloques de máscara pedidos y sube una tira chica por bloque (la usa la vista previa
    para recortarte en vivo, con la misma máscara que el render)."""
    mask_cache = workdir / "fx-mask"
    key = fx_mask.ensure_chunks(mezz, src_size, total_frames, fmt, offset_x, chunks, mask_cache, on_progress=lambda p: on_progress(p * 0.85) if on_progress else None, check=getattr(ctx, "check", None))
    strips = mask_cache / key / "tiras"
    strips.mkdir(exist_ok=True)
    done: list[int] = []
    for i, k in enumerate(sorted(set(chunks))):
        if not fx_mask.chunk_path(mask_cache, key, k).exists():
            continue
        path = strips / f"m-{k:05d}.png"
        if not path.exists():
            fx_mask.preview_strip(mask_cache, key, k, fmt, path)
        upload(path, f"{prefix}/{key}/m-{k:05d}.png")
        done.append(k)
        if on_progress:
            on_progress(0.85 + 0.15 * (i + 1) / max(1, len(chunks)))
    w, h = fx_mask.PREVIEW_SIZE[fmt]
    return {"key": key, "chunks": done, "fps": fx_mask.PREVIEW_FPS, "tile": [w, h]}


def render_stills(
    ctx: Any,
    item: dict[str, Any],
    times: list[float],
    *,
    joined: Path,
    mezz: Path,
    src_size: tuple[int, int],
    total_frames: int,
    fmt: str,
    offset_x: float,
    workdir: Path,
    fonts_dir: Path,
    image_hosts: tuple[str, ...] = (),
    out_dir: Path,
) -> list[Path | None]:
    """Cuadros sueltos de un efecto o una animación (PNG del tamaño final) en los instantes pedidos (segundos del
    efecto): para que Claude mire su animación sobre el video real. Mismo motor y mismas entradas que el render."""
    if not enabled():
        raise ComposFailed("El motor de efectos no está disponible.", retry=False)
    item = validate(item)
    spec = item["spec"]
    start = float(spec["start"])
    frames = max(1, round(float(spec["duration"]) * FPS))
    cache = workdir / "fx"
    cache.mkdir(exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    source_frames = [min(max(0, int(f)), max(0, total_frames - 1)) for f in (item.get("sourceFrames") or [])][:frames]
    while source_frames and len(source_frames) < frames:
        source_frames.append(source_frames[-1])
    h = hashlib.sha1(json.dumps({"spec": spec, "src": source_frames, "fmt": fmt, "off": round(offset_x, 3)}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    base = base_clip(joined, start, frames, src_size, fmt, offset_x, cache / f"base-{h}.mkv")
    payload: dict[str, Any] = {"spec": spec, "base": str(base), "out": str(out_dir / "c"), "fps": FPS, "fontsDir": str(fonts_dir), "stills": [max(0.0, min(float(spec["duration"]) - 1 / FPS, t)) for t in times]}
    try:
        if spec.get("mask") and source_frames:
            mask_cache = workdir / "fx-mask"
            key = fx_mask.ensure_chunks(mezz, src_size, total_frames, fmt, offset_x, fx_mask.chunks_for_frames(source_frames), mask_cache, check=getattr(ctx, "check", None))
            mpath, mw, mh = mask_file(mask_cache, key, source_frames, cache / f"mask-{h}.raw")
            payload["mask"] = {"path": str(mpath), "width": mw, "height": mh}
        if item.get("images") or item.get("imageKeys"):
            payload["images"] = fetch_images(ctx, item, cache, image_hosts)
        run_node(payload, timeout=300)
    finally:
        for tmp in (cache / f"base-{h}.mkv", cache / f"mask-{h}.raw"):
            tmp.unlink(missing_ok=True)
    return [p if (p := out_dir / f"c-{k}.png").exists() else None for k in range(len(times))]
