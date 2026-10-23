/**
 * Motor de efectos (isomórfico): `FxRenderer.render(ctx, spec, t, fuentes)` dibuja el cuadro completo del efecto en el
 * instante t (segundos desde que empieza). Lo usan la vista previa (<canvas>) y el worker (skia-canvas, empaquetado en
 * worker/motion/fx-engine.mjs con `pnpm motion:bundle`).
 */
import type { FxKind } from "../catalog";
import type { FxSpec } from "../compile";
import { FxFrame, LayerPool, type FxCtx, type FxHost, type FxSources } from "./core";
import { checklist, chartGrow, coverStory, digitalZoom, glassType, headlineWall, phoneMockup } from "./effects-ref";
import { couchWall, doodleBoil, frameBreak, greenScreen, orbit, paperCut, uiWorld, vertigo, zoomCut, zoomOut } from "./effects-own";

export const FX_DRAW: Record<FxKind, (f: FxFrame) => void> = {
  digital_zoom: digitalZoom,
  cover_story: coverStory,
  checklist,
  glass_type: glassType,
  iphone: phoneMockup,
  chart_grow: chartGrow,
  headline_wall: headlineWall,
  orbit,
  couch_wall: couchWall,
  ui_world: uiWorld,
  frame_break: frameBreak,
  zoom_cut: zoomCut,
  zoom_out: zoomOut,
  green_screen: greenScreen,
  paper_cut: paperCut,
  doodle_boil: doodleBoil,
  vertigo,
};

export class FxRenderer {
  private pool = new LayerPool();
  constructor(private host: FxHost) {}

  /**
   * Dibuja el cuadro. `ctx` es el lienzo de salida; `pixelScale` = píxeles del lienzo por píxel del video final
   * (1 en el worker, ~0,33 en la vista previa).
   */
  render(ctx: FxCtx, spec: FxSpec, t: number, src: FxSources, pixelScale = 1): void {
    ctx.save();
    // Borrar todo el lienzo también reinicia lo que skia-canvas tiene grabado (si no, cada cuadro repite los anteriores).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, spec.width * pixelScale + 2, spec.height * pixelScale + 2);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = true;
    const frame = new FxFrame(ctx, spec, Math.max(0, Math.min(spec.duration, t)), src, this.host, pixelScale, this.pool);
    FX_DRAW[spec.kind](frame);
    ctx.restore();
  }
}

export { FxFrame, WORKER_FONTS, type FxCtx, type FxFonts, type FxHost, type FxSources, type ImageLike, type Layer } from "./core";
export { digitalZoomScale, chartCurve } from "./effects-ref";
