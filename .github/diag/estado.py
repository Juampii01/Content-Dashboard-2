"""Diagnóstico de solo lectura: por qué no baja el link de Instagram (yt-dlp desde el worker)."""
import json, os, subprocess, sys
import psycopg
from psycopg.rows import dict_row

out = {}
url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
with psycopg.connect(url, row_factory=dict_row) as conn:
    conn.execute("SET TRANSACTION READ ONLY")
    rows = conn.execute("""select id, status, error, created_at::text, source->>'kind' kind from video_looks order by created_at desc limit 6""").fetchall()
    out["looks"] = rows
    jobs = conn.execute("""select type, status, error_message, output::text, finished_at::text from jobs where type='VIDEO_LOOK' order by created_at desc limit 4""").fetchall()
    out["jobs"] = jobs
try:
    import yt_dlp
    out["yt_dlp"] = yt_dlp.version.__version__
except Exception as e:
    out["yt_dlp"] = repr(e)
for u in ["https://www.instagram.com/reel/DerY94iOOTY/", "https://www.youtube.com/shorts/aqz-KE-bpKQ"]:
    p = subprocess.run([sys.executable, "-m", "yt_dlp", "-v", "--simulate", "--no-cache-dir", u], capture_output=True, text=True, timeout=120)
    lines = [l for l in (p.stdout + p.stderr).splitlines() if "ERROR" in l or "WARNING" in l or "[instagram]" in l or "[youtube]" in l]
    out[u] = {"code": p.returncode, "lines": lines[-15:]}
print(json.dumps(out, default=str, indent=1))
