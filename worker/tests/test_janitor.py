"""Limpieza de la carpeta de trabajo: borra proyectos inexistentes y viejos, nunca los activos."""

import os
import time
import uuid

import pytest

from comunes import db
from comunes.janitor import cleanup_workdirs

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="falta TEST_DATABASE_URL")


def test_cleanup(tmp_path):
    conn = db.connect(URL)
    alive = str(uuid.uuid4())
    done_old = str(uuid.uuid4())
    gone = str(uuid.uuid4())
    conn.execute("INSERT INTO video_projects (id, title, status) VALUES (%s, 'vivo', 'AWAITING_REVIEW'), (%s, 'viejo', 'DONE')", (alive, done_old))
    try:
        for pid in (alive, done_old, gone):
            (tmp_path / pid).mkdir()
            (tmp_path / pid / "original.mp4").write_bytes(b"x")
        (tmp_path / "no-es-proyecto").mkdir()
        old = time.time() - 5 * 86_400
        for f in (tmp_path / done_old).rglob("*"):
            os.utime(f, (old, old))
        os.utime(tmp_path / done_old, (old, old))

        removed = cleanup_workdirs(conn, tmp_path)

        assert removed == 2
        assert (tmp_path / alive).exists()
        assert not (tmp_path / done_old).exists()
        assert not (tmp_path / gone).exists()
        assert (tmp_path / "no-es-proyecto").exists()
    finally:
        conn.execute("DELETE FROM video_projects WHERE id IN (%s, %s)", (alive, done_old))
