"""Grabaciones del navegador (MediaRecorder): WebM sin duración en la cabecera y tomas cortadas al final."""

import shutil
import subprocess
from pathlib import Path

import pytest

from comunes import ffmpeg
from video import ingest

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="sin ffmpeg")


def _browser_like_webm(out: Path, seconds: float = 3.0) -> None:
    """Como MediaRecorder: WebM VP8 + Opus escrito a un pipe (sin poder volver atrás a escribir la duración)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=30:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=300:sample_rate=48000:duration={seconds}",
        "-c:v", "libvpx", "-b:v", "500k", "-deadline", "realtime", "-c:a", "libopus", "-f", "webm", "pipe:1",
    ]
    with out.open("wb") as fh:
        subprocess.run(cmd, stdout=fh, check=True)


def test_webm_without_duration_is_remuxed(tmp_path: Path) -> None:
    src = tmp_path / "original.webm"
    _browser_like_webm(src)
    probe = ffmpeg.probe(src)
    assert ingest.probe_duration(probe) == 0, "el WebM escrito a un pipe no debería traer duración"
    assert ingest.needs_remux(probe)
    with pytest.raises(Exception):
        ingest.analyze_probe(probe)  # sin arreglo: "demasiado corto"

    fixed = ingest.remux_for_duration(src, tmp_path / "original.fixed.mkv")
    info = ingest.analyze_probe(ffmpeg.probe(fixed))
    assert 2.8 <= info["duration"] <= 3.2
    assert info["hasAudio"] and info["width"] == 640 and info["height"] == 360


def test_truncated_recording_keeps_what_was_recorded(tmp_path: Path) -> None:
    """Pestaña cerrada a mitad: el archivo se corta en cualquier byte; se conserva lo grabado hasta ahí."""
    full = tmp_path / "full.webm"
    _browser_like_webm(full, seconds=4.0)
    data = full.read_bytes()
    cut = tmp_path / "original.webm"
    cut.write_bytes(data[: int(len(data) * 0.7)])
    fixed = ingest.remux_for_duration(cut, tmp_path / "original.fixed.mkv")
    info = ingest.analyze_probe(ffmpeg.probe(fixed))
    assert 2.0 <= info["duration"] <= 3.6


def test_regular_files_are_not_remuxed(tmp_path: Path) -> None:
    src = tmp_path / "original.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2.5",
         "-f", "lavfi", "-i", "sine=duration=2.5", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(src)],
        check=True,
    )
    assert not ingest.needs_remux(ffmpeg.probe(src))
