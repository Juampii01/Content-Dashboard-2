"""Solo lectura: trabajos en curso o en cola antes de desplegar el worker."""
import json, os
import psycopg
from psycopg.rows import dict_row
with psycopg.connect(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    r = conn.execute("select type, status, count(*) n, max(created_at)::text ultimo from jobs where status in ('QUEUED','RUNNING') group by 1,2").fetchall()
    w = conn.execute("select max(seen_at)::text latido from worker_heartbeats").fetchone() if False else None
print(json.dumps({"en_curso": r}, default=str))
