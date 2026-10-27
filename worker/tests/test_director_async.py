"""Pasos del director en segundo plano: se pide con async, se pregunta hasta que esté y un corte suelto no lo pierde."""

from __future__ import annotations

import pytest

from comunes import appclient
from comunes.errors import JobError


def client(monkeypatch, replies):
    c = appclient.AppClient("https://app.test", "x")
    calls = []

    def fake(path, payload, timeout):
        calls.append(payload)
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(c, "_post", fake)
    monkeypatch.setattr(appclient.stop_event, "wait", lambda s: None)
    return c, calls


def test_pide_en_segundo_plano_y_pregunta(monkeypatch):
    c, calls = client(monkeypatch, [{"ok": True, "pending": "cabc123"}, {"ok": True, "done": False}, {"ok": True, "done": True, "next": None, "status": "AWAITING_REVIEW"}])
    res = c.director("p", {"step": "compos"})
    assert res["status"] == "AWAITING_REVIEW"
    assert calls[0] == {"step": "compos", "async": True}
    assert calls[1] == {"step": "poll", "call": "cabc123"}


def test_app_vieja_contesta_directo(monkeypatch):
    c, _ = client(monkeypatch, [{"ok": True, "next": {"step": "edit"}, "status": "PROCESSING"}])
    assert c.director("p", {"step": "start"})["next"] == {"step": "edit"}


def test_un_corte_al_preguntar_no_pierde_el_paso(monkeypatch):
    c, _ = client(monkeypatch, [{"ok": True, "pending": "cabc123"}, JobError("corte", detail="reset"), {"ok": True, "done": True, "status": "X"}])
    assert c.director("p", {"step": "compos"})["status"] == "X"


def test_error_definitivo_se_propaga(monkeypatch):
    c, _ = client(monkeypatch, [{"ok": True, "pending": "cabc123"}, JobError("no", retry=False)])
    with pytest.raises(JobError):
        c.director("p", {"step": "compos"})


def test_una_pieza_larga_pasa_la_revision_del_render():
    """Una animación de «Animar todo» dura hasta 180 s y su código hasta 90 mil caracteres (los efectos, hasta 30 s)."""
    from video import fx

    comp = {"spec": {"v": 1, "kind": "composition", "duration": 54, "compos": {"code": "x" * 60_000, "env": {}}}}
    assert fx.validate(comp) is comp
    with pytest.raises(JobError):
        fx.validate({"spec": {"v": 1, "kind": "magazine", "duration": 54}})
