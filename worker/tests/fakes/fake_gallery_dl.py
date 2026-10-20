"""gallery-dl simulado: copia las imágenes de FAKE_GALLERY_DIR a la carpeta `-D` como lo haría la descarga real
(nombres 01.jpg, 02.jpg…). Con FAKE_GALLERY_FAIL=1 responde como cuando Instagram pide iniciar sesión.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def main() -> int:
    args = sys.argv[1:]
    dest = Path(args[args.index("-D") + 1])
    if os.environ.get("FAKE_GALLERY_FAIL") == "1":
        print("[instagram][error] HttpError: '401 Unauthorized' for 'https://www.instagram.com/api/v1/media/…' (login required)", file=sys.stderr)
        return 4
    src = Path(os.environ["FAKE_GALLERY_DIR"])
    dest.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(sorted(p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))):
        target = dest / f"{i + 1:02d}{f.suffix.lower()}"
        shutil.copyfile(f, target)
        print(str(target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
