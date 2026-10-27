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
import { counter, highlighter, letterBuild, neonText, outlineFill, scramble, text3d, titleCard, typewriter, underlineDraw, waveText, wordPop, wordSlam, wordStack } from "./fx-text";
import { arrowDraw, badgeStamp, beforeAfter, checkCross, circleHand, emojiBounce, flashFrame, focusBrackets, magnifier, speechBubble, spotlight, stickerBurst } from "./fx-callouts";
import { bigStat, definition, lowerThird, notification, numberedList, poll, priceTag, progressBar, prosCons, questionBox, quoteCard, ratingStars, searchBar, socialComment, timelineSteps } from "./fx-cards";
import { bgBlur, bwAccent, chroma, dreamyGlow, duotone, dust, filmGrain, glitch, letterbox, lightLeak, sparkles, vhs, vignette, warmFilm } from "./fx-looks";
import { beatPulse, bounceZoom, handheld, impact, pushIn, rollIn, shake, slowPan, snapZoom, tilt } from "./fx-camera";
import { browserWindow, computerScreen, filmStrip, notebook, paperFrame, phoneFrame, polaroid, splitThree, splitTwo, tapeFrame } from "./fx-frames";
import { TRANSITION_DRAW } from "./transitions";
import { replayComposition } from "../../compos/replay";
import { bgBrand, bgBw, cloneTrio, dropShadow, echo, glowOutline, stickerCutout, textBehind } from "./fx-cutout";

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
  // Texto
  typewriter,
  word_pop: wordPop,
  underline_draw: underlineDraw,
  highlighter,
  counter,
  text_3d: text3d,
  neon_text: neonText,
  letter_build: letterBuild,
  word_stack: wordStack,
  word_slam: wordSlam,
  scramble,
  wave_text: waveText,
  title_card: titleCard,
  outline_fill: outlineFill,
  // Atención
  arrow_draw: arrowDraw,
  circle_hand: circleHand,
  magnifier,
  flash_frame: flashFrame,
  emoji_bounce: emojiBounce,
  sticker_burst: stickerBurst,
  check_cross: checkCross,
  before_after: beforeAfter,
  spotlight,
  focus_brackets: focusBrackets,
  speech_bubble: speechBubble,
  badge_stamp: badgeStamp,
  // Tarjetas
  lower_third: lowerThird,
  quote_card: quoteCard,
  big_stat: bigStat,
  numbered_list: numberedList,
  pros_cons: prosCons,
  timeline_steps: timelineSteps,
  progress_bar: progressBar,
  poll,
  social_comment: socialComment,
  notification,
  question_box: questionBox,
  rating_stars: ratingStars,
  price_tag: priceTag,
  search_bar: searchBar,
  definition,
  // Looks
  vignette,
  film_grain: filmGrain,
  light_leak: lightLeak,
  dust,
  vhs,
  glitch,
  chroma,
  bw_accent: bwAccent,
  duotone,
  bg_blur: bgBlur,
  sparkles,
  letterbox,
  warm_film: warmFilm,
  dreamy_glow: dreamyGlow,
  // Cámara
  shake,
  impact,
  beat_pulse: beatPulse,
  slow_pan: slowPan,
  bounce_zoom: bounceZoom,
  tilt,
  handheld,
  push_in: pushIn,
  snap_zoom: snapZoom,
  roll_in: rollIn,
  // Marcos
  phone_frame: phoneFrame,
  polaroid,
  tape_frame: tapeFrame,
  paper_frame: paperFrame,
  notebook,
  computer_screen: computerScreen,
  split_two: splitTwo,
  split_three: splitThree,
  film_strip: filmStrip,
  browser_window: browserWindow,
  // Con tu recorte
  text_behind: textBehind,
  glow_outline: glowOutline,
  drop_shadow: dropShadow,
  echo,
  bg_brand: bgBrand,
  bg_bw: bgBw,
  clone_trio: cloneTrio,
  sticker_cutout: stickerCutout,
};

export class FxRenderer {
  private pool = new LayerPool();
  constructor(private host: FxHost) {}

  /**
   * Dibuja el cuadro. `ctx` es el lienzo de salida; `pixelScale` = píxeles del lienzo por píxel del video final
   * (1 en el worker, ~0,33 en la vista previa).
   */
  render(ctx: FxCtx, spec: FxSpec, t: number, src: FxSources, pixelScale = 1): { movable: { x: number; y: number; w: number; h: number } | null } {
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
    if (spec.kind === "composition") {
      replayComposition(frame, src.compos);
      ctx.restore();
      return { movable: null };
    }
    const draw = (FX_DRAW as Record<string, ((f: FxFrame) => void) | undefined>)[spec.kind] ?? (TRANSITION_DRAW as Record<string, ((f: FxFrame) => void) | undefined>)[spec.kind];
    if (draw) draw(frame);
    else frame.drawBase(ctx);
    ctx.restore();
    // La caja de diseño del elemento movible (para el lienzo de la revisión), si el efecto tiene uno.
    return { movable: frame.movableBox };
  }
}

export { FxFrame, WORKER_FONTS, type FxCtx, type FxFonts, type FxHost, type FxSources, type ImageLike, type Layer } from "./core";
export { digitalZoomScale, chartCurve } from "./effects-ref";
export { TRANSITION_DRAW } from "./transitions";
