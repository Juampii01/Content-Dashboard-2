"""Trabajos en curso o en cola (solo lectura): para no desplegar el worker en medio de uno."""

import os

import psycopg

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url) as conn:
    rows = conn.execute("select type, status, stage, started_at, created_at from jobs where status in ('RUNNING', 'QUEUED') order by created_at").fetchall()
print("== trabajos en curso o en cola:", len(rows))
for r in rows:
    print(" ", r[0], r[1], r[2], "inicio", str(r[3])[:19], "creado", str(r[4])[:19])
