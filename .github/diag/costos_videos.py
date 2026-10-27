"""Consumo de IA de la instalación (solo lectura): qué clave se usa y cuánto se gastó. No imprime claves."""

import os

import psycopg

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
print("== clave de Anthropic del servidor configurada:", bool(os.environ.get("ANTHROPIC_API_KEY")))
with psycopg.connect(url) as conn:
    k = conn.execute("select label, updated_at from service_credentials where provider = 'ANTHROPIC'").fetchone()
    print("== clave de Anthropic cargada en Ajustes:", f"sí, termina en {k[0]} (desde {str(k[1])[:10]})" if k else "no (se usa la del servidor)")
    for days in (1, 7, 30):
        r = conn.execute("select coalesce(sum(cost_usd),0), count(*) from ai_usage where created_at > now() - make_interval(days => %s)", (days,)).fetchone()
        print(f"== últimos {days} días: USD {r[0]:.2f} en {r[1]} llamadas")
    print("== por día (últimos 10)")
    for d, c, n in conn.execute("select date(created_at), sum(cost_usd), count(*) from ai_usage where created_at > now() - interval '10 days' group by 1 order by 1").fetchall():
        print(f"   {d}  USD {c:7.2f}  ({n})")
    print("== por proveedor y modelo (30 días)")
    for p, m, c, n in conn.execute("select provider, model, sum(cost_usd), count(*) from ai_usage where created_at > now() - interval '30 days' group by 1,2 order by 3 desc").fetchall():
        print(f"   {p:12} {m:28} USD {c:7.2f}  ({n})")
    print("== en curso (lo que muestra Inicio)")
    for t, s in conn.execute("select title, status from video_projects where status in ('PROCESSING','AWAITING_REVIEW','RENDERING') order by updated_at desc limit 8").fetchall():
        print("  ", t[:50], s)
