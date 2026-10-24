/**
 * Composiciones en el plan de edición: forma (Zod), tramos en el video final y el "spec" que dibujan la vista previa y
 * el worker (mismo motor de efectos: kind "composition"). Sin servidor.
 */
import { z } from "zod";
import { SFX_NAMES, type SfxName } from "../sfx-library";
import { outputRange, type Timeline } from "../timeline";
import { FPS, type VideoFormat } from "../types";
import { OUTPUT, type Box, type FxBrand, type FxSpec } from "../fx/compile";
import { COMPOS_LIMITS, type ComposAsset, type ComposEnvData } from "./contract";

const sfxName = z.enum(SFX_NAMES as [SfxName, ...SfxName[]]);

/** Imagen generada con IA para una composición (sin texto: el texto lo dibuja la composición). */
export const composImageSchema = z.object({
  id: z.string().regex(/^g[0-9a-z]{1,20}$/),
  /** Clave en el almacenamiento público (editor/<proyecto>/compos/…). */
  key: z.string().max(300),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  prompt: z.string().max(600),
  /** Zona importante de la imagen (0…1), la que eligió Claude mirándola. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1), label: z.string().max(80).optional() }).optional(),
  /** Lo que Claude vio en la imagen (zonas, colores), para escribir la animación. */
  notes: z.string().max(600).optional(),
});
export type ComposImage = z.infer<typeof composImageSchema>;

export const composParamSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/),
  label: z.string().min(1).max(40),
  value: z.string().max(160),
});

export const compositionSchema = z.object({
  id: z.string().min(1).max(40),
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  /** Nombre corto para la línea de tiempo ("Cifra que gira en 3D"). */
  name: z.string().min(1).max(60),
  code: z.string().min(1).max(COMPOS_LIMITS.codeChars),
  /** Textos editables (los lee el código en env.params). */
  params: z.array(composParamSchema).max(12),
  /** Sonidos de la biblioteca en momentos de la composición (segundos desde que empieza). */
  sounds: z.array(z.object({ at: z.number().min(0).max(COMPOS_LIMITS.maxSeconds), name: sfxName, gain: z.number().min(-30).max(0).default(-14) })).max(8).optional(),
  /** Oculta los subtítulos mientras dura (la composición ya muestra el texto). */
  hide_captions: z.boolean().optional(),
  why: z.string().max(300).optional(),
  /** Capa (orden de dibujo): más alta, más arriba. Sin el campo, 0. Ver lib/video/layers.ts. */
  layer: z.number().int().min(0).max(999).optional(),
  source: z.enum(["copy", "director", "user"]),
  /** Momento de la receta de la referencia que copia (si viene de "Copiar edición"). */
  moment: z.string().max(40).optional(),
  /** Parecido a la referencia (0–100) y qué no se pudo. */
  match: z.object({ score: z.number().min(0).max(100), note: z.string().max(300) }).optional(),
  /** Familias visuales (para rotar entre videos): "texto-letra-a-letra", "tarjeta-3d"… */
  tags: z.array(z.string().max(40)).max(6).optional(),
  images: z.array(composImageSchema).max(4).optional(),
  /** Huella del código que pasó la validación (lib/video/compos/validate.ts). */
  checked: z.string().max(40).optional(),
  /** Pedido de la persona que la creó o la cambió por última vez. */
  request: z.string().max(600).optional(),
});
export type Composition = z.infer<typeof compositionSchema>;

export const MAX_COMPOSITIONS = 24;
export const compositionListSchema = z.array(compositionSchema).max(MAX_COMPOSITIONS);

// ─── Tramos ──────────────────────────────────────────────────────────────

/** `layer`: capa de la composición (lib/video/layers.ts). */
export type ComposSegment = { id: string; start: number; end: number; item: Composition; layer?: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const snap = (t: number) => Math.round(t * FPS) / FPS;

/** Tramos de las composiciones en el video final (como los efectos: dentro del video; se pueden pisar, van en capas). */
export function composSegments(timeline: Pick<Timeline, "words" | "duration">, items: Composition[]): ComposSegment[] {
  const out: ComposSegment[] = [];
  const placed = items
    .map((item) => ({ item, range: outputRange(timeline, item.from_word, item.to_word) }))
    .filter((x): x is { item: Composition; range: { start: number; end: number } } => Boolean(x.range))
    .sort((a, b) => a.range.start - b.range.start);
  for (const { item, range } of placed) {
    let start = Math.max(0, range.start - 0.05);
    let end = Math.min(timeline.duration, range.end + 0.15);
    if (end - start > COMPOS_LIMITS.maxSeconds) end = start + COMPOS_LIMITS.maxSeconds;
    if (end - start < 0.8) end = Math.min(timeline.duration, start + 0.8);
    start = snap(start);
    end = snap(end);
    if (end - start < COMPOS_LIMITS.minSeconds) continue;
    out.push({ id: item.id, start: round3(start), end: round3(end), item, layer: item.layer ?? 0 });
  }
  return out;
}

/** ¿Usa el recorte de la persona? (el worker solo arma la máscara si hace falta) */
export const needsMask = (code: string) => /\b(drawPerson|env\.person|silhouette)\b/.test(code);
/** ¿Usa las imágenes permitidas? */
export const usesAssets = (code: string) => /\benv\.assets\b/.test(code);

/** Franja de los subtítulos en el video final (aproximada al estilo de siempre: abajo del centro). */
export function captionBand(format: VideoFormat, visible: boolean): ComposEnvData["captions"] {
  const { h: H } = OUTPUT[format];
  return format === "9:16" ? { y: Math.round(H * 0.6), h: Math.round(H * 0.17), visible } : { y: Math.round(H * 0.76), h: Math.round(H * 0.16), visible };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Valores de los textos editables. */
export const paramValues = (item: Pick<Composition, "params">): Record<string, string> => Object.fromEntries(item.params.map((p) => [p.key, p.value]));

/** Datos de `env` de una composición en un tramo (los mismos en la vista previa y en el render). */
export function composEnv(input: {
  item: Composition;
  start: number;
  end: number;
  timeline: Pick<Timeline, "words">;
  format: VideoFormat;
  brand: FxBrand;
  face: Box;
  captionsVisible: boolean;
  /** Miniaturas de tus reels disponibles (cantidad y títulos). */
  thumbs?: { title: string }[];
}): ComposEnvData {
  const { item, start, end } = input;
  const { w: W, h: H } = OUTPUT[input.format];
  const duration = round3(end - start);
  const words = input.timeline.words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({ text: w.text, t0: round3(Math.max(0, w.start - start)), t1: round3(Math.min(duration, w.end - start)), strong: w.emphasis }));
  const assets: ComposAsset[] = [
    ...(item.images ?? []).map((g) => ({ id: g.id, width: g.width, height: g.height, kind: "image" as const, title: g.focus?.label ?? g.prompt.slice(0, 60) })),
    ...(usesAssets(item.code) ? (input.thumbs ?? []).slice(0, 6).map((t, i) => ({ id: `t${i}`, width: 1080, height: 1920, kind: "thumb" as const, title: t.title.slice(0, 60) })) : []),
  ];
  return {
    width: W,
    height: H,
    duration,
    seed: seedOf(item.id),
    words,
    params: paramValues(item),
    brand: { accent: input.brand.accent, bg: input.brand.bg, surface: input.brand.surface, ink: input.brand.text, muted: input.brand.muted, accentText: input.brand.accentText, display: input.brand.font === "montserrat" ? "Montserrat" : "Inter" },
    face: input.face,
    captions: captionBand(input.format, input.captionsVisible && !item.hide_captions),
    mask: needsMask(item.code),
    assets,
  };
}

/** El spec que dibuja el motor de efectos (kind "composition"). */
export function compileComposition(input: Parameters<typeof composEnv>[0]): FxSpec {
  const env = composEnv(input);
  const { w: W, h: H } = OUTPUT[input.format];
  const b = input.brand;
  return {
    v: 1,
    id: input.item.id,
    kind: "composition",
    seed: env.seed,
    start: input.start,
    end: input.end,
    duration: env.duration,
    format: input.format,
    width: W,
    height: H,
    text: input.item.name,
    items: [],
    kicker: "",
    accent: b.accent,
    bg: b.bg,
    surface: b.surface,
    ink: b.text,
    muted: b.muted,
    accentText: b.accentText,
    display: b.font,
    face: input.face,
    words: env.words.map((w) => ({ t0: w.t0, t1: w.t1, text: w.text, stop: false, strong: w.strong })),
    marks: [],
    cut: null,
    thumbs: env.assets.map((a) => a.id),
    cards: [],
    mask: env.mask,
    compos: { code: input.item.code, env },
  };
}

/** Tramos (segundos del video final) donde una composición oculta los subtítulos. */
export const composCaptionHides = (segments: ComposSegment[]) => segments.filter((s) => s.item.hide_captions).map((s) => ({ start: s.start, end: s.end }));

/** Sonidos de las composiciones en segundos del video final (su punto fuerte cae en `at`). */
export const composSounds = (segments: ComposSegment[]) => segments.flatMap((s) => (s.item.sounds ?? []).filter((x) => x.at <= s.end - s.start).map((x) => ({ name: x.name, hitAt: round3(s.start + x.at), gain: x.gain })));

/** Composiciones que manda el navegador: forma válida y dentro de la transcripción (se pueden pisar: van en capas). */
export function cleanCompositions(raw: unknown[], wordCount: number): Composition[] {
  const out: Composition[] = [];
  const parsed = raw.map((r) => compositionSchema.safeParse(r)).flatMap((p) => (p.success ? [p.data] : []));
  for (const c of parsed.sort((a, b) => a.from_word - b.from_word).slice(0, MAX_COMPOSITIONS)) {
    const from = Math.min(c.from_word, c.to_word);
    const to = Math.max(c.from_word, c.to_word);
    if (to >= wordCount) continue;
    out.push({ ...c, from_word: from, to_word: to });
  }
  return out;
}

let counter = 0;
export const newComposId = () => `cm${Date.now().toString(36)}${(counter++).toString(36)}`;
