"""Codex CLI con la cuenta de ChatGPT del propio cliente.

- Conectar: `codex login --device-auth` en un CODEX_HOME temporal. Codex imprime un enlace y un código de un solo uso;
  la persona los abre en su navegador y, al terminar, Codex deja `auth.json` en ese CODEX_HOME. El worker se lo pasa a
  la app, que lo guarda cifrado. Nunca se loguea su contenido.
- Generar: por cada imagen, `codex exec` con el prompt por stdin (y referencias con `-i`). Codex llama a su herramienta
  de imágenes y deja el PNG en `$CODEX_HOME/generated_images/<sesión>/`. Es la misma forma que usa carrusel-creator-pro
  (`llamar_codex` en mac/motor/carrusel.sh).
- Si Codex refrescó los tokens durante el trabajo, `auth.json` cambia: el worker vuelve a guardarlo en la app.
- Al terminar se borra el CODEX_HOME temporal (permisos 700/600 mientras existe).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from comunes.errors import Cancelled, JobError

log = logging.getLogger("worker.carruseles")

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SESSION_RE = re.compile(r"session id:\s*([0-9a-zA-Z-]{8,})")
URL_RE = re.compile(r"https://\S+/device\S*|https://\S*codex\S*")
CODE_RE = re.compile(r"\b([A-Z0-9]{4,5}-[A-Z0-9]{4,6})\b")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}

LIMIT_RE = re.compile(r"usage limit|usage_limit_reached|rate limit reached|hit your usage limit|quota", re.I)
AUTH_RE = re.compile(
    r"401|unauthori[sz]ed|refresh token|refresh_token|token (has )?expired|token_expired|invalid_grant|log ?in again|not logged in|"
    r"sign in again|please (re-?)?login|authentication (required|failed)|auth\.json",
    re.I,
)

MSG_EXPIRED = "Vuelve a conectar tu ChatGPT: la sesión venció o se cerró. Ve a Ajustes → Claves de servicios."
MSG_LIMIT = "Llegaste al límite de imágenes de tu plan de ChatGPT por hoy; prueba más tarde o agrega una API key de OpenAI."
MSG_MISSING = "Falta Codex en el servicio de procesamiento. Avísale a soporte para que lo instale."
MSG_FAILED = "ChatGPT no devolvió la imagen. Prueba de nuevo; si sigue, cambia la descripción de la escena."


def codex_bin() -> str | None:
    return shutil.which(os.environ.get("CODEX_BIN") or "codex")


@dataclass
class CodexHome:
    """CODEX_HOME temporal de un trabajo, con el auth.json del cliente."""

    path: Path
    original: str

    @classmethod
    def create(cls, base: Path, auth_json: str | None) -> "CodexHome":
        path = base / "codex-home"
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True, mode=0o700)
        os.chmod(path, 0o700)
        if auth_json:
            auth = path / "auth.json"
            fd = os.open(auth, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(auth_json)
        return cls(path, auth_json or "")

    @property
    def auth_path(self) -> Path:
        return self.path / "auth.json"

    def current_auth(self) -> str | None:
        try:
            return self.auth_path.read_text()
        except OSError:
            return None

    def refreshed(self) -> str | None:
        """El auth.json actual si Codex lo cambió (tokens refrescados); si no, None."""
        now = self.current_auth()
        return now if now and now.strip() != self.original.strip() else None

    def mark_saved(self, value: str) -> None:
        self.original = value

    def env(self) -> dict[str, str]:
        keep = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "TZ")}
        # Variables de prueba del Codex simulado (solo en tests locales).
        keep.update({k: v for k, v in os.environ.items() if k.startswith("FAKE_CODEX_")})
        return {**keep, "CODEX_HOME": str(self.path), "HOME": str(self.path)}

    def cleanup(self) -> None:
        shutil.rmtree(self.path, ignore_errors=True)


def classify_failure(log_text: str) -> JobError:
    clean = ANSI.sub("", log_text)
    if LIMIT_RE.search(clean):
        return JobError(MSG_LIMIT, retry=False, detail="codex: límite de uso")
    if AUTH_RE.search(clean):
        return JobError(MSG_EXPIRED, retry=False, detail="codex: sesión vencida")
    return JobError(MSG_FAILED, retry=True, detail="codex: sin imagen")


def _run(cmd: list[str], *, stdin: str | None, env: dict[str, str], cwd: Path, timeout: int, check: Callable[[], None]) -> tuple[int, str]:
    """Corre un proceso; si el trabajo se cancela, lo corta. Devuelve (código, salida combinada)."""
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=str(cwd), text=True)
    out: list[str] = []
    reader = threading.Thread(target=lambda: out.extend(proc.stdout or []), daemon=True)
    reader.start()
    if stdin is not None and proc.stdin:
        try:
            proc.stdin.write(stdin)
            proc.stdin.close()
        except BrokenPipeError:
            pass
    started = time.monotonic()
    try:
        while proc.poll() is None:
            check()
            if time.monotonic() - started > timeout:
                proc.kill()
                raise JobError(MSG_FAILED, retry=True, detail="codex: tiempo agotado")
            time.sleep(0.5)
    except Cancelled:
        proc.kill()
        raise
    reader.join(timeout=5)
    return proc.returncode or 0, "".join(out)


def generate_image(home: CodexHome, workdir: Path, prompt: str, refs: list[Path], *, model: str, effort: str, check: Callable[[], None], timeout: int = 420) -> Path:
    """Una imagen con Codex. Devuelve la ruta del PNG generado."""
    exe = codex_bin()
    if not exe:
        raise JobError(MSG_MISSING, retry=False, detail="codex no está en el PATH")
    cmd = [
        exe,
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "-s",
        "read-only",
        "-C",
        str(workdir),
        "-m",
        model,
        "-c",
        f"model_reasoning_effort={effort}",
        "-c",
        'cli_auth_credentials_store="file"',
    ]
    for ref in refs:
        cmd += ["-i", str(ref)]
    # El prompt va por stdin (sin "-" al final: -i lo leería como una imagen).
    code, output = _run(cmd, stdin=prompt, env=home.env(), cwd=workdir, timeout=timeout, check=check)
    clean = ANSI.sub("", output)
    match = SESSION_RE.search(clean)
    images: list[Path] = []
    gen = home.path / "generated_images"
    if match:
        folder = gen / match.group(1)
        if folder.is_dir():
            images = sorted((p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT), key=lambda p: p.stat().st_mtime)
    if not images and gen.is_dir():
        # Respaldo: cualquier imagen nueva del CODEX_HOME de este trabajo.
        images = sorted((p for p in gen.rglob("*") if p.suffix.lower() in IMAGE_EXT), key=lambda p: p.stat().st_mtime)
    if not images:
        log.warning("codex terminó (código %s) sin imagen", code)
        raise classify_failure(clean)
    return images[-1]


@dataclass
class DeviceCode:
    url: str
    code: str


def parse_device_prompt(text: str) -> DeviceCode | None:
    """Saca el enlace y el código del mensaje de Codex ("1. Open this link… 2. Enter this one-time code…")."""
    clean = ANSI.sub("", text)
    url = URL_RE.search(clean)
    if not url:
        return None
    code: str | None = None
    lines = [line.strip() for line in clean.splitlines()]
    for i, line in enumerate(lines):
        if "one-time code" in line.lower():
            code = next((nxt for nxt in lines[i + 1 :] if nxt), None)
            break
    if code is None:
        found = CODE_RE.search(clean)
        code = found.group(1) if found else None
    if not code or len(code) > 40 or " " in code:
        return None
    return DeviceCode(url.group(0).rstrip(".,)"), code)


def device_login(home: CodexHome, workdir: Path, on_code: Callable[[DeviceCode], None], check: Callable[[], None], timeout: int = 16 * 60) -> str:
    """Login por código de dispositivo. Llama a `on_code` apenas Codex muestra el enlace y el código.

    Devuelve el contenido de auth.json cuando la persona termina. Corta si el trabajo se cancela.
    """
    exe = codex_bin()
    if not exe:
        raise JobError(MSG_MISSING, retry=False, detail="codex no está en el PATH")
    cmd = [exe, "login", "--device-auth", "-c", 'cli_auth_credentials_store="file"']
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=home.env(), cwd=str(workdir), text=True, bufsize=1)
    lines: list[str] = []
    sent = threading.Event()
    found: list[DeviceCode] = []

    def read() -> None:
        buf = ""
        for line in proc.stdout or []:
            lines.append(line)
            buf += ANSI.sub("", line)
            if not found:
                parsed = parse_device_prompt(buf)
                if parsed:
                    found.append(parsed)

    def deliver() -> None:
        # Se avisa desde el hilo principal (usa la conexión a la base del trabajo).
        if found and not sent.is_set():
            sent.set()
            on_code(found[0])

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    started = time.monotonic()
    try:
        while proc.poll() is None:
            check()
            deliver()
            if time.monotonic() - started > timeout:
                proc.kill()
                raise JobError("El código venció sin que terminaras de entrar. Vuelve a conectar tu ChatGPT.", retry=False, detail="login: tiempo agotado")
            time.sleep(0.5)
    except Cancelled:
        proc.kill()
        raise
    reader.join(timeout=5)
    deliver()
    text = ANSI.sub("", "".join(lines))
    auth = home.current_auth()
    if proc.returncode == 0 and auth:
        return auth
    if not sent.is_set():
        raise JobError("No pudimos iniciar la conexión con ChatGPT. Prueba de nuevo en unos minutos.", retry=False, detail=f"login sin código: {text[-200:]}")
    if re.search(r"timed out|expired", text, re.I):
        raise JobError("El código venció sin que terminaras de entrar. Vuelve a conectar tu ChatGPT.", retry=False, detail="login: código vencido")
    if re.search(r"workspace|permission", text, re.I):
        raise JobError("Esa cuenta de ChatGPT no tiene permiso para usar Codex. Prueba con otra cuenta o con una API key de OpenAI.", retry=False, detail="login: sin permiso")
    raise JobError("No se completó la conexión con ChatGPT. Vuelve a intentarlo.", retry=False, detail=f"login código {proc.returncode}")
