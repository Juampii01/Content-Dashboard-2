"""Configuración del worker, leída una sola vez de las variables de entorno.

Nunca se imprimen valores de claves: solo si están o no.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

VERSION = "1.0.0"


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    database_url: str
    app_url: str
    worker_secret: str
    work_dir: Path
    fonts_dir: Path
    worker_id: str
    idle_exit_minutes: int
    lease_seconds: int
    poll_seconds: int
    deepgram_api_key: str | None
    groq_api_key: str | None
    test_transcript: str | None
    x264_preset: str
    capabilities: list[str] = field(default_factory=lambda: ["VIDEO_ANALYZE", "VIDEO_RENDER"])

    def describe(self) -> str:
        """Resumen para el log de arranque, sin secretos."""
        providers = [p for p, ok in (("deepgram", self.deepgram_api_key), ("groq", self.groq_api_key), ("prueba", self.test_transcript)) if ok]
        return (
            f"worker {self.worker_id} v{VERSION} · app {self.app_url} · trabajo {self.work_dir} · "
            f"transcripción: {', '.join(providers) or 'sin configurar'} · apagado tras {self.idle_exit_minutes or '∞'} min sin trabajos"
        )


def load() -> Config:
    missing = [n for n in ("DATABASE_URL_UNPOOLED", "APP_URL", "WORKER_SECRET") if not os.environ.get(n)]
    # DATABASE_URL sirve de respaldo, pero en Neon tiene que ser la conexión sin pooler.
    if "DATABASE_URL_UNPOOLED" in missing and os.environ.get("DATABASE_URL"):
        missing.remove("DATABASE_URL_UNPOOLED")
    if missing:
        raise SystemExit(f"Faltan variables de entorno: {', '.join(missing)} (ver docs/worker.md)")
    here = Path(__file__).resolve().parent.parent
    on_fly = bool(os.environ.get("FLY_APP_NAME"))
    test_transcript = os.environ.get("WORKER_TEST_TRANSCRIPT") or None
    if on_fly and test_transcript:
        # El proveedor de prueba es solo para tests locales: nunca en producción.
        test_transcript = None
    return Config(
        database_url=os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"],
        app_url=os.environ["APP_URL"].rstrip("/"),
        worker_secret=os.environ["WORKER_SECRET"],
        work_dir=Path(os.environ.get("WORK_DIR") or (Path("/data/work") if on_fly else here.parent / ".data" / "worker")),
        fonts_dir=Path(os.environ.get("FONTS_DIR") or here / "fonts"),
        worker_id=os.environ.get("FLY_MACHINE_ID") or f"{socket.gethostname()}-{os.getpid()}",
        idle_exit_minutes=_int("IDLE_EXIT_MINUTES", 5),
        lease_seconds=max(30, _int("LEASE_SECONDS", 90)),
        poll_seconds=max(1, _int("POLL_SECONDS", 3)),
        deepgram_api_key=os.environ.get("DEEPGRAM_API_KEY") or None,
        groq_api_key=os.environ.get("GROQ_API_KEY") or None,
        test_transcript=test_transcript,
        x264_preset=os.environ.get("X264_PRESET") or "slow",
    )
