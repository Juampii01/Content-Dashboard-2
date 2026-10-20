"""Codex simulado para pruebas (como CODEX_SIMULADO en carrusel-creator-pro): no gasta nada ni sale a la red.

    codex exec … [-i ref] < prompt     → imprime un log con "session id:" y deja un PNG (Pillow) en
                                         $CODEX_HOME/generated_images/<sesión>/
    codex login --device-auth          → imprime el enlace y el código como Codex, espera y escribe auth.json

Modos (FAKE_CODEX_MODE): ok (por defecto) · limit (límite del plan) · expired (sesión vencida) · refresh (cambia
auth.json, como cuando Codex refresca los tokens) · noimage (termina sin imagen). FAKE_CODEX_LOGIN_WAIT: segundos que
"tarda" la persona en entrar (por defecto 2). FAKE_CODEX_DELAY: segundos por imagen (por defecto 0,5).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path

ANSI_BLUE, ANSI_GRAY, RESET = "\x1b[94m", "\x1b[90m", "\x1b[0m"


def home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def login() -> int:
    print(f"\nWelcome to Codex [v{ANSI_GRAY}0.162.1{RESET}]\n{ANSI_GRAY}OpenAI's command-line coding agent{RESET}\n", flush=True)
    print("Follow these steps to sign in with ChatGPT using device code authorization:\n", flush=True)
    print(f"1. Open this link in your browser and sign in to your account\n   {ANSI_BLUE}https://auth.openai.com/codex/device{RESET}\n", flush=True)
    print(f"2. Enter this one-time code {ANSI_GRAY}(expires in 15 minutes){RESET}\n   {ANSI_BLUE}FAKE-12345{RESET}\n", flush=True)
    time.sleep(float(os.environ.get("FAKE_CODEX_LOGIN_WAIT", "2")))
    if os.environ.get("FAKE_CODEX_MODE") == "login_fail":
        print("Error logging in with device code: device auth timed out after 15 minutes", flush=True)
        return 1
    auth = {"OPENAI_API_KEY": None, "tokens": {"id_token": fake_jwt("cliente@example.com"), "access_token": "acc-" + uuid.uuid4().hex, "refresh_token": "ref-" + uuid.uuid4().hex, "account_id": "acct-prueba"}, "last_refresh": "2026-10-20T00:00:00Z"}
    path = home() / "auth.json"
    path.write_text(json.dumps(auth))
    os.chmod(path, 0o600)
    print("Successfully logged in", flush=True)
    return 0


def fake_jwt(email: str) -> str:
    import base64

    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'none'})}.{b64({'email': email, 'https://api.openai.com/auth': {'chatgpt_plan_type': 'plus'}})}.firma"


def make_png(path: Path, seed: str) -> None:
    from PIL import Image, ImageDraw, ImageFilter

    h = hashlib.sha256(seed.encode()).digest()
    w, hh = 1024, 1536
    im = Image.new("RGB", (w, hh), (h[0], h[1], h[2]))
    d = ImageDraw.Draw(im)
    for i in range(10):
        r = 80 + h[i + 3] % 220
        cx, cy = (h[i + 5] * 4) % w, (h[i + 7] * 6) % hh
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(h[i + 9], h[i + 11], h[i + 13]))
    im = im.filter(ImageFilter.GaussianBlur(14))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG")


def exec_(args: list[str]) -> int:
    prompt = sys.stdin.read()
    refs = [args[i + 1] for i, a in enumerate(args) if a == "-i" and i + 1 < len(args)]
    mode = os.environ.get("FAKE_CODEX_MODE", "ok")
    auth = home() / "auth.json"
    sid = str(uuid.uuid4())
    print("OpenAI Codex v0.162.1 (research preview)\n--------")
    print(f"model: {args[args.index('-m') + 1] if '-m' in args else 'gpt-5.6-terra'}\nsandbox: read-only")
    print(f"session id: {sid}\n--------")
    print(f"\x1b[36muser\x1b[0m\n{prompt[:200]}")
    if not auth.exists():
        print("\x1b[31mERROR:\x1b[0m Not logged in. Run codex login.", flush=True)
        return 1
    if mode == "expired":
        print("\x1b[31mERROR:\x1b[0m Your access token could not be refreshed because your refresh token has expired. Please log in again.", flush=True)
        return 1
    if mode == "limit":
        print("\x1b[31mERROR:\x1b[0m You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 hours 4 minutes.", flush=True)
        return 1
    time.sleep(float(os.environ.get("FAKE_CODEX_DELAY", "0.5")))
    if mode == "refresh":
        data = json.loads(auth.read_text())
        data["tokens"]["access_token"] = "acc-refrescado-" + uuid.uuid4().hex[:8]
        data["last_refresh"] = "2026-10-20T12:00:00Z"
        auth.write_text(json.dumps(data))
    if mode != "noimage":
        make_png(home() / "generated_images" / sid / f"ig_{uuid.uuid4().hex[:12]}.png", prompt + "|".join(refs))
    # Registro de llamadas para que los tests comprueben referencias y prompt.
    calls = os.environ.get("FAKE_CODEX_CALLS")
    if calls:
        with open(calls, "a") as fh:
            fh.write(json.dumps({"refs": len(refs), "prompt": prompt[:400]}) + "\n")
    print("\x1b[35m\x1b[3mcodex\x1b[0m\x1b[0m\nok\n\x1b[35m\x1b[3mtokens used\x1b[0m\x1b[0m\n12,345", flush=True)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--version"]:
        print("codex-cli 0.162.1 (simulado)")
        return 0
    if args[:1] == ["login"] and "--device-auth" in args:
        return login()
    if args[:1] == ["exec"]:
        return exec_(args[1:])
    print(f"fake codex: orden no soportada {args}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
