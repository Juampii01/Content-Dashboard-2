"""Trabajos en curso o en cola (solo lectura): para no desplegar el worker en medio de uno."""

import os

import psycopg

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url) as conn:
    rows = conn.execute("select type, status, stage, started_at, created_at from jobs where status in ('RUNNING', 'QUEUED') order by created_at").fetchall()
print("== trabajos en curso o en cola:", len(rows))
for r in rows:
    print(" ", r[0], r[1], r[2], "inicio", str(r[3])[:19], "creado", str(r[4])[:19])

# Videos dentro de las animaciones: el último proyecto con animaciones de hoy, qué marcó el chat y qué llegó al pedido.
import json  # noqa: E402

with psycopg.connect(url) as conn:
    last = conn.execute("select video_project_id from jobs where type = 'VIDEO_COMPOS' and video_project_id is not null order by created_at desc limit 1").fetchone()
    if last:
        pid = last[0]
        print("== último proyecto con animaciones:", pid)
        chat = conn.execute("select messages from compos_chats where project_id = %s and comp_id = 'video'", (pid,)).fetchone()
        for m in ((chat[0] if chat else None) or [])[-14:]:
            items = [{"kind": it.get("kind"), "scope": it.get("scope"), "adjuntos": it.get("attachments")} for it in (m.get("items") or [])]
            print(" ", m.get("role"), str(m.get("at"))[:19], "| videos del mensaje:", [{"ref": c.get("ref"), "nombre": c.get("name")} for c in (m.get("clips") or [])], "| acciones:", json.dumps(items, ensure_ascii=False)[:400])
        for r in conn.execute("select status, created_at, work from compos_requests where project_id = %s order by created_at desc limit 5", (pid,)).fetchall():
            tasks = (r[2] or {}).get("tasks") or []
            print("  pedido", r[0], str(r[1])[:19], "| clips en tareas:", [len(t.get("clips") or []) for t in tasks], "| pieza única:", [bool(t.get("long")) for t in tasks])
