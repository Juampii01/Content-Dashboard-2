"""Solo lectura: trabajos en curso y consumo de IA desde el despliegue (22:12 UTC)."""
import json, os
import psycopg
from psycopg.rows import dict_row
with psycopg.connect(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    since = "2026-10-27 22:12:00+00"
    out = {
        "en_curso": conn.execute("select type, status, count(*) n from jobs where status in ('QUEUED','RUNNING') group by 1,2").fetchall(),
        "trabajos": conn.execute("select type, status, coalesce(error_message,'') err, created_at::text from jobs where created_at > %s order by created_at", (since,)).fetchall(),
        "por_paso": conn.execute("select step, model, status, count(*) n, round(sum(cost_usd)::numeric,4) usd, sum(input_tokens) inp, sum(output_tokens) outp, sum(cache_read_tokens) cr from api_usage where created_at > %s group by 1,2,3 order by usd desc", (since,)).fetchall(),
        "por_video": conn.execute("select a.video_id, p.title, round(max(a.video_duration_sec)::numeric,1) dur, count(*) n, round(sum(a.cost_usd)::numeric,4) usd from api_usage a left join video_projects p on p.id=a.video_id where a.created_at > %s group by 1,2", (since,)).fetchall(),
        "biblioteca": conn.execute("select kind, status, ficha_status, title from broll_clips order by created_at desc limit 5").fetchall() if conn.execute("select 1 from information_schema.columns where table_name='broll_clips' and column_name='ficha_status'").fetchone() else "sin columnas",
    }
print(json.dumps(out, default=str))
