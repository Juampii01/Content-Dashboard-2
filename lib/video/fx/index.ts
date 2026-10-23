/**
 * Efectos "de firma" del Editor: ficha (catalog), plan (schema), del plan al dibujo (compile) y motor (engine).
 * Exportaciones con nombre (las usa el empaquetado del worker: worker/motion/fx-engine.mjs).
 */
export { FX_KINDS, FX_INFO, FX_GALLERY_ORDER, FX_FREQUENCIES, FX_FREQUENCY_LABELS, fxBudget, FX_MIN_GAP, isFxKind, type FxKind, type FxInfo, type FxFrequency } from "./catalog";
export { FX_VERSION, fxSegments, compileFx, faceAnchor, framingMap, sourceRangesOf, sourceFramesOf, revealMarks, fxCaptionHides, OUTPUT, type FxSpec, type FxSegment, type FxWord, type FxBrand, type Box } from "./compile";
export { FxRenderer, FX_DRAW, WORKER_FONTS, digitalZoomScale, chartCurve, type FxCtx, type FxFonts, type FxHost, type FxSources, type ImageLike, type Layer } from "./engine";
