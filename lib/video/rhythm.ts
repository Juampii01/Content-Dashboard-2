/**
 * Ritmo de la edición: densidad elegida, puntaje medido y "relleno de ritmo".
 *
 * - Densidad (Mi marca → Cómo salen tus videos, y por video en la revisión): Sobria, Normal o Editor de reels. Fija
 *   cada cuánto tiene que cambiar algo en pantalla, cada cuánto va un b-roll, gráfico o efecto, la pausa máxima, la
 *   fuerza de los punch-ins y las cantidades que puede usar el director.
 * - `rhythmScore`: mide sobre el video final cuántas cosas cambian cada 10 s, el hueco más largo sin cambios y qué parte
 *   del video tiene algo en pantalla. Lo ve la persona en la revisión y lo usa el crítico.
 * - `fillRhythm`: paso determinista después del director (aunque el modelo sea tímido): donde hay huecos más largos
 *   que el objetivo agrega punch-ins en palabras fuertes y, si falta, gráficos simples (palabra clave o frase sobre el
 *   video) ya sincronizados con lo que se dice; con Editor de reels, además, efecto de firma en la apertura, palabras
 *   clave en los subtítulos y muletillas fuera. Nunca tapa lo prohibido ni repite dos cosas iguales seguidas, y anota
 *   cada cosa que agregó con su "por qué".
 *
 * Sin servidor ni navegador: lo usan el director, la revisión (vista previa) y las pruebas.
 */
import { brollSegments, directorZooms, type OutputBroll, type OutputZoom } from "./effects";
import { fxSegments } from "./fx/compile";
import { FX_INFO, type FxKind } from "./fx/catalog";
import { defaultFx, newFxId, type FxItem } from "./fx/schema";
import { brollGraphicOption } from "./motion-graphics";
import { withCueWords } from "./motion-cues";
import { sceneSchema, type Layer, type MotionScene } from "./motion/schema";
import type { MotionThemeInput } from "./motion/theme";
import { normalizeRemovals } from "./plan";
import { captionText, norm } from "./text";
import { buildTimeline, removedIds, type Timeline } from "./timeline";
import type { BrollItem, EditPlan, Removal, TimedWord, VideoFormat, Word, ZoomMoment } from "./types";

// ─── Densidad ─────────────────────────────────────────────────────────────

export const DENSITIES = ["sobria", "normal", "reels"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_SETTINGS = ["auto", ...DENSITIES] as const;
export type DensitySetting = (typeof DENSITY_SETTINGS)[number];

export const DENSITY_LABELS: Record<Density, { label: string; description: string }> = {
  sobria: { label: "Sobria", description: "Pocos cambios: zooms suaves y algún gráfico donde suma. Para temas serios o largos." },
  normal: { label: "Normal", description: "Un cambio cada 4 o 5 segundos y un gráfico o b-roll cada 10 a 14." },
  reels: { label: "Editor de reels", description: "Algo cambia cada 2 a 4 segundos, un gráfico, b-roll o efecto cada 6 a 8, efecto en la apertura y pausas al mínimo." },
};

export const DENSITY_AUTO_LABEL = { label: "Según el formato", description: "Editor de reels en vertical (Reels y TikTok) y Normal en horizontal." };

export type DensityTargets = {
  /** Hueco máximo sin que nada cambie en pantalla (s). */
  changeEvery: number;
  /** Hueco máximo entre b-roll, gráficos y efectos (s); Infinity = no se rellena. */
  richEvery: number;
  /** Pausa máxima entre palabras (s). */
  pause: number;
  /** Escalas de los punch-ins, alternadas (nunca dos iguales seguidas). */
  zoomScales: number[];
  /** Separación mínima entre zooms del director (s). */
  zoomGap: number;
  /** Cada cuántos segundos va un b-roll o gráfico del director. */
  brollEvery: number;
  /** Factor sobre la cantidad de efectos de Mi marca. */
  fxFactor: number;
  /** Efecto de firma en la apertura. */
  openingFx: boolean;
  /** Una palabra clave resaltada por frase en los subtítulos. */
  emphasisPerPhrase: boolean;
  /** Muletillas y arranques en falso del detector fuera aunque el director no los corte. */
  cutFillers: boolean;
  /** Objetivo de cambios por cada 10 s (para el puntaje). */
  changesPer10: number;
  /** Parte del video con algo en pantalla (para el puntaje). */
  coverage: number;
};

export const DENSITY_TARGETS: Record<Density, DensityTargets> = {
  reels: { changeEvery: 3.2, richEvery: 7.5, pause: 0.3, zoomScales: [1.15, 1.3], zoomGap: 0, brollEvery: 7, fxFactor: 1.6, openingFx: true, emphasisPerPhrase: true, cutFillers: true, changesPer10: 3, coverage: 0.6 },
  normal: { changeEvery: 5, richEvery: 13, pause: 0.5, zoomScales: [1.08, 1.15], zoomGap: 2.5, brollEvery: 10, fxFactor: 1, openingFx: false, emphasisPerPhrase: false, cutFillers: false, changesPer10: 2, coverage: 0.4 },
  sobria: { changeEvery: 9, richEvery: Infinity, pause: 0.6, zoomScales: [1.06, 1.1], zoomGap: 5, brollEvery: 16, fxFactor: 0.5, openingFx: false, emphasisPerPhrase: false, cutFillers: false, changesPer10: 1, coverage: 0.2 },
};

export function isDensity(v: unknown): v is Density {
  return typeof v === "string" && (DENSITIES as readonly string[]).includes(v);
}

/** La densidad que se usa: la elegida, o según el formato (Editor de reels en 9:16, Normal en 16:9). */
export function densityFor(setting: DensitySetting | null | undefined, format: VideoFormat): Density {
  if (isDensity(setting)) return setting;
  return format === "9:16" ? "reels" : "normal";
}

/** Densidad de un plan (los planes de antes no la tienen: según el formato). */
export function planDensity(plan: Pick<EditPlan, "format"> & { rhythm?: { density?: unknown } | null }): Density {
  return densityFor(isDensity(plan.rhythm?.density) ? plan.rhythm!.density : "auto", plan.format);
}

// ─── Puntaje ──────────────────────────────────────────────────────────────

export type RhythmEventKind = "corte" | "zoom" | "broll" | "grafico" | "efecto" | "elemento";
export type RhythmEvent = { t: number; kind: RhythmEventKind };
export type RhythmSpan = { start: number; end: number; kind: "zoom" | "broll" | "grafico" | "efecto"; scale?: number; label?: string };

export type RhythmScore = {
  duration: number;
  /** Cambios visuales cada 10 s. */
  changesPer10: number;
  /** El hueco más largo sin cambios (s) y dónde está. */
  longestGap: { start: number; end: number; seconds: number };
  /** Parte del video (0 a 1) con algo en pantalla: zoom, b-roll, gráfico o efecto. */
  coverage: number;
  events: RhythmEvent[];
  spans: RhythmSpan[];
  /** Huecos más largos que el objetivo de la densidad. */
  gaps: { start: number; end: number; seconds: number }[];
  density: Density;
  /** 0 a 100 contra el objetivo de la densidad. */
  score: number;
  verdict: string;
};

export type RhythmInput = {
  timeline: Pick<Timeline, "clips" | "duration" | "words">;
  broll: Pick<OutputBroll, "start" | "end" | "option">[];
  zooms: Pick<OutputZoom, "start" | "end" | "scale">[];
  effects: { start: number; end: number; kind?: string }[];
  /** Instantes en que entra cada elemento de un gráfico (ítems, cifras). */
  entries?: number[];
  density: Density;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que cambia en pantalla y lo que se ve, sobre el video final. */
export function rhythmEvents(input: Omit<RhythmInput, "density">): { events: RhythmEvent[]; spans: RhythmSpan[] } {
  const events: RhythmEvent[] = [];
  const spans: RhythmSpan[] = [];
  let acc = 0;
  // Un corte cuenta como cambio cuando salta contenido (algo cortado o un bloque movido); recortar una pausa entre
  // dos palabras seguidas casi no se ve.
  for (const [i, c] of input.timeline.clips.entries()) {
    const prev = input.timeline.clips[i - 1];
    if (prev && c.firstWord !== prev.lastWord + 1) events.push({ t: acc, kind: "corte" });
    acc += (c.endFrame - c.startFrame) / 30;
  }
  for (const z of input.zooms) {
    events.push({ t: z.start, kind: "zoom" }, { t: z.end, kind: "zoom" });
    spans.push({ start: z.start, end: z.end, kind: "zoom", scale: z.scale });
  }
  for (const b of input.broll) {
    const kind = b.option.source === "graphic" ? "grafico" : "broll";
    events.push({ t: b.start, kind }, { t: b.end, kind });
    spans.push({ start: b.start, end: b.end, kind });
  }
  for (const f of input.effects) {
    events.push({ t: f.start, kind: "efecto" }, { t: f.end, kind: "efecto" });
    spans.push({ start: f.start, end: f.end, kind: "efecto", ...(f.kind ? { label: f.kind } : {}) });
  }
  for (const t of input.entries ?? []) events.push({ t, kind: "elemento" });
  const d = input.timeline.duration;
  return { events: events.filter((e) => e.t > 0.05 && e.t < d - 0.05).sort((a, b) => a.t - b.t), spans: spans.sort((a, b) => a.start - b.start) };
}

export function rhythmScore(input: RhythmInput): RhythmScore {
  const d = Math.max(0.01, input.timeline.duration);
  const { events, spans } = rhythmEvents(input);
  const target = DENSITY_TARGETS[input.density];
  // Dos cambios a menos de 0,3 s cuentan como uno (un b-roll que sale y un zoom que entra).
  const times: number[] = [];
  for (const e of events) if (!times.length || e.t - times[times.length - 1]! >= 0.3) times.push(e.t);
  const marks = [0, ...times, d];
  let longest = { start: 0, end: d, seconds: d };
  const gaps: RhythmScore["gaps"] = [];
  longest = { start: 0, end: 0, seconds: 0 };
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i]!;
    const b = marks[i + 1]!;
    // Los huecos que caen enteros dentro de un gráfico o efecto a pantalla completa no cuentan (ya hay algo nuevo).
    const covered = spans.some((s) => s.kind !== "zoom" && s.start <= a + 0.05 && s.end >= b - 0.05);
    if (covered) continue;
    if (b - a > longest.seconds) longest = { start: round2(a), end: round2(b), seconds: round2(b - a) };
    if (b - a > target.changeEvery + 0.3) gaps.push({ start: round2(a), end: round2(b), seconds: round2(b - a) });
  }
  // Cobertura: unión de los tramos con algo en pantalla (los zooms de 1,0 no cuentan).
  const ranges = spans.filter((s) => s.kind !== "zoom" || (s.scale ?? 1) > 1.01).map((s) => [Math.max(0, s.start), Math.min(d, s.end)] as const).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of ranges) {
    if (!cur || a > cur[1]) {
      if (cur) covered += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) covered += cur[1] - cur[0];
  const coverage = Math.min(1, covered / d);
  const per10 = (times.length / d) * 10;
  const pChanges = Math.min(1, per10 / target.changesPer10);
  const pGap = Math.min(1, (target.changeEvery * 1.25) / Math.max(target.changeEvery, longest.seconds));
  const pCover = Math.min(1, coverage / target.coverage);
  const score = Math.round(100 * (0.4 * pChanges + 0.35 * pGap + 0.25 * pCover));
  const verdict =
    score >= 85
      ? "Buen ritmo para esta densidad."
      : longest.seconds > target.changeEvery * 1.6
        ? `Hay un tramo de ${longest.seconds.toFixed(1).replace(".", ",")} s sin cambios: se siente lento.`
        : per10 < target.changesPer10 * 0.7
          ? "Pocos cambios en pantalla para esta densidad."
          : "Le falta algo en pantalla en varias partes.";
  return { duration: round2(d), changesPer10: round2(per10), longestGap: longest, coverage: round2(coverage), events, spans, gaps, density: input.density, score, verdict };
}

/** Puntaje de un plan tal como se va a ver (los mismos cálculos que la vista previa y el render). */
export function planRhythm(plan: EditPlan, words: Word[], duration: number, density = planDensity(plan)): RhythmScore {
  const timeline = buildTimeline(words, plan, duration);
  const broll = brollSegments(timeline, plan.broll);
  const fx = fxSegments(timeline, plan.effects ?? []);
  const zooms = directorZooms(timeline, plan.zoom_moments, [...broll, ...fx]);
  return rhythmScore({ timeline, broll, zooms, effects: fx.map((f) => ({ start: f.start, end: f.end, kind: f.item.kind })), entries: graphicEntriesOf(broll), density });
}

function graphicEntriesOf(broll: OutputBroll[]): number[] {
  const out: number[] = [];
  for (const b of broll) {
    const g = b.option.graphic as MotionScene | null | undefined;
    if (b.option.source !== "graphic" || !g || g.v !== 2) continue;
    for (const l of g.layers as Layer[]) if (l.type === "component") for (const c of l.cues ?? []) out.push(b.start + c);
  }
  return out;
}

// ─── Relleno de ritmo ─────────────────────────────────────────────────────

export type RhythmAddition = { kind: "zoom" | "grafico" | "efecto" | "resaltado" | "corte" | "pausas"; from_word: number; to_word: number; why: string };

export type FillInput = {
  words: Word[];
  duration: number;
  density: Density;
  format: VideoFormat;
  /** Rangos de palabras donde no va nada encima (lo que se muestra: producto, pantalla). */
  forbidden: { from: number; to: number; label: string }[];
  /** Tema de la marca para los gráficos nuevos. */
  theme: MotionThemeInput | null;
  /** Efectos que permite Mi marca (vacío = ninguno) y dónde se ve la cara (para los que van detrás de la persona). */
  fxAllowed?: FxKind[];
  faceWords?: Set<number> | null;
  /** Candidatos del detector (muletillas y arranques en falso) para "Editor de reels". */
  candidates?: { kind: string; from_word: number; to_word: number; confidence: number }[];
  /** Lo que no se puede cortar. */
  mustKeep?: { from: number; to: number }[];
  /** Al cambiar la densidad en la revisión: lo agregado antes por el ritmo se quita y se vuelve a calcular. */
  replace?: boolean;
};

export type FillResult = { plan: EditPlan; added: RhythmAddition[] };

const NEG = /^(no|nunca|nadie|nada|jamas|ninguno|ninguna|tampoco|sin)$/;
const NUMW = /^(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|mil|millon|millones|doble|triple|mitad|porciento)$/;
const STOP = new Set("el la los las un una unos unas de del al a en y o u que con por para es son se te tu tus mi mis su sus lo le les como pero si ya muy mas este esta esto ese esa eso hay fue ser estar tienes tiene tengo hace hacer cuando donde porque yo me nos todo toda todos vos sos tenes".split(" "));

/** Puntaje de "fuerza" de una palabra: cifras, negaciones, resaltadas, verbos en gerundio y palabras largas. */
export function wordStrength(text: string, emphasized = false): number {
  const w = norm(text);
  if (!w) return 0;
  if (/\d/.test(text) || NUMW.test(w)) return 10;
  if (NEG.test(w)) return 8;
  if (emphasized) return 7;
  if (STOP.has(w)) return 0;
  return Math.min(6, w.length / 2) + (/(ando|endo|iendo)$/.test(w) ? 1 : 0);
}

type Clause = { from: number; to: number; start: number; end: number; ids: number[] };

/** Frases cortas del video final (por puntos, comas y pausas; las largas se parten): la unidad del ritmo. */
export function clausesOf(timed: TimedWord[], words: Word[]): Clause[] {
  const out: Clause[] = [];
  let cur: TimedWord[] = [];
  const close = () => {
    if (!cur.length) return;
    out.push({ from: cur[0]!.id, to: cur[cur.length - 1]!.id, start: cur[0]!.start, end: cur[cur.length - 1]!.end, ids: cur.map((w) => w.id) });
    cur = [];
  };
  for (let i = 0; i < timed.length; i++) {
    const w = timed[i]!;
    const prev = cur[cur.length - 1];
    if (prev && (w.id !== prev.id + 1 || w.start - prev.end > 0.35 || w.end - cur[0]!.start > 3.4)) close();
    cur.push(w);
    const raw = words[w.id]?.text ?? w.text;
    if (w.stop || /[,;:]$/.test(raw.trim())) close();
  }
  close();
  return out;
}

const overlapsW = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;

/** Lo que agregó el ritmo antes (se reconoce por su "por qué"). */
export const RHYTHM_TAG = "Ritmo:";
const isRhythm = (why: string | undefined) => Boolean(why?.startsWith(RHYTHM_TAG));

/** Componente principal de un gráfico (para no repetir dos iguales seguidos). */
function componentOf(b: BrollItem): string {
  const g = b.choice?.graphic as MotionScene | null | undefined;
  if (!g || g.v !== 2) return b.choice?.source ?? "";
  const c = (g.layers as Layer[]).find((l) => l.type === "component");
  return c && c.type === "component" ? c.component : "primitivas";
}

/** Gráfico simple sincronizado: palabra clave o frase sobre el video, con la palabra fuerte marcada cuando suena. */
function simpleScene(kind: "keyword" | "quote", clause: Clause, words: Word[], corrections: Record<string, string>, theme: MotionThemeInput, format: VideoFormat, position: "top" | "bottom"): MotionScene | null {
  const spoken = clause.ids.map((id) => ({ id, text: captionText(corrections[String(id)] ?? words[id]!.text) })).filter((w) => w.text);
  if (!spoken.length) return null;
  const ranked = [...spoken].sort((a, b) => wordStrength(b.text) - wordStrength(a.text));
  const key = ranked[0]!;
  const clean = (s: string) => s.replace(/[¿?¡!«»"“”]/g, "");
  let layer: Record<string, unknown>;
  if (kind === "keyword") {
    // La palabra fuerte y, si suma, la que le sigue ("sin resultados", "más clientes").
    const i = spoken.indexOf(key);
    const next = spoken[i + 1];
    const two = next && wordStrength(next.text) >= 3 && `${key.text} ${next.text}`.length <= 22 ? `${key.text} ${next.text}` : key.text;
    const text = clean(two);
    if (!text) return null;
    layer = { type: "component", component: "keyword", props: { text: text.charAt(0).toLocaleUpperCase("es") + text.slice(1), label: "", emphasis: "marker" } };
  } else {
    const text = clean(spoken.map((w) => w.text).slice(0, 9).join(" ")).slice(0, 110).trim();
    if (text.split(/\s+/).length < 3) return null;
    layer = { type: "component", component: "quote", props: { text: text.charAt(0).toLocaleUpperCase("es") + text.slice(1), highlight: clean(key.text).slice(0, 40), author: "" } };
  }
  const parsed = sceneSchema.safeParse({ v: 2, duration: Math.max(1.2, clause.end - clause.start), format, mode: "overlay", position, theme, layers: [layer] });
  return parsed.success ? withCueWords(parsed.data, spoken) : null;
}

/** Efectos que sirven para abrir (sobre la persona), en orden de preferencia. */
const OPENERS: FxKind[] = ["cover_story", "digital_zoom", "glass_type"];

export function fillRhythm(plan0: EditPlan, input: FillInput): FillResult {
  const { words, duration, density } = input;
  const t = DENSITY_TARGETS[density];
  const added: RhythmAddition[] = [];
  const plan: EditPlan = { ...plan0, broll: [...plan0.broll], ...(plan0.zoom_moments ? { zoom_moments: [...plan0.zoom_moments] } : {}), ...(plan0.effects ? { effects: [...plan0.effects] } : {}) };
  if (input.replace) {
    plan.broll = plan.broll.filter((b) => !isRhythm(b.why));
    if (plan.zoom_moments) plan.zoom_moments = plan.zoom_moments.filter((z) => !isRhythm(z.why));
    if (plan.effects) plan.effects = plan.effects.filter((e) => !isRhythm(e.why));
    plan.removals = plan.removals.filter((r) => !isRhythm(r.note));
    plan.captions = { ...plan.captions, emphasis_words: plan.captions.emphasis_words.filter((id) => !(plan0.rhythm?.added ?? []).some((a) => a.kind === "resaltado" && a.from_word === id)) };
  }
  const forbidden = input.forbidden;

  // 0. Nunca dos recursos iguales seguidos (dos "número que cuenta" o dos "gráfico que crece" uno detrás del otro): el
  // segundo se quita (si no lo puso la persona) y el hueco lo rellena algo distinto más abajo.
  if (density !== "sobria") {
    const rich = [
      ...plan.broll.filter((b) => b.choice).map((b) => ({ from: b.from_word, key: `g:${componentOf(b)}`, drop: () => (plan.broll = plan.broll.filter((x) => x.id !== b.id)), user: b.id.startsWith("u"), label: "gráfico" })),
      ...(plan.effects ?? []).map((e) => ({ from: e.from_word, key: `fx:${e.kind}`, drop: () => (plan.effects = (plan.effects ?? []).filter((x) => x.id !== e.id)), user: e.source === "user", label: `efecto «${FX_INFO[e.kind].label}»` })),
    ].sort((a, b) => a.from - b.from);
    for (let i = 1; i < rich.length; i++) {
      const a = rich[i - 1]!;
      const b = rich[i]!;
      if (a.key !== b.key || b.user || a.key.endsWith(":")) continue;
      b.drop();
      added.push({ kind: b.key.startsWith("fx") ? "efecto" : "grafico", from_word: b.from, to_word: b.from, why: `${RHYTHM_TAG} quité un ${b.label} repetido justo después de otro igual.` });
      rich.splice(i, 1);
      i--;
    }
  }

  // 1. Pausas y muletillas (la pausa máxima de la densidad; con Editor de reels, fuera muletillas y arranques en falso).
  const pause = Math.min(plan.pacing?.long_pause ?? t.pause, t.pause);
  if (!plan.pacing || plan.pacing.long_pause !== pause || input.replace) {
    plan.pacing = { long_pause: input.replace ? t.pause : pause };
    added.push({ kind: "pausas", from_word: 0, to_word: Math.max(0, words.length - 1), why: `${RHYTHM_TAG} pausas de hasta ${String(plan.pacing.long_pause).replace(".", ",")} s entre palabras.` });
  }
  if (t.cutFillers && input.candidates?.length) {
    const keep = input.mustKeep ?? [];
    const extra: Removal[] = [];
    const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
    for (const c of input.candidates) {
      if ((c.kind !== "filler" && c.kind !== "false_start") || c.confidence < 0.5) continue;
      const r = { from: c.from_word, to: c.to_word };
      if (keep.some((k) => overlapsW(k, r))) continue;
      if (plan.removals.some((x) => x.from_word <= r.from && x.to_word >= r.to)) continue;
      // Dentro del gancho, solo si no lo deja sin palabras.
      if (hook && overlapsW({ from: hook.from_word, to: hook.to_word }, r) && r.to - r.from + 1 >= (hook.to_word - hook.from_word + 1) * 0.3) continue;
      extra.push({ from_word: r.from, to_word: r.to, reason: c.kind === "filler" ? "filler" : "false_start", confidence: Math.max(0.5, c.confidence), source: "auto", note: `${RHYTHM_TAG} ${c.kind === "filler" ? "muletilla fuera" : "arranque en falso fuera"}.` });
      added.push({ kind: "corte", from_word: r.from, to_word: r.to, why: `${RHYTHM_TAG} ${c.kind === "filler" ? "muletilla fuera para que no se caiga el ritmo" : "arranque en falso fuera"}.` });
    }
    if (extra.length) plan.removals = normalizeRemovals([...plan.removals, ...extra], words.length);
  }

  const timelineOf = () => buildTimeline(words, plan, duration);
  let timeline = timelineOf();
  const removed = removedIds(plan, words.length);
  const clauses = clausesOf(timeline.words, words);
  const emphasis = new Set(plan.captions.emphasis_words);
  const strongest = (c: Clause) => [...c.ids].sort((a, b) => wordStrength(words[b]!.text, emphasis.has(b)) - wordStrength(words[a]!.text, emphasis.has(a)) || a - b)[0]!;

  // 2. Efecto de firma en la apertura (Editor de reels): sobre la persona, en la primera frase.
  if (t.openingFx && (input.fxAllowed ?? []).length) {
    const fx = plan.effects ?? [];
    const segs = fxSegments(timeline, fx);
    const broll = brollSegments(timeline, plan.broll);
    const opening = clauses.filter((c) => c.start < 3.2);
    if (opening.length && !segs.some((s) => s.start < 2.5) && !broll.some((b) => b.start < 2.5)) {
      const from = opening[0]!.from;
      let to = opening[0]!.to;
      for (const c of opening.slice(1)) if (c.end - opening[0]!.start <= 3.6) to = c.to;
      for (const kind of OPENERS) {
        if (!input.fxAllowed!.includes(kind)) continue;
        const info = FX_INFO[kind];
        if (info.mask && input.faceWords && ![from, to].every((id) => input.faceWords!.has(id))) continue;
        if (forbidden.some((f) => overlapsW(f, { from, to }))) break;
        if (fx.some((e) => overlapsW({ from: e.from_word, to: e.to_word }, { from, to }))) break;
        const spoken = Array.from({ length: to - from + 1 }, (_, k) => ({ id: from + k, text: words[from + k]!.text })).filter((w) => !removed.has(w.id));
        const item: FxItem = { id: newFxId(), kind, from_word: from, to_word: to, ...defaultFx(kind, spoken), why: `${RHYTHM_TAG} la apertura con más intensidad: frena el scroll.`, source: "director" };
        plan.effects = [...fx, item].sort((a, b) => a.from_word - b.from_word);
        added.push({ kind: "efecto", from_word: from, to_word: to, why: item.why! });
        break;
      }
      timeline = timelineOf();
    }
  }

  // 3. Gráficos simples donde pasa demasiado tiempo sin b-roll, gráfico ni efecto.
  if (Number.isFinite(t.richEvery) && input.theme) {
    for (let guard = 0; guard < 20 && plan.broll.length < 20; guard++) {
      const broll = brollSegments(timeline, plan.broll);
      const fx = fxSegments(timeline, plan.effects ?? []);
      const rich = [...broll.map((b) => ({ start: b.start, end: b.end })), ...fx.map((f) => ({ start: f.start, end: f.end }))].sort((a, b) => a.start - b.start);
      const marks = [{ start: 0, end: 0 }, ...rich, { start: timeline.duration, end: timeline.duration }];
      let placed = false;
      for (let i = 0; i < marks.length - 1 && !placed; i++) {
        const a = marks[i]!.end;
        const b = marks[i + 1]!.start;
        if (b - a <= t.richEvery) continue;
        // La frase más cerca de la mitad del hueco que dure de 1,2 a 4 s y no toque lo prohibido ni otra cosa.
        const mid = a + Math.min(t.richEvery * 0.75, (b - a) / 2);
        const options = clauses
          .filter((c) => c.start >= Math.max(a + 1.5, 1.5) && c.end <= b - 0.8 && c.end - c.start >= 1.2 && c.end - c.start <= 4.2)
          .filter((c) => !forbidden.some((f) => overlapsW(f, c)))
          .filter((c) => !plan.broll.some((x) => overlapsW({ from: x.from_word, to: x.to_word }, c)) && !(plan.effects ?? []).some((e) => overlapsW({ from: e.from_word, to: e.to_word }, c)))
          .sort((x, y) => Math.abs(x.start - mid) - Math.abs(y.start - mid));
        const clause = options[0];
        if (!clause) continue;
        // Nunca dos iguales seguidos: alterna palabra clave y frase (y arriba y abajo).
        const prevItem = [...plan.broll].filter((x) => x.from_word < clause.from).sort((x, y) => y.from_word - x.from_word)[0];
        const prev = prevItem ? componentOf(prevItem) : "";
        const nextItem = [...plan.broll].filter((x) => x.from_word > clause.to).sort((x, y) => x.from_word - y.from_word)[0];
        const next = nextItem ? componentOf(nextItem) : "";
        const words3 = clause.ids.length;
        let kind: "keyword" | "quote" = words3 >= 4 && prev !== "quote" ? "quote" : "keyword";
        if (kind === prev || kind === next) kind = kind === "keyword" ? "quote" : "keyword";
        if (kind === "quote" && words3 < 3) kind = "keyword";
        // La frase va abajo (ocupa el lugar de los subtítulos, que dicen lo mismo); la palabra clave, arriba, junto a
        // los subtítulos, sin tapar la cara.
        const scene = simpleScene(kind, clause, words, plan.corrections, input.theme, input.format, kind === "quote" ? "bottom" : "top");
        if (!scene) {
          clauses.splice(clauses.indexOf(clause), 1);
          placed = true;
          break;
        }
        const option = brollGraphicOption(scene);
        const why = `${RHYTHM_TAG} ${(b - a).toFixed(0)} s sin nada nuevo en pantalla: ${kind === "keyword" ? "la palabra clave" : "la frase"} entra cuando la dices.`;
        plan.broll = [...plan.broll, { id: `r${(rcount++).toString(36)}${clause.from}`, from_word: clause.from, to_word: clause.to, query_en: "", keywords: [], why, choice: option, options: [option] }].sort((x, y) => x.from_word - y.from_word);
        added.push({ kind: "grafico", from_word: clause.from, to_word: clause.to, why });
        placed = true;
      }
      if (!placed) break;
      timeline = timelineOf();
    }
  }

  // 4. Punch-ins donde pasa demasiado tiempo sin que nada cambie (en la palabra fuerte de la frase).
  const scales = t.zoomScales;
  const tried = new Set<string>();
  const zoomed = (id: number) => (plan.zoom_moments ?? []).some((z) => id >= z.from_word && id <= z.to_word);
  for (let guard = 0; guard < 120; guard++) {
    const broll = brollSegments(timeline, plan.broll);
    const fx = fxSegments(timeline, plan.effects ?? []);
    const avoid = [...broll, ...fx];
    const zooms = directorZooms(timeline, plan.zoom_moments, avoid);
    const score = rhythmScore({ timeline, broll, zooms, effects: fx, entries: graphicEntriesOf(broll), density });
    const gap = score.gaps.find((g) => !tried.has(`${g.start}-${g.end}`) && !avoid.some((s) => s.start <= g.start + 0.05 && s.end >= g.end - 0.05));
    if (!gap) break;
    tried.add(`${gap.start}-${gap.end}`);
    const target = gap.start + Math.min(t.changeEvery * 0.8, gap.seconds / 2);
    const free = (a: number, b: number) => !avoid.some((s) => a < s.end && s.start < b);
    const inGap = clauses.filter((c) => c.start >= Math.max(0.5, gap.start + 0.5) && c.start < gap.end - 0.6 && free(c.start, c.end) && !c.ids.some(zoomed));
    const clause = inGap.sort((x, y) => Math.abs(x.start - target) - Math.abs(y.start - target))[0];
    let ok = false;
    if (clause) {
      const strong = strongest(clause);
      const startId = clause.ids.indexOf(strong) <= 2 ? clause.from : strong;
      const tw = (id: number) => timeline.words.find((w) => w.id === id);
      const endId = clause.ids.filter((id) => id >= startId && (tw(id)?.end ?? 0) - (tw(startId)?.start ?? 0) <= 3).at(-1) ?? clause.to;
      ok = addZoom(startId, endId, wordStrength(words[strong]!.text, emphasis.has(strong)) >= 8 ? `énfasis en «${captionText(words[strong]!.text)}»` : "cambio de encuadre para que no se estanque");
    }
    if (!ok) {
      // Sin una frase que empiece en el hueco: se parte el hueco con un zoom en su palabra más fuerte.
      const ws = timeline.words.filter((w) => w.start >= Math.max(0.6, gap.start + 0.8) && w.start <= gap.end - 0.8 && free(w.start, w.end) && !zoomed(w.id));
      if (!ws.length) continue;
      const near = ws.filter((w) => Math.abs(w.start - target) <= 1.2);
      const pool = near.length ? near : ws;
      const w = [...pool].sort((x, y) => wordStrength(words[y.id]!.text, emphasis.has(y.id)) - wordStrength(words[x.id]!.text, emphasis.has(x.id)) || Math.abs(x.start - target) - Math.abs(y.start - target))[0]!;
      const last = ws.filter((x) => x.id >= w.id && x.end - w.start <= 2.6 && !zoomed(x.id)).at(-1) ?? w;
      addZoom(w.id, last.id, "el plano no cambia hace rato");
    }
    timeline = timelineOf();
  }

  // 5. Una palabra clave resaltada por frase en los subtítulos (Editor de reels).
  if (t.emphasisPerPhrase) {
    const list = [...plan.captions.emphasis_words];
    for (const c of clauses) {
      if (list.length >= 40) break;
      if (c.ids.some((id) => list.includes(id))) continue;
      const s = strongest(c);
      if (wordStrength(words[s]!.text) < 3) continue;
      list.push(s);
      added.push({ kind: "resaltado", from_word: s, to_word: s, why: `${RHYTHM_TAG} palabra clave de la frase resaltada.` });
    }
    plan.captions = { ...plan.captions, emphasis_words: [...new Set(list)].sort((a, b) => a - b).slice(0, 40) };
  }

  plan.rhythm = { density, added: [...(input.replace ? [] : (plan0.rhythm?.added ?? []).filter((a) => !added.some((b) => b.kind === a.kind && b.from_word === a.from_word))), ...added].slice(-120) };
  return { plan, added };

  function addZoom(from: number, to: number, reason: string): boolean {
    const list = [...(plan.zoom_moments ?? [])].sort((a, b) => a.from_word - b.from_word);
    if (list.some((z) => overlapsW({ from: z.from_word, to: z.to_word }, { from, to }))) return false;
    if (list.length >= 60) return false;
    // Alterna la escala con el zoom anterior (nunca dos iguales seguidos).
    const prev = list.filter((z) => z.to_word < from).at(-1);
    const nextZ = list.find((z) => z.from_word > to);
    let scale = scales[0]!;
    for (const s of [...scales].reverse()) if (Math.abs(s - (prev?.scale ?? 1)) > 0.02 && Math.abs(s - (nextZ?.scale ?? 1)) > 0.02) scale = s;
    if (Math.abs(scale - (prev?.scale ?? 0)) <= 0.02) scale = scales.find((s) => Math.abs(s - (prev?.scale ?? 0)) > 0.02) ?? scale;
    const why = `${RHYTHM_TAG} ${reason}.`;
    plan.zoom_moments = [...list, { from_word: from, to_word: to, scale, why }].sort((a, b) => a.from_word - b.from_word);
    added.push({ kind: "zoom", from_word: from, to_word: to, why });
    return true;
  }
}

let rcount = 0;

/** El tema de los gráficos del plan (para que lo agregado se vea igual que lo demás). */
export function themeOfPlan(plan: Pick<EditPlan, "broll">): MotionThemeInput | null {
  for (const b of plan.broll) {
    const g = b.choice?.graphic as MotionScene | null | undefined;
    if (g && g.v === 2) return g.theme as MotionThemeInput;
  }
  return null;
}

export type ZoomMomentWithWhy = ZoomMoment;

/** Lo que va en la tarea del director: la densidad y sus objetivos para este largo. */
export function rhythmTaskText(density: Density, seconds: number): string {
  const t = DENSITY_TARGETS[density];
  const rich = Number.isFinite(t.richEvery) ? Math.max(1, Math.round(seconds / t.brollEvery)) : 0;
  const zooms = Math.max(1, Math.round(seconds / (t.changeEvery * 1.3)));
  const label = DENSITY_LABELS[density].label;
  if (density === "reels")
    return `DENSIDAD "${label}": algo cambia en pantalla cada 2 a 4 s (punch-in o cambio de encuadre casi en cada frase, alternando suave y marcado: unos ${zooms} zooms en este video), un b-roll, gráfico o efecto cada 6 a 8 s (unos ${rich}), efecto de firma en la apertura, pausas de 0,3 s como mucho (pace "fast") y muletillas fuera, palabras clave resaltadas en cada frase, nunca dos cosas iguales seguidas.`;
  if (density === "normal") return `DENSIDAD "${label}": un cambio en pantalla cada 4 o 5 s (unos ${zooms} zooms), un b-roll, gráfico o efecto cada 10 a 14 s (unos ${rich}), pausas de hasta 0,5 s.`;
  return `DENSIDAD "${label}": pocos cambios (zooms suaves, uno cada 8 s o más) y solo los gráficos que suman de verdad; pausas naturales.`;
}

/** Ritmo medido, en texto para el crítico. */
export function rhythmText(s: RhythmScore): string {
  const f = (n: number) => n.toFixed(1).replace(".", ",");
  return `Densidad ${DENSITY_LABELS[s.density].label}: puntaje ${s.score}/100 · ${f(s.changesPer10)} cambios cada 10 s (objetivo ${DENSITY_TARGETS[s.density].changesPer10}) · hueco más largo ${f(s.longestGap.seconds)} s (del ${f(s.longestGap.start)} al ${f(s.longestGap.end)}) · ${Math.round(s.coverage * 100)} % del video con algo en pantalla. ${s.verdict}`;
}

/**
 * Gráficos del plan sincronizados con la voz: cada elemento con su palabra (lo que marcó Claude o, si no, lo que se
 * empareja con lo dicho) y el tramo estirado hasta que se dice el último (sin pisar lo que sigue ni pasar de 12 s).
 */
export function syncGraphics(plan: EditPlan, words: Word[], forbidden: { from: number; to: number }[] = []): EditPlan {
  const sorted = [...plan.broll].sort((a, b) => a.from_word - b.from_word);
  const out: BrollItem[] = [];
  for (const [i, item] of sorted.entries()) {
    const g = item.choice?.graphic as MotionScene | null | undefined;
    if (item.choice?.source !== "graphic" || !g || g.v !== 2) {
      out.push(item);
      continue;
    }
    const nextFrom = sorted[i + 1]?.from_word ?? words.length;
    // Lo que se dice desde el inicio del tramo hasta unos segundos después (el último ítem puede decirse más adelante).
    const limit = words.findIndex((w, k) => k > item.to_word && w.start - words[item.from_word]!.start > 12);
    const end = Math.min(nextFrom - 1, limit < 0 ? words.length - 1 : limit - 1);
    const spoken = words.slice(item.from_word, end + 1).map((w) => ({ id: w.id, text: w.text }));
    const scene = withCueWords(g, spoken);
    let to = item.to_word;
    let last = -1;
    for (const l of scene.layers as Layer[]) {
      if (l.type === "component") last = Math.max(last, ...(l.cue_words ?? [-1]));
      else if ((l.type === "text" || l.type === "counter") && l.cue_word != null) last = Math.max(last, l.cue_word);
    }
    if (last > to) {
      // Hasta el final de lo que se dice en ese elemento (la coma o el punto), sin pisar lo prohibido.
      let k = last;
      while (k < end && k - last < 6 && !/[.,;:?!]$/.test(words[k]!.text)) k++;
      while (k > to && forbidden.some((f) => k >= f.from && k <= f.to)) k--;
      to = Math.max(to, k);
    }
    const option = brollGraphicOption(scene);
    out.push({ ...item, to_word: to, choice: option, options: [option, ...item.options.filter((o) => o.source !== "graphic")].slice(0, 12) });
  }
  return { ...plan, broll: out };
}
