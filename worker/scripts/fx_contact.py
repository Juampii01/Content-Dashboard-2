"""Renderiza cada efecto sobre el video de prueba y arma una hoja de contacto por efecto (y una general).

    python scripts/make_fx_video.py /tmp/fx --no-alpha
    python scripts/fx_contact.py /tmp/fx/fx-1080x1920.mp4 /tmp/fx/transcript.json /tmp/fx/hojas [--only cover_story,orbit]

Usa las mismas piezas que el render (worker/video/fx.py: tramo, máscara y motor de efectos en Node) y los specs que
arma la app (`scripts/fx-dump.mts`). Deja `<efecto>.jpg` (6 cuadros del tramo con su tiempo), `<efecto>.mp4` y
`tiempos.json` (segundos de máscara y de dibujo por efecto).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from video import fx  # noqa: E402
from video.reframe import FaceFinder  # noqa: E402

REPO = HERE.parent.parent


class FakeCtx:
    def check(self) -> None:
        return None


def measure_face(video: Path, models: Path) -> tuple[int, int, int, int]:
    finder = FaceFinder(models)
    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    boxes = []
    for i in np.linspace(0, n - 1, 12).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if not ok:
            continue
        h, w = frame.shape[:2]
        faces = finder.detect(frame)
        if faces:
            x, y, fw, fh, _ = max(faces, key=lambda f: f[2] * f[3])
            boxes.append((x * w, y * h, fw * w, fh * h))
    if not boxes:
        return (380, 560, 300, 330)
    return tuple(int(np.median([b[k] for b in boxes])) for k in range(4))  # type: ignore[return-value]


def sheet(video: Path, out: Path, label: str, times: list[float], tile=(270, 480)) -> None:
    cap = cv2.VideoCapture(str(video))
    tiles = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            frame = np.zeros((tile[1], tile[0], 3), np.uint8)
        im = cv2.resize(frame, tile, interpolation=cv2.INTER_AREA)
        cv2.rectangle(im, (0, tile[1] - 26), (tile[0], tile[1]), (0, 0, 0), -1)
        cv2.putText(im, f"{t:.2f} s", (8, tile[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(im)
    rows = [np.hstack(tiles[i : i + 3]) for i in range(0, len(tiles), 3)]
    img = np.vstack(rows)
    head = np.zeros((44, img.shape[1], 3), np.uint8)
    cv2.putText(head, label, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.imwrite(str(out), np.vstack([head, img]), [cv2.IMWRITE_JPEG_QUALITY, 88])


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("video", type=Path)
    p.add_argument("transcript", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--only", default="")
    p.add_argument("--models", type=Path, default=HERE.parent / "models")
    p.add_argument("--fonts", type=Path, default=HERE.parent / "fonts")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    face = measure_face(args.video, args.models)
    print("cara:", face)
    dump = subprocess.run(
        ["node", "--import", "tsx", "scripts/fx-dump.mts", str(args.transcript), "--face", ",".join(str(v) for v in face)],
        cwd=REPO, capture_output=True, check=True,
    )
    specs = json.loads(dump.stdout)
    only = {k for k in args.only.split(",") if k}
    cap = cv2.VideoCapture(str(args.video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    timings = {}
    for entry in specs:
        kind = entry["kind"]
        if only and kind not in only:
            continue
        spec = entry["spec"]
        frames = round(spec["duration"] * 30)
        start_frame = round(spec["start"] * 30)
        item = {"spec": spec, "sourceFrames": list(range(start_frame, start_frame + frames))}
        t0 = time.monotonic()
        res = fx.render_effects(
            FakeCtx(), [item], joined=args.video, mezz=args.video, src_size=(w, h), total_frames=total, fmt=spec["format"], offset_x=0.0, workdir=args.out, fonts_dir=args.fonts
        )[0]
        elapsed = time.monotonic() - t0
        target = args.out / f"{kind}.mp4"
        target.write_bytes(Path(res["path"]).read_bytes())
        d = spec["duration"]
        times = [0.15, d * 0.2, d * 0.4, d * 0.6, d * 0.8, max(0, d - 0.12)]
        sheet(target, args.out / f"{kind}.jpg", f"{entry['label']} ({kind}) · {d:.1f} s", times)
        timings[kind] = {"seconds": round(d, 2), "total_s": round(elapsed, 1), "mask_s": round(res["maskMs"] / 1000, 1), "draw_s": round(res["ms"] / 1000, 1)}
        print(kind, timings[kind], flush=True)
    (args.out / "tiempos.json").write_text(json.dumps(timings, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
