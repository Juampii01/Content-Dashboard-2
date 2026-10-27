/**
 * Curvas de animación con nombre. Todas van de 0 a 1 (algunas se pasan un poco y vuelven: back, elastic, spring).
 * El resorte es físico (oscilador amortiguado) y se normaliza para que termine exacto en 1 al final del tramo.
 */
import { z } from "zod";

export const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EASINGS = {
  linear: (p: number) => p,
  easeInQuad: (p: number) => p * p,
  easeOutQuad: (p: number) => 1 - (1 - p) ** 2,
  easeInCubic: (p: number) => p ** 3,
  easeOutCubic: (p: number) => 1 - (1 - p) ** 3,
  easeInOut: (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  easeInOutSine: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
  easeOutQuart: (p: number) => 1 - (1 - p) ** 4,
  easeOutQuint: (p: number) => 1 - (1 - p) ** 5,
  easeOutExpo: (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  easeInExpo: (p: number) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  easeInOutExpo: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
  /** Se pasa ~10 % y vuelve: entradas con carácter (íconos, insignias). */
  back: (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  /** Se pasa ~4 %: el "back" de los elementos grandes. */
  backSoft: (p: number) => 1 + 1.9 * (p - 1) ** 3 + 0.9 * (p - 1) ** 2,
  /** Elástico suave (dos rebotes cortos), para notificaciones y "pop". */
  elastic: (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-9 * p) * Math.sin(((p * 10 - 0.75) * (2 * Math.PI)) / 3.4) + 1),
} as const;
export type EaseName = keyof typeof EASINGS | "spring";
export const EASE_NAMES = [...Object.keys(EASINGS), "spring"] as unknown as [EaseName, ...EaseName[]];

/** Resorte: `bounce` 0 (sin rebote, amortiguado crítico) a 0,6 (rebota bastante). */
export const springSchema = z.object({ type: z.literal("spring"), bounce: z.number().min(0).max(0.7).default(0.3) });
export type Spring = z.infer<typeof springSchema>;
export const easeSchema = z.union([z.enum(EASE_NAMES), springSchema]);
export type Ease = EaseName | Spring;

/**
 * Respuesta de un resorte amortiguado de 0 a 1 en el tiempo normalizado p (el tramo dura lo que el resorte tarda
 * en asentarse a la vista). Se corrige el pequeño resto final para que en p = 1 valga exactamente 1.
 */
export function spring(p: number, bounce = 0.3): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const zeta = Math.max(0.05, 1 - bounce);
  // Unas 1,1 oscilaciones visibles en el tramo: con ω0 = 2π·1,1 el resorte se asienta antes de p = 1.
  const w0 = 2 * Math.PI * 1.1;
  const x = (t: number) => {
    if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  };
  const end = x(1);
  return x(p) + (1 - end) * p ** 4;
}

const springCache = new Map<number, Float64Array>();
/** El resorte precalculado (mismo resultado, más rápido cuadro a cuadro). */
function springFast(p: number, bounce: number): number {
  const key = Math.round(bounce * 1000);
  let table = springCache.get(key);
  if (!table) {
    table = new Float64Array(513);
    for (let i = 0; i <= 512; i++) table[i] = spring(i / 512, bounce);
    springCache.set(key, table);
  }
  const f = clamp01(p) * 512;
  const i = Math.floor(f);
  if (i >= 512) return table[512]!;
  return table[i]! + (table[i + 1]! - table[i]!) * (f - i);
}

export function applyEase(ease: Ease | undefined, p: number): number {
  const q = clamp01(p);
  if (!ease) return EASINGS.easeOutCubic(q);
  if (typeof ease === "string") {
    if (ease === "spring") return springFast(q, 0.3);
    return EASINGS[ease](q);
  }
  return springFast(q, ease.bounce ?? 0.3);
}
