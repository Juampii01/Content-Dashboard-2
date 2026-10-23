/**
 * Vuelca los números del lienzo de la revisión que el worker tiene que repetir igual: el lugar de los subtítulos
 * (`captionAnchor`) y las rampas de opacidad de las animaciones (`animFades` / `rampAlpha`), tal como los manda la app.
 * Lo usan las pruebas del worker (worker/tests/test_canvas_place.py) y tests/canvas-transform.test.mts revisa que
 * esté al día.
 *   node --import tsx scripts/canvas-dump.mts [salida.json]
 */
import { writeFileSync } from "node:fs";
import { brollRenderEdit, resolveEdit } from "../lib/video/broll-edit";
import { captionLook, CAPTION_STYLE_KEYS } from "../lib/video/caption-styles";
import { captionAnchor } from "../lib/video/canvas/captions";
import { ANIM_KINDS, animFades, rampAlpha, type Anim } from "../lib/video/canvas/transform";

export function canvasDump() {
  const places = [null, { x: 0, y: -0.2, scale: 1 }, { x: 0.1, y: 0.05, scale: 1.4 }, { x: -0.25, y: -0.4, scale: 0.6 }, { x: 0, y: 0.1, scale: 2.5 }];
  const captions = (["9:16", "16:9"] as const).flatMap((format) => {
    const [W, H] = format === "9:16" ? [1080, 1920] : [1920, 1080];
    return CAPTION_STYLE_KEYS.flatMap((style) => {
      const look = captionLook(style, { format, accent: "#0070F8", brandFont: "montserrat" });
      return places.map((place) => ({ format, style, look, place, width: W, height: H, anchor: captionAnchor(look, place, W, H) }));
    });
  });
  const anims: Anim[] = [
    ...ANIM_KINDS.map((k) => ({ in: k, out: k, inDur: 0.4, outDur: 0.3 })),
    { in: "pop", out: "aparecer", inDur: 1.2, outDur: 2 },
    { in: "ninguna", out: "deslizar_lado", inDur: 0.2, outDur: 0.6 },
  ];
  const fades = anims.flatMap((anim) =>
    [0.5, 2, 4.5].map((duration) => {
      const edit = brollRenderEdit({ edit: resolveEdit({ anim }), format: "9:16", duration, clipWidth: 0, clipHeight: 0, accent: "#0070F8", ground: "#030A22", graphic: { mode: "overlay" } });
      const f = animFades(anim, duration);
      const samples = Array.from({ length: 11 }, (_, i) => {
        const t = Math.round(((duration * i) / 10) * 1000) / 1000;
        return { t, alpha: rampAlpha(f.fadeIn, f.fadeOut, t, duration) };
      });
      return { anim, duration, edit, fadeIn: f.fadeIn, fadeOut: f.fadeOut, samples };
    }),
  );
  return { captions, fades };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "worker/tests/fixtures/canvas-place.json";
  writeFileSync(out, `${JSON.stringify(canvasDump())}\n`);
  console.log(out);
}
