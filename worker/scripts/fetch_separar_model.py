"""Baja el modelo para separar la voz de la música (se corre al construir la imagen Docker).

    python scripts/fetch_separar_model.py /app/models

| Modelo | De dónde | Licencia | Tamaño |
|---|---|---|---|
| HT-Demucs v4 (Meta), exportado a ONNX con pesos fp16 | HuggingFace adowu/htdemucs-onnx, revisión fijada | MIT | ~158 MB |

Corre con onnxruntime en la CPU, sin PyTorch (ver video/separar.py). Se comprueba el sha256.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

REVISION = "e6b688a9a9f977e2efaba79d0f18b9b0cfc606ea"
URL = f"https://huggingface.co/adowu/htdemucs-onnx/resolve/{REVISION}/htdemucs_fp16weights.onnx"
SHA256 = "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a"


def main() -> int:
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "models") / "htdemucs"
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / "htdemucs_fp16weights.onnx"
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        print(f"htdemucs: ya está ({target})")
        return 0
    with urllib.request.urlopen(URL, timeout=900) as res:
        data = res.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"htdemucs: el archivo bajado no coincide (sha256 {digest})")
    target.write_bytes(data)
    print(f"htdemucs: {len(data) // (1024 * 1024)} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
