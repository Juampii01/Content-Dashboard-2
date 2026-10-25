"""CLAUDE_LOGIN: conectar la suscripción de Claude desde la plataforma (video/claude_login.py), con una terminal simulada
(sin cuenta real) y, si está la CLI del SDK, que de verdad muestre el enlace de inicio de sesión."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from comunes.errors import JobError
from video import claude_login

URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=xyz"
TOKEN = "sk-ant-oat01-" + "A1b2C3d4" * 12


class FakeTerm:
    def __init__(self, script: dict[str, str]) -> None:
        self.script = script
        self.raw = ""
        self.sent: list[str] = []
        self.step = 0

    def read(self, _seconds: float) -> str:
        if self.step == 0:
            # El enlace llega dentro de un hipervínculo OSC 8, con colores, como lo muestra la CLI.
            self.raw += f"\x1b[2mBrowser didn't open?\x1b[22m\n\x1b]8;id=1;{URL}\x1b\\{URL[:40]}\x1b]8;;\x1b\\\nPaste code here if prompted >"
            self.step = 1
        return self.raw

    def write(self, text: str) -> None:
        self.sent.append(text)
        if text == "\r":
            self.raw += self.script.get("after", "")
        else:
            self.raw += "*" * len(text)

    def alive(self) -> bool:
        return True

    def close(self) -> None:
        return None


class Ctx:
    def __init__(self, tmp: Path) -> None:
        self.config = SimpleNamespace(work_dir=tmp, worker_id="w")
        self.job = {"id": "j1"}
        self.stages: list[str] = []

    def stage(self, text: str, *_a: Any) -> None:
        self.stages.append(text)

    def check(self) -> None:
        return None


@pytest.fixture
def db(monkeypatch: pytest.MonkeyPatch) -> dict:
    state: dict[str, Any] = {"outputs": [], "code": None, "reads": 0, "forgot": False}

    def pasted(_ctx: Any) -> str | None:
        state["reads"] += 1
        return "codigo-de-prueba-123#estado" if state["reads"] >= 2 else None

    monkeypatch.setattr(claude_login, "_set_output", lambda _ctx, out: state["outputs"].append(out))
    monkeypatch.setattr(claude_login, "_pasted_code", pasted)
    monkeypatch.setattr(claude_login, "_forget_code", lambda _ctx: state.update(forgot=True))
    monkeypatch.setattr(claude_login, "cli_path", lambda: "/bin/claude")
    return state


def test_login_shows_the_link_takes_the_code_and_returns_the_token(tmp_path: Path, db: dict) -> None:
    term = FakeTerm({"after": f"\r\n\x1b[32m✓ Long-lived authentication token created successfully!\x1b[39m\r\nYour OAuth token (valid for 1 year):\r\n\x1b[1m{TOKEN}\x1b[22m\r\n"})
    token = claude_login.login(Ctx(tmp_path), term_factory=lambda argv, env: term)
    assert token == TOKEN
    assert db["outputs"][0] == {"url": URL, "waiting": "code"}
    assert term.sent[:2] == ["codigo-de-prueba-123#estado", "\r"]
    assert db["forgot"] is True
    # La carpeta temporal (HOME de la CLI) se borra.
    assert not list(tmp_path.glob("claude-login-*"))


def test_login_with_a_bad_code_fails_clearly(tmp_path: Path, db: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude_login, "WAIT_TOKEN_S", 1)
    term = FakeTerm({"after": "\r\nOAuth error: Invalid code\r\n"})
    with pytest.raises(JobError, match="no aceptó ese código"):
        claude_login.login(Ctx(tmp_path), term_factory=lambda argv, env: term)


@pytest.mark.skipif(not (Path(claude_login.__file__).exists()), reason="")
def test_the_real_cli_shows_a_login_link(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        cli = claude_login.cli_path()
    except JobError:
        pytest.skip("sin la CLI de Claude")
    outputs: list[dict] = []
    monkeypatch.setattr(claude_login, "_set_output", lambda _ctx, out: outputs.append(out))
    monkeypatch.setattr(claude_login, "_pasted_code", lambda _ctx: None)
    monkeypatch.setattr(claude_login, "WAIT_CODE_S", 1)
    assert cli
    with pytest.raises(JobError, match="15 minutos"):
        claude_login.login(Ctx(tmp_path))
    assert outputs and outputs[0]["url"].startswith("https://") and "oauth/authorize" in outputs[0]["url"]


def test_token_is_not_glued_to_the_next_line() -> None:
    text = f"Your OAuth token (valid for 1 year):\r\n\r\n{TOKEN}\r\nStore this token securely. You won't be able to see it again.\r\n"
    assert claude_login.find_token(text) == TOKEN


def test_login_job_checks_the_token_before_saving(tmp_path: Path, db: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    term = FakeTerm({"after": f"\r\n{TOKEN}\r\nStore this token securely.\r\n"})
    monkeypatch.setattr(claude_login, "Terminal", lambda argv, env: term)
    monkeypatch.setattr(claude_login, "verify", lambda token, work_dir: "Authentication error")
    ctx = Ctx(tmp_path)
    ctx.app = SimpleNamespace(_post=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no debería guardar")))
    with pytest.raises(JobError) as err:
        claude_login.claude_login(ctx)
    assert "no funcionó al probarla" in err.value.user_message
