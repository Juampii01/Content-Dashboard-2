"""Qué disparó el ciclo del director del último video (solo lectura): pedidos de «Edítalo así» y vueltas."""

import json
import os

import psycopg

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url) as conn:
    pid, title, d, mode = conn.execute("select id, title, director, edit_mode from video_projects order by created_at desc limit 1").fetchone()
    d = d or {}
    print("== director del último video", title, pid, "edit_mode", mode)
    print("ciclo:", d.get("cycle"), "| claves:", sorted(d.keys()))
    req = d.get("request") or {}
    print("pedido:", json.dumps({k: (str(v)[:300]) for k, v in req.items() if k in ("instruction", "text", "source", "at", "createdAt")}, ensure_ascii=False))
    print("activo:", json.dumps({k: str(v)[:200] for k, v in (d.get("active") or {}).items()}, ensure_ascii=False)[:800])
    for e in (d.get("edits") or [])[-4:]:
        print("edición:", json.dumps({k: str(v)[:250] for k, v in e.items() if k not in ("plan", "compliance", "before")}, ensure_ascii=False)[:900])
    for r in (d.get("rounds") or []):
        print("vuelta:", r.get("n"), r.get("score"), str(r.get("verdict"))[:160])
    print("budget:", json.dumps(d.get("budget"), ensure_ascii=False)[:600])
    print("steps:", d.get("steps"))
