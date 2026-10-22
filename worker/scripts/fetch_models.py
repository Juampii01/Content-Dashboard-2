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
| DeepFilterNet3 (ONNX: enc, erb_dec, df_dec) | GitHub Rikorose/DeepFilterNet v0.5.6 | MIT o Apache-2.0 | ~8,6 MB |
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import tarfile
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


# Audio de estudio (worker/video/studio.py). Primero el .tar.gz del repo en la versión fijada; si no responde, el
# binario oficial de la misma versión (trae el mismo modelo adentro). En los dos casos se comprueban los archivos.
DFN_TAR_URL = "https://github.com/Rikorose/DeepFilterNet/raw/v0.5.6/models/DeepFilterNet3_onnx.tar.gz"
DFN_BIN_URL = "https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-unknown-linux-musl"
DFN_BIN_SHA256 = "70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da"
DFN_SHA256 = {
    "enc.onnx": "7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916",
    "erb_dec.onnx": "ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895",
    "df_dec.onnx": "23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a",
}


def _dfn_members(raw: bytes) -> dict[str, bytes]:
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        out = {}
        for m in tar.getmembers():
            name = m.name.rsplit("/", 1)[-1]
            if m.isfile() and name in DFN_SHA256:
                out[name] = tar.extractfile(m).read()  # type: ignore[union-attr]
        return out


def _dfn_from_binary(data: bytes) -> dict[str, bytes]:
    if hashlib.sha256(data).hexdigest() != DFN_BIN_SHA256:
        raise SystemExit("deepfilternet: el binario bajado no coincide")
    pos = 0
    while (pos := data.find(b"\x1f\x8b\x08", pos)) >= 0:
        try:
            files = _dfn_members(_gunzip(data[pos:]))
            if len(files) == len(DFN_SHA256):
                return files
        except Exception:  # noqa: BLE001 (no es el tar que buscamos)
            pass
        pos += 3
    raise SystemExit("deepfilternet: no se encontró el modelo dentro del binario")


def _gunzip(data: bytes) -> bytes:
    import zlib

    return zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data[:20_000_000])


def fetch_deepfilternet(dest: Path) -> None:
    target = dest / "deepfilternet3"
    ok = lambda: all((target / n).exists() and hashlib.sha256((target / n).read_bytes()).hexdigest() == h for n, h in DFN_SHA256.items())  # noqa: E731
    if ok():
        print(f"deepfilternet3: ya está ({target})")
        return
    files: dict[str, bytes] = {}
    try:
        with urllib.request.urlopen(DFN_TAR_URL, timeout=120) as res:
            files = _dfn_members(res.read())
        if any(hashlib.sha256(files.get(n, b"")).hexdigest() != h for n, h in DFN_SHA256.items()):
            files = {}
    except Exception as exc:  # noqa: BLE001
        print(f"deepfilternet3: el .tar.gz no respondió ({exc}); pruebo con el binario oficial")
    if not files:
        with urllib.request.urlopen(DFN_BIN_URL, timeout=300) as res:
            files = _dfn_from_binary(res.read())
    for name, h in DFN_SHA256.items():
        if hashlib.sha256(files[name]).hexdigest() != h:
            raise SystemExit(f"deepfilternet3: {name} no coincide")
    target.mkdir(parents=True, exist_ok=True)
    for name, blob in files.items():
        (target / name).write_bytes(blob)
    print(f"deepfilternet3: {sum(len(b) for b in files.values()) // 1024} KB")


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
    parser.add_argument("--only", choices=["yunet", "parakeet", "whisper", "deepfilternet"], action="append")
    parser.add_argument("--whisper-model", default="small")
    args = parser.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)
    wanted = set(args.only or ["yunet", "parakeet", "whisper", "deepfilternet"])
    if "yunet" in wanted:
        fetch_yunet(args.dest)
    if "deepfilternet" in wanted:
        fetch_deepfilternet(args.dest)
    if "parakeet" in wanted:
        fetch_parakeet(args.dest)
    if "whisper" in wanted:
        fetch_whisper(args.dest, args.whisper_model)
    return 0


if __name__ == "__main__":
    sys.exit(main())
