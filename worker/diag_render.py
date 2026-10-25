"""Diagnóstico de un render (solo lectura): qué le mandó la app al worker y cómo quedaron los archivos de trabajo.

Uso (en la máquina del worker): `python diag_render.py <project_id>`. Lo corre el workflow "Diagnóstico de render".
No imprime claves, tokens ni URLs firmadas: solo tiempos, cantidades y duraciones.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def probe(path: Path) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration,nb_frames,r_frame_rate:format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
        ).stdout
        data = json.loads(out or "{}")
        return {"format": data.get("format", {}).get("duration"), "streams": [{k: s.get(k) for k in ("codec_type", "duration", "nb_frames", "r_frame_rate")} for s in data.get("streams", [])]}
    except Exception as error:  # noqa: BLE001
        return {"error": str(error)}


def main(pid: str) -> None:
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
    with psycopg.connect(url, row_factory=dict_row) as conn:
        project = conn.execute("select status, format, media from video_projects where id = %s", (pid,)).fetchone()
        jobs = conn.execute(
            "select id, status, attempts, error_message, created_at, finished_at, input from jobs where video_project_id = %s and type = 'VIDEO_RENDER' order by created_at desc limit 2",
            (pid,),
        ).fetchall()
    print("== proyecto")
    print(json.dumps({"status": project and project["status"], "format": project and project["format"], "media": project and project["media"]}, default=str, indent=1))
    for job in jobs:
        data = job["input"] or {}
        clips = data.get("clips") or []
        print(f"== render {job['id']} {job['status']} intentos={job['attempts']} creado={job['created_at']} error={job['error_message']}")
        print("clips (start,end en cuadros a 30 fps; role):", [(c.get("start"), c.get("end"), c.get("role")) for c in clips])
        print("total cuadros:", sum(c["end"] - c["start"] for c in clips), "esperado s:", data.get("expected") or data.get("duration"))
        print("audio:", json.dumps(data.get("audio"), default=str)[:600])
        print("claves del input:", sorted(data.keys()))
        for key in ("broll", "effects", "compositions", "fx", "zooms", "phraseFixes", "transitions"):
            value = data.get(key)
            if isinstance(value, list):
                print(f"{key}: {len(value)}")
    work = Path(os.environ.get("WORK_DIR") or "/data/work") / pid
    print("== archivos de trabajo", work)
    if work.exists():
        for f in sorted(work.rglob("*")):
            if f.is_file() and f.suffix in (".mp4", ".wav", ".mkv", ".m4a", ".mov") and f.stat().st_size > 0:
                print(f.relative_to(work), f.stat().st_size, json.dumps(probe(f)))


if __name__ == "__main__":
    main(sys.argv[1])
