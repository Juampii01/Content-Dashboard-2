"""Baja el modelo de recorte de personas de las miniaturas de YouTube (se corre al construir la imagen Docker).

    python scripts/fetch_cutout_model.py /app/models

| Modelo | De dónde | Licencia | Tamaño |
|---|---|---|---|
| U²-Net human segmentation (ONNX, el mismo que usa rembg) | GitHub danielgatis/rembg, release v0.0.0 | Apache-2.0 | ~168 MB |
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
SHA256 = "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c"


def main() -> int:
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "models") / "rembg"
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / "u2net_human_seg.onnx"
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        print(f"u2net_human_seg: ya está ({target})")
        return 0
    with urllib.request.urlopen(URL, timeout=600) as res:
        data = res.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"u2net_human_seg: el archivo bajado no coincide (sha256 {digest})")
    target.write_bytes(data)
    print(f"u2net_human_seg: {len(data) // (1024 * 1024)} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
