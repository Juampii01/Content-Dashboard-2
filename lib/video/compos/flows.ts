import "server-only";
import { cleanRefs } from "../refs";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { sentences } from "@/lib/ai/prompts/editor";
import {
  adaptTask,
  adaptWireSchema,
  COPY_RULES,
  keyMomentsTask,
  keyMomentsWireSchema,
  WHOLE_LAYOUT,
  WHOLE_RULES,
  wholeVideoTask,
  wholeVideoWireSchema,
  type WholeMode,
  recipeTask,
  recipeWireSchema,
  requestPlanTask,
  requestPlanWireSchema,
  type RecipeWire,
} from "@/lib/ai/prompts/compos";
import { getDb, schema } from "@/lib/db";
import { readBytes } from "@/lib/storage";
import { FX_INFO, FX_KINDS, type FxKind } from "../fx/catalog";
import { defaultFx, newFxId, type FxItem } from "../fx/schema";
import { TRANSITION_KINDS, type TransitionKind } from "../fx/transitions";
import { fxSegments } from "../fx/compile";
import { planSchemaFor } from "../plan";
import { outputRange, removedIds } from "../timeline";
import { referenceSummary } from "../director/reference";
import { mapText } from "../director/context";
import type { DirectorState } from "../director/types";
import type { EditPlan, Word } from "../types";
import { compositionSchema, type Composition } from "./schema";
import { fakeAdapt, fakeKeyMoments, fakeRecipe, fakeRequestPlan } from "./fake";
import { activeCount, enqueueRequest, MAX_ACTIVE } from "./requests";
import { frameFor, loadWorkCtx, newTask, newWorkId, readWork, STAGE_COST, type ComposTask, type ComposWork, type WorkCtx } from "./work";

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

export type RecipeMoment = RecipeWire["moments"][number] & { id: string };

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
  /** Animaciones reusadas de Mis efectos (en lugar de escribirlas) y lo que eso ahorró del tope. */
  reused?: number;
  savedUsd?: number;
  at: string;
};

export const readCopy = (d: DirectorState): CopyState | null => ((d as DirectorState & { copy?: CopyState | null }).copy ?? null);

async function saveDirectorExtra(projectId: string, director: DirectorState, extra: Record<string, unknown>, columns: Partial<typeof schema.videoProjects.$inferInsert> = {}): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set({ director: { ...director, ...extra, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>, ...columns })
    .where(eq(schema.videoProjects.id, projectId));
}

export async function sheetImages(keys: { key: string }[]) {
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

/** Las palabras que quedan, con las correcciones de los subtítulos (igual que las ve la animación en env.words). */
export const keptWords = (ctx: WorkCtx): Word[] => {
  const removed = removedIds(ctx.plan, ctx.words.length);
  const fixes = ctx.plan.corrections ?? {};
  return ctx.words.filter((w) => !removed.has(w.id)).map((w) => (fixes[String(w.id)] ? { ...w, text: fixes[String(w.id)]! } : w));
};

export const sentencesText = (words: Word[]) =>
  sentences(words)
    .map((f) => `[${f.from}–${f.to}] ${f.start.toFixed(1)}–${f.end.toFixed(1)} s: ${f.text}`)
    .join("\n");

/**
 * Cuántas animaciones y cuántas vueltas de revisión entran en lo que queda del tope (dejando ~USD 0,60 para la segunda
 * mirada y la revisión final). Primero calidad (al menos una vuelta con cuadros) sin bajar de 8 momentos; con tope
 * chico, menos momentos o sin revisión.
 */
function copyBudget(ctx: WorkCtx): { compose: number; lookRounds: number } {
  const usable = Math.max(0, ctx.cap - ctx.spent - 0.6);
  const perTask = STAGE_COST.plan + STAGE_COST.code * 1.15;
  for (const rounds of [3, 2, 1]) {
    const n = Math.min(14, Math.floor(usable / (perTask + rounds * STAGE_COST.look)));
    if (n >= 8) return { compose: n, lookRounds: rounds };
  }
  const withOne = Math.floor(usable / (perTask + STAGE_COST.look));
  if (withOne >= 3) return { compose: Math.min(14, withOne), lookRounds: 1 };
  return { compose: Math.max(0, Math.min(14, Math.floor(usable / perTask))), lookRounds: 0 };
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

export const momentDetail = (m: RecipeMoment) =>
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

const FUNCTION_LABEL: Record<string, string> = { gancho: "Gancho", enumeracion: "Enumeración", cifra: "Cifra", promesa: "Promesa", cta: "Llamado a la acción", enfasis: "Énfasis", historia: "Historia", prueba: "Prueba", pregunta: "Pregunta", cambio: "Cambio de tema", otro: "Otro momento" };
const KIND_LABEL: Record<string, string> = { transicion: "transición", texto: "texto animado", tarjeta: "tarjeta", camara: "movimiento de cámara", look: "look", broll: "b-roll", recorte: "recorte de la persona", subtitulos: "subtítulos", sonido: "sonido", grafico: "gráfico", imagen: "imagen" };

/** Al terminar las animaciones de la copia: el informe por momento. */
export async function finishCopy(projectId: string): Promise<CopyReport | null> {
  const ctx = await loadWorkCtx(projectId);
  const copy = ctx ? readCopy(ctx.director) : null;
  if (!ctx || !copy?.recipe) return null;
  const work = readWork(ctx.director);
  const moments = copy.recipe.moments.map((m) => {
    const map = copy.mapping?.find((x) => x.moment === m.id);
    const task = work?.tasks.find((t) => t.moment === m.id);
    const label = `${FUNCTION_LABEL[m.function] ?? m.function} · ${KIND_LABEL[m.kind] ?? m.kind}`;
    if (task?.status === "done" && task.result) {
      const score = task.score ?? null;
      return { id: m.id, label, t0: m.t0, status: (score == null || score >= 70 ? "copiado" : "aproximado") as "copiado" | "aproximado", score, how: task.reused ? `«${task.result.name}» de Mis efectos` : `animación «${task.result.name}»`, note: task.note ?? "" };
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
    reused: work?.tasks.filter((t) => t.reused && t.status === "done").length ?? 0,
    savedUsd: Math.round((work?.tasks.filter((t) => t.reused && t.status === "done").length ?? 0) * STAGE_COST.code * 100) / 100,
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
  const work: ComposWork = { id: newWorkId(), mode: "edit", tasks, startedAt: new Date().toISOString(), spentAtStart: ctx.spent, lookRounds: ctx.cap - ctx.spent > 1.5 ? 1 : 0, done: false, cannot: planned.cannot.slice(0, 400), editId: ctx.director.active?.id ?? ctx.director.pending?.id ?? null };
  await saveDirectorExtra(projectId, ctx.director, { compos: work });
  return true;
}

export class ComposRequestError extends Error {}

/**
 * Pedido desde el Estudio: una animación nueva en un tramo ("Pide una animación aquí") o un cambio a una existente
 * ("Pídele un cambio a esta animación"). Arma el taller y encola VIDEO_COMPOS; el video sigue en revisión.
 */
/** Pedidos activos a la vez por video (cada uno con su trabajo; el worker corre hasta 3 en paralelo). */
export const MAX_ACTIVE_REQUESTS = MAX_ACTIVE;

/**
 * Pedido del Estudio ("Pide una animación aquí" o "Pídele un cambio a esta animación"). Varios pueden correr a la vez:
 * cada uno es su propia fila con su reserva del tope de IA y su trabajo VIDEO_COMPOS (lib/video/compos/requests.ts).
 * Si no alcanza el tope, el pedido queda fallido con el aviso (`error`) sin frenar a los demás.
 */
/** Lo más que viaja de la charla a cada animación (lo último, que es lo que se acordó). */
export const CONVERSATION_MAX = 24000;

/**
 * La animación que ya ocupa ese tramo: una normal que se cruza con al menos el 40 % del más corto de los dos, o la pieza
 * única que lo cubre (con el segundo dentro de la pieza, para cambiar esa escena).
 */
function overlapping(ctx: WorkCtx, from: number, to: number): { comp: Composition; at: number | null } | null {
  const comps = ctx.plan.compositions ?? [];
  let best: { comp: Composition; share: number } | null = null;
  for (const c of comps) {
    if (c.long) continue;
    const inter = Math.min(c.to_word, to) - Math.max(c.from_word, from) + 1;
    if (inter <= 0) continue;
    const share = inter / Math.max(1, Math.min(c.to_word - c.from_word + 1, to - from + 1));
    if (share >= 0.4 && (!best || share > best.share)) best = { comp: c, share };
  }
  if (best) return { comp: best.comp, at: null };
  const long = comps.find((c) => c.long && c.from_word <= to && c.to_word >= from);
  if (!long) return null;
  const piece = outputRange(ctx.timeline, long.from_word, long.to_word);
  const here = outputRange(ctx.timeline, from, to);
  return { comp: long, at: piece && here ? Math.max(0, here.start - piece.start) : null };
}

export async function startStudioRequest(
  projectId: string,
  input: { from_word: number; to_word: number; instruction: string; replace: unknown | null; at?: number | null; refs?: unknown; look?: { moment: string; detail: string; sheets: { key: string; width: number; height: number }[] } | null; conversation?: string | null; autoReplace?: boolean },
  userId: string | null,
): Promise<{ workId: string; error: string | null }> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new ComposRequestError("Este video todavía no está listo para animar.");
  if (ctx.project.status !== "AWAITING_REVIEW" && ctx.project.status !== "DONE") throw new ComposRequestError("Espera a que termine lo que se está procesando.");
  if (!aiConfigured()) throw new ComposRequestError("Falta configurar la IA en esta instalación.");
  const instruction = input.instruction.trim().slice(0, 1500);
  if (instruction.length < 3) throw new ComposRequestError("Escribe qué animación quieres.");
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < ctx.words.length;
  if (!valid(input.from_word) || !valid(input.to_word) || input.from_word > input.to_word) throw new ComposRequestError("Elige un tramo del video.");
  // Con los lugares llenos (por ejemplo, durante «Animar todo el video»), el pedido queda en espera y entra solo.
  const full = (await activeCount(projectId)) >= MAX_ACTIVE_REQUESTS;
  let base: Composition | null = null;
  if (input.replace) {
    const parsed = compositionSchema.safeParse(input.replace);
    base = parsed.success ? parsed.data : (ctx.plan.compositions ?? []).find((c) => c.id === (input.replace as { id?: string })?.id) ?? null;
    if (!base) throw new ComposRequestError("No encontramos esa animación. Recarga la página.");
  }
  // Desde el chat: si ya hay una animación en ese tramo, se reemplaza (en una pieza única, la escena de ese momento).
  let at = input.at ?? null;
  if (!base && input.autoReplace) {
    const hit = overlapping(ctx, input.from_word, input.to_word);
    if (hit) {
      base = hit.comp;
      at = hit.at;
    }
  }
  // Imágenes de la persona: las nuevas, o las de estilo que ya tenía la animación que se cambia.
  const fresh = cleanRefs(projectId, input.refs);
  const refs = fresh.length ? fresh : cleanRefs(projectId, base?.refs);
  // Un cambio chico no necesita planear imágenes, salvo que las pida o mande imágenes para usar dentro.
  const needsPlan = !(base && !ANIMATION_RE.test(instruction) && !fresh.some((r) => r.use === "inside"));
  return enqueueRequest({
    projectId,
    userId,
    cap: ctx.cap,
    spent: ctx.spent,
    needsPlan,
    wait: full,
    build: (lookRounds) => {
      const task = newTask({ compId: base?.id, from_word: input.from_word, to_word: input.to_word, brief: base ? `Cambiar la animación «${base.name}»: ${instruction}` : instruction, source: "user", request: instruction, base });
      if (refs.length) task.refs = refs;
      if (input.conversation) task.conversation = input.conversation.slice(-CONVERSATION_MAX);
      // «Mira este video»: el momento de la referencia que se adapta, con sus hojas de cuadros.
      if (input.look && !base) {
        task.source = "copy";
        task.moment = input.look.moment;
        task.momentDetail = input.look.detail.slice(0, 2000);
        task.refSheets = input.look.sheets.filter((s) => s.key.startsWith(`editor/${projectId}/mirar/`)).slice(0, 2);
      }
      if (!needsPlan) task.status = "code";
      // Pieza única: se conserva todo (escenas, franja fija) y, si se pidió en un punto, se cambia solo esa escena.
      if (base?.long) {
        task.long = true;
        if (base.scenes?.length) task.scenes = base.scenes;
        if (base.frame) task.frame = base.frame;
        if (at != null && base.scenes?.length) {
          const t = at;
          const i = base.scenes.findIndex((sc) => t >= sc.start && t < sc.end);
          task.scene = i >= 0 ? i : base.scenes.reduce((best, sc, k) => (Math.abs(sc.start - t) < Math.abs(base!.scenes![best]!.start - t) ? k : best), 0);
        }
      }
      return {
        id: newWorkId(),
        mode: "request",
        tasks: [task],
        startedAt: new Date().toISOString(),
        spentAtStart: ctx.spent,
        lookRounds,
        done: false,
        request: { instruction, from_word: input.from_word, to_word: input.to_word, replaceId: base?.id ?? null },
      };
    },
  });
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

// ─── Animar todo el video ────────────────────────────────────────────────

export type WholeMoment = { from_word: number; to_word: number; start: number; end: number; said: string; title: string; prompt: string };
export type WholePlan = { mode: WholeMode; style: string; moments: WholeMoment[] };

/** Cuántas animaciones según el modo y la duración (una cada ~5 s con la cara; una cada ~5 s a pantalla completa). */
export function wholeCount(mode: WholeMode, seconds: number): { min: number; max: number } {
  if (mode !== "face") return { min: Math.max(2, Math.ceil(seconds / 9)), max: Math.min(30, Math.max(3, Math.ceil(seconds / 3.5))) };
  return { min: Math.min(20, Math.max(2, Math.round(seconds / 9))), max: Math.min(20, Math.max(3, Math.round(seconds / 5))) };
}

/**
 * Ordena, recorta y limpia lo que propuso la IA: ids válidos y de palabras que quedan, sin superposiciones; en pantalla
 * completa, además, sin huecos (cada una llega hasta la siguiente y cubren de la primera a la última palabra).
 */
export function cleanWhole(mode: WholeMode, words: Word[], raw: { from_word: number; to_word: number; title: string; prompt: string }[], max: number): Omit<WholeMoment, "start" | "end" | "said">[] {
  if (!words.length) return [];
  const ids = words.map((w) => w.id);
  const snap = (id: number, dir: 1 | -1) => {
    if (dir > 0) return ids.find((x) => x >= id) ?? ids[ids.length - 1]!;
    return [...ids].reverse().find((x) => x <= id) ?? ids[0]!;
  };
  const sorted = raw
    .filter((m) => Number.isInteger(m.from_word) && Number.isInteger(m.to_word) && m.prompt.trim().length >= 20)
    .map((m) => ({ from_word: snap(Math.min(m.from_word, m.to_word), 1), to_word: snap(Math.max(m.from_word, m.to_word), -1), title: m.title.trim().slice(0, 80) || "Animación", prompt: m.prompt.trim().slice(0, 1100) }))
    .filter((m) => m.from_word <= m.to_word)
    .sort((a, b) => a.from_word - b.from_word);
  const out: typeof sorted = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.from_word <= last.to_word) {
      if (mode !== "face") m.from_word = last.to_word + 1;
      else continue;
      if (m.from_word > m.to_word) continue;
    }
    out.push(m);
    if (out.length >= max) break;
  }
  // Todos los modos menos «Con tu cara» cubren el video entero (la disposición de la pantalla es la misma siempre).
  if (mode !== "face" && out.length) {
    out[0]!.from_word = ids[0]!;
    for (let i = 0; i < out.length - 1; i++) {
      const nextStart = out[i + 1]!.from_word;
      out[i]!.to_word = [...ids].reverse().find((x) => x < nextStart) ?? out[i]!.to_word;
    }
    out[out.length - 1]!.to_word = ids[ids.length - 1]!;
  }
  return out;
}

/** «Animar todo el video», paso 1: Claude lee el video y propone el estilo y un pedido por momento (para revisar). */
export async function planWholeVideo(projectId: string, input: { mode: WholeMode; notes: string; conversation?: string | null }): Promise<WholePlan> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new ComposRequestError("Este video todavía no está listo para animar.");
  if (ctx.project.status !== "AWAITING_REVIEW" && ctx.project.status !== "DONE") throw new ComposRequestError("Espera a que termine lo que se está procesando.");
  if (!aiConfigured()) throw new ComposRequestError("Falta configurar la IA en esta instalación.");
  const words = keptWords(ctx);
  if (words.length < 4) throw new ComposRequestError("El video tiene muy poco texto para armar animaciones.");
  const count = wholeCount(input.mode, ctx.timeline.duration);
  const out = (w: Word) => ctx.timeline.words.find((x) => x.id === w.id);
  const text = sentences(words)
    .map((f) => {
      const a = out(words.find((w) => w.id === f.from)!);
      const b = out(words.find((w) => w.id === f.to)!);
      return `[${f.from}–${f.to}] ${(a?.start ?? f.start).toFixed(1)}–${(b?.end ?? f.end).toFixed(1)} s: ${f.text}`;
    })
    .join("\n");
  let wire: { style: string; moments: { from_word: number; to_word: number; title: string; prompt: string }[] };
  try {
    wire = await generateStructured({
      feature: "video.compos.todo",
      model: "main",
      thinking: { effort: "medium" },
      context: `${WHOLE_RULES}\n\n${ctx.brandCtx}`,
      task: wholeVideoTask({ mode: input.mode, duration: ctx.timeline.duration, format: ctx.format, sentences: text, map: mapText(ctx.director.map, ctx.words), notes: input.conversation ? `${input.notes.trim().slice(0, 800)}\n\nLA CHARLA COMPLETA CON LA PERSONA (arma las escenas con todo lo que pidió o aceptó ahí, sin dejar nada afuera):\n${input.conversation.slice(-CONVERSATION_MAX)}` : input.notes.trim().slice(0, 800), count }),
      schema: wholeVideoWireSchema,
      maxTokens: 20000,
      timeoutMs: 280_000,
      videoProjectId: projectId,
      fake: () => ({
        style: "Fondo negro con grano, blanco y el color de la marca, tipografía serif grande, movimientos de cámara lentos y golpes de sonido graves.",
        moments: sentences(words).slice(0, count.max).map((f) => ({ from_word: f.from, to_word: f.to, title: f.text.split(" ").slice(0, 4).join(" "), prompt: `Animación sobre «${f.text}»: la frase aparece palabra por palabra en serif blanca sobre un fondo que se mueve lento, con un destello del color de la marca al final.` })),
      }),
    });
  } catch (error) {
    console.error("[compos] todo el video:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    throw new ComposRequestError(error instanceof AiError ? error.message : "No pudimos armar el plan con IA. Prueba de nuevo.");
  }
  const moments = cleanWhole(input.mode, words, wire.moments, count.max).map((m) => {
    const r = outputRange(ctx.timeline, m.from_word, m.to_word);
    return { ...m, start: r?.start ?? 0, end: r?.end ?? 0, said: words.filter((w) => w.id >= m.from_word && w.id <= m.to_word).map((w) => w.text).join(" ").slice(0, 300) };
  });
  if (!moments.length) throw new ComposRequestError("La IA no propuso animaciones para este video. Prueba de nuevo.");
  return { mode: input.mode, style: wire.style.trim().slice(0, 500), moments };
}

/**
 * «Animar todo el video», paso 2: UNA sola animación de principio a fin del video (una pieza, con inicio y cierre),
 * armada por las escenas que se revisaron. En «Mitad y mitad» y «Fondo blanco arriba», la franja de la persona es fija
 * (la dibuja el motor con el encuadre elegido; la IA solo anima arriba). Después se cambia por escena.
 */
export async function startWholeVideo(projectId: string, plan: { mode: WholeMode; style: string; moments: { from_word: number; to_word: number; prompt: string; title?: string }[]; conversation?: string | null }, userId: string | null): Promise<{ count: number; workId: string; error: string | null }> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) throw new ComposRequestError("Este video todavía no está listo para animar.");
  if (ctx.project.status !== "AWAITING_REVIEW" && ctx.project.status !== "DONE") throw new ComposRequestError("Espera a que termine lo que se está procesando.");
  if (!aiConfigured()) throw new ComposRequestError("Falta configurar la IA en esta instalación.");
  const words = keptWords(ctx);
  if (!words.length) throw new ComposRequestError("El video no tiene texto para animar.");
  const moments = cleanWhole(plan.mode, words, plan.moments.map((m) => ({ ...m, title: m.title ?? "" })), 30);
  if (!moments.length) throw new ComposRequestError("No quedó ninguna escena para crear.");
  const from = words[0]!.id;
  const to = words[words.length - 1]!.id;
  const piece = outputRange(ctx.timeline, from, to);
  if (!piece) throw new ComposRequestError("No pudimos ubicar el video. Recarga la página.");
  const pieceStart = Math.max(0, piece.start - 0.05);
  const scenes = moments.map((m, i) => {
    const r = outputRange(ctx.timeline, m.from_word, m.to_word);
    const a = Math.max(0, (r?.start ?? 0) - pieceStart);
    const b = Math.max(a + 0.5, (r?.end ?? a + 1) - pieceStart);
    return { title: (m.title || `Escena ${i + 1}`).slice(0, 80), start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100, brief: m.prompt.slice(0, 1200) };
  });
  // En los modos que cubren todo, cada escena llega hasta la siguiente y la primera arranca en 0.
  if (plan.mode !== "face") {
    scenes[0]!.start = 0;
    for (let i = 0; i < scenes.length - 1; i++) scenes[i]!.end = scenes[i + 1]!.start;
  }
  const style = plan.style.trim().slice(0, 500);
  const layout = WHOLE_LAYOUT[plan.mode];
  const outside = plan.mode === "face" ? "Fuera de las escenas no dibujes nada: se ve a la persona hablando (background \"video\")." : "";
  const instruction = `Pieza única de animación para TODO el video, de principio a fin, con las escenas de la lista. ${layout} ${outside} ${style ? `ESTILO COMÚN: ${style}` : ""}`.replace(/\s+/g, " ").trim().slice(0, 1500);
  const frame = plan.mode === "split" || plan.mode === "top" ? frameFor(ctx, plan.mode, { start: piece.start, end: piece.end }) : undefined;
  const { workId, error } = await enqueueRequest({
    projectId,
    userId,
    cap: ctx.cap,
    spent: ctx.spent,
    needsPlan: true,
    build: (lookRounds) => {
      const task = newTask({ from_word: from, to_word: to, brief: instruction, source: "user", request: instruction });
      task.long = true;
      task.scenes = scenes;
      if (frame) task.frame = frame;
      if (plan.conversation) task.conversation = plan.conversation.slice(-CONVERSATION_MAX);
      return {
        id: newWorkId(),
        mode: "request",
        tasks: [task],
        startedAt: new Date().toISOString(),
        spentAtStart: ctx.spent,
        lookRounds: Math.min(lookRounds, 1),
        done: false,
        request: { instruction, from_word: from, to_word: to, replaceId: null },
      };
    },
  });
  return { count: scenes.length, workId, error };
}
