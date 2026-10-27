"""Solo lectura: estado después del despliegue (migraciones, worker, trabajos)."""
import json, os
import psycopg
from psycopg.rows import dict_row
with psycopg.connect(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    has = conn.execute("select to_regclass('public.api_usage') t").fetchone()["t"]
    out = {
        "migraciones": conn.execute("select count(*) n from drizzle.__drizzle_migrations").fetchone(),
        "latido": conn.execute("select worker_id, version, seen_at::text from worker_heartbeats order by seen_at desc limit 2").fetchall(),
        "api_usage": conn.execute("select count(*) n from api_usage").fetchone() if has else "sin tabla",
        "en_curso": conn.execute("select type, status, count(*) n from jobs where status in ('QUEUED','RUNNING') group by 1,2").fetchall(),
        "ultimos_fallos": conn.execute("select type, error_message, finished_at::text from jobs where status='FAILED' and finished_at > now() - interval '30 minutes' order by finished_at desc limit 5").fetchall(),
    }
print(json.dumps(out, default=str))
