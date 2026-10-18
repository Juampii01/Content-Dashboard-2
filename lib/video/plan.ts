/**
 * Plan de edición v2: esquema, armado a partir de la respuesta de Claude y validación.
 *
 * Validaciones: los ids existen, los cortes no se superponen (se unen), los ganchos duran de 3 a 8 s
 * y no caen sobre lo cortado, y la duración final se compara con el objetivo del formato.
 */
import { z } from "zod";
import type { PlanAiOutput } from "@/lib/ai/prompts/editor";
import { sentences } from "@/lib/ai/prompts/editor";
import { confidentRemovals, type Candidate } from "./candidates";
import { buildTimeline, planSegments } from "./timeline";
import { REMOVAL_REASONS, type CaptionPresetKey, type EditPlan, type HookCandidate, type Removal, type VideoFormat, type Word } from "./types";

const removalSchema = z.object({
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  reason: z.enum(REMOVAL_REASONS),
  confidence: z.number().min(0).max(1),
  source: z.enum(["auto", "ai", "user"]),
  note: z.string().max(300).optional(),
});

const hookSchema = z.object({
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  score: z.number().min(0).max(1),
  why: z.string().max(400),
});

export const planSchema = z.object({
  version: z.literal(2),
  format: z.enum(["9:16", "16:9"]),
  segments: z.array(z.object({ id: z.string().max(20), from_word: z.number().int(), to_word: z.number().int(), role: z.enum(["hook", "body", "cta"]) })).max(2000),
  order: z.array(z.string().max(20)).max(2000),
  removals: z.array(removalSchema).max(5000),
  proposed_removals: z.array(removalSchema).max(5000),
  hook_candidates: z.array(hookSchema).max(5),
  selected_hook: z.number().int().min(0).max(4).nullable(),
  captions: z.object({ preset: z.enum(["clasico", "pop", "ninguno"]), emphasis_words: z.array(z.number().int().min(0)).max(40) }),
  corrections: z.record(z.string().regex(/^\d+$/), z.string().max(60)),
  overlays: z.array(z.object({ text: z.string().max(120), from_word: z.number().int(), to_word: z.number().int(), position: z.enum(["top", "center"]) })).max(20),
  broll: z.array(z.object({ from_word: z.number().int(), to_word: z.number().int(), query_en: z.string().max(120), source: z.enum(["pexels", "upload"]) })).max(10),
  audio: z.object({ music_asset_id: z.string().nullable(), music_db: z.number().min(-40).max(0), target_lufs: z.number().min(-24).max(-9) }),
  framing: z.object({ mode: z.enum(["center", "manual"]), offset_x: z.number().min(-1).max(1) }),
  off_script: z.array(z.number().int().min(0)).max(20000),
  summary: z.string().max(1000),
  warning: z.string().max(1000),
  planned_by: z.enum(["ai", "auto"]),
});

/** Problemas que hacen inválido un plan para estas palabras. Lista vacía = válido. */
export function planIssues(plan: EditPlan, wordCount: number): string[] {
  const issues: string[] = [];
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < wordCount;
  const check = (label: string, from: number, to: number) => {
    if (!valid(from) || !valid(to)) issues.push(`${label}: ids fuera de rango (${from}–${to}).`);
    else if (from > to) issues.push(`${label}: rango invertido (${from}–${to}).`);
  };
  const sorted = [...plan.removals].sort((a, b) => a.from_word - b.from_word);
  sorted.forEach((r, i) => {
    check("Corte", r.from_word, r.to_word);
    const next = sorted[i + 1];
    if (next && next.from_word <= r.to_word) issues.push(`Cortes superpuestos (${r.from_word}–${r.to_word} y ${next.from_word}–${next.to_word}).`);
  });
  plan.hook_candidates.forEach((h) => check("Gancho", h.from_word, h.to_word));
  if (plan.selected_hook != null && !plan.hook_candidates[plan.selected_hook]) issues.push("El gancho elegido no existe.");
  plan.captions.emphasis_words.forEach((id) => !valid(id) && issues.push(`Palabra resaltada inexistente (${id}).`));
  Object.keys(plan.corrections).forEach((id) => !valid(Number(id)) && issues.push(`Corrección de una palabra inexistente (${id}).`));
  return issues;
}

/** Esquema completo para un video concreto: además de la forma, valida ids y superposiciones. */
export function planSchemaFor(wordCount: number) {
  return planSchema.superRefine((plan, ctx) => {
    for (const message of planIssues(plan as EditPlan, wordCount)) ctx.addIssue({ code: "custom", message });
  });
}

/** Ordena, recorta a los ids válidos y une los cortes que se superponen o se tocan. */
export function normalizeRemovals(list: Removal[], wordCount: number): Removal[] {
  const clean = list
    .map((r) => ({ ...r, from_word: Math.max(0, Math.min(r.from_word, r.to_word)), to_word: Math.min(wordCount - 1, Math.max(r.from_word, r.to_word)) }))
    .filter((r) => r.from_word < wordCount && r.to_word >= 0 && r.from_word <= r.to_word)
    .sort((a, b) => a.from_word - b.from_word || b.to_word - a.to_word);
  const out: Removal[] = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r.from_word <= last.to_word + 1) {
      if (r.to_word > last.to_word) last.to_word = r.to_word;
      // Se queda el motivo del corte más seguro; un corte de la persona manda sobre los automáticos.
      if (r.source === "user" || (last.source !== "user" && r.confidence > last.confidence)) {
        last.reason = r.reason;
        last.confidence = r.confidence;
        last.source = r.source;
        last.note = r.note;
      }
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

/** Convierte un conjunto de ids cortados en rangos (para guardar lo que eligió la persona en la revisión). */
export function rangesFromIds(ids: number[], previous: Removal[]): Removal[] {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: Removal[] = [];
  for (const id of sorted) {
    const last = out[out.length - 1];
    if (last && id === last.to_word + 1) last.to_word = id;
    else out.push({ from_word: id, to_word: id, reason: "manual", confidence: 1, source: "user" });
  }
  // Cada rango conserva el motivo del corte original que lo contiene, si lo hay.
  return out.map((r) => {
    const origin = previous.find((p) => p.from_word <= r.from_word && p.to_word >= r.to_word) ?? previous.find((p) => p.from_word <= r.to_word && p.to_word >= r.from_word);
    return origin ? { ...r, reason: origin.reason, confidence: origin.confidence, source: origin.source, note: origin.note } : r;
  });
}

const HOOK_MIN = 3;
const HOOK_MAX = 8;
const HOOK_TOLERANCE = 0.5;

function hookIsValid(h: HookCandidate, words: Word[], removedSet: Set<number>): boolean {
  const a = words[h.from_word];
  const b = words[h.to_word];
  if (!a || !b || h.from_word > h.to_word) return false;
  const dur = b.end - a.start;
  if (dur < HOOK_MIN - HOOK_TOLERANCE || dur > HOOK_MAX + HOOK_TOLERANCE) return false;
  let cut = 0;
  for (let id = h.from_word; id <= h.to_word; id++) if (removedSet.has(id)) cut++;
  return cut / (h.to_word - h.from_word + 1) <= 0.3;
}

/** Ganchos sin IA: frases completas de 3 a 8 s, prefiriendo preguntas, números y frases fuertes al principio. */
export function fallbackHooks(words: Word[], removedSet: Set<number>, count = 3): HookCandidate[] {
  const scored = sentences(words)
    .map((f) => {
      const dur = f.end - f.start;
      let score = 0.4;
      if (/[?¿]/.test(f.text)) score += 0.15;
      if (/\d/.test(f.text)) score += 0.15;
      if (f.index === 1) score += 0.1;
      if (dur >= 4 && dur <= 7) score += 0.05;
      return { from_word: f.from, to_word: f.to, score: Math.min(0.9, score), why: "Frase completa que se entiende sola (propuesta automática)." };
    })
    .filter((h) => hookIsValid(h, words, removedSet))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count);
}

export const FORMAT_TARGET: Record<VideoFormat, { max: number; label: string }> = {
  "9:16": { max: 90, label: "Reels y TikTok" },
  "16:9": { max: 600, label: "YouTube" },
};

export function assemblePlan(input: {
  ai: PlanAiOutput | null;
  candidates: Candidate[];
  words: Word[];
  duration: number;
  format: VideoFormat;
  preset: CaptionPresetKey;
  corrections: Record<string, string>;
  offScript: number[];
  /** Mensaje corto si la IA falló y el plan se arma sin ella. */
  aiError?: string | null;
}): EditPlan {
  const { ai, candidates, words } = input;
  const count = words.length;
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const removals: Removal[] = [];
  if (ai) {
    const decided = new Set<string>();
    for (const d of ai.decisions) {
      const c = byId.get(d.candidate.trim().toUpperCase());
      if (!c || c.kind === "silence") continue;
      decided.add(c.id);
      if (d.cut) removals.push({ from_word: c.from_word, to_word: c.to_word, reason: c.kind, confidence: clamp01(d.confidence), source: "auto", note: c.note });
    }
    // Candidatos sin decisión: se cortan solo los muy seguros.
    for (const c of confidentRemovals(candidates, 0.85)) {
      if (!decided.has(c.id)) removals.push({ from_word: c.from_word, to_word: c.to_word, reason: c.kind, confidence: c.confidence, source: "auto", note: c.note });
    }
    for (const r of ai.extra_removals) {
      if (r.from_word < 0 || r.to_word >= count || r.from_word > r.to_word) continue;
      // Un corte extra de más de 40 palabras o 20 s es sospechoso: no se aplica sin revisión.
      if (r.to_word - r.from_word > 40 || words[r.to_word]!.end - words[r.from_word]!.start > 20) continue;
      removals.push({ from_word: r.from_word, to_word: r.to_word, reason: r.reason, confidence: clamp01(r.confidence), source: "ai", note: r.note.slice(0, 300) });
    }
  } else {
    for (const c of confidentRemovals(candidates)) {
      removals.push({ from_word: c.from_word, to_word: c.to_word, reason: c.kind, confidence: c.confidence, source: "auto", note: c.note });
    }
  }
  const normalized = normalizeRemovals(removals, count);
  const removedSet = new Set<number>();
  normalized.forEach((r) => {
    for (let id = r.from_word; id <= r.to_word; id++) removedSet.add(id);
  });

  let hooks = (ai?.hook_candidates ?? [])
    .map((h) => ({ from_word: h.from_word, to_word: h.to_word, score: clamp01(h.score), why: h.why.slice(0, 400) }))
    .filter((h) => hookIsValid(h, words, removedSet))
    .slice(0, 3);
  if (hooks.length < 3) {
    const extra = fallbackHooks(words, removedSet).filter((f) => !hooks.some((h) => h.from_word <= f.to_word && f.from_word <= h.to_word));
    hooks = [...hooks, ...extra].slice(0, 3);
  }

  const emphasis = [...new Set((ai?.emphasis_words ?? []).filter((id) => id >= 0 && id < count && !removedSet.has(id)))].slice(0, 8);

  const plan: EditPlan = {
    version: 2,
    format: input.format,
    segments: [],
    order: [],
    removals: normalized,
    proposed_removals: normalized.map((r) => ({ ...r })),
    hook_candidates: hooks,
    selected_hook: hooks.length ? 0 : null,
    captions: { preset: input.preset, emphasis_words: emphasis },
    corrections: input.corrections,
    overlays: [],
    broll: [],
    audio: { music_asset_id: null, music_db: -22, target_lufs: -14 },
    framing: { mode: "center", offset_x: 0 },
    off_script: input.offScript,
    summary: ai?.summary.slice(0, 1000) ?? "Plan armado sin IA: se cortaron solo las tomas repetidas, arranques en falso y muletillas más claras.",
    warning: ai?.warning.slice(0, 1000) ?? (input.aiError ? `La IA no respondió (${input.aiError}). Revisa los cortes con más atención.` : ""),
    planned_by: ai ? "ai" : "auto",
  };
  return withDerived(plan, words, input.duration);
}

/** Recalcula segmentos y orden, y agrega un aviso si la duración final se pasa del objetivo. */
export function withDerived(plan: EditPlan, words: Word[], duration: number): EditPlan {
  const timeline = buildTimeline(words, plan, duration);
  const { segments, order } = planSegments(timeline.clips);
  const target = FORMAT_TARGET[plan.format];
  let warning = plan.warning.replace(/\s*El video final dura [\s\S]*$/, "");
  if (timeline.duration > target.max) {
    warning = `${warning ? `${warning} ` : ""}El video final dura ${Math.round(timeline.duration)} s; para ${target.label} conviene menos de ${target.max} s.`;
  }
  return { ...plan, segments, order, warning: warning.slice(0, 1000) };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
