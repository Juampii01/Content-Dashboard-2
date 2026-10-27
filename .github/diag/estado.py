"""Solo lectura: estado después del despliegue de ScrapeCreators."""
import json, os
import psycopg
from psycopg.rows import dict_row
with psycopg.connect(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    out = {
        "migraciones": conn.execute("select count(*) n from drizzle.__drizzle_migrations").fetchone(),
        "enum": conn.execute("select 'SCRAPECREATORS' = any(enum_range(null::service_provider)::text[]) ok").fetchone(),
        "latido": conn.execute("select seen_at::text from worker_heartbeats order by seen_at desc limit 1").fetchone(),
        "en_curso": conn.execute("select type, status, count(*) n from jobs where status in ('QUEUED','RUNNING') group by 1,2").fetchall(),
    }
import subprocess, sys
try:
    import yt_dlp; out["yt_dlp"] = yt_dlp.version.__version__
except Exception as e: out["yt_dlp"] = repr(e)
print(json.dumps(out, default=str))
