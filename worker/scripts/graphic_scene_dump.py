"""Vuelca la escena de un gráfico (cajas y tiempos) con una medición falsa y fija, para comparar el diseño del worker
con el de la vista previa (lib/video/graphic-scene.ts) en las pruebas de la app (tests/video-graphics.test.mts).

Uso: echo '{"spec": {...}, "width": 1080, "height": 1920, "duration": 3}' | python scripts/graphic_scene_dump.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from video import graphics  # noqa: E402


class FakeFonts:
    """Cada carácter mide 0,55 del tamaño (0,6 en negrita máxima): igual que en la prueba de TypeScript."""

    def measure(self, text: str, font: tuple[str, int], size: float) -> float:
        return len(text) * graphics.rnd(size) * (0.6 if font[1] == 900 else 0.55)


def main() -> None:
    data = json.load(sys.stdin)
    scene = graphics.build_scene(data["spec"], data["width"], data["height"], data["duration"], FakeFonts())  # type: ignore[arg-type]
    out = {
        "timeScale": round(scene.time_scale, 4),
        "exit": round(scene.exit, 4),
        "elements": [
            {"x": round(e.x, 2), "y": round(e.y, 2), "w": round(e.w, 2), "h": round(e.h, 2), "kind": e.anim["kind"], "start": round(e.anim["start"], 4), "dur": round(e.anim["dur"], 4), "paints": [p["type"] for p in e.paints]}
            for e in scene.elements
        ],
    }
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
