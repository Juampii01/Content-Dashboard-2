"""Bucle principal del worker: toma trabajos, los ejecuta con lease y progreso, y se apaga solo si no hay nada.

Cada tipo de trabajo tiene un handler registrado (`register`). Así los carruseles pueden sumar el suyo
sin tocar la cola. El handler recibe un `JobContext` con progreso, etapa y acceso a la app y a la base.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import psycopg

from . import db
from .appclient import AppClient
from .config import VERSION, Config
from .errors import Cancelled, JobError, Shutdown
from .ffmpeg import stop_event

log = logging.getLogger("worker")

PROGRESS_EVERY = 2.0
HEARTBEAT_EVERY = 15.0

Handler = Callable[["JobContext"], dict[str, Any]]
_handlers: dict[str, Handler] = {}


def register(job_type: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _handlers[job_type] = fn
        return fn

    return deco


@dataclass
class JobContext:
    job: dict[str, Any]
    config: Config
    conn: psycopg.Connection
    app: AppClient
    _progress: Callable[[int, str], None]
    _stage: str = "Preparando"
    _base: float = 0.0
    _span: float = 1.0

    @property
    def input(self) -> dict[str, Any]:
        return self.job["input"]

    def stage(self, name: str, start: float, end: float) -> None:
        """Entra en una etapa que ocupa el tramo [start, end] (0 a 1) de la barra total."""
        self._stage, self._base, self._span = name, start, max(0.0, end - start)
        self._progress(round(start * 100), name)

    def progress(self, fraction: float) -> None:
        """Avance dentro de la etapa actual (0 a 1)."""
        self._progress(round((self._base + self._span * max(0.0, min(1.0, fraction))) * 100), self._stage)

    def check(self) -> None:
        if stop_event.is_set():
            raise Cancelled()

    def workdir(self, project_id: str) -> Path:
        path = self.config.work_dir / project_id
        path.mkdir(parents=True, exist_ok=True)
        return path


class Worker:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.app = AppClient(config.app_url, config.worker_secret)
        self.conn = db.connect(config.database_url)
        self.side = db.connect(config.database_url)  # latido y lease, en su propio hilo
        self.side_lock = threading.Lock()
        self.shutdown = threading.Event()
        self.current: dict[str, Any] | None = None
        self.last_progress = 0.0
        self.pending_progress: tuple[int, str] | None = None

    # ─── Señales ───────────────────────────────────────────────────────────

    def install_signals(self) -> None:
        def on_signal(signum: int, _frame: Any) -> None:
            log.info("señal %s: apagando con orden", signum)
            self.shutdown.set()
            stop_event.set()

        signal.signal(signal.SIGTERM, on_signal)
        signal.signal(signal.SIGINT, on_signal)

    # ─── Hilo lateral: latido y lease ──────────────────────────────────────

    def side_loop(self) -> None:
        last_beat = 0.0
        last_lease = 0.0
        while not self.shutdown.is_set():
            now = time.monotonic()
            try:
                with self.side_lock:
                    if now - last_beat >= HEARTBEAT_EVERY:
                        db.heartbeat(self.side, self.config.worker_id, VERSION, self.config.capabilities)
                        last_beat = now
                    job = self.current
                    if job and now - last_lease >= self.config.lease_seconds / 3:
                        if not db.renew(self.side, job["id"], self.config.worker_id, self.config.lease_seconds):
                            log.warning("el trabajo %s dejó de ser nuestro (cancelado o tomado por otro worker)", job["id"])
                            stop_event.set()
                        last_lease = now
                    if job and self.pending_progress and now - self.last_progress >= PROGRESS_EVERY:
                        value, stage = self.pending_progress
                        self.pending_progress = None
                        self.last_progress = now
                        if not db.progress(self.side, job["id"], self.config.worker_id, value, stage):
                            stop_event.set()
            except psycopg.Error as exc:
                log.warning("latido/lease falló: %s", exc.__class__.__name__)
                try:
                    self.side = db.connect(self.config.database_url)
                except psycopg.Error:
                    pass
            self.shutdown.wait(1.0)

    def report(self, value: int, stage: str) -> None:
        """Guarda el progreso; se escribe en la base como mucho cada 2 s (los cambios de etapa, enseguida)."""
        changed_stage = self.pending_progress is None or self.pending_progress[1] != stage
        self.pending_progress = (value, stage)
        if changed_stage and self.current and time.monotonic() - self.last_progress > 0.3:
            with self.side_lock:
                if self.current and self.pending_progress:
                    db.progress(self.side, self.current["id"], self.config.worker_id, *self.pending_progress)
                    self.pending_progress = None
                    self.last_progress = time.monotonic()

    # ─── Bucle principal ───────────────────────────────────────────────────

    def run(self) -> int:
        self.install_signals()
        log.info(self.config.describe())
        types = [t for t in self.config.capabilities if t in _handlers]
        side = threading.Thread(target=self.side_loop, daemon=True)
        side.start()
        idle_since = time.monotonic()
        try:
            while not self.shutdown.is_set():
                try:
                    job = db.claim(self.conn, self.config.worker_id, types, self.config.lease_seconds)
                except psycopg.Error as exc:
                    log.warning("no se pudo consultar la cola (%s); reintento en 10 s", exc.__class__.__name__)
                    self.shutdown.wait(10)
                    self.conn = db.connect(self.config.database_url)
                    continue
                if job:
                    self.process(job)
                    idle_since = time.monotonic()
                    continue
                idle = time.monotonic() - idle_since
                if self.config.idle_exit_minutes and idle >= self.config.idle_exit_minutes * 60:
                    log.info("sin trabajos hace %s min: me apago", self.config.idle_exit_minutes)
                    break
                self.shutdown.wait(self.config.poll_seconds)
        finally:
            self.shutdown.set()
            side.join(timeout=5)
            try:
                db.goodbye(self.conn, self.config.worker_id)
            except psycopg.Error:
                pass
        return 0

    def process(self, job: dict[str, Any]) -> None:
        handler = _handlers[job["type"]]
        stop_event.clear()
        self.current = job
        self.pending_progress = None
        log.info("trabajo %s (%s), intento %s de %s", job["id"], job["type"], job["attempts"], job["max_attempts"])
        ctx = JobContext(job=job, config=self.config, conn=self.conn, app=self.app, _progress=self.report)
        started = time.monotonic()
        try:
            if int(job["attempts"]) > int(job["max_attempts"]):
                raise JobError("El procesamiento se interrumpió varias veces. Prueba con un video más corto o avísale a soporte.", retry=False)
            output = handler(ctx)
            with self.side_lock:
                self.current = None
            db.succeed(self.conn, job["id"], self.config.worker_id, output)
            log.info("trabajo %s listo en %.1f s", job["id"], time.monotonic() - started)
        except Cancelled:
            with self.side_lock:
                self.current = None
            if self.shutdown.is_set():
                db.release(self.conn, job, self.config.worker_id)
                log.info("trabajo %s devuelto a la cola por apagado", job["id"])
            else:
                log.info("trabajo %s cancelado", job["id"])
        except Shutdown:
            with self.side_lock:
                self.current = None
            db.release(self.conn, job, self.config.worker_id)
        except JobError as exc:
            with self.side_lock:
                self.current = None
            log.error("trabajo %s falló: %s", job["id"], exc.detail or exc.user_message)
            retried = db.fail(self.conn, job, self.config.worker_id, exc.user_message, exc.retry)
            log.info("→ %s", "se reintentará" if retried else "falló definitivamente")
        except Exception as exc:  # noqa: BLE001 — cualquier error inesperado se reintenta
            with self.side_lock:
                self.current = None
            log.exception("trabajo %s: error inesperado", job["id"])
            db.fail(self.conn, job, self.config.worker_id, "Falló el procesamiento del video. Si vuelve a pasar, avísale a soporte.", True)
            del exc
        finally:
            stop_event.clear()
