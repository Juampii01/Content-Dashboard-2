/**
 * Transiciones entre tramos: se ponen en un corte del video final (entre dos tramos que quedan) y tapan el salto con un
 * movimiento, un destello o un barrido. Se dibujan con el mismo motor que los efectos (lib/video/fx/engine/transitions)
 * sobre los cuadros del video tal como quedan: la unión de tramos, el audio y la voz NO cambian (no hay fundido cruzado:
 * eso correría la voz). Lo único que puede sumar es un efecto de sonido en el corte.
 *
 * El corte se identifica por la primera palabra del tramo que entra (`at_word`), así sobrevive a otros cambios del
 * plan; si ese corte desaparece (se restauró lo cortado), la transición no se dibuja. Sin servidor.
 */
import { z } from "zod";
import { FPS, type VideoFormat } from "../types";
import type { Timeline } from "../timeline";
import { OUTPUT, type Box, type FxBrand, type FxSpec } from "./compile";

export const TRANSITION_KINDS = [
  "tr_zoom_in",
  "tr_zoom_out",
  "tr_whip",
  "tr_whip_up",
  "tr_blur",
  "tr_flash",
  "tr_flash_brand",
  "tr_fade_black",
  "tr_dip_brand",
  "tr_slide",
  "tr_slide_up",
  "tr_spin",
  "tr_glitch",
  "tr_light_leak",
  "tr_iris",
  "tr_blinds",
  "tr_pixelate",
  "tr_shake",
  "tr_diagonal",
  "tr_rgb_split",
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
export const isTransitionKind = (v: unknown): v is TransitionKind => typeof v === "string" && (TRANSITION_KINDS as readonly string[]).includes(v);

export type TransitionInfo = {
  label: string;
  description: string;
  /** Duración por defecto (segundos, centrada en el corte). */
  duration: number;
  /** Sonido que suena en el corte (lib/video/sfx). */
  sound: string;
  keywords: string;
  /** Energía: "suave" (cambio de tema tranquilo) o "fuerte" (ritmo alto). El director alterna según la densidad. */
  energy: "suave" | "fuerte";
};

export const TRANSITION_INFO: Record<TransitionKind, TransitionInfo> = {
  tr_zoom_in: { label: "Zoom de entrada", description: "La cámara entra con desenfoque y sale en el tramo siguiente.", duration: 0.6, sound: "whoosh", keywords: "zoom acercar entrar", energy: "fuerte" },
  tr_zoom_out: { label: "Zoom de salida", description: "La imagen se aleja con desenfoque y el tramo siguiente llega de lejos.", duration: 0.6, sound: "whoosh_soft", keywords: "zoom alejar salir", energy: "suave" },
  tr_whip: { label: "Barrido", description: "Un latigazo de cámara hacia un costado, con desenfoque de movimiento.", duration: 0.5, sound: "swipe", keywords: "barrido whip latigazo paneo rapido", energy: "fuerte" },
  tr_whip_up: { label: "Barrido vertical", description: "El latigazo va hacia arriba, como al deslizar en el teléfono.", duration: 0.5, sound: "swipe_up", keywords: "barrido vertical arriba deslizar", energy: "fuerte" },
  tr_blur: { label: "Desenfoque", description: "Todo se desenfoca y se vuelve a enfocar en el tramo siguiente.", duration: 0.6, sound: "air", keywords: "desenfoque blur foco suave", energy: "suave" },
  tr_flash: { label: "Destello blanco", description: "Un destello blanco tapa el corte, como un flash de cámara.", duration: 0.4, sound: "camera", keywords: "flash destello blanco camara", energy: "fuerte" },
  tr_flash_brand: { label: "Destello de marca", description: "Un destello con el color de tu marca.", duration: 0.4, sound: "sparkle", keywords: "destello color marca", energy: "fuerte" },
  tr_fade_black: { label: "Fundido a negro", description: "Baja a negro y vuelve a subir (un respiro entre partes).", duration: 0.8, sound: "none", keywords: "fundido negro pausa", energy: "suave" },
  tr_dip_brand: { label: "Fundido a tu color", description: "Baja al fondo de tu marca y vuelve.", duration: 0.8, sound: "none", keywords: "fundido color marca", energy: "suave" },
  tr_slide: { label: "Deslizamiento", description: "El tramo sale hacia un lado sobre tu color y el siguiente entra del otro.", duration: 0.6, sound: "swipe", keywords: "deslizar empujar lado slide", energy: "fuerte" },
  tr_slide_up: { label: "Deslizamiento vertical", description: "El tramo sube y el siguiente llega desde abajo.", duration: 0.6, sound: "swipe_up", keywords: "deslizar arriba vertical", energy: "fuerte" },
  tr_spin: { label: "Giro", description: "La imagen gira con desenfoque y aterriza en el tramo siguiente.", duration: 0.6, sound: "whoosh", keywords: "giro rotar spin", energy: "fuerte" },
  tr_glitch: { label: "Glitch", description: "Unos cuadros de falla digital tapan el corte.", duration: 0.4, sound: "glitch", keywords: "glitch error digital", energy: "fuerte" },
  tr_light_leak: { label: "Fuga de luz", description: "Una luz cálida de película cruza y tapa el corte.", duration: 0.9, sound: "shimmer", keywords: "luz calida pelicula", energy: "suave" },
  tr_iris: { label: "Máscara circular", description: "Un círculo se cierra sobre tu cara y se abre en el tramo siguiente.", duration: 0.7, sound: "pop", keywords: "circulo iris cerrar abrir", energy: "suave" },
  tr_blinds: { label: "Persianas", description: "Franjas de tu color se cierran y se abren como persianas.", duration: 0.7, sound: "click", keywords: "persianas franjas barras", energy: "suave" },
  tr_pixelate: { label: "Pixelado", description: "La imagen se pixela y se vuelve a armar.", duration: 0.5, sound: "digital", keywords: "pixel pixelado digital", energy: "fuerte" },
  tr_shake: { label: "Sacudida", description: "Un golpe de cámara en el corte.", duration: 0.4, sound: "impact", keywords: "sacudida golpe temblor", energy: "fuerte" },
  tr_diagonal: { label: "Barrido diagonal", description: "Una franja de tu color cruza en diagonal y revela el tramo siguiente.", duration: 0.6, sound: "swish", keywords: "diagonal barrido franja wipe", energy: "fuerte" },
  tr_rgb_split: { label: "Color separado", description: "Los colores se separan y se vuelven a juntar en el corte.", duration: 0.5, sound: "glitch_soft", keywords: "rgb colores separados", energy: "fuerte" },
};

export const TRANSITION_DURATION = { min: 0.3, max: 1.2 } as const;
export const MAX_TRANSITIONS = 24;

export const transitionItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(TRANSITION_KINDS),
  /** Primera palabra del tramo que entra (el corte). */
  at_word: z.number().int().min(0),
  duration: z.number().min(TRANSITION_DURATION.min).max(TRANSITION_DURATION.max).optional(),
  /** Con su sonido en el corte (por defecto, sí). */
  sound: z.boolean().optional(),
  why: z.string().max(300).optional(),
  source: z.enum(["director", "user"]).optional(),
});
export type TransitionItem = z.infer<typeof transitionItemSchema>;
export const transitionListSchema = z.array(transitionItemSchema).max(MAX_TRANSITIONS);

/** Cortes del video final: instante (s) y primera palabra del tramo que entra. */
export function cutPoints(timeline: Pick<Timeline, "clips">): { at: number; word: number; index: number }[] {
  const out: { at: number; word: number; index: number }[] = [];
  let acc = 0;
  timeline.clips.forEach((c, i) => {
    if (i > 0) out.push({ at: acc, word: c.firstWord, index: i });
    acc += (c.endFrame - c.startFrame) / FPS;
  });
  return out;
}

export type TransitionSegment = { id: string; start: number; end: number; cut: number; item: TransitionItem };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const snap = (t: number) => Math.round(t * FPS) / FPS;

/**
 * Dónde se dibuja cada transición (segundos del video final): centrada en su corte, sin salirse del video, sin pisar
 * otra transición ni lo que está ocupado (`blocked`: efectos y b-roll, que llevan su propia capa).
 */
export function transitionSegments(timeline: Pick<Timeline, "clips" | "duration">, items: TransitionItem[], blocked: { start: number; end: number }[] = []): TransitionSegment[] {
  const cuts = cutPoints(timeline);
  const out: TransitionSegment[] = [];
  const placed = items
    .map((item) => ({ item, cut: cuts.find((c) => c.word === item.at_word) }))
    .filter((x): x is { item: TransitionItem; cut: { at: number; word: number; index: number } } => Boolean(x.cut))
    .sort((a, b) => a.cut.at - b.cut.at);
  for (const { item, cut } of placed) {
    const d = Math.min(TRANSITION_DURATION.max, Math.max(TRANSITION_DURATION.min, item.duration ?? TRANSITION_INFO[item.kind].duration));
    let start = snap(Math.max(0, cut.at - d / 2));
    let end = snap(Math.min(timeline.duration, cut.at + d / 2));
    const prev = out[out.length - 1];
    if (prev && start < prev.end) start = prev.end;
    if (end - start < 0.2) continue;
    if (blocked.some((b) => start < b.end && b.start < end)) continue;
    start = round3(start);
    end = round3(end);
    out.push({ id: item.id, start, end, cut: round3(cut.at), item });
  }
  return out;
}

/** Spec del motor para una transición (el mismo que dibujan la vista previa y el worker). */
export function compileTransition(input: { segment: TransitionSegment; format: VideoFormat; brand: FxBrand; face: Box }): FxSpec {
  const { segment: seg, brand } = input;
  const { w: W, h: H } = OUTPUT[input.format];
  let seed = 2166136261;
  for (let i = 0; i < seg.id.length; i++) seed = Math.imul(seed ^ seg.id.charCodeAt(i), 16777619) >>> 0;
  const duration = round3(seg.end - seg.start);
  return {
    v: 1,
    id: seg.id,
    kind: seg.item.kind,
    seed,
    start: seg.start,
    end: seg.end,
    duration,
    format: input.format,
    width: W,
    height: H,
    text: "",
    items: [],
    kicker: "",
    accent: brand.accent,
    bg: brand.bg,
    surface: brand.surface,
    ink: brand.text,
    muted: brand.muted,
    accentText: brand.accentText,
    display: brand.font,
    face: input.face,
    words: [],
    marks: [],
    cut: round3(seg.cut - seg.start),
    thumbs: [],
    cards: [],
    mask: false,
  };
}

/** Transiciones que manda el navegador: forma válida, en un corte que existe, sin repetir corte. */
export function cleanTransitions(raw: unknown[], timeline: Pick<Timeline, "clips">): TransitionItem[] {
  const cuts = new Set(cutPoints(timeline).map((c) => c.word));
  const seen = new Set<number>();
  const out: TransitionItem[] = [];
  for (const r of raw) {
    const p = transitionItemSchema.safeParse(r);
    if (!p.success) continue;
    const it = p.data;
    if (!cuts.has(it.at_word) || seen.has(it.at_word)) continue;
    seen.add(it.at_word);
    out.push({ ...it, why: it.why?.slice(0, 300) });
    if (out.length >= MAX_TRANSITIONS) break;
  }
  return out;
}

/** Sonidos de las transiciones (en el corte), para sumarlos a la mezcla. */
export function transitionSounds(segments: TransitionSegment[]): { name: string; hitAt: number }[] {
  return segments.filter((s) => s.item.sound !== false && TRANSITION_INFO[s.item.kind].sound !== "none").map((s) => ({ name: TRANSITION_INFO[s.item.kind].sound, hitAt: s.cut }));
}

let counter = 0;
export const newTransitionId = () => `tr${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Orden de la galería: primero las más usadas. */
export const TRANSITION_GALLERY_ORDER: TransitionKind[] = [...TRANSITION_KINDS];

/** Buscador de transiciones (sin tildes). */
export function searchTransitions(query: string): TransitionKind[] {
  const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const terms = plain(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...TRANSITION_GALLERY_ORDER];
  return TRANSITION_GALLERY_ORDER.filter((k) => {
    const i = TRANSITION_INFO[k];
    const hay = plain(`${i.label} ${i.description} ${i.keywords} transicion`);
    return terms.every((t) => hay.includes(t));
  });
}
