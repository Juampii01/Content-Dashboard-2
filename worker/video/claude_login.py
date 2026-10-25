"""CLAUDE_LOGIN — conecta la suscripción de Claude del cliente desde la plataforma, sin terminal.

El worker corre `claude setup-token` (la CLI que trae el SDK de agentes) en una terminal virtual, deja el enlace de
inicio de sesión en la salida del trabajo para que Ajustes lo muestre, y espera el código que la persona pega en la
pantalla después de autorizar (la app lo escribe en `jobs.input.code`). Con el código, la CLI devuelve el token de
larga duración, que se guarda cifrado en la app (POST /api/worker/claude). El token y el código nunca se loguean.
"""

from __future__ import annotations

import fcntl
import logging
import os
import pty
import re
import select
import shutil
import signal
import struct
import tempfile
import termios
import time
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from comunes.errors import JobError
from comunes.runner import JobContext, register

log = logging.getLogger("worker.claude_login")

URL_RE = re.compile(r"https://[A-Za-z0-9.-]+/[^\s\x07\x1b\]]*oauth/authorize\?[^\s\x07\x1b\]]+")
TOKEN_RE = re.compile(r"sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}")
ANSI_RE = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?<>=]*[A-Za-z~]|\x1b[()][A-Za-z0-9]|\x1b[=>78]")
WAIT_URL_S = 90
WAIT_CODE_S = 15 * 60
WAIT_TOKEN_S = 90


def cli_path() -> str:
    """La CLI de Claude que trae el SDK (o una instalada en el sistema)."""
    try:
        import claude_agent_sdk  # noqa: PLC0415

        bundled = Path(claude_agent_sdk.__file__).resolve().parent / "_bundled" / "claude"
        if bundled.exists():
            return str(bundled)
    except ImportError:
        pass
    found = shutil.which("claude")
    if not found:
        raise JobError("Falta la herramienta de Claude en el servicio de procesamiento. Avísale a soporte.", retry=False)
    return found


def clean(raw: str) -> str:
    return ANSI_RE.sub("", raw)


def find_token(text: str) -> str | None:
    """El token tal cual aparece en su línea (la terminal es ancha: no se parte). Antes se unían las líneas y el token
    quedaba pegado a la palabra siguiente («…AAStore this token…»), así que se guardaba uno que no servía."""
    for line in text.replace("\r", "\n").split("\n"):
        found = TOKEN_RE.search(line)
        if found:
            return found.group(0)
    return None


def verify(token: str, work_dir: Path) -> str | None:
    """Una llamada mínima con el token antes de guardarlo. Devuelve el problema (o None si anda)."""
    from comunes import ia_server  # noqa: PLC0415

    res = ia_server.run_call({"token": token, "task": "Responde con el JSON pedido.", "system": "Prueba de conexión.", "schema": {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, "model": "haiku", "feature": "conexion.prueba"}, work_dir)
    if res.get("ok"):
        return None
    return str(res.get("error") or "sin detalle")


class Terminal:
    """Un proceso en una terminal virtual ancha (para que el enlace y el token no se corten en líneas)."""

    def __init__(self, argv: list[str], env: dict[str, str]) -> None:
        self.pid, self.fd = pty.fork()
        if self.pid == 0:  # hijo
            try:
                os.execve(argv[0], argv, env)
            finally:
                os._exit(127)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 1000, 0, 0))
        self.raw = ""

    def read(self, seconds: float) -> str:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([self.fd], [], [], min(0.5, max(0.0, end - time.monotonic())))
            if not ready:
                continue
            try:
                chunk = os.read(self.fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            self.raw += chunk.decode(errors="replace")
            # Respuestas a las preguntas de la terminal (tamaño, colores): la CLI espera algo y no bloquea si no llega.
        return self.raw

    def write(self, text: str) -> None:
        os.write(self.fd, text.encode())

    def alive(self) -> bool:
        try:
            pid, _ = os.waitpid(self.pid, os.WNOHANG)
            return pid == 0
        except ChildProcessError:
            return False

    def close(self) -> None:
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, 0)
        except ChildProcessError:
            pass


def _set_output(ctx: JobContext, output: dict[str, Any]) -> None:
    ctx.conn.execute("UPDATE jobs SET output = %s WHERE id = %s AND locked_by = %s AND status = 'RUNNING'", (Jsonb(output), ctx.job["id"], ctx.config.worker_id))


def _pasted_code(ctx: JobContext) -> str | None:
    row = ctx.conn.execute("SELECT input->>'code' AS code FROM jobs WHERE id = %s", (ctx.job["id"],)).fetchone()
    code = (row or {}).get("code") if isinstance(row, dict) else (row[0] if row else None)
    return str(code).strip() if code else None


def _forget_code(ctx: JobContext) -> None:
    ctx.conn.execute("UPDATE jobs SET input = input - 'code' WHERE id = %s", (ctx.job["id"],))


def login(ctx: JobContext, term_factory: Any = None) -> str:
    """Corre setup-token de punta a punta y devuelve el token."""
    home = Path(tempfile.mkdtemp(prefix="claude-login-", dir=str(ctx.config.work_dir)))
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "TERM": "xterm-256color",
        "COLUMNS": "1000",
        "LANG": "C.UTF-8",
        "BROWSER": "/bin/true",
        "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    }
    term = (term_factory or Terminal)([cli_path(), "setup-token"], env)
    try:
        ctx.stage("Preparando el inicio de sesión con Claude", 0.0, 0.1)
        url = None
        end = time.monotonic() + WAIT_URL_S
        while time.monotonic() < end and not url:
            ctx.check()
            found = URL_RE.search(term.read(1.0))
            url = found.group(0) if found else None
            if not url and not term.alive():
                break
        if not url:
            log.warning("setup-token sin enlace: %s", clean(term.raw)[-300:])
            raise JobError("Claude no nos dio el enlace para iniciar sesión. Prueba de nuevo en unos minutos.", retry=False)
        _set_output(ctx, {"url": url, "waiting": "code"})
        ctx.stage("Esperando que entres con tu cuenta de Claude", 0.1, 0.9)
        code = None
        end = time.monotonic() + WAIT_CODE_S
        while time.monotonic() < end and not code:
            ctx.check()
            term.read(1.5)  # que la CLI no se quede esperando con su salida llena
            code = _pasted_code(ctx)
        if not code:
            raise JobError("Pasaron 15 minutos sin el código de Claude. Vuelve a conectar cuando quieras.", retry=False)
        _forget_code(ctx)
        _set_output(ctx, {"url": url, "waiting": "token"})
        ctx.stage("Terminando la conexión", 0.9, 0.98)
        start = len(term.raw)
        # El código y el Enter van por separado: juntos, la CLI los toma como un pegado y el Enter queda como texto.
        term.write(code)
        term.read(1.0)
        term.write("\r")
        end = time.monotonic() + WAIT_TOKEN_S
        enters = 1
        while time.monotonic() < end:
            ctx.check()
            text = clean(term.read(1.0)[start:])
            # Si a los pocos segundos sigue esperando, un Enter más (hasta 3).
            if enters < 3 and time.monotonic() > end - WAIT_TOKEN_S + 8 * enters and not find_token(text):
                term.write("\r")
                enters += 1
            token = find_token(text)
            if token:
                return token
            low = text.lower()
            if any(k in low for k in ("invalid", "error", "failed", "expired")) and not term.alive():
                break
            if not term.alive():
                break
        # Lo que mostró la CLI después del código, sin los asteriscos del campo ni nada que parezca un token.
        tail = re.sub(r"\*{3,}", "[código]", clean(term.raw[start:]))
        tail = re.sub(r"sk-ant-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,}", "…", tail).replace("\r", " ")
        log.warning("setup-token sin token (%s Enter): %s", enters, " ".join(tail.split())[-600:])
        raise JobError("Claude no aceptó ese código. Vuelve a empezar y pega el código completo apenas te lo muestre.", retry=False)
    finally:
        term.close()
        shutil.rmtree(home, ignore_errors=True)


@register("CLAUDE_LOGIN")
def claude_login(ctx: JobContext) -> dict[str, Any]:
    token = login(ctx)
    ctx.stage("Probando la conexión", 0.98, 0.99)
    problem = verify(token, ctx.config.work_dir)
    if problem:
        log.warning("el token nuevo no anduvo: %s", problem[:300])
        raise JobError("Claude dio la conexión pero no funcionó al probarla. Vuelve a conectar; si se repite, avísale a soporte.", retry=False, detail=problem[:300])
    saved = ctx.app._post("/api/worker/claude", {"jobId": str(ctx.job["id"]), "token": token}, timeout=60)  # noqa: SLF001
    _set_output(ctx, {"label": saved.get("label")})
    return {"connected": True, "label": saved.get("label")}
