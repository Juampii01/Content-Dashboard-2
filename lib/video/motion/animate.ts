/**
 * Comportamientos de alto nivel: generan los keyframes de una animación con buen criterio por defecto (duración,
 * distancia y curva distintas según el tipo de movimiento). Los usan los componentes y las capas del esquema.
 *
 * Reglas de dirección de animación:
 * - Lo que se desplaza usa curvas que frenan fuerte (expo/quint); lo que crece, resorte; lo que se dibuja, easeInOut.
 * - Las distancias son cortas (24–60 px a 1080) y las opacidades llegan antes que el movimiento.
 * - Nada aparece de golpe: hasta lo instantáneo tiene 0,15 s de fundido.
 */
import { z } from "zod";
import { easeSchema, type Ease } from "./easing";
import { addKeys, type Key, type Node, type Prop } from "./nodes";

export type Dir = "left" | "right" | "up" | "down";

type Base = { at: number; dur?: number; ease?: Ease };

/** Aparece (solo opacidad). */
export function fadeIn<T extends Node>(n: T, { at, dur = 0.35, ease = "easeOutCubic" }: Base): T {
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Sube un poco mientras aparece: el movimiento base de los textos. */
export function fadeUp<T extends Node>(n: T, { at, dur = 0.6, dist = 40, ease = "easeOutExpo" }: Base & { dist?: number }): T {
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + dur * 0.55, v: 1, ease: "easeOutCubic" }]);
  addKeys(n, "y", [{ t: at, v: dist }, { t: at + dur, v: 0, ease }]);
  return n;
}

/** Entra deslizándose desde un costado (la dirección es hacia dónde se mueve). */
export function slide<T extends Node>(n: T, { at, dur = 0.6, dist = 80, dir = "right", ease = "easeOutExpo" }: Base & { dist?: number; dir?: Dir }): T {
  const prop: Prop = dir === "left" || dir === "right" ? "x" : "y";
  const sign = dir === "right" || dir === "down" ? -1 : 1;
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + dur * 0.5, v: 1, ease: "easeOutCubic" }]);
  addKeys(n, prop, [{ t: at, v: sign * dist }, { t: at + dur, v: 0, ease }]);
  return n;
}

/** Crece con un resorte (insignias, íconos, números). */
export function pop<T extends Node>(n: T, { at, dur = 0.6, from = 0.6, bounce = 0.35 }: Base & { from?: number; bounce?: number }): T {
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + Math.min(0.2, dur * 0.4), v: 1, ease: "easeOutCubic" }]);
  addKeys(n, "scale", [{ t: at, v: from }, { t: at + dur, v: 1, ease: { type: "spring", bounce } }]);
  return n;
}

/** Se acerca desde un poco más grande (palabras clave, títulos enormes). */
export function zoomIn<T extends Node>(n: T, { at, dur = 0.7, from = 1.14, ease = "easeOutExpo" }: Base & { from?: number }): T {
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + dur * 0.45, v: 1, ease: "easeOutCubic" }]);
  addKeys(n, "scale", [{ t: at, v: from }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Cortina: se descubre desde un borde. */
export function wipe<T extends Node>(n: T, { at, dur = 0.55, dir = "right", ease = "easeInOutExpo" }: Base & { dir?: Dir | "center" }): T {
  n.reveal = dir === "right" ? "left" : dir === "left" ? "right" : dir === "down" ? "up" : dir === "up" ? "down" : "center";
  addKeys(n, "reveal", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Trazo que se dibuja (líneas, flechas, íconos, subrayados, tildes, arcos). */
export function draw<T extends Node>(n: T, { at, dur = 0.7, ease = "easeInOut", fade = true }: Base & { fade?: boolean }): T {
  addKeys(n, "draw", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  if (fade) addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + 0.08, v: 1, ease: "linear" }]);
  return n;
}

/** Relleno que avanza (barras, niveles, anillos). */
export function fill<T extends Node>(n: T, { at, dur = 0.8, ease = "easeOutQuint", from = 0 }: Base & { from?: number }): T {
  addKeys(n, "fill", [{ t: at, v: from }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Número que cuenta (la pista va de 0 a 1 y el formato hace el resto). */
export function countUp<T extends Node>(n: T, { at, dur = 1.1, ease = "easeOutExpo" }: Base): T {
  addKeys(n, "value", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Máquina de escribir: las letras aparecen de a una (velocidad por defecto: 28 letras por segundo). */
export function typewriter<T extends Node>(n: T, { at, dur, chars = 30, ease = "linear" }: Base & { chars?: number }): T {
  const d = dur ?? Math.max(0.4, Math.min(1.6, chars / 28));
  addKeys(n, "chars", [{ t: at, v: 0 }, { t: at + d, v: 1, ease }]);
  addKeys(n, "opacity", [{ t: at, v: 0 }, { t: at + 0.05, v: 1, ease: "linear" }]);
  return n;
}

/** Marcador que barre detrás de las palabras marcadas del texto. */
export function highlight<T extends Node>(n: T, { at, dur = 0.5, ease = "easeInOutExpo" }: Base): T {
  addKeys(n, "mark", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Tachado que se dibuja. */
export function strike<T extends Node>(n: T, { at, dur = 0.45, ease = "easeInOut" }: Base): T {
  addKeys(n, "strike", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Subrayado que se dibuja. */
export function underline<T extends Node>(n: T, { at, dur = 0.5, ease = "easeInOutExpo" }: Base): T {
  addKeys(n, "underline", [{ t: at, v: 0 }, { t: at + dur, v: 1, ease }]);
  return n;
}

/** Latido sutil y repetido (llamar la atención sin distraer). */
export function pulse<T extends Node>(n: T, { at, period = 1.3, amount = 0.04, count = 2 }: { at: number; period?: number; amount?: number; count?: number }): T {
  const keys: Key[] = [{ t: at, v: 1 }];
  for (let i = 0; i < count; i++) {
    const t0 = at + i * period;
    keys.push({ t: t0 + period * 0.35, v: 1 + amount, ease: "easeInOutSine" }, { t: t0 + period, v: 1, ease: "easeInOutSine" });
  }
  addKeys(n, "scale", keys);
  n.ambient = true;
  return n;
}

/** Aplica la misma animación a varios nodos en cascada. */
export function stagger<T extends Node>(nodes: T[], each: number, fn: (n: T, at: number, i: number) => void, start = 0): T[] {
  nodes.forEach((n, i) => fn(n, start + i * each, i));
  return nodes;
}

// ─── Desde el esquema ─────────────────────────────────────────────────────

export const BEHAVIORS = ["fadeIn", "fadeUp", "slide", "pop", "zoomIn", "wipe", "draw", "fill", "countUp", "typewriter", "highlight", "strike", "underline", "pulse", "check"] as const;
export type BehaviorName = (typeof BEHAVIORS)[number];

export const behaviorSchema = z.object({
  type: z.enum(BEHAVIORS),
  /** Segundo en que empieza (desde el inicio de la escena). */
  at: z.number().min(0).max(30).default(0),
  dur: z.number().min(0.05).max(10).optional(),
  ease: easeSchema.optional(),
  /** Distancia en unidades (1080 = el lado corto). */
  dist: z.number().min(0).max(800).optional(),
  dir: z.enum(["left", "right", "up", "down", "center"]).optional(),
  /** Escala inicial (pop, zoomIn) o valor inicial del relleno. */
  from: z.number().min(0).max(3).optional(),
  bounce: z.number().min(0).max(0.7).optional(),
  /** pulse: amplitud y período. */
  amount: z.number().min(0).max(0.3).optional(),
  period: z.number().min(0.2).max(5).optional(),
  count: z.number().int().min(1).max(10).optional(),
  /** En un grupo: cascada entre hijos (segundos entre uno y otro). */
  each: z.number().min(0).max(2).optional(),
});
export type Behavior = z.infer<typeof behaviorSchema>;

/** Aplica un comportamiento del esquema a un nodo (`u` convierte unidades a píxeles). */
export function applyBehavior(n: Node, b: Behavior, u: number, at = b.at): void {
  const dist = b.dist != null ? b.dist * u : undefined;
  const common = { at, ...(b.dur != null ? { dur: b.dur } : {}), ...(b.ease ? { ease: b.ease } : {}) };
  switch (b.type) {
    case "fadeIn":
      fadeIn(n, common);
      break;
    case "fadeUp":
      fadeUp(n, { ...common, dist: dist ?? 40 * u });
      break;
    case "slide":
      slide(n, { ...common, dist: dist ?? 80 * u, dir: b.dir === "center" || !b.dir ? "right" : b.dir });
      break;
    case "pop":
      pop(n, { ...common, ...(b.from != null ? { from: b.from } : {}), ...(b.bounce != null ? { bounce: b.bounce } : {}) });
      break;
    case "zoomIn":
      zoomIn(n, { ...common, ...(b.from != null ? { from: b.from } : {}) });
      break;
    case "wipe":
      wipe(n, { ...common, dir: b.dir ?? "right" });
      break;
    case "draw":
    case "check":
      draw(n, common);
      break;
    case "fill":
      fill(n, { ...common, ...(b.from != null ? { from: b.from } : {}) });
      break;
    case "countUp":
      countUp(n, common);
      break;
    case "typewriter":
      typewriter(n, { ...common, chars: n.kind === "text" ? n.lines.reduce((a, l) => a + l.text.length, 0) : 30 });
      break;
    case "highlight":
      highlight(n, common);
      break;
    case "strike":
      strike(n, common);
      break;
    case "underline":
      underline(n, common);
      break;
    case "pulse":
      pulse(n, { at, ...(b.period != null ? { period: b.period } : {}), ...(b.amount != null ? { amount: b.amount } : {}), ...(b.count != null ? { count: b.count } : {}) });
      break;
  }
}
