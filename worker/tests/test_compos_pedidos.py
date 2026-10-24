"""Pedidos de animaciones del Estudio, varios a la vez: el trabajo de un pedido toma los otros pedidos en cola del
mismo video y corre hasta COMPOS_PARALLEL en paralelo; un pedido que falla deja su aviso en su fila (no tumba a los
demás ni marca el video como fallido); los pasos pesados (imágenes, cuadros) van de a uno."""

from __future__ import annotations

import threading
import time
from typing import Any

import pytest

from comunes.errors import JobError
from video import compos


class _Ctx:
    def __init__(self, work_id: str) -> None:
        self.input = {"projectId": "p1", "workId": work_id}
        self.conn = object()
        self.config = type("C", (), {"worker_id": "w-test"})()
        self.stages: list[str] = []

    def stage(self, name: str, a: float, b: float) -> None:
        self.stages.append(name)

    def check(self) -> None:
        return None


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    from comunes import db

    state: dict[str, Any] = {"queue": [], "finished": {}, "failed": {}}
    monkeypatch.setattr(db, "get_project", lambda conn, pid: {"id": pid, "status": "AWAITING_REVIEW"})
    monkeypatch.setattr(db, "adopt_compos", lambda conn, worker, pid, lease: state["queue"].pop(0) if state["queue"] else None)
    monkeypatch.setattr(db, "finish_adopted", lambda conn, job_id, worker, error: state["finished"].__setitem__(job_id, error))
    monkeypatch.setattr(db, "fail_compos_request", lambda conn, wid, message: state["failed"].__setitem__(wid, message))
    return state


def test_corre_varios_en_paralelo_sin_pasar_el_limite(monkeypatch: pytest.MonkeyPatch, fake_db: dict[str, Any]) -> None:
    fake_db["queue"] = [{"id": f"j{i}", "input": {"workId": f"w{i}"}} for i in range(1, 6)]
    running = {"now": 0, "max": 0}
    lock = threading.Lock()
    seen: list[str] = []

    def fake_run(ctx: Any, project: dict[str, Any], first: str, a: float, b: float, extra: dict[str, Any] | None = None, heavy: Any = None) -> dict[str, Any]:
        with lock:
            running["now"] += 1
            running["max"] = max(running["max"], running["now"])
            seen.append(extra["workId"])
        time.sleep(0.3)
        with lock:
            running["now"] -= 1
        return {"next": None}

    monkeypatch.setattr(compos.director, "run", fake_run)
    out = compos.compos_job(_Ctx("w0"))
    assert sorted(seen) == ["w0", "w1", "w2", "w3", "w4", "w5"]
    assert running["max"] == compos.PARALLEL
    assert sorted(out["done"]) == sorted(seen)
    assert fake_db["finished"] == {f"j{i}": None for i in range(1, 6)}


def test_un_pedido_que_falla_no_tumba_a_los_demas(monkeypatch: pytest.MonkeyPatch, fake_db: dict[str, Any]) -> None:
    fake_db["queue"] = [{"id": "j1", "input": {"workId": "w1"}}]

    def fake_run(ctx: Any, project: dict[str, Any], first: str, a: float, b: float, extra: dict[str, Any] | None = None, heavy: Any = None) -> dict[str, Any]:
        if extra["workId"] == "w1":
            raise JobError("No alcanzó el tope de IA.", retry=False)
        return {"next": None}

    monkeypatch.setattr(compos.director, "run", fake_run)
    out = compos.compos_job(_Ctx("w0"))
    assert out == {"done": ["w0"], "failed": ["w1"]}
    assert fake_db["failed"] == {"w1": "No alcanzó el tope de IA."}
    assert fake_db["finished"] == {"j1": "No alcanzó el tope de IA."}


def test_los_pasos_pesados_van_de_a_uno(monkeypatch: pytest.MonkeyPatch, fake_db: dict[str, Any]) -> None:
    fake_db["queue"] = [{"id": "j1", "input": {"workId": "w1"}}, {"id": "j2", "input": {"workId": "w2"}}]
    inside = {"now": 0, "max": 0}

    def fake_run(ctx: Any, project: dict[str, Any], first: str, a: float, b: float, extra: dict[str, Any] | None = None, heavy: Any = None) -> dict[str, Any]:
        with heavy:
            inside["now"] += 1
            inside["max"] = max(inside["max"], inside["now"])
            time.sleep(0.15)
            inside["now"] -= 1
        return {"next": None}

    monkeypatch.setattr(compos.director, "run", fake_run)
    compos.compos_job(_Ctx("w0"))
    assert inside["max"] == 1


def test_sin_pedido_sigue_el_taller_del_director(monkeypatch: pytest.MonkeyPatch, fake_db: dict[str, Any]) -> None:
    calls: list[Any] = []
    monkeypatch.setattr(compos.director, "run", lambda ctx, project, first, a, b, **kw: calls.append(kw) or {"status": "AWAITING_REVIEW"})
    ctx = _Ctx("")
    ctx.input = {"projectId": "p1"}
    assert compos.compos_job(ctx) == {"status": "AWAITING_REVIEW"}
    assert calls == [{}]
