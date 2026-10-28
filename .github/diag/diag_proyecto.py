"""Diagnóstico de un proyecto del editor (solo lectura): historial de trabajos y cómo quedó guardado el plan.

Uso: `python diag_proyecto.py <project_id>`. No imprime claves, tokens, URLs ni código de animaciones.
"""

from __future__ import annotations

import json
import os
import sys

import psycopg
from psycopg.rows import dict_row


def main(pid: str) -> None:
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
    with psycopg.connect(url, row_factory=dict_row) as conn:
        p = conn.execute(
            "select status, format, edit_mode, caption_preset, created_at, updated_at, plan, transcript, media from video_projects where id = %s",
            (pid,),
        ).fetchone()
        jobs = conn.execute(
            "select type, status, stage, attempts, error_message, created_at, started_at, finished_at from jobs where video_project_id = %s order by created_at",
            (pid,),
        ).fetchall()
        reqs = conn.execute(
            "select status, delivered, error, created_at, updated_at, work from compos_requests where project_id = %s order by created_at",
            (pid,),
        ).fetchall()
    if not p:
        print("no existe")
        return
    words = (p["transcript"] or {}).get("words") or []
    def t(i: object) -> str:
        if isinstance(i, int) and 0 <= i < len(words):
            return f"{words[i].get('start', 0):.1f}"
        return "?"
    def span(x: dict) -> str:
        return f"{t(x.get('from_word'))}-{t(x.get('to_word'))}s w{x.get('from_word')}-{x.get('to_word')}"
    plan = p["plan"] or {}
    print("== proyecto", json.dumps({k: str(p[k]) for k in ("status", "format", "edit_mode", "caption_preset", "created_at", "updated_at")}, ensure_ascii=False))
    print("palabras:", len(words), "duración:", (p["media"] or {}).get("duration"), "claves del plan:", sorted(plan.keys()))
    print("cortes:", len(plan.get("removals") or []), "pausas:", json.dumps(plan.get("pacing"))[:200], "subtítulos:", json.dumps(plan.get("captions") or plan.get("caption_preset"))[:200])
    print("== trabajos")
    for j in jobs:
        print(j["type"], j["status"], str(j["created_at"])[:19], "→", str(j["finished_at"])[:19], "|", j["stage"], "|", (j["error_message"] or "")[:160])
    print("== pedidos de animación")
    for r in reqs:
        tasks = (r["work"] or {}).get("tasks") or []
        t0 = tasks[0] if tasks else {}
        print(r["status"], r["delivered"], str(r["created_at"])[:19], str(r["updated_at"])[:19], "| tareas:", len(tasks), "|", (str(t0.get("request") or ""))[:140].replace("\n", " "), "|", (r["error"] or "")[:160])
        # Videos dentro de la animación (clips): si llegaron y si el worker armó sus hojas.
        for tk in tasks:
            cl = tk.get("clips") or []
            res = tk.get("result") or {}
            print("   tarea", tk.get("status"), "| clips:", [{"titulo": c.get("title"), "hojas": len((c.get("ready") or {}).get("sheets") or []), "error": c.get("error")} for c in cl], "| resultado con clips:", len(res.get("clips") or []), "| usa env.clip:", "env.clip(" in str(res.get("code") or ""), "| error:", (tk.get("error") or "")[:160])
    for key in ("compositions", "effects", "broll", "zoom_moments", "transitions", "graphics"):
        items = plan.get(key)
        if not isinstance(items, list):
            continue
        print(f"== {key}: {len(items)}")
        for x in items:
            name = x.get("name") or x.get("title") or x.get("kind") or x.get("type") or (x.get("choice") or {}).get("kind") or ""
            extra = {k: x.get(k) for k in ("id", "long", "mode", "frame", "layout", "source", "lane", "captions", "hide_captions") if k in x}
            print(" ", span(x), "|", str(name)[:70], "|", json.dumps(extra, ensure_ascii=False)[:200])
            if key == "compositions":
                print("    clips:", [{"titulo": c.get("title"), "seg": c.get("duration"), "cuadros": c.get("frames"), "hojas": len(c.get("sheets") or [])} for c in x.get("clips") or []], "| imágenes hoja:", sum(1 for g in x.get("images") or [] if g.get("sheet")), "| usa env.clip:", "env.clip(" in str(x.get("code") or ""))


if __name__ == "__main__":
    main(sys.argv[1])
