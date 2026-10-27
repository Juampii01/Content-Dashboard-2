"""Cola sobre Postgres: toma exclusiva, lease vencido, reintentos con espera y fallo definitivo.

Necesita una base de prueba con las migraciones aplicadas (nunca la de un cliente: crea y borra trabajos):
    TEST_DATABASE_URL=postgres://… pytest tests/test_queue.py
"""

import os
import threading
import uuid

import pytest

from comunes import db

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL no está definida")
TYPES = ["VIDEO_ANALYZE", "VIDEO_RENDER"]


@pytest.fixture()
def conn():
    c = db.connect(URL)
    c.execute("DELETE FROM jobs WHERE type IN ('VIDEO_ANALYZE', 'VIDEO_RENDER')")
    yield c
    c.execute("DELETE FROM jobs WHERE type IN ('VIDEO_ANALYZE', 'VIDEO_RENDER')")
    c.execute("DELETE FROM video_projects WHERE title LIKE 'test-cola-%'")
    c.close()


def add_job(conn, project_id=None, max_attempts=3):
    return conn.execute(
        "INSERT INTO jobs (type, input, max_attempts, video_project_id) VALUES ('VIDEO_ANALYZE', '{}', %s, %s) RETURNING id",
        (max_attempts, project_id),
    ).fetchone()["id"]


def add_project(conn):
    return conn.execute("INSERT INTO video_projects (title, status) VALUES (%s, 'PROCESSING') RETURNING id", (f"test-cola-{uuid.uuid4()}",)).fetchone()["id"]


def test_two_workers_never_take_the_same_job(conn):
    ids = {add_job(conn) for _ in range(6)}
    taken: list[str] = []
    lock = threading.Lock()

    def worker(name: str) -> None:
        c = db.connect(URL)
        while True:
            job = db.claim(c, name, TYPES, 60)
            if not job:
                break
            with lock:
                taken.append(job["id"])
        c.close()

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(taken) == sorted(ids)


def test_expired_lease_is_recovered_and_counts_attempt(conn):
    job_id = add_job(conn)
    first = db.claim(conn, "muerto", TYPES, 30)
    assert first["attempts"] == 1
    assert db.claim(conn, "vivo", TYPES, 30) is None  # el lease sigue vigente
    conn.execute("UPDATE jobs SET locked_until = now() - interval '1 second' WHERE id = %s", (job_id,))
    second = db.claim(conn, "vivo", TYPES, 30)
    assert second["id"] == job_id and second["attempts"] == 2 and second["locked_by"] == "vivo"
    assert db.renew(conn, job_id, "muerto", 30) is False  # el worker viejo ya no puede renovar
    assert db.renew(conn, job_id, "vivo", 30) is True


def test_retry_with_backoff_then_final_failure_marks_project(conn):
    project = add_project(conn)
    job_id = add_job(conn, project, max_attempts=2)
    job = db.claim(conn, "w", TYPES, 30)
    assert db.fail(conn, job, "w", "Falló algo.", retry=True) is True
    row = conn.execute("SELECT status, run_after > now() + interval '20 seconds' AS later, stage FROM jobs WHERE id = %s", (job_id,)).fetchone()
    assert row["status"] == "QUEUED" and row["later"] and "Reintento 2 de 2" in row["stage"]
    assert db.claim(conn, "w", TYPES, 30) is None  # todavía no le toca
    conn.execute("UPDATE jobs SET run_after = now() WHERE id = %s", (job_id,))
    job = db.claim(conn, "w", TYPES, 30)
    assert job["attempts"] == 2
    assert db.fail(conn, job, "w", "Falló otra vez.", retry=True) is False
    assert conn.execute("SELECT status FROM jobs WHERE id = %s", (job_id,)).fetchone()["status"] == "FAILED"
    p = conn.execute("SELECT status, error_message FROM video_projects WHERE id = %s", (project,)).fetchone()
    assert p["status"] == "FAILED" and p["error_message"] == "Falló otra vez."


def test_release_returns_job_without_counting(conn):
    job_id = add_job(conn)
    job = db.claim(conn, "w", TYPES, 30)
    db.release(conn, job, "w")
    row = conn.execute("SELECT status, attempts FROM jobs WHERE id = %s", (job_id,)).fetchone()
    assert row["status"] == "QUEUED" and row["attempts"] == 0


def test_cancel_stops_progress_updates(conn):
    job_id = add_job(conn)
    db.claim(conn, "w", TYPES, 30)
    assert db.progress(conn, job_id, "w", 40, "Transcribiendo") is True
    conn.execute("UPDATE jobs SET status = 'CANCELED' WHERE id = %s", (job_id,))
    assert db.progress(conn, job_id, "w", 50, "Transcribiendo") is False
    assert db.renew(conn, job_id, "w", 30) is False


def test_heartbeat_upsert(conn):
    db.heartbeat(conn, "test-hb", "1.0", TYPES)
    db.heartbeat(conn, "test-hb", "1.1", TYPES)
    row = conn.execute("SELECT version FROM worker_heartbeats WHERE worker_id = 'test-hb'").fetchone()
    assert row["version"] == "1.1"
    db.goodbye(conn, "test-hb")
