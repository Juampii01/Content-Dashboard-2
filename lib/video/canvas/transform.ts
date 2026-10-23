/**
 * Lienzo de la revisión: dónde va y cómo entra y sale lo que se ve sobre el video (gráficos con la marca, los elementos
 * movibles de los efectos y los subtítulos).
 *
 * - `transform`: desplazamiento del centro en fracción del ancho y del alto del cuadro de salida, tamaño (multiplicador)
 *   y, donde aplica, rotación en grados. Se aplica alrededor del centro del elemento tal como lo ubica su diseño.
 * - `anim`: entrada y salida ("aparecer", "deslizar_arriba", "deslizar_lado", "pop", "escribir", "ninguna") con su
 *   duración. La opacidad es siempre una rampa lineal (así el worker la hace con el `fade` de ffmpeg); el movimiento,
 *   la escala y el revelado los dibuja el motor (el mismo en la vista previa y en el render).
 *
 * Una sola fuente de verdad: la vista previa, el motor de gráficos, el motor de efectos y lo que se manda al worker usan
 * estas funciones. Sin los campos, todo se ve y se renderiza como antes. Sin servidor ni navegador.
 */
import { z } from "zod";
import { ANIM_KINDS, DEFAULT_ANIM, isIdentity, sameAnim, type Anim, type AnimKind, type Place, type Transform } from "./place-math";

// Reexportaciones con nombre (sin `export *`, así también se importa desde CommonJS en las pruebas).
export {
  ANIM_KINDS,
  ANIM_MOTION,
  DEFAULT_ANIM,
  IDENTITY_TRANSFORM,
  NEUTRAL_STATE,
  animDurations,
  animFades,
  animState,
  applyAnimGeometry,
  applyTransform,
  isIdentity,
  rampAlpha,
  safeMargins,
  sameAnim,
  snapBox,
  transformedBox,
} from "./place-math";
export type { Anim, AnimCtx, AnimKind, AnimState, Box, Place, PlacedBox, SnapGuide, Transform, TransformCtx } from "./place-math";

// ─── Forma ────────────────────────────────────────────────────────────────

export const TRANSFORM_LIMITS = { offset: 0.5, scaleMin: 0.4, scaleMax: 2.5, rotation: 45 } as const;

export const transformSchema = z.object({
  /** Corrimiento del centro: fracción del ancho (x) y del alto (y) del video final. */
  x: z.number().min(-TRANSFORM_LIMITS.offset).max(TRANSFORM_LIMITS.offset).default(0),
  y: z.number().min(-TRANSFORM_LIMITS.offset).max(TRANSFORM_LIMITS.offset).default(0),
  /** Tamaño respecto del de diseño (1). */
  scale: z.number().min(TRANSFORM_LIMITS.scaleMin).max(TRANSFORM_LIMITS.scaleMax).default(1),
  /** Grados, en sentido horario (solo gráficos y efectos). */
  rotation: z.number().min(-TRANSFORM_LIMITS.rotation).max(TRANSFORM_LIMITS.rotation).optional(),
});
export type TransformOut = z.output<typeof transformSchema>;
export type TransformInput = z.input<typeof transformSchema>;

export const ANIM_LIMITS = { min: 0.05, max: 2 } as const;

export const animSchema = z.object({
  in: z.enum(ANIM_KINDS).default("aparecer"),
  out: z.enum(ANIM_KINDS).default("aparecer"),
  /** Segundos de la entrada y de la salida. */
  inDur: z.number().min(ANIM_LIMITS.min).max(ANIM_LIMITS.max).default(0.2),
  outDur: z.number().min(ANIM_LIMITS.min).max(ANIM_LIMITS.max).default(0.2),
});

export type AnimInput = z.input<typeof animSchema>;

/** Lo que se le agrega a un elemento: dónde va y cómo entra y sale. */
export const placeSchema = z.object({ transform: transformSchema.optional(), anim: animSchema.optional() });

export const ANIM_LABELS: Record<AnimKind, { label: string; hint: string }> = {
  aparecer: { label: "Aparecer", hint: "Se funde suave." },
  deslizar_arriba: { label: "Deslizar hacia arriba", hint: "Sube un poco mientras aparece." },
  deslizar_lado: { label: "Deslizar de costado", hint: "Entra desde la izquierda y sale hacia la derecha." },
  pop: { label: "Pop", hint: "Crece con un pequeño rebote." },
  escribir: { label: "Escribir", hint: "Se revela de izquierda a derecha, como si se escribiera." },
  ninguna: { label: "Sin animación", hint: "Corte seco: está o no está." },
};

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo);

/** Deja una transformación dentro de los límites; undefined si es la de siempre (así el plan no crece de más). */
export function cleanTransform(raw: unknown, opts: { rotation?: boolean } = {}): Transform | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const L = TRANSFORM_LIMITS;
  const out: Transform = {
    x: r4(clamp(num(r.x, 0), -L.offset, L.offset)),
    y: r4(clamp(num(r.y, 0), -L.offset, L.offset)),
    scale: r4(clamp(num(r.scale, 1), L.scaleMin, L.scaleMax)),
  };
  const rot = opts.rotation === false ? 0 : r4(clamp(num(r.rotation, 0), -L.rotation, L.rotation));
  if (rot) out.rotation = rot;
  return isIdentity(out) ? undefined : out;
}

/** Deja una animación válida; undefined si es la de siempre (aparecer 0,2 s / 0,2 s). */
export function cleanAnim(raw: unknown): Anim | undefined {
  const parsed = animSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const a = { ...parsed.data, inDur: r4(parsed.data.inDur), outDur: r4(parsed.data.outDur) };
  return sameAnim(a, DEFAULT_ANIM) ? undefined : a;
}

/** El lugar completo (transform y anim limpios) o undefined si no cambia nada. */
export function cleanPlace(raw: { transform?: unknown; anim?: unknown } | null | undefined, opts: { rotation?: boolean; anim?: boolean } = {}): Place | undefined {
  if (!raw) return undefined;
  const transform = cleanTransform(raw.transform, opts);
  const anim = opts.anim === false ? undefined : cleanAnim(raw.anim);
  if (!transform && !anim) return undefined;
  return { ...(transform ? { transform } : {}), ...(anim ? { anim } : {}) };
}
