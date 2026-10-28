"""Cola de trabajos sobre la tabla `jobs` de Postgres (sin pg-boss ni Redis).

- Tomar: `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`. Dos workers nunca toman
  el mismo trabajo. También se recuperan trabajos con el lease vencido (un worker que murió a mitad).
- Lease: el worker renueva `locked_until` mientras trabaja; si no puede (otro lo tomó, se canceló), para.
- Reintentos: con espera creciente (30 s, 2 min, 8 min…) hasta `max_attempts`. Después, FAILED con el error en español.
- Latido: `worker_heartbeats`, para que la app sepa si el servicio está encendido.

Usa la conexión sin pooler (`DATABASE_URL_UNPOOLED`): el pooler de Neon en modo transacción no conserva sesión.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

log = logging.getLogger("worker.db")

BACKOFF_BASE_SECONDS = 30


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(
        url,
        autocommit=True,
        row_factory=dict_row,
        connect_timeout=15,
        keepalives=1,
        keepalives_idle=30,
        application_name="content2-worker",
    )


def backoff_seconds(attempts: int) -> int:
    """Espera antes del reintento número `attempts` (1 → 30 s, 2 → 2 min, 3 → 8 min), con tope de 30 min."""
    return min(1800, BACKOFF_BASE_SECONDS * 4 ** max(0, attempts - 1))


CLAIM_SQL = """
UPDATE jobs SET
  status = 'RUNNING',
  locked_by = %(worker)s,
  locked_until = now() + make_interval(secs => %(lease)s),
  attempts = attempts + 1,
  started_at = coalesce(started_at, now())
WHERE id = (
  SELECT id FROM jobs
  WHERE type = ANY(%(types)s::job_type[])
    AND ((status = 'QUEUED' AND run_after <= now()) OR (status = 'RUNNING' AND locked_until < now()))
  ORDER BY run_after, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
"""


def claim(conn: psycopg.Connection, worker: str, types: list[str], lease: int) -> dict[str, Any] | None:
    return conn.execute(CLAIM_SQL, {"worker": worker, "types": types, "lease": lease}).fetchone()


def renew(conn: psycopg.Connection, job_id: str, worker: str, lease: int) -> bool:
    row = conn.execute(
        "UPDATE jobs SET locked_until = now() + make_interval(secs => %s) WHERE id = %s AND locked_by = %s AND status = 'RUNNING' RETURNING id",
        (lease, job_id, worker),
    ).fetchone()
    return row is not None


def progress(conn: psycopg.Connection, job_id: str, worker: str, value: int, stage: str) -> bool:
    row = conn.execute(
        "UPDATE jobs SET progress = %s, stage = %s WHERE id = %s AND locked_by = %s AND status = 'RUNNING' RETURNING id",
        (max(0, min(100, value)), stage[:120], job_id, worker),
    ).fetchone()
    return row is not None


def succeed(conn: psycopg.Connection, job_id: str, worker: str, output: dict[str, Any]) -> bool:
    """Marca el trabajo como listo. Solo si sigue en curso y es nuestro: uno cancelado mientras corría queda cancelado."""
    row = conn.execute(
        """UPDATE jobs SET status = 'SUCCEEDED', progress = 100, stage = 'Listo', output = %s, error_message = NULL,
           finished_at = now(), locked_until = NULL WHERE id = %s AND locked_by = %s AND status = 'RUNNING' RETURNING id""",
        (Jsonb(output), job_id, worker),
    ).fetchone()
    return row is not None


def fail(conn: psycopg.Connection, job: dict[str, Any], worker: str, message: str, retry: bool) -> bool | None:
    """Marca el intento como fallido. Devuelve True si queda programado un reintento, False si falló del todo y None si
    el trabajo ya no estaba en curso (lo cancelaron mientras corría): entonces no se toca nada, ni se revive."""
    attempts = int(job["attempts"])
    if retry and attempts < int(job["max_attempts"]):
        wait = backoff_seconds(attempts)
        row = conn.execute(
            """UPDATE jobs SET status = 'QUEUED', run_after = now() + make_interval(secs => %s), locked_by = NULL, locked_until = NULL,
               error_message = %s, stage = %s WHERE id = %s AND locked_by = %s AND status = 'RUNNING' RETURNING id""",
            (wait, message[:1000], f"Reintento {attempts + 1} de {job['max_attempts']} en {format_wait(wait)}", job["id"], worker),
        ).fetchone()
        return True if row else None
    row = conn.execute(
        """UPDATE jobs SET status = 'FAILED', error_message = %s, finished_at = now(), locked_until = NULL
           WHERE id = %s AND locked_by = %s AND status = 'RUNNING' RETURNING id""",
        (message[:1000], job["id"], worker),
    ).fetchone()
    if row is None:
        return None
    if job.get("video_project_id"):
        conn.execute(
            "UPDATE video_projects SET status = 'FAILED', error_message = %s, updated_at = now() WHERE id = %s",
            (message[:1000], job["video_project_id"]),
        )
    return False


ADOPT_SQL = """
UPDATE jobs SET
  status = 'RUNNING',
  locked_by = %(worker)s,
  locked_until = now() + make_interval(secs => %(lease)s),
  attempts = attempts + 1,
  started_at = coalesce(started_at, now())
WHERE id = (
  SELECT id FROM jobs
  WHERE type = 'VIDEO_COMPOS' AND video_project_id = %(project)s
    AND status = 'QUEUED' AND run_after <= now() AND input ? 'workId'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
"""


def adopt_compos(conn: psycopg.Connection, worker: str, project_id: str, lease: int) -> dict[str, Any] | None:
    """Toma otro pedido de animación en cola del mismo video para correrlo en paralelo (lease largo: el hilo lateral
    solo renueva el trabajo principal)."""
    return conn.execute(ADOPT_SQL, {"worker": worker, "project": project_id, "lease": lease}).fetchone()


def finish_adopted(conn: psycopg.Connection, job_id: str, worker: str, error: str | None) -> None:
    """Cierra un pedido adoptado. Un pedido fallido no marca el video como fallido (el aviso va en el pedido)."""
    if error is None:
        succeed(conn, job_id, worker, {"parallel": True})
        return
    conn.execute(
        """UPDATE jobs SET status = 'FAILED', error_message = %s, finished_at = now(), locked_until = NULL
           WHERE id = %s AND locked_by = %s AND status = 'RUNNING'""",
        (error[:1000], job_id, worker),
    )


def compos_request_status(conn: psycopg.Connection, work_id: str) -> str | None:
    """Estado de un pedido de animación ("queued", "running", "canceled"…), o None si ya no existe."""
    row = conn.execute("SELECT status FROM compos_requests WHERE id = %s", (work_id,)).fetchone()
    if row is None:
        return None
    return str(row["status"] if isinstance(row, dict) else row[0])


def fail_compos_request(conn: psycopg.Connection, work_id: str, message: str) -> None:
    """Un pedido de animación que no se pudo terminar: el aviso queda en su fila (los demás siguen)."""
    conn.execute(
        """UPDATE compos_requests SET status = 'failed', error = %s, updated_at = now()
           WHERE id = %s AND status IN ('queued', 'running')""",
        (message[:400], work_id),
    )


def release(conn: psycopg.Connection, job: dict[str, Any], worker: str) -> None:
    """Devuelve el trabajo a la cola sin contar el intento (apagado ordenado)."""
    conn.execute(
        """UPDATE jobs SET status = 'QUEUED', attempts = greatest(0, attempts - 1), run_after = now(), locked_by = NULL,
           locked_until = NULL, stage = 'En cola' WHERE id = %s AND locked_by = %s AND status = 'RUNNING'""",
        (job["id"], worker),
    )


def heartbeat(conn: psycopg.Connection, worker: str, version: str, capabilities: list[str]) -> None:
    conn.execute(
        """INSERT INTO worker_heartbeats (worker_id, version, capabilities, seen_at) VALUES (%s, %s, %s, now())
           ON CONFLICT (worker_id) DO UPDATE SET version = excluded.version, capabilities = excluded.capabilities, seen_at = now()""",
        (worker, version, capabilities),
    )
    conn.execute("DELETE FROM worker_heartbeats WHERE seen_at < now() - interval '1 day'")


def goodbye(conn: psycopg.Connection, worker: str) -> None:
    conn.execute("DELETE FROM worker_heartbeats WHERE worker_id = %s", (worker,))


# ─── Proyectos de video ────────────────────────────────────────────────────


def get_project(conn: psycopg.Connection, project_id: str) -> dict[str, Any] | None:
    return conn.execute("SELECT * FROM video_projects WHERE id = %s", (project_id,)).fetchone()


def update_project(conn: psycopg.Connection, project_id: str, **fields: Any) -> None:
    if not fields:
        return
    cols = []
    values: list[Any] = []
    for key, value in fields.items():
        cols.append(f"{key} = %s")
        values.append(Jsonb(value) if isinstance(value, (dict, list)) else value)
    values.append(project_id)
    conn.execute(f"UPDATE video_projects SET {', '.join(cols)}, updated_at = now() WHERE id = %s", values)


def format_wait(seconds: int) -> str:
    return f"{seconds} s" if seconds < 60 else f"{seconds // 60} min"


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
