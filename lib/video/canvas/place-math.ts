/**
 * Cálculos del lienzo de la revisión (sin Zod, para que los motores empaquetados del worker sigan livianos): caja
 * transformada, aplicar la transformación y la animación a un contexto Canvas 2D, rampas de opacidad e imán de guías.
 * Las formas (Zod) y la limpieza están en ./transform.ts, que reexporta todo esto.
 */

export type Transform = { x: number; y: number; scale: number; rotation?: number };
export const ANIM_KINDS = ["aparecer", "deslizar_arriba", "deslizar_lado", "pop", "escribir", "ninguna"] as const;
export type AnimKind = (typeof ANIM_KINDS)[number];
export type Anim = { in: AnimKind; out: AnimKind; inDur: number; outDur: number };
export type Place = { transform?: Transform; anim?: Anim };

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 };
/** Igual al fundido de 0,2 s de siempre de los gráficos. */
export const DEFAULT_ANIM: Anim = { in: "aparecer", out: "aparecer", inDur: 0.2, outDur: 0.2 };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo);

export const isIdentity = (t: Transform | null | undefined) => !t || (Math.abs(t.x) < 1e-4 && Math.abs(t.y) < 1e-4 && Math.abs(t.scale - 1) < 1e-4 && !t.rotation);
export const sameAnim = (a: Anim, b: Anim) => a.in === b.in && a.out === b.out && Math.abs(a.inDur - b.inDur) < 1e-4 && Math.abs(a.outDur - b.outDur) < 1e-4;

// ─── Geometría ────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };
/** Caja ya transformada: centro, tamaño y rotación (grados), en píxeles del video final. */
export type PlacedBox = { cx: number; cy: number; w: number; h: number; rotation: number };

/** Dónde queda la caja de diseño con la transformación (sin animación). */
export function transformedBox(box: Box, t: Transform | null | undefined, W: number, H: number): PlacedBox {
  const tr = t ?? IDENTITY_TRANSFORM;
  return { cx: box.x + box.w / 2 + tr.x * W, cy: box.y + box.h / 2 + tr.y * H, w: box.w * tr.scale, h: box.h * tr.scale, rotation: tr.rotation ?? 0 };
}

/** Contexto mínimo para transformar (Canvas 2D del navegador y skia-canvas). */
export type TransformCtx = { translate(x: number, y: number): void; rotate(a: number): void; scale(x: number, y: number): void };

/** Aplica la transformación alrededor del centro de la caja de diseño. */
export function applyTransform(ctx: TransformCtx, t: Transform | null | undefined, box: Box, W: number, H: number): void {
  if (!t || isIdentity(t)) return;
  const px = box.x + box.w / 2;
  const py = box.y + box.h / 2;
  ctx.translate(px + t.x * W, py + t.y * H);
  if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
  if (t.scale !== 1) ctx.scale(t.scale, t.scale);
  ctx.translate(-px, -py);
}

// ─── Animación ────────────────────────────────────────────────────────────

export type AnimState = {
  /** Opacidad (rampa lineal). */
  alpha: number;
  /** Corrimiento por la animación, en fracción del ancho / alto del video. */
  dx: number;
  dy: number;
  /** Escala por la animación (1 = asentado). */
  scale: number;
  /** Parte visible de izquierda a derecha (1 = todo). */
  reveal: number;
};

export const NEUTRAL_STATE: AnimState = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };

/** Cuánto se mueve cada animación (fracción del cuadro) y desde qué escala crece el pop. */
export const ANIM_MOTION = { slideUp: 0.06, slideSide: 0.08, popFrom: 0.6 } as const;

/** Duraciones reales de la entrada y la salida para un tramo: cada una como mucho el 45 % del tramo. */
export function animDurations(anim: Anim, duration: number): { inDur: number; outDur: number } {
  const cap = Math.max(0, duration) * 0.45;
  return { inDur: r4(anim.in === "ninguna" ? 0 : Math.min(anim.inDur, cap)), outDur: r4(anim.out === "ninguna" ? 0 : Math.min(anim.outDur, cap)) };
}

/** Parte de la duración de cada animación que es fundido (lineal). */
const FADE_SHARE: Record<AnimKind, number> = { aparecer: 1, deslizar_arriba: 0.6, deslizar_lado: 0.6, pop: 0.4, escribir: 0, ninguna: 0 };

/** Rampas lineales de opacidad (segundos de fundido de entrada y de salida): lo que hace ffmpeg en el render. */
export function animFades(anim: Anim, duration: number): { fadeIn: number; fadeOut: number } {
  const d = animDurations(anim, duration);
  return { fadeIn: r4(d.inDur * FADE_SHARE[anim.in]), fadeOut: r4(d.outDur * FADE_SHARE[anim.out]) };
}

/** Opacidad con rampas lineales (igual que `fade=t=in/out:alpha=1` de ffmpeg). */
export function rampAlpha(fadeIn: number, fadeOut: number, t: number, duration: number): number {
  let a = 1;
  if (fadeIn > 0) a = Math.min(a, t / fadeIn);
  if (fadeOut > 0) a = Math.min(a, (duration - t) / fadeOut);
  return clamp(a, 0, 1);
}

const easeOutCubic = (p: number) => 1 - (1 - clamp(p, 0, 1)) ** 3;
const easeInCubic = (p: number) => clamp(p, 0, 1) ** 3;
const backOut = (p: number, k = 1.70158) => {
  const q = clamp(p, 0, 1) - 1;
  return 1 + (k + 1) * q ** 3 + k * q ** 2;
};

/** Estado de la animación en el instante t (segundos desde que empieza el tramo). */
export function animState(anim: Anim | null | undefined, t: number, duration: number): AnimState {
  if (!anim) return NEUTRAL_STATE;
  const d = animDurations(anim, duration);
  const f = animFades(anim, duration);
  const s: AnimState = { alpha: rampAlpha(f.fadeIn, f.fadeOut, t, duration), dx: 0, dy: 0, scale: 1, reveal: 1 };
  if (d.inDur > 0 && t < d.inDur) {
    const p = clamp(t / d.inDur, 0, 1);
    const e = easeOutCubic(p);
    if (anim.in === "deslizar_arriba") s.dy += (1 - e) * ANIM_MOTION.slideUp;
    else if (anim.in === "deslizar_lado") s.dx -= (1 - e) * ANIM_MOTION.slideSide;
    else if (anim.in === "pop") s.scale *= ANIM_MOTION.popFrom + (1 - ANIM_MOTION.popFrom) * backOut(p);
    else if (anim.in === "escribir") s.reveal = Math.min(s.reveal, p);
  }
  const left = duration - t;
  if (d.outDur > 0 && left < d.outDur) {
    const q = clamp(1 - left / d.outDur, 0, 1);
    const e = easeInCubic(q);
    if (anim.out === "deslizar_arriba") s.dy -= e * ANIM_MOTION.slideUp;
    else if (anim.out === "deslizar_lado") s.dx += e * ANIM_MOTION.slideSide;
    else if (anim.out === "pop") s.scale *= 1 - (1 - ANIM_MOTION.popFrom) * e;
    else if (anim.out === "escribir") s.reveal = Math.min(s.reveal, 1 - q);
  }
  return { alpha: r4(s.alpha), dx: r4(s.dx), dy: r4(s.dy), scale: r4(s.scale), reveal: r4(clamp(s.reveal, 0, 1)) };
}

/** Contexto para dibujar la animación (además de transformar, recortar el revelado). */
export type AnimCtx = TransformCtx & { beginPath(): void; rect(x: number, y: number, w: number, h: number): void; clip(): void };

/**
 * Aplica el movimiento, la escala y el revelado de la animación alrededor de la caja (la opacidad la maneja quien
 * dibuja). `pad` agranda el recorte del revelado para no cortar sombras.
 */
export function applyAnimGeometry(ctx: AnimCtx, st: AnimState, box: Box, W: number, H: number, pad = 0): void {
  if (st.dx || st.dy) ctx.translate(st.dx * W, st.dy * H);
  if (st.scale !== 1) {
    const px = box.x + box.w / 2;
    const py = box.y + box.h / 2;
    ctx.translate(px, py);
    ctx.scale(st.scale, st.scale);
    ctx.translate(-px, -py);
  }
  if (st.reveal < 1) {
    ctx.beginPath();
    ctx.rect(box.x - pad, box.y - pad, (box.w + pad * 2) * st.reveal, box.h + pad * 2);
    ctx.clip();
  }
}

// ─── Guías ───────────────────────────────────────────────────────────────

/**
 * Márgenes seguros del cuadro (fracciones): en vertical lejos de los bordes, del encabezado y de la interfaz de Reels de
 * abajo; en horizontal, el margen de títulos. Los mismos de la zona segura del motor de gráficos.
 */
export function safeMargins(format: "9:16" | "16:9"): { left: number; right: number; top: number; bottom: number } {
  return format === "9:16" ? { left: 0.065, right: 0.935, top: 0.065, bottom: 0.84 } : { left: 0.05, right: 0.95, top: 0.06, bottom: 0.93 };
}

export type SnapGuide = { axis: "x" | "y"; at: number; kind: "center" | "safe" };

/**
 * Imanta el centro de una caja (en fracciones del cuadro) al centro del cuadro y sus bordes a los márgenes seguros.
 * `threshold` es la distancia (fracción) desde la que se imanta. Devuelve la corrección y las guías que se ven.
 */
export function snapBox(
  box: { cx: number; cy: number; w: number; h: number },
  format: "9:16" | "16:9",
  threshold = 0.012,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const m = safeMargins(format);
  const guides: SnapGuide[] = [];
  const pick = (axis: "x" | "y", candidates: { delta: number; at: number; kind: SnapGuide["kind"] }[]) => {
    const best = candidates.filter((c) => Math.abs(c.delta) <= threshold).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
    if (!best) return 0;
    guides.push({ axis, at: best.at, kind: best.kind });
    return best.delta;
  };
  const dx = pick("x", [
    { delta: 0.5 - box.cx, at: 0.5, kind: "center" },
    { delta: m.left - (box.cx - box.w / 2), at: m.left, kind: "safe" },
    { delta: m.right - (box.cx + box.w / 2), at: m.right, kind: "safe" },
  ]);
  const dy = pick("y", [
    { delta: 0.5 - box.cy, at: 0.5, kind: "center" },
    { delta: m.top - (box.cy - box.h / 2), at: m.top, kind: "safe" },
    { delta: m.bottom - (box.cy + box.h / 2), at: m.bottom, kind: "safe" },
  ]);
  return { dx, dy, guides };
}
