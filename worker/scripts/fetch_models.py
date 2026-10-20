"""Baja los modelos open source del worker a una carpeta (se corre al construir la imagen Docker).

    python scripts/fetch_models.py /app/models            # todos
    python scripts/fetch_models.py worker/models --only yunet

Nunca se bajan modelos en cada trabajo: en Fly hay red, pero así cada video arranca enseguida y el worker
funciona igual aunque HuggingFace no responda. Al ejecutar, los proveedores leen solo de esta carpeta.

| Modelo | De dónde | Licencia | Tamaño |
|---|---|---|---|
| Parakeet TDT 0.6b v3 (ONNX int8) | HuggingFace istupakov/parakeet-tdt-0.6b-v3-onnx | CC-BY-4.0 | ~670 MB |
| Silero VAD (ONNX) | HuggingFace istupakov/silero-vad-onnx | MIT | ~2 MB |
| faster-whisper small (CTranslate2) | HuggingFace Systran/faster-whisper-small | MIT | ~480 MB |
| YuNet 2023mar (detector de caras) | GitHub opencv/opencv_zoo | MIT | 230 KB |
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

YUNET_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
YUNET_FILE = "face_detection_yunet_2023mar.onnx"


def fetch_yunet(dest: Path) -> None:
    target = dest / YUNET_FILE
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == YUNET_SHA256:
        print(f"yunet: ya está ({target})")
        return
    with urllib.request.urlopen(YUNET_URL, timeout=120) as res:
        data = res.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != YUNET_SHA256:
        raise SystemExit(f"yunet: el archivo bajado no coincide (sha256 {digest})")
    target.write_bytes(data)
    print(f"yunet: {len(data) // 1024} KB")


def fetch_parakeet(dest: Path) -> None:
    import onnx_asr

    # Si la carpeta no existe, onnx-asr la baja de HuggingFace; si existe, la usa sin red.
    onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", dest / "parakeet-tdt-0.6b-v3", quantization="int8")
    onnx_asr.load_vad("silero", dest / "silero-vad")
    print("parakeet + silero: listos")


def fetch_whisper(dest: Path, model: str) -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(f"Systran/faster-whisper-{model}", local_dir=dest / f"whisper-{model}")
    print(f"faster-whisper {model}: listo")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dest", type=Path)
    parser.add_argument("--only", choices=["yunet", "parakeet", "whisper"], action="append")
    parser.add_argument("--whisper-model", default="small")
    args = parser.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only or ["yunet", "parakeet", "whisper"])
    if "yunet" in wanted:
        fetch_yunet(args.dest)
    if "parakeet" in wanted:
        fetch_parakeet(args.dest)
    if "whisper" in wanted:
        fetch_whisper(args.dest, args.whisper_model)
    return 0


if __name__ == "__main__":
    sys.exit(main())
