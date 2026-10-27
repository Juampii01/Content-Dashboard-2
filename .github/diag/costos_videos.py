"""Costo de IA de los últimos videos del Editor (solo lectura): total, por función y por tanda de pedidos.

No imprime claves, tokens, URLs ni código de animaciones.
"""

import os

import psycopg

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url) as conn:
    projects = conn.execute(
        "select id, title, created_at, (media->>'duration') from video_projects where created_at > now() - interval '4 days' order by created_at desc limit 8"
    ).fetchall()
    print("== costos de IA de los últimos videos")
    for pid, title, created, dur in projects:
        total = conn.execute("select coalesce(sum(cost_usd),0), count(*) from ai_usage where video_project_id = %s", (pid,)).fetchone()
        print(f"\n## {title[:60]} | {pid} | creado {str(created)[:19]} | dura {dur} s | TOTAL USD {total[0]:.2f} en {total[1]} llamadas")
        for f, m, c, n in conn.execute(
            "select feature, model, sum(cost_usd), count(*) from ai_usage where video_project_id = %s group by 1,2 order by 3 desc", (pid,)
        ).fetchall():
            print(f"   {f:32} {m:28} USD {c:7.2f}  ({n})")
        print("   -- por hora (tandas)")
        for h, c, n in conn.execute(
            "select date_trunc('minute', created_at) - (extract(minute from created_at)::int % 15) * interval '1 minute', sum(cost_usd), count(*) from ai_usage where video_project_id = %s group by 1 order by 1",
            (pid,),
        ).fetchall():
            print(f"   {str(h)[:16]}  USD {c:7.2f}  ({n})")
        print("   -- pedidos de animación")
        for st, used, res, cr, up, req in conn.execute(
            "select status, used_usd, reserved_usd, created_at, updated_at, coalesce(work->'tasks'->0->>'request','') from compos_requests where project_id = %s order by created_at",
            (pid,),
        ).fetchall():
            print(f"   {str(cr)[:19]} → {str(up)[:19]} {st:9} usado USD {used:.2f} (reserva {res:.2f}) | {req[:110].replace(chr(10), ' ')}")
        for j in conn.execute("select type, status, created_at, finished_at from jobs where video_project_id = %s order by created_at", (pid,)).fetchall():
            print(f"   trabajo {j[0]:14} {j[1]:9} {str(j[2])[:19]} → {str(j[3])[:19]}")
