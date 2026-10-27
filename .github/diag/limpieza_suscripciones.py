"""Fase 0: respaldo y borrado de las credenciales de suscripción (Claude y ChatGPT).

Corre dentro de la máquina del worker. MODO=respaldo solo respalda y verifica. MODO=borrar respalda, verifica y,
solo si el respaldo coincide fila por fila, borra en una transacción. Nunca imprime claves, tokens ni etiquetas.
"""

import hashlib
import json
import os
import re
import shutil
import tarfile
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

MODO = os.environ.get("MODO", "respaldo")
PROVIDERS = ("CLAUDE", "CHATGPT")
stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
dest = Path("/data/respaldos")
dest.mkdir(parents=True, exist_ok=True)
os.chmod(dest, 0o700)
out: dict = {"modo": MODO, "respaldo": {}, "borrado": None}
h = lambda s: hashlib.sha256((s or "").encode()).hexdigest()[:16]

url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ["DATABASE_URL"]
with psycopg.connect(url, row_factory=dict_row) as conn:
    rows = [dict(r) for r in conn.execute(
        "select * from service_credentials where provider::text = any(%s) order by provider", (list(PROVIDERS),)).fetchall()]
    # Restos de directorios temporales con sesiones (trabajos que se cortaron antes de limpiar).
    work = Path("/data/work")
    leftovers = [p for p in work.rglob("*") if p.is_dir() and re.match(r"^(claude-login-|ia-|agente-|codex-home)", p.name)] if work.exists() else []
    leftovers = [p for p in leftovers if not any(q in p.parents for q in leftovers)]

    file = dest / f"{stamp}-suscripciones.json"
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump({"tabla": "service_credentials", "filas": rows, "nota": "secret_enc va cifrado (AES-256-GCM, lib/crypto.ts)"}, fh, default=str, ensure_ascii=False)
    tar = None
    if leftovers:
        tar = dest / f"{stamp}-restos-temporales.tar.gz"
        with tarfile.open(tar, "w:gz") as t:
            for p in leftovers:
                t.add(p, arcname=str(p.relative_to(work)))
        os.chmod(tar, 0o600)

    # Verificación: se relee el archivo y se compara fila por fila.
    back = json.loads(file.read_text())["filas"]
    ok = len(back) == len(rows) and all(a["id"] == str(b["id"]) and a["secret_enc"] == b["secret_enc"] for a, b in zip(back, rows))
    out["respaldo"] = {
        "archivo": str(file), "bytes": file.stat().st_size, "sha256_archivo": hashlib.sha256(file.read_bytes()).hexdigest(),
        "restos_tar": str(tar) if tar else None, "restos": [str(p.relative_to(work)) for p in leftovers],
        "verificado": ok,
        "filas": [{"id": str(r["id"]), "provider": r["provider"], "creado": str(r["created_at"]), "actualizado": str(r["updated_at"]),
                   "sha256_secret_enc": h(r["secret_enc"])} for r in rows],
    }
    # ¿Quedó algún token en trabajos? Solo se cuentan coincidencias, nunca se imprime el valor.
    pat = r"(sk-ant-oat|refresh_token|access_token|id_token)"
    out["jobs_con_patron_token"] = [dict(r) for r in conn.execute(
        "select type::text, count(*) n from jobs where coalesce(input::text,'') ~* %s or coalesce(output::text,'') ~* %s group by 1", (pat, pat)).fetchall()]

    if MODO == "borrar":
        if not ok:
            out["borrado"] = "NO: el respaldo no coincide, no se borró nada"
        else:
            with conn.transaction():
                gone = conn.execute("delete from service_credentials where provider::text = any(%s) returning id", (list(PROVIDERS),)).fetchall()
                ids = sorted(str(r["id"]) for r in gone)
                if ids != sorted(str(r["id"]) for r in rows):
                    raise SystemExit("Las filas borradas no coinciden con el respaldo: se deshace la transacción")
            for p in leftovers:
                shutil.rmtree(p, ignore_errors=True)
            out["borrado"] = {"filas": ids, "restos_borrados": len(leftovers)}
    out["quedan"] = [dict(r) for r in conn.execute("select provider::text from service_credentials order by 1").fetchall()]
    out["respaldos_en_volumen"] = sorted(p.name for p in dest.iterdir())
print(json.dumps(out, ensure_ascii=False, default=str, indent=1))
