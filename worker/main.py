"""Worker de Content 2: procesa los trabajos pesados (video) fuera de Vercel.

    python main.py

Variables: ver docs/worker.md. Se apaga solo después de IDLE_EXIT_MINUTES sin trabajos (0 = nunca).
"""

from __future__ import annotations

import logging
import os
import sys

from comunes import config as config_module
from comunes.runner import Worker

# Los módulos de trabajos se registran al importarse.
import video.pipeline  # noqa: F401  (VIDEO_ANALYZE, VIDEO_RENDER, VIDEO_STYLE, VIDEO_CLIP, LONG_VIDEO_CLIPS)
import carruseles  # noqa: F401  (CAROUSEL_STYLE, CAROUSEL_COPY, CAROUSEL_IMAGES, CAROUSEL_ANIMATE)
import youtube  # noqa: F401  (YT_THUMBNAILS, YOUTUBE_TRANSCRIPT)
import video.reel_copy  # noqa: F401  (REEL_COPY)
import video.separar  # noqa: F401  (AUDIO_SPLIT)
import video.look  # noqa: F401  (VIDEO_LOOK)
import video.peaks  # noqa: F401  (VIDEO_PEAKS)


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    config = config_module.load()
    config.work_dir.mkdir(parents=True, exist_ok=True)
    return Worker(config).run()


if __name__ == "__main__":
    sys.exit(main())
