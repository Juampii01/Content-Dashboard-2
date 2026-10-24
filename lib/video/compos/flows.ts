import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { sentences } from "@/lib/ai/prompts/editor";
import {
  adaptTask,
  adaptWireSchema,
  COPY_RULES,
  keyMomentsTask,
  keyMomentsWireSchema,
  recipeTask,
  recipeWireSchema,
  requestPlanTask,
  requestPlanWireSchema,
  type RecipeWire,
} from "@/lib/ai/prompts/compos";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { readBytes } from "@/lib/storage";
import { FX_INFO, FX_KINDS, type FxKind } from "../fx/catalog";
import { defaultFx, newFxId, type FxItem } from "../fx/schema";
import { TRANSITION_KINDS, type TransitionKind } from "../fx/transitions";
import { fxSegments } from "../fx/compile";
import { planSchemaFor } from "../plan";
import { removedIds } from "../timeline";
import { referenceSummary } from "../director/reference";
import { mapText } from "../director/context";
import type { DirectorState } from "../director/types";
import type { EditPlan, Word } from "../types";
import { compositionSchema, type Composition } from "./schema";
import { fakeAdapt, fakeKeyMoments, fakeRecipe, fakeRequestPlan } from "./fake";
import { loadWorkCtx, newTask, newWorkId, readWork, STAGE_COST, type ComposTask, type ComposWork, type WorkCtx } from "./work";

/**
 * Los tres caminos que llenan el taller de composiciones:
 * - "Copiar edición": receta de la referencia (Opus mira los cuadros densos) → adaptación al guion nuevo (por función)
 *   → una animación por momento (con la ficha del momento y sus cuadros) → revisión contra la referencia → informe
 *   "copié N de M momentos".
 * - Pedidos: "Pide una animación aquí" y "Pídele un cambio a esta animación" (Estudio, trabajo VIDEO_COMPOS) y los
 *   pedidos de animaciones o imágenes en "Edítalo así".
 * - Variedad: sin referencia, el director escribe animaciones propias para 2 o 3 momentos clave, rotando familias
 *   respecto de los últimos videos de la marca.
 */

type RecipeMoment = RecipeWire["moments"][number] & { id: string };

type CopyState = {
  referenceId: string;
  /** El pedido de "Edítalo así" que la empezó (para no repetir vueltas del director). */
  editId?: string | null;
  status: "recipe" | "adapt" | "compose" | "done" | "failed";
  recipe?: Omit<RecipeWire, "moments"> & { moments: RecipeMoment[] };
  mapping?: { moment: string; plan: "compose" | "catalog" | "skip"; from_word: number; to_word: number; reason: string; applied?: string | null }[];
  report?: CopyReport | null;
  error?: string | null;
};

export type CopyReport = {
  total: number;
  copied: number;
  approx: number;
  missed: number;
  moments: { id: string; label: string; t0: number; status: "copiado" | "aproximado" | "no"; score: number | null; how: string; note: string }[];
  costUsd: number;
  at: string;
};

export const readCopy = (d: DirectorState): CopyState | null => ((d as DirectorState & { copy?: CopyState | null }).copy ?? null);

async function saveDirectorExtra(projectId: string, director: DirectorState, extra: Record<string, unknown>, columns: Partial<typeof schema.videoProjects.$inferInsert> = {}): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set({ director: { ...director, ...extra, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>, ...columns })
    .where(eq(schema.videoProjects.id, projectId));
}

async function sheetImages(keys: { key: string }[]) {
  const out: { mediaType: "image/jpeg"; data: string }[] = [];
  for (const k of keys) {
    try {
      out.push({ mediaType: "image/jpeg", data: (await readBytes(k.key, 6 * 1024 * 1024)).toString("base64") });
    } catch (error) {
      console.error("[copiar] hoja ilegible:", error instanceof Error ? error.message : error);
    }
  }
  return out;
}

const keptWords = (ctx: WorkCtx): Word[] => {
  const removed = removedIds(ctx.plan, ctx.words.length);
  return ctx.words.filter((w) => !removed.has(w.id));
};

const sentencesText = (words: Word[]) =>
  sentences(words)
    .map((f) => `[${f.from}–${f.to}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");

/** Cuánto presupuesto dejar para las animaciones de la copia y cuántas vueltas de revisión. */
function copyBudget(ctx: WorkCtx): { compose: number; lookRounds: number } {
  const left = ctx.cap - ctx.spent;
  const perTask = STAGE_COST.plan + STAGE_COST.code * 1.3;
  // Reserva para la segunda mirada del director y la revisión final.
  const usable = Math.max(0, left - 0.6);
  const lookRounds = usable > 9 * (perTask + STAGE_COST.look * 2) ? 3 : usable > 6 * (perTask + STAGE_COST.look) ? 2 : usable > 4 * perTask + 4 * STAGE_COST.look ? 1 : 0;
  const per = perTask + lookRounds * STAGE_COST.look;
  return { compose: Math.max(0, Math.min(14, Math.floor(usable / per))), lookRounds };
}

// ─── Copiar edición ──────────────────────────────────────────────────────

/** Después de dirigir con la referencia: ¿empieza la copia de animaciones? */
export function wantsCopy(director: DirectorState): boolean {
  const pending = director.pending as (DirectorState["pending"] & { copy?: boolean }) | null;
  return Boolean(pending?.copy && director.reference?.status === "ready" && director.reference.id === pending.reference?.id);
}

export async function startCopy(projectId: string): Promise<{ step: "recipe" } | null> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx || ctx.director.reference?.status !== "ready") return null;
  const copy: CopyState = { referenceId: ctx.director.reference.id, status: "recipe", editId: ctx.director.active?.id ?? ctx.director.pending?.id ?? null };
  await saveDirectorExtra(projectId, ctx.director, { copy, compos: null });
  return { step: "recipe" };
}

/** Receta: Opus mira todos los cuadros de la referencia y la desarma en momentos. */
export async function recipeStep(projectId: string): Promise<{ step: string; label?: string }> {
  const ctx = await loadWorkCtx(projectId);
  const copy = ctx ? readCopy(ctx.director) : null;
  const ref = ctx?.director.reference;
  if (!ctx || !copy || !ref || ref.status !== "ready") return { step: "compos-skip" };
  const m = ref.metrics;
  const moments = ref.moments ?? [];
  let recipe: RecipeWire;
  try {
    recipe = await generateStructured({
      feature: "video.compos.receta",
      model: "deep",
      thinking: { effort: "high" },
      context: `${COPY_RULES}\n\n${ctx.brandCtx}`,
      task: recipeTask({
        duration: m?.duration ?? (moments.at(-1)?.t ?? 30),
        aspect: m?.aspect ?? "9:16",
        metrics: referenceSummary(m) || "(sin medidas)",
        moments: moments.map((x) => `R#${x.frame} ${x.t.toFixed(2)} s${x.cut ? " · corte" : ""}${x.face ? " · persona" : " · sin persona"}${x.text ? ` · texto «${x.text.slice(0, 60)}»` : ""}${x.said ? ` · dice «${x.said.slice(0, 60)}»` : ""}`).join("\n"),
        transcript: ref.transcript ?? "",
        sheets: (ref.sheets ?? []).length,
        frames: moments.length,
      }),
      images: await sheetImages(ref.sheets ?? []),
      imageSizes: (ref.sheets ?? []).map((s) => ({ width: s.width, height: s.height })),
      schema: recipeWireSchema,
      maxTokens: 32000,
      timeoutMs: 600_000,
      videoProjectId: projectId,
      fake: () => fakeRecipe(moments, m?.duration ?? 30),
    });
  } catch (error) {
    console.error("[copiar] receta:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    await saveDirectorExtra(projectId, ctx.director, { copy: { ...copy, status: "failed", error: "No pudimos desarmar la referencia con IA. Quedó la edición del director con el ritmo y los subtítulos de la referencia." } });
    return { step: "compos-skip" };
  }
  const withIds = { ...recipe, moments: recipe.moments.slice(0, 40).map((x, i) => ({ ...x, id: `m${i + 1}` })) };
  await saveDirectorExtra(projectId, ctx.director, { copy: { ...copy, status: "adapt", recipe: withIds } });
  return { step: "adapt", label: `Adaptando ${withIds.moments.length} momentos de la referencia a tu video` };
}

const momentDetail = (m: RecipeMoment) =>
  `${m.id} (${m.kind}, ${m.function}, ${m.t0.toFixed(1)}–${m.t1.toFixed(1)} s en la referencia, cuadros ${m.frames.map((f) => `R#${f}`).join(", ")})\nSe ve: ${m.visual}\nMovimiento: ${m.motion}\nCon lo que se dice: ${m.relation}`;

/** Adaptación: cada momento al tramo del video nuevo que cumple la misma función. Arma el taller. */
export async function adaptStep(projectId: string): Promise<{ step: string; label?: string }> {
  const ctx = await loadWorkCtx(projectId);
  const copy = ctx ? readCopy(ctx.director) : null;
  if (!ctx || !copy?.recipe) return { step: "compos-skip" };
  const recipe = copy.recipe;
  const words = keptWords(ctx);
  const budget = copyBudget(ctx);
  const recipeText = [
    recipe.summary,
    ...Object.entries(recipe.global).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`),
    "MOMENTOS:",
    ...recipe.moments.map((m) => `${m.id} [importancia ${m.importance}] ${m.t0.toFixed(1)}–${m.t1.toFixed(1)} s · ${m.kind} · ${m.function}${m.catalog ? ` · biblioteca: ${m.catalog}` : ""}: ${m.visual} | ${m.motion} | ${m.relation}`),
  ].join("\n");
  const taken = [
    ...fxSegments(ctx.timeline, ctx.plan.effects ?? []).map((s) => `efecto ${s.item.kind} [${s.item.from_word}–${s.item.to_word}]`),
    ...ctx.plan.broll.filter((b) => b.choice).map((b) => `b-roll [${b.from_word}–${b.to_word}]`),
  ].join("\n");
  let mapping: { moments: { moment: string; plan: "compose" | "catalog" | "skip"; from_word: number; to_word: number; brief: string; texts: string[]; reason: string }[] };
  try {
    mapping = await generateStructured({
      feature: "video.compos.adaptar",
      model: "deep",
      thinking: { effort: "medium" },
      context: `${COPY_RULES}\n\n${ctx.brandCtx}`,
      task: adaptTask({ recipe: recipeText, sentences: sentencesText(words), duration: ctx.timeline.duration, maxCompose: budget.compose, taken }),
      schema: adaptWireSchema,
      maxTokens: 16000,
      timeoutMs: 400_000,
      videoProjectId: projectId,
      fake: () =>
        fakeAdapt(
          recipe.moments.map((m) => ({ id: m.id, function: m.function, importance: m.importance })),
          sentences(words),
          budget.compose,
        ),
    });
  } catch (error) {
    console.error("[copiar] adaptar:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    await saveDirectorExtra(projectId, ctx.director, { copy: { ...copy, status: "failed", error: "No pudimos adaptar la referencia a tu video." } });
    return { step: "compos-skip" };
  }
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < ctx.words.length;
  const removed = removedIds(ctx.plan, ctx.words.length);
  const ok = mapping.moments.filter((x) => valid(x.from_word) && valid(x.to_word) && x.from_word <= x.to_word && recipe.moments.some((m) => m.id === x.moment));
  // Sin pisarse entre sí: el más importante primero.
  const byImportance = [...ok].sort((a, b) => (recipe.moments.find((m) => m.id === b.moment)?.importance ?? 1) - (recipe.moments.find((m) => m.id === a.moment)?.importance ?? 1));
  const placed: typeof ok = [];
  for (const x of byImportance) {
    if (x.plan !== "skip" && placed.some((p) => p.plan !== "skip" && x.from_word <= p.to_word && p.from_word <= x.to_word)) {
      placed.push({ ...x, plan: "skip", reason: `${x.reason} (se pisaba con otro momento más importante)` });
      continue;
    }
    placed.push(x);
  }
  // Los de la biblioteca se ponen ahora (efecto o transición), si coinciden de verdad.
  let plan = ctx.plan;
  const mapRecords: NonNullable<CopyState["mapping"]> = [];
  for (const x of placed) {
    const m = recipe.moments.find((r) => r.id === x.moment)!;
    let applied: string | null = null;
    if (x.plan === "catalog" && m.catalog) {
      const res = applyCatalog(plan, m.catalog, x, words, removed);
      if (res) {
        plan = res.plan;
        applied = res.label;
      }
    }
    mapRecords.push({ moment: x.moment, plan: x.plan, from_word: x.from_word, to_word: x.to_word, reason: x.reason.slice(0, 300), applied });
  }
  if (plan !== ctx.plan && !planSchemaFor(ctx.words.length).safeParse(plan).success) plan = ctx.plan;
  const tasks: ComposTask[] = placed
    .filter((x) => x.plan === "compose")
    .slice(0, budget.compose)
    .map((x) => {
      const m = recipe.moments.find((r) => r.id === x.moment)!;
      return newTask({
        from_word: x.from_word,
        to_word: x.to_word,
        brief: `${x.brief}${x.texts.length ? `\nTextos en pantalla: ${x.texts.map((t) => `«${t}»`).join(", ")}` : ""}`.slice(0, 1500),
        source: "copy",
        moment: m.id,
        momentDetail: momentDetail(m),
        refFrames: m.frames.slice(0, 12),
      });
    });
  const work: ComposWork = { id: newWorkId(), mode: "copy", tasks, startedAt: new Date().toISOString(), spentAtStart: ctx.spent, lookRounds: budget.lookRounds, done: tasks.length === 0 };
  await saveDirectorExtra(projectId, ctx.director, { copy: { ...copy, status: "compose", mapping: mapRecords }, compos: work }, plan !== ctx.plan ? { plan } : {});
  return { step: tasks.length ? "compos" : "compos-skip", label: tasks.length ? `Programando ${tasks.length} animaciones a medida` : undefined };
}

/** Un momento de la receta que coincide con un efecto o una transición de la biblioteca: se pone tal cual. */
function applyCatalog(plan: EditPlan, key: string, x: { from_word: number; to_word: number }, words: Word[], removed: Set<number>): { plan: EditPlan; label: string } | null {
  const k = key.trim();
  if ((FX_KINDS as readonly string[]).includes(k)) {
    const kind = k as FxKind;
    const overlap = (a: { from_word: number; to_word: number }) => a.from_word <= x.to_word && x.from_word <= a.to_word;
    if ((plan.effects ?? []).some(overlap) || plan.broll.some((b) => b.choice && overlap(b))) return null;
    const spoken = words.filter((w) => w.id >= x.from_word && w.id <= x.to_word && !removed.has(w.id)).map((w) => ({ id: w.id, text: w.text }));
    const item: FxItem = { id: newFxId(), kind, from_word: x.from_word, to_word: x.to_word, ...defaultFx(kind, spoken), why: "Copiado de la referencia.", source: "director" };
    return { plan: { ...plan, effects: [...(plan.effects ?? []), item].sort((a, b) => a.from_word - b.from_word).slice(0, 40) }, label: `efecto «${FX_INFO[kind].label}»` };
  }
  if ((TRANSITION_KINDS as readonly string[]).includes(k)) {
    const kind = k as TransitionKind;
    if ((plan.transitions ?? []).some((t) => t.at_word === x.from_word)) return null;
    return { plan: { ...plan, transitions: [...(plan.transitions ?? []), { id: `tr${Date.now().toString(36)}${x.from_word}`, kind, at_word: x.from_word, source: "director", why: "Copiada de la referencia." }] }, label: `transición ${kind}` };
  }
  return null;
}

/** Al terminar las animaciones de la copia: el informe por momento. */
export async function finishCopy(projectId: string): Promise<CopyReport | null> {
  const ctx = await loadWorkCtx(projectId);
  const copy = ctx ? readCopy(ctx.director) : null;
  if (!ctx || !copy?.recipe) return null;
  const work = readWork(ctx.director);
  const moments = copy.recipe.moments.map((m) => {
    const map = copy.mapping?.find((x) => x.moment === m.id);
    const task = work?.tasks.find((t) => t.moment === m.id);
    const label = `${m.function} · ${m.kind}`;
    if (task?.status === "done" && task.result) {
      const score = task.score ?? null;
      return { id: m.id, label, t0: m.t0, status: (score == null || score >= 70 ? "copiado" : "aproximado") as "copiado" | "aproximado", score, how: `animación «${task.result.name}»`, note: task.note ?? "" };
    }
    if (map?.plan === "catalog") {
      // Ritmo, subtítulos y zooms los copia el director; un efecto de la biblioteca, si coincidía.
      return { id: m.id, label, t0: m.t0, status: "aproximado" as const, score: null, how: map.applied ?? "con el ritmo, los subtítulos o los zooms de la edición", note: map.reason };
    }
    return { id: m.id, label, t0: m.t0, status: "no" as const, score: null, how: "", note: task?.error || map?.reason || "No hubo un momento equivalente en tu video." };
  });
  const report: CopyReport = {
    total: moments.length,
    copied: moments.filter((m) => m.status === "copiado").length,
    approx: moments.filter((m) => m.status === "aproximado").length,
    missed: moments.filter((m) => m.status === "no").length,
    moments,
    costUsd: Math.max(0, ctx.spent - (work?.spentAtStart ?? ctx.spent)),
    at: new Date().toISOString(),
  };
  await saveDirectorExtra(projectId, ctx.director, { copy: { ...copy, status: "done", report } });
  return report;
}

// ─── Pedidos ─────────────────────────────────────────────────────────────

const ANIMATION_RE = /\banimaci[oó]n|\banima\b|\banimar\b|\bimagen\b|\bim[aá]genes\b|\bmapa\b|\bflecha|\bcre[aá] con ia|\bgener[aá] con ia|\bmotion\b|\bgr[aá]fico animado|\bcomposici[oó]n|\bque se vea\b|\bhac[eé] foco|\bzoom (a|en) (la|el)\b/i;

/** ¿El pedido de "Edítalo así" incluye animaciones o imágenes a medida? */
export const asksForAnimation = (instruction: string) => ANIMATION_RE.test(instruction);

/** "Edítalo así" con animaciones: Claude arma la lista (dónde va cada una) y se abre el taller. */
export async function startEditRequest(projectId: string, instruction: string): Promise<boolean> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx || !aiConfigured()) return false;
  const words = keptWords(ctx);
  let planned: { tasks: { from_word: number; to_word: number; brief: string }[]; cannot: string };
  try {
    planned = await generateStructured({
      feature: "video.compos.pedido",
      model: "main",
      context: `${COPY_RULES}\n\n${ctx.brandCtx}`,
      task: requestPlanTask({ instruction, sentences: sentencesText(words), span: null }),
      schema: requestPlanWireSchema,
      maxTokens: 4000,
      videoProjectId: projectId,
      fake: () => fakeRequestPlan(instruction, null, sentences(words)),
    });
  } catch (error) {
    console.error("[compos] pedido:", error instanceof AiError ? error.detail : error);
    return false;
  }
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < ctx.words.length;
  const tasks = planned.tasks.filter((t) => valid(t.from_word) && valid(t.to_word) && t.from_word <= t.to_word).slice(0, 4).map((t) => newTask({ from_word: t.from_word, to_word: t.to_word, brief: t.brief.slice(0, 1500), source: "user", request: instruction }));
  if (!tasks.length) return false;
  const work: ComposWork = { id: newWorkId(), mode: "edit", tasks, startedAt: new Date().toISOString(), spentAtStart: ctx.spent, lookRounds: ctx.cap - ctx.spent > 3 ? 2 : ctx.cap - ctx.spent > 1.5 ? 1 : 0, done: false, cannot: planned.cannot.slice(0, 400) };
  await saveDirectorExtra(projectId, ctx.director, { compos: work });
  return true;
}

export class ComposRequestError extends Error {}

/**
 * Pedido desde el Estudio: una animación nueva en un tramo ("Pide una animación aquí") o un cambio a una existente
 * ("Pídele un cambio a esta animación"). Arma el taller y encola VIDEO_COMPOS; el video sigue en revisión.
 */
export async function startStudioRequest(projectId: string, input: { from_word: number; to_word: number; instruction: string; replace: unknown | null }, userId: string | null): Promise<{ workId: string }> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new ComposRequestError("Este video todavía no está listo para animar.");
  if (ctx.project.status !== "AWAITING_REVIEW" && ctx.project.status !== "DONE") throw new ComposRequestError("Espera a que termine lo que se está procesando.");
  if (!aiConfigured()) throw new ComposRequestError("Falta configurar la IA en esta instalación.");
  const current = readWork(ctx.director);
  if (current && !current.done && Date.now() - new Date(current.startedAt).getTime() < 30 * 60_000) throw new ComposRequestError("Ya hay una animación en curso. Espera a que termine.");
  const instruction = input.instruction.trim().slice(0, 600);
  if (instruction.length < 3) throw new ComposRequestError("Escribe qué animación quieres.");
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < ctx.words.length;
  if (!valid(input.from_word) || !valid(input.to_word) || input.from_word > input.to_word) throw new ComposRequestError("Elige un tramo del video.");
  if (ctx.cap - ctx.spent < STAGE_COST.code + STAGE_COST.plan) throw new ComposRequestError(`No queda tope de IA para este video (usaste USD ${ctx.spent.toFixed(2)} de ${ctx.cap.toFixed(2)}). Súbelo en el brief del director.`);
  let base: Composition | null = null;
  if (input.replace) {
    const parsed = compositionSchema.safeParse(input.replace);
    base = parsed.success ? parsed.data : (ctx.plan.compositions ?? []).find((c) => c.id === (input.replace as { id?: string })?.id) ?? null;
    if (!base) throw new ComposRequestError("No encontramos esa animación. Recarga la página.");
  }
  const task = newTask({ compId: base?.id, from_word: input.from_word, to_word: input.to_word, brief: base ? `Cambiar la animación «${base.name}»: ${instruction}` : instruction, source: "user", request: instruction, base });
  // Un cambio chico no necesita planear imágenes, salvo que las pida.
  if (base && !ANIMATION_RE.test(instruction)) task.status = "code";
  const left = ctx.cap - ctx.spent;
  const work: ComposWork = {
    id: newWorkId(),
    mode: "request",
    tasks: [task],
    startedAt: new Date().toISOString(),
    spentAtStart: ctx.spent,
    lookRounds: left > 2 ? 2 : left > 1.2 ? 1 : 0,
    done: false,
    request: { instruction, from_word: input.from_word, to_word: input.to_word, replaceId: base?.id ?? null },
  };
  await saveDirectorExtra(projectId, ctx.director, { compos: work });
  await enqueueJob({ type: "VIDEO_COMPOS", videoProjectId: projectId, createdBy: userId, stage: "En cola", maxAttempts: 2, input: { projectId, workId: work.id } });
  return { workId: work.id };
}

// ─── Variedad (sin referencia) ───────────────────────────────────────────

/** Familias de animaciones y efectos que usó la marca en sus últimos videos (para rotar). */
export async function recentUsage(excludeId: string, limit = 8): Promise<{ families: string[]; fx: FxKind[]; transitions: string[] }> {
  const rows = await getDb()
    .select({ plan: schema.videoProjects.plan })
    .from(schema.videoProjects)
    .where(and(ne(schema.videoProjects.id, excludeId), sql`${schema.videoProjects.plan} is not null`))
    .orderBy(desc(schema.videoProjects.updatedAt))
    .limit(limit)
    .catch(() => []);
  const families = new Map<string, number>();
  const fx = new Map<FxKind, number>();
  const transitions = new Map<string, number>();
  for (const r of rows) {
    const p = r.plan as EditPlan | null;
    for (const c of p?.compositions ?? []) for (const t of c.tags ?? []) families.set(t, (families.get(t) ?? 0) + 1);
    for (const e of p?.effects ?? []) fx.set(e.kind, (fx.get(e.kind) ?? 0) + 1);
    for (const t of p?.transitions ?? []) transitions.set(t.kind, (transitions.get(t.kind) ?? 0) + 1);
  }
  const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { families: top(families).slice(0, 12), fx: top(fx).slice(0, 16), transitions: top(transitions).slice(0, 8) };
}

/** Sin referencia: 2 o 3 animaciones a medida en momentos clave, si el tope alcanza. */
export async function startVariety(projectId: string, mapTextOverride?: string): Promise<boolean> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx || !aiConfigured()) return false;
  const left = ctx.cap - ctx.spent;
  const per = STAGE_COST.plan + STAGE_COST.code * 1.3 + STAGE_COST.look;
  // Reserva para la segunda mirada y la revisión final.
  const count = Math.min(3, Math.floor((left - 1.2) / per));
  if (count < 1) return false;
  const words = keptWords(ctx);
  const recent = await recentUsage(projectId);
  const taken = [
    ...fxSegments(ctx.timeline, ctx.plan.effects ?? []).map((s) => `efecto ${s.item.kind} [${s.item.from_word}–${s.item.to_word}]`),
    ...ctx.plan.broll.filter((b) => b.choice).map((b) => `b-roll [${b.from_word}–${b.to_word}]`),
  ].join("\n");
  let picked: { moments: { from_word: number; to_word: number; brief: string; family: string }[] };
  try {
    picked = await generateStructured({
      feature: "video.compos.momentos",
      model: "main",
      context: `${COPY_RULES}\n\n${ctx.brandCtx}`,
      task: keyMomentsTask({ sentences: sentencesText(words), map: mapTextOverride ?? mapText(ctx.director.map, ctx.words), count, avoid: recent.families.join(", "), taken }),
      schema: keyMomentsWireSchema,
      maxTokens: 3000,
      videoProjectId: projectId,
      fake: () => fakeKeyMoments(sentences(words), count),
    });
  } catch (error) {
    console.error("[compos] momentos:", error instanceof AiError ? error.detail : error);
    return false;
  }
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < ctx.words.length;
  const tasks: ComposTask[] = [];
  for (const m of picked.moments) {
    if (!valid(m.from_word) || !valid(m.to_word) || m.from_word > m.to_word) continue;
    if (tasks.some((t) => m.from_word <= t.to_word && t.from_word <= m.to_word)) continue;
    tasks.push(newTask({ from_word: m.from_word, to_word: m.to_word, brief: m.brief.slice(0, 1200), source: "director", family: m.family }));
    if (tasks.length >= count) break;
  }
  if (!tasks.length) return false;
  const work: ComposWork = { id: newWorkId(), mode: "variety", tasks, startedAt: new Date().toISOString(), spentAtStart: ctx.spent, lookRounds: left > 5 ? 1 : 0, done: false };
  await saveDirectorExtra(projectId, ctx.director, { compos: work, recentFamilies: recent.families });
  return true;
}
