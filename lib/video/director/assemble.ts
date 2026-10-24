/**
 * Del director (formato de cable) al plan de edición v2 que ya usan la revisión, la vista previa y el render.
 *
 * Reutiliza los formatos existentes (cortes, ganchos, b-roll, gráficos) y agrega lo nuevo del director: bloques
 * movidos, zooms, subtítulos ocultos, ritmo y versiones. Todo se valida aquí con reglas duras que no dependen de la IA:
 * no se corta lo que el brief pide que quede, el b-roll nunca tapa un tramo importante del mapa, el gancho ni la CTA,
 * y los bloques movidos son frases completas. Sin servidor: lo usan el servicio, el simulador y las pruebas.
 */
import { sentences } from "@/lib/ai/prompts/editor";
import { sceneFromWire, type MotionSceneAi } from "@/lib/ai/prompts/motion";
import type { DirectorWire } from "@/lib/ai/prompts/director";
import type { Candidate } from "../candidates";
import { fallbackHooks, hookIsValid, normalizeRemovals, trimHook, withDerived, type PlanStyle } from "../plan";
import { buildTimeline, removedIds } from "../timeline";
import type { BrollItem, CaptionPresetKey, EditPlan, HookCandidate, PlanMove, Removal, VideoFormat, Word, ZoomMoment } from "../types";
import type { PlanVariant, VideoMap } from "./types";
import { effectsFromWire, type FxLimits } from "../fx/director";
import { DENSITY_TARGETS, type Density } from "../rhythm";
import { coverForbidden, effectsForbidden } from "./protect";

export const PACE_PAUSE: Record<"calm" | "normal" | "fast", number> = { calm: 0.7, normal: 0.5, fast: 0.3 };

export type BrollLimits = { count: number; minSeconds: number; maxSeconds: number; graphics: boolean; stock: boolean };

export type DirectorInput = {
  words: Word[];
  duration: number;
  format: VideoFormat;
  preset: CaptionPresetKey;
  corrections: Record<string, string>;
  offScript: number[];
  candidates: Candidate[];
  map: VideoMap | null;
  /** Lo que el brief pide que no se corte (rangos de palabras): ningún corte lo toca. */
  mustKeep: { from: number; to: number }[];
  /**
   * Lo que tiene que quedar a la vista (la oferta, la CTA, el producto en pantalla): se puede cortar una toma repetida
   * o una muletilla adentro, pero no tanto que se pierda (queda al menos el 60 %).
   */
  protect?: { from: number; to: number; label: string }[];
  style: PlanStyle | null;
  broll: BrollLimits;
  /** Plan anterior (al corregir): se conservan sonido, encuadre, subtítulos y los b-roll que siguen en su lugar. */
  base: EditPlan | null;
  /** Clips de un video largo: el gancho ya está al principio. */
  keepOpening?: boolean;
  /** Efectos de la biblioteca: los que permite Mi marca y cuántos, y dónde se ve la cara (para los que te recortan). */
  fx?: { limits: FxLimits; faceWords?: Set<number> | null; keepUser?: boolean };
  /** Densidad de ritmo (lib/video/rhythm.ts): fuerza y separación de los zooms. Sin el campo, Normal. */
  density?: Density;
};

export type PendingGraphic = { item: BrollItem; scene: MotionSceneAi | null; spoken: string };

export type Assembled = {
  plan: EditPlan;
  /** B-roll nuevos que necesitan su gráfico (validado con el motor) o sus alternativas de stock. */
  pending: PendingGraphic[];
  variants: PlanVariant[];
  /** Lo que se descartó por las reglas duras (para el registro y para avisar). */
  dropped: string[];
};

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from <= b.to && b.from <= a.to;
const clip = (s: string, n: number) => s.trim().slice(0, n);
let counter = 0;
const newId = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Rangos donde no puede ir lo que tapa a la persona: el gancho, la apertura, la última frase de la CTA y lo que se
 * muestra (con tope, ver protect.ts). Con `overlay` (gráfico sobre el video), solo lo que se muestra.
 */
export function brollForbidden(words: Word[], removed: Set<number>, hook: HookCandidate | null, map: VideoMap | null, overlay = false): { from: number; to: number; label: string }[] {
  return coverForbidden(words, removed, hook, map, overlay);
}

export function planFromDirector(ai: DirectorWire, input: DirectorInput): Assembled {
  const { words, map } = input;
  const n = words.length;
  const dropped: string[] = [];
  const valid = (a: number, b: number) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b < n && a <= b;
  const phrases = sentences(words);
  const sentenceStart = new Set(phrases.map((f) => f.from));
  const sentenceEnd = new Set(phrases.map((f) => f.to));
  const keep = input.mustKeep;

  // 1. Cortes.
  const cuts: Removal[] = [];
  for (const c of ai.cuts) {
    const from = Math.min(c.from_word, c.to_word);
    const to = Math.max(c.from_word, c.to_word);
    if (!valid(from, to)) continue;
    if (keep.some((k) => overlaps(k, { from, to }))) {
      dropped.push(`No corté "${words[from]!.text}…" porque el brief pide que quede.`);
      continue;
    }
    const span = words[to]!.end - words[from]!.start;
    const big = c.reason === "bad_take" || c.reason === "off_topic" || c.reason === "retake";
    if ((!big && (to - from > 40 || span > 20)) || to - from > 160 || span > 60) {
      dropped.push(`Un corte de ${Math.round(span)} s era demasiado largo para hacerlo sin que lo revises.`);
      continue;
    }
    cuts.push({ from_word: from, to_word: to, reason: c.reason, confidence: 0.9, source: "ai", note: clip(c.why, 300) });
  }
  // Lo protegido no puede quedar casi todo cortado (salvo por tomas repetidas o muletillas: esas repiten o no suman).
  for (const p of input.protect ?? []) {
    const hard = cuts.filter((c) => (c.reason === "bad_take" || c.reason === "off_topic") && overlaps({ from: c.from_word, to: c.to_word }, p));
    if (!hard.length) continue;
    const gone = new Set<number>();
    for (const c of hard) for (let id = Math.max(c.from_word, p.from); id <= Math.min(c.to_word, p.to); id++) gone.add(id);
    if (gone.size > (p.to - p.from + 1) * 0.4) {
      for (const c of hard) cuts.splice(cuts.indexOf(c), 1);
      dropped.push(`No corté ${p.label}: tiene que quedar.`);
    }
  }
  // Las pausas largas las acorta el ritmo (pacing); los demás candidatos los decidió el director.
  const removals = normalizeRemovals(cuts, n);
  const removedSet = removedIds({ removals }, n);

  // 2. Ganchos (el primero se usa).
  let hooks: HookCandidate[] = ai.hooks
    .filter((h) => valid(Math.min(h.from_word, h.to_word), Math.max(h.from_word, h.to_word)))
    .map((h) => trimHook({ from_word: Math.min(h.from_word, h.to_word), to_word: Math.max(h.from_word, h.to_word), score: clamp01(h.score), why: clip(h.why, 400) }, removedSet))
    .filter((h) => hookIsValid(h, words, removedSet))
    .slice(0, 3);
  if (hooks.length < 3) {
    const extra = fallbackHooks(words, removedSet).filter((f) => !hooks.some((h) => h.from_word <= f.to_word && f.from_word <= h.to_word));
    hooks = [...hooks, ...extra].slice(0, 3);
  }
  const hook = hooks[0] && !input.keepOpening ? hooks[0] : null;

  // 3. Bloques movidos: frases completas, sin superponerse, a un límite de frase.
  const moves: PlanMove[] = [];
  for (const m of ai.moves.slice(0, 2)) {
    const from = Math.min(m.from_word, m.to_word);
    const to = Math.max(m.from_word, m.to_word);
    if (!valid(from, to) || !sentenceStart.has(from) || !sentenceEnd.has(to)) {
      dropped.push("Un bloque movido no era de frases completas: lo dejé en su lugar.");
      continue;
    }
    if (m.after_word !== -1 && (!valid(m.after_word, m.after_word) || !sentenceEnd.has(m.after_word) || (m.after_word >= from && m.after_word <= to))) continue;
    if (moves.some((x) => overlaps({ from: x.from_word, to: x.to_word }, { from, to }))) continue;
    if (hook && overlaps({ from: hook.from_word, to: hook.to_word }, { from, to })) continue;
    moves.push({ from_word: from, to_word: to, after_word: m.after_word, why: clip(m.why, 300) });
  }

  // 4. Palabras resaltadas.
  const emphasis = [...new Set(ai.emphasis_words.filter((id) => id >= 0 && id < n && !removedSet.has(id)))].slice(0, 8);

  // 5. B-roll y gráficos.
  const forbidden = brollForbidden(words, removedSet, hook, map);
  const forbiddenOverlay = brollForbidden(words, removedSet, hook, map, true);
  const base = input.base;
  const pending: PendingGraphic[] = [];
  const broll: BrollItem[] = [];
  const limits = input.broll;
  for (const b of ai.broll) {
    if (broll.length >= limits.count) break;
    const from = Math.min(b.from_word, b.to_word);
    const to = Math.max(b.from_word, b.to_word);
    if (!valid(from, to)) continue;
    // Un gráfico sobre el video deja ver a la persona: puede ir en el gancho y en la CTA (las refuerza).
    const overlay = b.kind === "graphic" && b.graphic?.mode === "overlay";
    const hit = (overlay ? forbiddenOverlay : forbidden).find((f) => overlaps(f, { from, to }));
    if (hit) {
      dropped.push(`Quité un b-roll que iba a tapar ${hit.label}.`);
      continue;
    }
    const ids = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    if (ids.filter((id) => removedSet.has(id)).length > ids.length * 0.4) continue;
    const span = words[to]!.end - words[from]!.start;
    // Un gráfico dura lo que dura lo que se dice (una lista de tres errores puede llevar 10 s); un video, hasta 8 s.
    if (span < 0.8 || span > (b.kind === "graphic" ? 12 : 8)) continue;
    if (broll.some((c) => overlaps({ from: c.from_word, to: c.to_word }, { from, to }))) continue;
    const wantsGraphic = b.kind === "graphic" && Boolean(b.graphic) && limits.graphics && span >= 1.2;
    if (!wantsGraphic && !limits.stock) continue;
    // Al corregir, un b-roll que sigue en el mismo lugar conserva lo que ya tenía (y lo que eligió la persona).
    const same = base?.broll.find((x) => x.from_word === from && x.to_word === to && x.choice && (x.choice.source === "graphic") === wantsGraphic);
    if (same) {
      broll.push({ ...same, why: clip(b.why, 300) || same.why });
      continue;
    }
    const item: BrollItem = {
      id: newId(),
      from_word: from,
      to_word: to,
      query_en: clip(b.query_en, 120) || "business concept",
      keywords: b.keywords.map((k) => clip(k, 40)).filter(Boolean).slice(0, 4),
      why: clip(b.why, 300),
      choice: null,
      options: [],
    };
    broll.push(item);
    const spoken = phrases
      .filter((f) => f.from <= to && from <= f.to)
      .map((f) => f.text)
      .join(" ");
    pending.push({ item, scene: wantsGraphic ? sceneFromWire(b.graphic) : null, spoken });
  }
  broll.sort((a, b) => a.from_word - b.from_word);

  // 6. Zooms (fuera de los b-roll) y subtítulos ocultos.
  // Fuerza y separación según la densidad: con Editor de reels, punch-ins de 1,15 y 1,3 que pueden ir seguidos.
  const target = DENSITY_TARGETS[input.density ?? "normal"];
  const [soft, strong] = [target.zoomScales[0]!, target.zoomScales[target.zoomScales.length - 1]!];
  const zooms: ZoomMoment[] = [];
  for (const z of [...ai.zooms].sort((a, b) => Math.min(a.from_word, a.to_word) - Math.min(b.from_word, b.to_word))) {
    const from = Math.min(z.from_word, z.to_word);
    const to = Math.max(z.from_word, z.to_word);
    if (!valid(from, to) || broll.some((b) => overlaps({ from: b.from_word, to: b.to_word }, { from, to }))) continue;
    if ((ai.effects ?? []).some((e) => overlaps({ from: Math.min(e.from_word, e.to_word), to: Math.max(e.from_word, e.to_word) }, { from, to }))) continue;
    const last = zooms[zooms.length - 1];
    if (last && (from <= last.to_word || words[from]!.start - words[last.to_word]!.end < target.zoomGap)) continue;
    let scale = z.strength === "marcado" ? strong : soft;
    // Nunca dos iguales seguidos: si el anterior está pegado y tiene la misma escala, se alterna.
    if (last && Math.abs(last.scale - scale) < 0.02 && words[from]!.start - words[last.to_word]!.end < 1) scale = scale === strong ? soft : strong;
    zooms.push({ from_word: from, to_word: to, scale, why: clip(z.why, 300) });
  }
  // Los tramos sin subtítulos que quitó la persona en el Estudio se quedan; los del director se vuelven a decidir.
  const userHide = (base?.captions.hide ?? []).filter((h) => h.why === "Lo quitaste tú." && valid(h.from_word, h.to_word));
  const hide = [
    ...userHide,
    ...ai.caption_hide
      .filter((h) => valid(Math.min(h.from_word, h.to_word), Math.max(h.from_word, h.to_word)))
      .slice(0, 30)
      .map((h) => ({ from_word: Math.min(h.from_word, h.to_word), to_word: Math.max(h.from_word, h.to_word), why: clip(h.why, 300) })),
  ].slice(0, 60);

  // 6 bis. Efectos de la biblioteca (nunca sobre un b-roll, lo importante que se muestra ni una toma mala).
  // Los efectos se dibujan sobre la persona que habla: el gancho y la CTA los admiten; solo se protege lo que se muestra
  // (con tope) y las tomas malas.
  const fxForbidden = effectsForbidden(words, map);
  const fx = input.fx
    ? effectsFromWire(ai.effects ?? [], { words, limits: input.fx.limits, broll, forbidden: fxForbidden, faceWords: input.fx.faceWords ?? null, removed: removedSet, base: base?.effects ?? null, keepUser: input.fx.keepUser })
    : { items: base?.effects ?? [], dropped: [] };
  dropped.push(...fx.dropped);

  // 7. El plan.
  const pace = ai.pace;
  const style = input.style;
  const plan: EditPlan = {
    version: 2,
    format: input.format,
    segments: [],
    order: [],
    removals,
    proposed_removals: removals.map((r) => ({ ...r })),
    hook_candidates: hooks,
    selected_hook: hooks.length && !input.keepOpening ? 0 : null,
    captions: {
      preset: base?.captions.preset ?? input.preset,
      emphasis_words: emphasis,
      ...(base?.captions.emoji != null ? { emoji: base.captions.emoji } : {}),
      ...(hide.length ? { hide } : {}),
      // El lugar y el tamaño que eligió la persona en el lienzo se quedan al corregir.
      ...(base?.captions.transform ? { transform: base.captions.transform } : {}),
      ...(base?.captions.lines ? { lines: base.captions.lines } : {}),
    },
    corrections: base?.corrections ?? input.corrections,
    overlays: [],
    broll,
    audio: base?.audio ?? { music_asset_id: null, music_db: -16, target_lufs: -14, sfx: "subtle", studio: "soft" },
    framing: base?.framing ?? { mode: "center", offset_x: 0 },
    off_script: input.offScript,
    summary: clip(ai.summary, 1000),
    warning: clip(ai.warning, 1000),
    planned_by: "ai",
    pacing: { long_pause: style ? style.longPause : PACE_PAUSE[pace] },
    director: { version: 1, pace },
    ...(moves.length ? { moves } : {}),
    ...(zooms.length ? { zoom_moments: zooms } : {}),
    ...(fx.items.length ? { effects: fx.items } : {}),
    ...(style ? { zooms_enabled: style.zoom, style_id: style.id } : {}),
  };
  const derived = withDerived(plan, words, input.duration);

  // 8. Versiones para probar.
  const variants: PlanVariant[] = [];
  for (const v of ai.variants.slice(0, 2)) {
    const extra: Removal[] = [];
    for (const c of v.extra_cuts) {
      const from = Math.min(c.from_word, c.to_word);
      const to = Math.max(c.from_word, c.to_word);
      if (!valid(from, to) || keep.some((k) => overlaps(k, { from, to }))) continue;
      extra.push({ from_word: from, to_word: to, reason: "off_topic", confidence: 0.8, source: "ai" });
    }
    const vRemovals = normalizeRemovals([...removals, ...extra], n);
    const vRemoved = removedIds({ removals: vRemovals }, n);
    let vHook: HookCandidate | null = hook;
    if (v.hook_from_word >= 0 && valid(Math.min(v.hook_from_word, v.hook_to_word), Math.max(v.hook_from_word, v.hook_to_word))) {
      const h = trimHook({ from_word: Math.min(v.hook_from_word, v.hook_to_word), to_word: Math.max(v.hook_from_word, v.hook_to_word), score: 0.8, why: clip(v.why, 300) }, vRemoved);
      if (hookIsValid(h, words, vRemoved)) vHook = h;
    }
    const keptBroll = v.keep_broll ? broll.filter((b) => !Array.from({ length: b.to_word - b.from_word + 1 }, (_, k) => b.from_word + k).some((id) => vRemoved.has(id))).map((b) => ({ ...b })) : [];
    const tl = buildTimeline(words, { removals: vRemovals, hook_candidates: vHook ? [vHook] : [], selected_hook: vHook ? 0 : null, corrections: plan.corrections, captions: plan.captions, pacing: plan.pacing, moves: plan.moves }, input.duration);
    if (tl.duration < 3 || Math.abs(tl.duration - buildTimeline(words, derived, input.duration).duration) < 2 && extra.length === 0 && vHook === hook) continue;
    variants.push({
      id: `v${variants.length + 1}`,
      label: clip(v.label, 60) || `Versión ${variants.length + 2}`,
      why: clip(v.why, 300),
      duration: tl.duration,
      removals: vRemovals.map((r) => ({ from_word: r.from_word, to_word: r.to_word })),
      hook: vHook ? { from_word: vHook.from_word, to_word: vHook.to_word } : null,
      broll: keptBroll,
    });
  }
  return { plan: derived, pending, variants, dropped };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);

/**
 * Aplica una versión sobre el plan principal (la persona eligió "Usar esta versión"). La versión principal queda
 * guardada como otra versión, así se puede volver.
 */
export function applyVariant(plan: EditPlan, variant: PlanVariant, words: Word[], duration: number): { plan: EditPlan; previous: PlanVariant } {
  const n = words.length;
  const current = buildTimeline(words, plan, duration);
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : null;
  const previous: PlanVariant = {
    id: `v${Date.now().toString(36)}`,
    label: "Versión anterior",
    why: "La que tenías antes de cambiar.",
    duration: current.duration,
    removals: plan.removals.map((r) => ({ from_word: r.from_word, to_word: r.to_word })),
    hook: hook ? { from_word: hook.from_word, to_word: hook.to_word } : null,
    broll: plan.broll.map((b) => ({ ...b })),
  };
  const removals = normalizeRemovals(
    variant.removals.map((r) => plan.removals.find((x) => x.from_word === r.from_word && x.to_word === r.to_word) ?? { ...r, reason: "off_topic" as const, confidence: 0.8, source: "ai" as const }),
    n,
  );
  let hooks = plan.hook_candidates;
  let selected: number | null = null;
  if (variant.hook) {
    const i = hooks.findIndex((h) => h.from_word === variant.hook!.from_word && h.to_word === variant.hook!.to_word);
    if (i >= 0) selected = i;
    else {
      hooks = [{ ...variant.hook, score: 0.8, why: variant.why || "Gancho de esta versión." }, ...hooks].slice(0, 5);
      selected = 0;
    }
  }
  const next: EditPlan = { ...plan, removals, hook_candidates: hooks, selected_hook: selected, broll: variant.broll.map((b) => ({ ...b })) };
  return { plan: withDerived(next, words, duration), previous };
}
