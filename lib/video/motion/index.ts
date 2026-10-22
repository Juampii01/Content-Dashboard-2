/**
 * Motor de motion graphics propio (TypeScript isomórfico, Canvas 2D). Lo usan la vista previa del navegador
 * (<canvas>) y el worker (skia-canvas, con este mismo código empaquetado en worker/motion/engine.mjs).
 *
 * Escena (schema.ts) → compileScene (compile.ts: componentes y primitivas a nodos en píxeles) → renderFrame
 * (render.ts) en cada instante. validateScene (validate.ts) revisa desbordes, choques, zona segura y contraste.
 */
export * from "./schema";
export * from "./compile";
export * from "./render";
export { COMPONENTS, COMPONENT_NAMES, type ComponentName } from "./components";
export { ICON_NAMES, ICON_TAGS, isIconName, type IconName } from "./icons";
export { SAMPLE_THEMES, resolveTheme, themeSchema, type MotionTheme, type MotionThemeInput } from "./theme";
export { EASINGS, applyEase, spring } from "./easing";
export { parseCount, formatCount } from "./count";

/** Tamaño del lienzo de cada formato. */
export const formatSize = (format: "9:16" | "16:9") => (format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });
