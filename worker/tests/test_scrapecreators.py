"""Plan B de descarga de links con ScrapeCreators (video/scrapecreators.py y style_job.download_link).

Sin red real: yt-dlp se reemplaza por uno que falla y ScrapeCreators y el CDN son un servidor local. La clave es
falsa y nunca sale del proceso.
"""

from __future__ import annotations

import json
import subprocess
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from comunes.errors import Cancelled, JobError
from comunes.ffmpeg import stop_event
from video import scrapecreators, style_job

FAKE_KEY = "prueba_FALSA_0123456789abcdef"
REEL = "https://www.instagram.com/reel/DerY94iOOTY/"
TIKTOK = "https://www.tiktok.com/@alguien/video/7251387037834595630"
LOCAL = ("127.0.0.1",)


@pytest.fixture(scope="module")
def mp4(tmp_path_factory: pytest.TempPathFactory) -> bytes:
    out = tmp_path_factory.mktemp("mp4") / "v.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x284:d=1", "-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-y", str(out)],
        check=True,
    )
    return out.read_bytes()


class Fake:
    """ScrapeCreators y CDN simulados. `instagram` / `tiktok` arman la respuesta de la API con la base del servidor."""

    def __init__(self, video: bytes) -> None:
        self.video = video
        self.requests: list[dict[str, Any]] = []
        self.instagram: Any = lambda base: {"success": True, "data": {"xdt_shortcode_media": {"is_video": True, "video_duration": 1.0, "video_url": f"{base}/cdn/v.mp4"}}}
        self.tiktok: Any = lambda base: {"aweme_detail": {"video": {"duration": 1000, "play_addr": {"url_list": ["https://evil.example.com/x.mp4", f"{base}/cdn/v.mp4"]}}}}
        self.api_status = 200
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                parts = urllib.parse.urlsplit(self.path)
                fake.requests.append({"path": parts.path, "query": urllib.parse.parse_qs(parts.query), "key": self.headers.get("x-api-key")})
                if parts.path in scrapecreators.ENDPOINTS.values():
                    body = (fake.instagram if "instagram" in parts.path else fake.tiktok)(fake.base)
                    data = json.dumps(body).encode()
                    self.send_response(fake.api_status)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                elif parts.path == "/cdn/v.mp4":
                    self.send_response(200)
                    self.send_header("content-type", "video/mp4")
                    self.send_header("content-length", str(len(fake.video)))
                    self.end_headers()
                    self.wfile.write(fake.video)
                elif parts.path == "/cdn/redirige":
                    self.send_response(302)
                    self.send_header("location", "http://169.254.169.254/latest/meta-data/")
                    self.end_headers()
                else:
                    self.send_response(404)
                    self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def api_calls(self) -> list[dict[str, Any]]:
        return [r for r in self.requests if r["path"] in scrapecreators.ENDPOINTS.values()]


@pytest.fixture
def fake(mp4: bytes):
    f = Fake(mp4)
    yield f
    f.server.shutdown()


@pytest.fixture
def ytdlp_fails(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """yt-dlp como en Fly hoy: Instagram responde vacío. Guarda las opciones con que se llamó."""
    import yt_dlp  # noqa: PLC0415
    from yt_dlp.utils import DownloadError  # noqa: PLC0415

    seen: list[dict[str, Any]] = []

    class Failing:
        def __init__(self, opts: dict[str, Any]) -> None:
            seen.append(opts)

        def __enter__(self) -> Failing:
            return self

        def __exit__(self, *_a: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> None:
            raise DownloadError("ERROR: [Instagram] DerY94iOOTY: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies")

    monkeypatch.setattr(yt_dlp, "YoutubeDL", Failing)
    return seen


def make_ctx(fake: Fake, key: str | None) -> SimpleNamespace:
    asked: list[str] = []

    def scrapecreators_key(job_id: str) -> str | None:
        asked.append(job_id)
        return key

    return SimpleNamespace(
        job={"id": "00000000-0000-0000-0000-000000000001"},
        app=SimpleNamespace(scrapecreators_key=scrapecreators_key, asked=asked),
        config=SimpleNamespace(scrapecreators_base_url=fake.base),
        check=lambda: None,
    )


def test_ytdlp_falla_y_el_plan_b_baja_el_reel(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    ctx = make_ctx(fake, FAKE_KEY)
    path = style_job.download_link(REEL, tmp_path, name="referencia", extra_hosts=LOCAL, ctx=ctx)
    assert path == tmp_path / "referencia.mp4"
    assert path.read_bytes() == fake.video
    assert ctx.app.asked == ["00000000-0000-0000-0000-000000000001"]
    [call] = fake.api_calls()
    assert call["path"] == "/v1/instagram/post"
    assert call["query"]["url"] == [REEL]
    assert call["key"] == FAKE_KEY, "la clave va en la cabecera"
    assert all(FAKE_KEY not in json.dumps(r["query"]) for r in fake.requests), "nunca en la URL"
    assert not any(r["key"] for r in fake.requests if r["path"].startswith("/cdn/")), "al CDN no se le manda la clave"
    assert not list(tmp_path.glob("*.part"))


def test_ytdlp_usa_node_para_youtube(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(style_job, "_node_path", lambda: "/usr/local/bin/node")
    with pytest.raises(JobError):
        style_job.download_link("https://www.youtube.com/watch?v=dQw4w9WgXcQ", tmp_path, ctx=make_ctx(fake, FAKE_KEY))
    assert ytdlp_fails[0]["js_runtimes"] == {"node": {"path": "/usr/local/bin/node"}}


def test_youtube_que_falla_no_usa_scrapecreators(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    ctx = make_ctx(fake, FAKE_KEY)
    with pytest.raises(JobError) as err:
        style_job.download_link("https://youtu.be/dQw4w9WgXcQ", tmp_path, ctx=ctx)
    assert err.value.user_message == style_job.LINK_ERROR
    assert ctx.app.asked == [] and fake.requests == []


def test_sin_clave_dice_que_hacer(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, ctx=make_ctx(fake, None))
    assert err.value.user_message == "Instagram no deja bajar este link desde el servidor. Sube el video o agrega tu clave de ScrapeCreators en Ajustes → Claves de servicios."
    assert err.value.retry is False
    assert fake.requests == []
    # Sin contexto (un llamado viejo) pasa lo mismo: nunca una clave de otro lado.
    with pytest.raises(JobError) as err2:
        style_job.download_link(TIKTOK, tmp_path, extra_hosts=LOCAL)
    assert err2.value.user_message.startswith("TikTok no deja bajar este link")


def test_cdn_no_permitido_se_rechaza(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    for bad in ("https://evil.example.com/v.mp4", "http://scontent.cdninstagram.com/v.mp4", "https://cdninstagram.com.evil.com/v.mp4", "https://169.254.169.254/latest/meta-data/", "file:///etc/passwd"):
        fake.instagram = lambda _base, bad=bad: {"data": {"xdt_shortcode_media": {"is_video": True, "video_url": bad}}}
        with pytest.raises(JobError) as err:
            style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, ctx=make_ctx(fake, FAKE_KEY))
        assert "Sube el video" in err.value.user_message
        assert "CDN no permitido" in (err.value.detail or "")
    assert not list(tmp_path.iterdir())


def test_redireccion_fuera_del_cdn_se_rechaza(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    fake.instagram = lambda base: {"data": {"xdt_shortcode_media": {"is_video": True, "video_url": f"{base}/cdn/redirige"}}}
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, ctx=make_ctx(fake, FAKE_KEY))
    assert "redirección no permitida" in (err.value.detail or "")
    assert not list(tmp_path.iterdir())


def test_tope_de_bytes(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, max_bytes=100, ctx=make_ctx(fake, FAKE_KEY))
    assert "pesa demasiado" in err.value.user_message
    assert not list(tmp_path.iterdir())


def test_demasiado_largo_segun_la_api(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    fake.instagram = lambda base: {"data": {"xdt_shortcode_media": {"is_video": True, "video_duration": 3600, "video_url": f"{base}/cdn/v.mp4"}}}
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, max_seconds=600, ctx=make_ctx(fake, FAKE_KEY))
    assert "demasiado largo" in err.value.user_message
    assert not any(r["path"].startswith("/cdn/") for r in fake.requests), "ni se empieza a bajar"


def test_foto_sin_video(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    fake.instagram = lambda _base: {"data": {"xdt_shortcode_media": {"is_video": False, "display_url": "https://scontent.cdninstagram.com/f.jpg"}}}
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, ctx=make_ctx(fake, FAKE_KEY))
    assert "no tiene un video" in err.value.user_message


def test_tiktok_salta_las_urls_no_permitidas(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]]) -> None:
    path = style_job.download_link(TIKTOK, tmp_path, name="video", extra_hosts=LOCAL, ctx=make_ctx(fake, FAKE_KEY))
    assert path.read_bytes() == fake.video
    assert fake.api_calls()[0]["path"] == "/v2/tiktok/video"


@pytest.mark.parametrize(("status", "text"), [(401, "no aceptó tu clave"), (402, "sin créditos"), (404, "privado"), (500, "Tampoco pudimos")])
def test_errores_de_la_api(tmp_path: Path, fake: Fake, ytdlp_fails: list[dict[str, Any]], status: int, text: str) -> None:
    fake.api_status = status
    with pytest.raises(JobError) as err:
        style_job.download_link(REEL, tmp_path, extra_hosts=LOCAL, ctx=make_ctx(fake, FAKE_KEY))
    assert text in err.value.user_message
    assert FAKE_KEY not in err.value.user_message and FAKE_KEY not in (err.value.detail or "")


def test_cancelar_corta_la_descarga(tmp_path: Path, fake: Fake) -> None:
    stop_event.set()
    try:
        with pytest.raises(Cancelled):
            scrapecreators.download_video(f"{fake.base}/cdn/v.mp4", tmp_path / "v.mp4", "instagram", max_bytes=10**9, extra_hosts=LOCAL)
    finally:
        stop_event.clear()
    assert not list(tmp_path.iterdir())


def test_base_de_la_api_solo_la_real_o_local_en_pruebas() -> None:
    assert scrapecreators.api_base_allowed("https://api.scrapecreators.com", ())
    assert not scrapecreators.api_base_allowed("https://api.scrapecreators.com.evil.com", ())
    assert not scrapecreators.api_base_allowed("http://127.0.0.1:9999", ())
    assert scrapecreators.api_base_allowed("http://127.0.0.1:9999", LOCAL)


def test_lista_de_cdns() -> None:
    ok = scrapecreators.cdn_allowed
    assert ok("https://scontent-sea1-1.cdninstagram.com/v/t50/x.mp4?oh=1", "instagram")
    assert ok("https://instagram.fcor2-1.fna.fbcdn.net/v.mp4", "instagram")
    assert ok("https://v16-webapp.tiktok.com/video/tos/x", "tiktok")
    assert ok("https://v45.tiktokcdn-eu.com/x", "tiktok")
    assert not ok("https://v45.tiktokcdn-eu.com/x", "instagram"), "cada red con sus CDNs"
    assert not ok("https://evilcdninstagram.com/v.mp4", "instagram")
    assert not ok("https://scontent.cdninstagram.com:8443/v.mp4", "instagram")
    assert not ok("https://user:pw@scontent.cdninstagram.com/v.mp4", "instagram")
    assert not ok("http://127.0.0.1/v.mp4", "instagram"), "localhost solo con extra_hosts de pruebas"
