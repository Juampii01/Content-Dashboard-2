"""Solo lectura: trabajos en curso o en cola (para no desplegar el worker en medio de uno) y credenciales que quedan."""
import json, os
import psycopg
from psycopg.rows import dict_row
url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url, row_factory=dict_row) as conn:
    conn.execute("set default_transaction_read_only = on")
    q = lambda s: [dict(r) for r in conn.execute(s).fetchall()]
    out = {
        "en_curso": q("select type::text, status::text, count(*) n from jobs where status in ('QUEUED','RUNNING') group by 1,2"),
        "pedidos_animacion_activos": q("select status, count(*) n from compos_requests where status in ('waiting','queued','running') group by 1"),
        "credenciales": q("select provider::text from service_credentials order by 1"),
        "redes": q("select platform::text, status::text, last_synced_at::text from social_accounts order by 1"),
        "ultimos_trabajos": q("select type::text, status::text, created_at::text, left(coalesce(error_message,''),120) err from jobs order by created_at desc limit 8"),
        "latido_worker": q("select version, seen_at::text from worker_heartbeats order by seen_at desc limit 2"),
    }
print(json.dumps(out, default=str, indent=1))
