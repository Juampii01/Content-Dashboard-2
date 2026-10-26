"""Costo de infraestructura de una instalación (solo lectura): cuánto trabajó el worker, qué gastó la IA y cuánto
ocupa la base, en los últimos 30 días. Lo corre el workflow «Diagnóstico de render» (`python diag_costos.py`).
No imprime claves, tokens ni URLs: solo cantidades, tiempos y tamaños.
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import timedelta

import psycopg
from psycopg.rows import dict_row

IDLE_TAIL = timedelta(minutes=float(os.environ.get("IDLE_EXIT_MINUTES", "5")))


def main() -> None:
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
    with psycopg.connect(url, row_factory=dict_row) as conn:
        jobs = conn.execute(
            "select type::text as type, status::text as status, started_at, finished_at from jobs where created_at > now() - interval '30 days' and started_at is not null order by started_at"
        ).fetchall()
        ai = conn.execute(
            "select provider, feature, count(*) n, sum(cost_usd) cost, sum(api_equivalent_usd) eq from ai_usage where created_at > now() - interval '30 days' group by provider, feature order by sum(cost_usd) + sum(api_equivalent_usd) desc"
        ).fetchall()
        videos = conn.execute(
            "select count(*) n, coalesce(sum((media->>'duration')::float), 0) secs from video_projects where created_at > now() - interval '30 days'"
        ).fetchone()
        renders = conn.execute("select count(*) n from jobs where type = 'VIDEO_RENDER' and status = 'DONE' and created_at > now() - interval '30 days'").fetchone()
        dbsize = conn.execute("select pg_database_size(current_database()) b").fetchone()
        span = conn.execute("select min(created_at) a, max(created_at) b from jobs where created_at > now() - interval '30 days'").fetchone()

    by_type: dict[str, dict[str, float]] = {}
    intervals = []
    for j in jobs:
        end = j["finished_at"] or j["started_at"]
        secs = max(0.0, (end - j["started_at"]).total_seconds())
        t = by_type.setdefault(j["type"], {"n": 0, "secs": 0.0, "failed": 0})
        t["n"] += 1
        t["secs"] += secs
        t["failed"] += 1 if j["status"] == "FAILED" else 0
        intervals.append((j["started_at"], end))
    # Máquina encendida ≈ trabajos (unidos) + la espera antes de apagarse sola.
    on = timedelta()
    cur = None
    for a, b in intervals:
        b = b + IDLE_TAIL
        if cur and a <= cur[1]:
            cur = (cur[0], max(cur[1], b))
        else:
            if cur:
                on += cur[1] - cur[0]
            cur = (a, b)
    if cur:
        on += cur[1] - cur[0]
    usage = shutil.disk_usage("/data") if os.path.exists("/data") else None
    print(json.dumps({
        "periodo": {"desde": str(span and span["a"]), "hasta": str(span and span["b"])},
        "trabajos": {k: {"n": v["n"], "min": round(v["secs"] / 60, 1), "fallidos": v["failed"]} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1]["secs"])},
        "maquina_encendida_horas": round(on.total_seconds() / 3600, 2),
        "videos": {"n": videos["n"], "min_de_video": round(videos["secs"] / 60, 1), "renders_ok": renders["n"]},
        "ia": [{"provider": r["provider"], "feature": r["feature"], "n": r["n"], "usd": round(r["cost"] or 0, 2), "usd_equivalente_plan": round(r["eq"] or 0, 2)} for r in ai],
        "base_mb": round(dbsize["b"] / 1e6, 1),
        "disco_worker_gb": usage and {"total": round(usage.total / 1e9, 1), "usado": round(usage.used / 1e9, 1)},
    }, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
