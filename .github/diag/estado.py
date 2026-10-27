"""Solo lectura: trabajos en curso o en cola (antes de desplegar el worker)."""
import json, os, time
import psycopg
from psycopg.rows import dict_row
with psycopg.connect(os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    r = conn.execute("select type, status, count(*) n from jobs where status in ('QUEUED','RUNNING') group by 1,2").fetchall()
print(json.dumps({"en_curso": r, "t": time.time()}, default=str))

# 22:34:46

# 22:37:36

# 22:40:27
