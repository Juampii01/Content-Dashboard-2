import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import {
  CRITIC_RULES,
  criticEditWireSchema,
  criticTask,
  criticWireSchema,
  DIRECTOR_RULES,
  directorTask,
  directorApiSchema,
  directorFromApi,
  directorToApi,
  goalRules,
  mapTask,
  mapWireSchema,
  VISION_RULES,
  type CriticWire,
  type DirectorWire,
} from "@/lib/ai/prompts/director";
import { MOTION_RULES } from "@/lib/ai/prompts/motion";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { deleteKeys, fileInfo, readBytes, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";
import { brollSourcesReady, libraryTags, searchOptions } from "../broll";
import { detectCandidates } from "../candidates";
import { brandGraphicLook, GRAPHIC_MAX_SECONDS } from "../graphics";
import { motionRetry } from "../motion-ai";
import { resolveScenes } from "../motion-build";
import { brollGraphicOption } from "../motion-graphics";
import { planSchemaFor, type PlanStyle } from "../plan";
import { alignScript } from "../script-align";
import { proofreadTranscript } from "../transcript-fix";
import { cleanPlan, legacyPlan, loadProject, renderInputFor, scriptText, VideoError, withEditorDefaults, type Project } from "../service";
import type { StyleMetrics } from "../style";
import { stylePreset } from "../styles";
import { buildTimeline } from "../timeline";
import type { CaptionPresetKey, EditPlan, MediaInfo, Transcript, VideoFormat, Word } from "../types";
import { applyVariant, planFromDirector, type BrollLimits } from "./assemble";
import { fxLimits, fxTaskText, parseFxRequest } from "../fx/director";
import { readEditorDefaults } from "../defaults";
import { checkPlan, safeFixes } from "./checks";
import { enforceLocks, guardIssues, hasLocks, locksText, parseLocks, type RequestLocks } from "./locks";
import { coverForbidden, protectedZones } from "./protect";
import { DENSITY_LABELS, densityFor, DENSITY_TARGETS, fillRhythm, planRhythm, rhythmTaskText, rhythmText, syncGraphics, type Density } from "../rhythm";
import { motionTheme } from "../motion-graphics";
import { removedIds } from "../timeline";
import { briefText, mapText, planText, sentencesText, transcriptText, tramosText } from "./context";
import { clampBudget, estimateRevise, estimateStage, MAX_EDIT_ROUNDS, planBudget, planEdit, type BudgetPlan, type CostInput, type EditEstimate, type StagePlan } from "./cost";
export type { EditEstimate } from "./cost";
import { newReferenceId, referenceFromPayload, referenceSettings, referenceSummary, referenceText, type DirectorReference, type ReferencePayload, type ReferenceSource } from "./reference";
import { applyRequest, checkCompliance, enforceRequest, findLinks, isReferenceLink, mergeCompliance, missingKey, missingOf, parseRequest, planBaseline, requestOverrides, requestText, settingsFromRequest, type ParsedRequest } from "./request";
import { diffPlans } from "./diff";
import { advanceWork, readWork } from "../compos/work";
import { adaptStep, asksForAnimation, finishCopy, readCopy, recentUsage, recipeStep, startCopy, startEditRequest, startVariety, wantsCopy } from "../compos/flows";
import type { FxKind } from "../fx/catalog";
import { keyFrames, type KeyFrame } from "./keyframes";
import { mapFromMeasures, mapFromWire, mustKeepRanges } from "./map";
import { mapToWire, simulateCritic, simulateDirector, simulateRequestCheck } from "./simulate";
import { BUDGET, effectiveBrief, readBrief, readDirector, type Brief, type CriticIssue, type CriticRound, type DirectorState, type EditRequest, type Eyes, type PendingRequest, type VideoMap } from "./types";

/**
 * Director de edición (servidor). Una máquina de estados que maneja el worker paso a paso
 * (POST /api/worker/projects/<id>/director): cada paso hace una sola llamada de IA, guarda su resultado y dice cuál
 * sigue. Así ninguna llamada HTTP dura demasiado y, si algo se corta, el trabajo se reintenta desde el último paso.
 *
 *   start → understand (mapa con visión) → direct (Opus con razonamiento) → preview (el worker arma los cuadros del
 *   plan) → critique (crítico con visión) → [revise → preview → critique] → finalize (revisión o "Hazlo por mí").
 *   "Edítalo así" y los arreglos de la revisión final empiezan en `edit`.
 *   Después del render, `final` revisa cuadros del MP4.
 *
 * Todo el consumo se carga al video (api_usage.video_id) y respeta el tope por video (lib/video/director/cost.ts).
 */

export type DirectorNext =
  | { step: "understand" | "direct" | "revise" | "finalize" | "edit" | "recipe" | "adapt" | "compos"; label?: string }
  | { step: "compos-images"; items: { taskId: string; imageId: string; prompt: string; aspect: string }[]; label: string }
  | { step: "compos-stills"; render: Record<string, unknown>; items: Record<string, unknown>[]; label: string }
  | { step: "preview"; round: number; render: Record<string, unknown>; frames: KeyFrame[] }
  | null;

export type DirectorBody =
  | { step: "start" }
  | { step: "understand" }
  | { step: "direct" }
  | { step: "critique"; round: number; sheets: { key: string; width: number; height: number }[] }
  | { step: "revise" }
  | { step: "finalize" }
  | { step: "edit" }
  | { step: "abort"; error?: string }
  | ({ step: "reference" } & ReferencePayload)
  | { step: "final"; sheets: { key: string; width: number; height: number }[]; frames: KeyFrame[] }
  // Composiciones (lib/video/compos): receta y adaptación de "Copiar edición" y el taller de animaciones.
  | { step: "recipe" }
  | { step: "adapt" }
  | { step: "compos"; workId?: string }
  | { step: "compos-images-done"; results: unknown[]; workId?: string }
  | { step: "compos-look"; sheets: { taskId: string; key: string; width: number; height: number; times?: number[] }[]; workId?: string };

const STAGE_LABEL: Record<string, string> = {
  "video.director.mapa": "Entender el video",
  "video.director.plan": "Dirigir la edición",
  "video.director.revisar": "Corregir",
  "video.director.critica": "Segunda mirada",
  "video.director.final": "Revisión final",
  "video.motion.retry": "Gráficos",
  "video.compos.receta": "Copiar edición: receta",
  "video.compos.adaptar": "Copiar edición: adaptar",
  "video.compos.pedido": "Animaciones: pedido",
  "video.compos.momentos": "Animaciones: momentos clave",
  "video.compos.plan": "Animaciones: plan",
  "video.compos.imagenes": "Animaciones: mirar imágenes",
  "video.compos.codigo": "Animaciones: programar",
  "video.compos.mirar": "Animaciones: revisar con cuadros",
};

// ─── Contexto de un proyecto ──────────────────────────────────────────────

type Ctx = {
  project: Project;
  words: Word[];
  duration: number;
  format: VideoFormat;
  eyes: Eyes | null;
  director: DirectorState;
  own: Brief | null;
  brandCtx: string;
  brand: Awaited<ReturnType<typeof getBrand>>;
  cap: number;
};

async function load(projectId: string): Promise<Ctx> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  const transcript = project.transcript as Transcript | null;
  if (!transcript?.words?.length) throw new VideoError("Todavía no hay transcripción para este video.");
  const media = (project.media ?? {}) as MediaInfo;
  const brand = await getBrand();
  return {
    project,
    words: transcript.words,
    duration: media.duration || transcript.duration,
    format: (project.format === "16:9" ? "16:9" : "9:16") as VideoFormat,
    eyes: readEyes(project.eyes),
    director: readDirector(project.director),
    own: readBrief(project.brief),
    brandCtx: await brandContext(brand),
    brand,
    cap: clampBudget(project.aiBudgetUsd),
  };
}

/** Palabras dichas mientras se ve la cara (tramos de los ojos con cara en al menos el 60 % de los cuadros). Sin ojos, null. */
function faceWordsOf(eyes: Eyes | null, words: Word[]): Set<number> | null {
  if (!eyes?.tramos.length) return null;
  const out = new Set<number>();
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const t = eyes.tramos.find((x) => mid >= x.start && mid <= x.end);
    if (t && t.faceRatio >= 0.6) out.add(w.id);
  }
  return out;
}

export function readEyes(raw: unknown): Eyes | null {
  const e = raw as Eyes | null;
  return e && e.version === 1 && Array.isArray(e.samples) && Array.isArray(e.tramos) ? { ...e, sheets: Array.isArray(e.sheets) ? e.sheets : [] } : null;
}

async function saveDirector(projectId: string, next: DirectorState, extra: Partial<typeof schema.videoProjects.$inferInsert> = {}): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set({ director: { ...next, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>, ...extra })
    .where(eq(schema.videoProjects.id, projectId));
}

/** Gasto de IA del video (todas las etapas). */
export async function spentUsd(projectId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${schema.apiUsage.costUsd}), 0)` })
    .from(schema.apiUsage)
    .where(eq(schema.apiUsage.videoId, projectId));
  return Number(row?.total ?? 0);
}

export type CostSummary = { totalUsd: number; capUsd: number; simulated: boolean; stages: { label: string; usd: number; calls: number }[] };

export async function costSummary(projectId: string, capUsd: number): Promise<CostSummary> {
  const rows = await getDb()
    .select({ feature: schema.apiUsage.step, provider: schema.apiUsage.provider, usd: sql<number>`sum(${schema.apiUsage.costUsd})`, calls: sql<number>`count(*)` })
    .from(schema.apiUsage)
    .where(eq(schema.apiUsage.videoId, projectId))
    .groupBy(schema.apiUsage.step, schema.apiUsage.provider);
  const by = new Map<string, { usd: number; calls: number }>();
  for (const r of rows) {
    const label = STAGE_LABEL[r.feature] ?? "Otros";
    const cur = by.get(label) ?? { usd: 0, calls: 0 };
    by.set(label, { usd: cur.usd + Number(r.usd), calls: cur.calls + Number(r.calls) });
  }
  const stages = [...by.entries()].map(([label, v]) => ({ label, ...v }));
  return { totalUsd: stages.reduce((a, s) => a + s.usd, 0), capUsd, simulated: rows.some((r) => r.provider === "simulado"), stages };
}

function costInput(ctx: Ctx, broll: number): CostInput {
  const sheet = ctx.eyes?.sheets[0] ?? { width: 1296, height: 1218 };
  return { words: ctx.words.length, sheets: ctx.eyes?.sheets.length ?? 0, sheet: { width: sheet.width, height: sheet.height }, broll };
}

/** Densidad de ritmo de este video: la que pidió en "Edítalo así", la del plan, o la de Mi marca (según el formato). */
function densityOf(ctx: Ctx, base: EditPlan | null, locks: RequestLocks | null | undefined): Density {
  if (locks?.density) return locks.density;
  if (base?.rhythm?.density) return base.rhythm.density;
  return densityFor(readEditorDefaults(ctx.brand).density, ctx.format);
}

function brollLimits(ctx: Ctx, styleEvery: number | null, density: Density = "normal"): BrollLimits & { count: number } {
  if (ctx.project.brollMode !== "auto") return { count: 0, minSeconds: 1.5, maxSeconds: 4, graphics: false, stock: false };
  const target = DENSITY_TARGETS[density];
  const every = styleEvery ?? (ctx.format === "9:16" ? target.brollEvery : Math.max(target.brollEvery, 14));
  const max = density === "reels" ? 14 : ctx.format === "9:16" ? 8 : 12;
  return { count: Math.max(1, Math.min(max, Math.floor((ctx.duration * 0.85) / Math.max(5, every)))), minSeconds: 1.5, maxSeconds: Math.min(6, GRAPHIC_MAX_SECONDS), graphics: true, stock: true };
}

async function sheetImages(keys: { key: string }[]): Promise<{ mediaType: "image/jpeg"; data: string }[]> {
  const out: { mediaType: "image/jpeg"; data: string }[] = [];
  for (const k of keys) {
    try {
      out.push({ mediaType: "image/jpeg", data: (await readBytes(k.key)).toString("base64") });
    } catch (error) {
      console.error("[director] no se pudo leer una hoja:", error instanceof Error ? error.message : error);
    }
  }
  return out;
}

/** Lo que aprendió la cuenta de sus videos de YouTube (caídas de retención explicadas), si hay. */
async function retentionLessons(): Promise<string> {
  const rows = await getDb()
    .select({ explanation: schema.retentionInsights.explanation })
    .from(schema.retentionInsights)
    .orderBy(desc(schema.retentionInsights.updatedAt))
    .limit(4)
    .catch(() => []);
  const lines = rows.flatMap((r) => [r.explanation.summary, ...r.explanation.drops.slice(0, 2).map((d) => `Se van cuando ${d.why.replace(/\.$/, "")}: ${d.change}`)]).filter(Boolean);
  return lines.length ? `RETENCIÓN EN YOUTUBE (lo que hace que se vayan en sus videos)\n${lines.slice(0, 8).map((l) => `- ${l}`).join("\n")}` : "";
}

async function styleFor(project: Project): Promise<{ plan: PlanStyle; text: string; every: number | null } | null> {
  const style = await stylePreset(project.styleId);
  if (!style) return null;
  const p = style.preset;
  const metrics = style.metrics as StyleMetrics | undefined;
  return {
    plan: { id: style.id, aggressiveness: p.pacing.aggressiveness, hookTarget: p.hook.targetSeconds, longPause: p.pacing.longPause, zoom: p.zoom.enabled },
    text: `- Ritmo: ${p.pacing.aggressiveness} (${(metrics?.cuts?.perMinute ?? 0).toFixed(1)} cortes por minuto), pausas de hasta ${p.pacing.longPause.toFixed(1)} s, gancho de unos ${p.hook.targetSeconds.toFixed(1)} s${p.broll.enabled ? `, b-roll cada ${p.broll.everySeconds.toFixed(0)} s de ${p.broll.durationSeconds.toFixed(1)} s` : ", casi sin b-roll"}${p.zoom.enabled ? ", con zooms" : ""}.`,
    every: p.broll.enabled ? p.broll.everySeconds : null,
  };
}

// ─── Pasos ────────────────────────────────────────────────────────────────

export async function directorStep(projectId: string, body: DirectorBody): Promise<{ next: DirectorNext; status: string }> {
  // Una corrección en curso: su consumo se carga a ese pedido (api_usage.request_id), para sumar cuánto costó cada una.
  const [row] = await getDb().select({ director: schema.videoProjects.director }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  const pendingId = row ? (readDirector(row.director).pending?.id ?? null) : null;
  return withAiScope(projectId, async () => {
    switch (body.step) {
      case "start":
        return start(projectId);
      case "understand":
        return understand(projectId);
      case "direct":
        return direct(projectId, null);
      case "edit":
        return direct(projectId, "edit");
      case "revise":
        return direct(projectId, "revise");
      case "critique":
        return critique(projectId, body.round, body.sheets);
      case "finalize":
        return finalize(projectId);
      case "abort":
        return abort(projectId, body.error ?? null);
      case "reference":
        return saveReference(projectId, body);
      case "final":
        // Sin revisión con IA después del render: el render entrega el video y listo (sus «arreglos» cortaban de más).
        return { next: null, status: "DONE" };
      case "recipe": {
        const r = await recipeStep(projectId);
        return r.step === "compos-skip" ? afterCompos(projectId) : { next: { step: r.step as "adapt", label: r.label }, status: "PROCESSING" };
      }
      case "adapt": {
        const r = await adaptStep(projectId);
        return r.step === "compos-skip" ? afterCompos(projectId) : { next: { step: "compos", label: r.label }, status: "PROCESSING" };
      }
      case "compos":
      case "compos-images-done":
      case "compos-look": {
        const r = await advanceWork(projectId, body);
        if (!r.finished) return { next: r.next, status: (await loadProject(projectId))?.status ?? "PROCESSING" };
        // Un pedido del Estudio (su propia fila): termina ahí, el Estudio lo entrega.
        if (body.workId) return { next: null, status: (await loadProject(projectId))?.status ?? "AWAITING_REVIEW" };
        return afterCompos(projectId);
      }
    }
  }, { requestId: pendingId });
}

async function start(projectId: string): Promise<{ next: DirectorNext; status: string }> {
  const ctx = await load(projectId);
  if (ctx.project.status !== "PROCESSING") return { next: null, status: ctx.project.status };
  if (ctx.director.pending) return { next: { step: "edit" }, status: "PROCESSING" };
  // Un reintento retoma donde quedó: corregir, volver a mirar o cerrar.
  if (ctx.project.plan && ctx.director.steps.includes("direct")) {
    const last = ctx.director.rounds.at(-1);
    if (last?.fixed && ctx.director.steps.at(-1) !== "revise") return { next: { step: "revise" }, status: "PROCESSING" };
    if (ctx.director.budget?.critic && ctx.director.rounds.length < roundLimit(ctx.director)) {
      return { next: await previewNext(ctx.project, ctx.project.plan as EditPlan, ctx.words, ctx.duration, ctx.director.rounds.length + 1, ctx.eyes), status: "PROCESSING" };
    }
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }
  if (ctx.director.map && ctx.director.steps.includes("understand")) return { next: { step: "direct" }, status: "PROCESSING" };
  // «Sin editar»: llega a la revisión tal cual se grabó (solo transcripto), sin pasar por la IA.
  if ((ctx.project as { editMode?: string }).editMode === "clean") {
    const plan = await cleanPlan(ctx.project);
    await saveDirector(projectId, { ...ctx.director, map: mapFromMeasures(ctx.eyes, ctx.words), steps: ["understand", "direct", "finalize"], cycle: "analysis", final: null }, { plan, status: "AWAITING_REVIEW", errorMessage: null });
    return { next: null, status: "AWAITING_REVIEW" };
  }
  if (!aiConfigured()) {
    // Sin IA: el plan de siempre (cortes seguros), con el mapa de las medidas para "Lo que entendió".
    const plan = await legacyPlan(ctx.project);
    await saveDirector(projectId, { ...ctx.director, map: mapFromMeasures(ctx.eyes, ctx.words), steps: ["understand", "direct"] }, { plan });
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }
  const budget = planBudget({ ...costInput(ctx, brollLimits(ctx, null).count), capUsd: ctx.cap, spentUsd: await spentUsd(projectId) });
  await saveDirector(projectId, { ...ctx.director, budget, degraded: budget.degraded, rounds: [], steps: ["start"], cycle: "analysis", final: null });
  return { next: { step: "understand" }, status: "PROCESSING" };
}

function budgetOf(d: DirectorState): BudgetPlan | null {
  return d.budget ?? null;
}

/** Vueltas de segunda mirada del ciclo: las del tope en el análisis; una en un pedido de la persona (si su plan la tiene). */
function roundLimit(d: DirectorState): number {
  if (d.cycle === "edit") return d.active ? (d.active.critic ? 1 : 0) : Math.min(1, d.budget?.critic?.rounds ?? 0);
  return d.budget?.critic?.rounds ?? 0;
}

async function understand(projectId: string): Promise<{ next: DirectorNext; status: string }> {
  const ctx = await load(projectId);
  if (ctx.project.status !== "PROCESSING") return { next: null, status: ctx.project.status };
  const budget = budgetOf(ctx.director);
  const stage: StagePlan & { sheets: "all" | "half" } = budget?.map ?? { model: "deep", effort: "medium", sheets: "all" };
  const all = ctx.eyes?.sheets ?? [];
  const sheets = stage.sheets === "half" ? all.filter((_, i) => i % 2 === 0) : all;
  const remaining = ctx.cap - (await spentUsd(projectId));
  const degraded = [...ctx.director.degraded];
  let map: VideoMap;
  const fallback = () => mapFromMeasures(ctx.eyes, ctx.words);
  if (remaining < estimateStage("map", stage, costInput(ctx, 0), { sheets: sheets.length }) * 0.6) {
    map = fallback();
    degraded.push("El mapa del video se armó solo con las medidas (sin mirar los cuadros) para no pasar el tope.");
  } else {
    const script = await scriptText(ctx.project.scriptId);
    const images = await sheetImages(sheets);
    const frames = sheets.reduce((a, s) => a + s.frames.length, 0);
    try {
      const wire = await generateStructured({
        feature: "video.director.mapa",
        model: stage.model,
        thinking: stage.effort ? { effort: stage.effort } : null,
        context: `${VISION_RULES}\n\n${ctx.brandCtx}`,
        task: mapTask({
          duration: ctx.duration,
          format: ctx.format,
          sheets: images.length,
          frames: images.length ? frames : 0,
          tramos: tramosText(ctx.eyes, ctx.words),
          sentences: sentencesText(ctx.words),
          brief: ctx.own ? briefText(effectiveBrief(ctx.own, null)) : null,
          script,
          notes: ctx.eyes?.notes ?? ["No se pudieron medir los cuadros del video."],
        }),
        images,
        imageSizes: sheets.map((s) => ({ width: s.width, height: s.height })),
        schema: mapWireSchema,
        maxTokens: 16000,
        timeoutMs: 280_000,
        fake: () => mapToWire(fallback()),
      });
      map = mapFromWire(wire, ctx.words, ctx.eyes);
      if (!images.length) map.by = "medidas";
    } catch (error) {
      console.error("[director] mapa sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
      map = fallback();
      degraded.push("No pudimos mirar el video con IA: el mapa salió de las medidas.");
    }
  }
  await saveDirector(projectId, { ...ctx.director, map, degraded, steps: [...ctx.director.steps, "understand"] });
  return { next: { step: "direct" }, status: "PROCESSING" };
}

/** La referencia lista para este ciclo: la del pedido en curso o la del brief. */
function activeReference(ctx: Ctx, mode: "revise" | "edit" | null): DirectorReference | null {
  const ref = ctx.director.reference;
  if (!ref || ref.status !== "ready") return null;
  if (mode === "edit") return ctx.director.pending?.reference?.id === ref.id ? ref : null;
  if (mode === "revise") return ctx.director.active?.referenceId === ref.id ? ref : null;
  const brief = ctx.own?.reference;
  return brief && ref.source.kind === "link" && ref.source.url === brief ? ref : null;
}

/** El pedido en curso en partes (en "Edítalo así") o el del último pedido (al corregir con la segunda mirada). */
function requestOf(director: DirectorState, mode: "revise" | "edit" | null): ParsedRequest | null {
  if (mode === "edit" && director.pending) {
    const link = director.pending.reference?.source.kind === "link" ? [director.pending.reference.source.url] : [];
    const parsed = parseRequest(director.pending.instruction, link);
    // Un archivo subido como referencia también es una parte del pedido.
    if (director.pending.reference && !parsed.items.some((i) => i.kind === "referencia")) parsed.items.push({ n: parsed.items.length + 1, kind: "referencia", quote: "como el video que subí", label: "Editar como la referencia" });
    return parsed;
  }
  if (mode === "revise") return director.request?.parsed ?? null;
  return null;
}

/** Una pista de la biblioteca de música lista (para "con música"). */
async function firstTrack(): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.musicTracks.id })
    .from(schema.musicTracks)
    .where(eq(schema.musicTracks.status, "READY"))
    .orderBy(desc(schema.musicTracks.createdAt))
    .limit(1)
    .catch(() => []);
  return row?.id ?? null;
}

/**
 * Dirige (primera vez), corrige con lo que encontró la segunda mirada (`revise`) o aplica un pedido de la persona
 * (`edit`, "Edítalo así"). Arma el plan con las reglas duras, resuelve gráficos y stock, y pide la vista previa.
 *
 * En un pedido: el pedido en partes manda sobre los topes (b-roll, efectos de Mi marca, densidad); después de armar se
 * aplican los ajustes (subtítulos, audio, formato…) y el piso sin IA (enforceRequest), se mide qué se cumplió de cada
 * parte y, si algo no se cumplió y queda tope, otra vuelta dirigida a eso (hasta MAX_EDIT_ROUNDS).
 */
async function direct(projectId: string, mode: "revise" | "edit" | null): Promise<{ next: DirectorNext; status: string }> {
  const ctx = await load(projectId);
  if (ctx.project.status !== "PROCESSING") return { next: null, status: ctx.project.status };
  const { words, duration, director } = ctx;
  const base = (ctx.project.plan as EditPlan | null) ?? null;
  const map = director.map ?? mapFromMeasures(ctx.eyes, words);
  const brief = effectiveBrief(ctx.own, map.inferredBrief);
  const script = await scriptText(ctx.project.scriptId);
  const alignment = script ? alignScript(words, script) : null;
  const candidates = detectCandidates(words, { script });
  const style = await styleFor(ctx.project);
  const pending = mode === "edit" ? director.pending : null;
  const parsed = requestOf(director, mode);
  const overrides = requestOverrides(parsed);
  const reference = activeReference(ctx, mode);
  const wantsReference = !mode || Boolean(parsed?.items.some((i) => i.kind === "referencia"));
  const refCopy = reference && wantsReference ? referenceSettings(reference.metrics, (parsed && settingsFromRequest(parsed).format) || ctx.format, (base?.captions.preset ?? ctx.project.captionPreset) as CaptionPresetKey) : null;
  // Lo que pidió la persona en "Edítalo así" (o en el pedido anterior, al corregir) no se deshace.
  const locks: RequestLocks | null = pending ? { ...parseLocks(pending.instruction), parsed } : (director.request ?? null);
  const format: VideoFormat = (parsed && settingsFromRequest(parsed).format) || ctx.format;
  // Densidad: la que pide la persona, la de la referencia (si la pidió o está en el brief), la del plan o la de Mi marca.
  const density = overrides.density ?? (wantsReference ? (refCopy?.density ?? null) : null) ?? densityOf(ctx, base, locks);
  // B-roll: el pedido manda sobre el tope de la densidad (y sobre "sin b-roll automático" del proyecto).
  const baseLimits = brollLimits(overrides.brollExtra && ctx.project.brollMode !== "auto" ? { ...ctx, project: { ...ctx.project, brollMode: "auto" } } : ctx, style?.every ?? null, density);
  const limits: BrollLimits & { count: number } = {
    ...baseLimits,
    count: overrides.noBroll && overrides.noGraphics ? 0 : overrides.fewerBroll ? Math.max(0, Math.round(baseLimits.count / 2)) : baseLimits.count + overrides.brollExtra,
    graphics: baseLimits.graphics && !overrides.noGraphics,
    stock: baseLimits.stock && !overrides.noBroll,
  };
  const tags = limits.count ? await libraryTags() : [];
  const stockReady = (brollSourcesReady().stock || tags.length > 0) && !overrides.noBroll;
  const look = brandGraphicLook(ctx.brand);
  const keep = [...mustKeepRanges(brief.mustKeep, words)];
  // La CTA siempre queda; en anuncios y ventas también la oferta y lo que se muestra (producto, pantalla).
  const protect: { from: number; to: number; label: string }[] = map.beats.filter((b) => b.role === "cta").map((b) => ({ from: b.from, to: b.to, label: "la llamada a la acción" }));
  if (brief.goal === "anuncio" || brief.goal === "vender") {
    for (const b of map.beats) if (b.role === "oferta") protect.push({ from: b.from, to: b.to, label: "la oferta" });
    for (const s of map.shots) if (s.important) protect.push({ from: s.from, to: s.to, label: s.shows.toLowerCase() });
  }
  const instruction = pending ? pending.instruction : null;
  if (instruction) keep.push(...mustKeepRanges(instruction.match(/no (?:cortes|quites|saques)[^.]*/i)?.[0] ?? "", words));
  const lastRound = director.rounds.at(-1);
  const issues = mode === "revise" ? guardIssues(lastRound?.issues ?? [], locks).kept : [];
  const budget = budgetOf(director);
  const spent = await spentUsd(projectId);
  const remaining = ctx.cap - spent;
  const degraded = [...director.degraded];
  const refSheets = reference?.sheets ?? [];
  const input = { ...costInput(ctx, limits.count), refSheets: refSheets.length };

  // Modelo y razonamiento: en un pedido, el máximo que entra en lo que queda del tope (planEdit); al dirigir y al
  // corregir, el del plan de costo del análisis. Solo baja si de verdad no alcanza.
  const editBudget = pending ? planEdit({ ...input, remaining, kind: pending.kind === "fix" ? "fix" : "edit" }) : null;
  let stage: StagePlan = editBudget?.director ?? budget?.director ?? { model: "deep", effort: "xhigh" };
  if (!editBudget) {
    const est = mode ? estimateRevise(stage, input) : estimateStage("director", stage, input);
    if (remaining < est) {
      const cheaper: StagePlan[] = [{ model: "deep", effort: "high" }, { model: "deep", effort: "medium" }, { model: "main", effort: null }];
      stage = cheaper.find((s) => (mode ? estimateRevise(s, input) : estimateStage("director", s, input)) <= remaining) ?? { model: "main", effort: null };
      degraded.push(stage.model === "main" ? "La dirección la hizo un modelo más económico para no pasar el tope." : "La dirección razonó menos para no pasar el tope.");
    }
  }
  if (mode && remaining < estimateRevise({ model: "main", effort: null }, input) * 0.5) {
    // Sin presupuesto para corregir con IA: lo que se puede hacer con reglas (el piso del pedido) y nada más.
    if (pending && base) return applyWithoutAi(ctx, base, parsed, locks, degraded, "No quedó presupuesto de IA para este pedido: apliqué lo que se puede hacer sin IA.");
    degraded.push("No quedó presupuesto para otra corrección con IA.");
    await saveDirector(projectId, { ...director, degraded, pending: null });
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }
  if (editBudget) for (const d of editBudget.degraded) if (!degraded.includes(d)) degraded.push(d);

  // Efectos de la biblioteca: los que permite Mi marca, cuántos para este largo, y dónde se ve la cara (los que te
  // recortan necesitan verte a cámara). Un efecto pedido entra aunque Mi marca no lo tenga o ya se llegue al tope.
  const fxAsk = instruction ? parseFxRequest(instruction) : null;
  const fxSettings = fxLimits(readEditorDefaults(ctx.brand).effects, duration * 0.85);
  const factor = DENSITY_TARGETS[density].fxFactor;
  const baseFx = fxSettings.max > 0 ? { ...fxSettings, max: Math.max(1, Math.round(fxSettings.max * factor)), minGap: Math.max(2, fxSettings.minGap / factor) } : fxSettings;
  const askedFx = overrides.fx.map((f) => f.kind);
  const fx0 = overrides.noFx
    ? { ...baseFx, allowed: [], max: 0 }
    : askedFx.length
      ? { ...baseFx, allowed: [...new Set([...baseFx.allowed, ...askedFx])], max: baseFx.max + askedFx.length, minGap: Math.min(baseFx.minGap, 3), frequency: baseFx.frequency === "ninguno" ? ("pocos" as const) : baseFx.frequency }
      : fxAsk && "kind" in fxAsk && baseFx.allowed.includes(fxAsk.kind)
        ? { ...baseFx, max: baseFx.max + 1 }
        : baseFx;
  // Transiciones: el pedido manda sobre Mi marca ("sin transiciones" o "pon transiciones", aunque la frecuencia sea ninguno).
  const fxT = overrides.transitions === "off" ? { ...fx0, transitions: 0 } : overrides.transitions === "more" ? { ...fx0, transitions: Math.max(fx0.transitions ?? 0, 2) + overrides.transitionKinds.length } : fx0;
  // Variedad entre videos: lo que la marca usó en sus últimos videos (el director y el relleno de ritmo lo rotan).
  const recent = await recentUsage(projectId).catch(() => ({ fx: [] as FxKind[], transitions: [] as string[], families: [] as string[] }));
  const fx = { ...fxT, recent: { fx: recent.fx, transitions: recent.transitions } };
  const faceWords = faceWordsOf(ctx.eyes, words);
  // Palabras mal transcritas ("desancado" → "estancado"): solo en la primera dirección, en paralelo con el director.
  const proofread = !mode && !base ? proofreadTranscript({ words, brandCtx: ctx.brandCtx, script }) : Promise.resolve({} as Record<string, string>);
  const limitsText = parsed?.items.length
    ? `TOPES DE ESTE PEDIDO (ya ajustados a lo que pide): hasta ${limits.count} b-roll y gráficos${limits.graphics ? "" : " (sin gráficos)"}${limits.stock ? "" : " (sin b-roll de video)"}; ${fxTaskText(fx)}; densidad «${DENSITY_LABELS[density].label}».`
    : "";
  const simInput = { words, duration, format, candidates, map, brief, broll: { ...limits, stock: stockReady }, mustKeep: keep, preset: ctx.project.captionPreset, base, issues, instruction, fx, request: parsed, reference: reference?.metrics ?? null };
  const images = refSheets.length ? await sheetImages(refSheets) : [];
  let ai: DirectorWire | null = null;
  try {
    const api = await generateStructured({
      feature: mode ? "video.director.revisar" : "video.director.plan",
      model: stage.model,
      thinking: stage.effort ? { effort: stage.effort } : null,
      // Estable entre videos (va en la caché): reglas del director, de motion graphics y la marca.
      context: `${DIRECTOR_RULES}\n\n${MOTION_RULES}\n\n${ctx.brandCtx}`,
      task: `${goalRules(brief.goal)}\n\n${directorTask({
        format,
        duration,
        brief: briefText(brief),
        map: mapText(map, words),
        sentences: sentencesText(words),
        candidates: candidates.filter((c) => c.kind !== "silence").map((c) => `${c.id} ${c.kind} [${c.from_word}–${c.to_word}] conf ${c.confidence.toFixed(2)}: ${c.note}`).join("\n") || "(ninguno)",
        transcript: transcriptText(words),
        forbidden: [
          ...forbiddenText(words, map, base),
          ...keep.map((k) => `- NO CORTAR [${k.from}–${k.to}]`),
          ...protect.map((p) => `- TIENE QUE QUEDAR (se puede limpiar una toma repetida adentro) [${p.from}–${p.to}]: ${p.label}`),
        ].join("\n"),
        broll: { ...limits, stock: stockReady, libraryTags: tags },
        style: style?.text ?? null,
        lessons: (await retentionLessons()) || "(ver TIPOS DE GANCHO y LO QUE YA FUNCIONÓ en la marca)",
        effects: fxTaskText(fx),
        rhythm: rhythmTaskText(density, duration * 0.85),
        locks: locksText(locks),
        request: requestText(parsed, { limits: limitsText, focus: pending?.focus }),
        reference: reference && wantsReference ? referenceText(reference) : "",
        revise:
          mode && base
            ? {
                plan: `${planText(base, words)}\n${settingsText(base)}`,
                issues: issues.map((i) => `- [${i.kind}, ${i.severity}, segundo ${i.at.toFixed(1)}] ${i.note} → ${i.fix}`).join("\n"),
                instruction,
              }
            : null,
      })}`,
      images,
      imageSizes: refSheets.map((s) => ({ width: s.width, height: s.height })),
      schema: directorApiSchema,
      maxTokens: 32000,
      timeoutMs: 600_000,
      fake: () => directorToApi(simulateDirector(simInput)),
    });
    ai = directorFromApi(api);
  } catch (error) {
    console.error("[director] dirección sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    if (!mode) {
      // Respaldo: el plan de antes (Sonnet o cortes seguros).
      const plan = await legacyPlan(ctx.project);
      await saveDirector(projectId, { ...director, degraded: [...degraded, "El director no respondió: el plan se armó con el editor de antes."], steps: [...director.steps, "direct"] }, { plan });
      return { next: { step: "finalize" }, status: "PROCESSING" };
    }
    if (pending && base) return applyWithoutAi(ctx, base, parsed, locks, degraded, "La IA no respondió: apliqué lo que se puede hacer sin IA.");
    await saveDirector(projectId, { ...director, degraded: [...degraded, "No pudimos aplicar la corrección con IA."], pending: null });
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }

  const preset = ctx.project.captionPreset as CaptionPresetKey;
  const assembled = planFromDirector(ai, {
    words,
    duration,
    format,
    preset: preset === "estilo" && !style ? "clasico" : preset,
    // Lo que coincide con el guion manda sobre la corrección de la IA.
    corrections: { ...(await proofread), ...(alignment?.corrections ?? {}) },
    offScript: alignment?.offScript ?? [],
    candidates,
    map,
    mustKeep: keep,
    protect,
    style: style?.plan ?? null,
    broll: { ...limits, stock: stockReady },
    base,
    keepOpening: ctx.project.origin === "clip",
    allowBigCuts: Boolean(instruction && pending?.kind !== "fix" && /acort|m[aá]s corto|recort|dura|segundos|\d+\s*s\b|quita (la|esa|esta) parte|saca (la|esa|esta) parte/i.test(instruction)),
    fx: { limits: fx, faceWords, keepUser: !overrides.noFx && !(fxAsk && "none" in fxAsk) },
    density,
  });
  let plan = base ? assembled.plan : await withEditorDefaults(assembled.plan, ctx.brand);
  if (assembled.dropped.length) console.info("[director] descartado:", assembled.dropped.slice(0, 4).join(" | "));

  // Gráficos (validados con el motor; una vuelta de corrección con Claude) y alternativas de stock.
  const context = `${MOTION_RULES}\n\n${ctx.brandCtx}`;
  const graphics = assembled.pending.filter((p) => p.scene);
  if (graphics.length) {
    const outcomes = await resolveScenes(
      graphics.map((p) => ({ ai: p.scene, spoken: p.spoken, look, format, duration: Math.max(1.5, words[p.item.to_word]!.end - words[p.item.from_word]!.start), bannedWords: ctx.brand?.bannedWords ?? [] })),
      { retries: 1, retry: motionRetry(context) },
    );
    outcomes.forEach((o, i) => {
      const { item } = graphics[i]!;
      if (o.scene) {
        const option = brollGraphicOption(o.scene);
        item.choice = option;
        item.options = [option];
      }
    });
  }
  let warning: string | null = null;
  for (const p of assembled.pending) {
    const item = plan.broll.find((b) => b.id === p.item.id);
    if (!item) continue;
    Object.assign(item, p.item);
    const span = words[item.to_word]!.end - words[item.from_word]!.start;
    const graphic = item.choice?.source === "graphic" ? item.choice : null;
    if (!stockReady) continue;
    const found = await searchOptions({ queryEn: item.query_en, keywords: item.keywords, format, minDuration: span }, graphic ? 4 : 6);
    if (!graphic) warning ??= found.warning;
    item.options = graphic ? [graphic, ...found.options] : found.options;
    item.choice = graphic ?? found.options[0] ?? null;
  }
  // Un b-roll sin nada que mostrar no sirve.
  plan = { ...plan, broll: plan.broll.filter((b) => b.choice) };
  if (warning) plan = { ...plan, warning: [plan.warning, warning].filter(Boolean).join(" ").slice(0, 1000) };

  // Sincronía con la voz y ritmo: cada elemento de los gráficos en su palabra, y el relleno de ritmo donde el director
  // dejó huecos (aunque el modelo haya sido tímido). Después, lo que pidió la persona vuelve si se perdió.
  const zones = protectedZones(map, words);
  plan = syncGraphics(plan, words, zones.zones);
  const filled = fillRhythm(plan, {
    words,
    duration,
    density,
    format,
    forbidden: zones.zones,
    theme: motionTheme(look),
    fxAllowed: fx.max > 0 ? fx.allowed : [],
    faceWords,
    candidates,
    mustKeep: [...keep, ...protect],
    recentFx: recent.fx,
  });
  plan = filled.plan;
  if (filled.added.length) console.info(`[director] ritmo (${density}): ${filled.added.length} agregados`);
  const locked = enforceLocks(plan, base, locks, zones.zones);
  plan = locked.plan;
  if (zones.trimmed.length) plan = { ...plan, warning: [plan.warning, "Había demasiado marcado como intocable: protegí solo lo que se muestra más importante."].filter(Boolean).join(" ").slice(0, 1000) };

  // Ajustes (subtítulos, audio, formato, densidad, zooms, cómo se ven gráficos y efectos) y el piso del pedido.
  const applied = applyRequest(plan, parsed, {
    ai: ai.settings ?? null,
    reference: refCopy && wantsReference ? refCopy.settings : null,
    words,
    duration,
    forbidden: zones.zones,
    mustKeep: [...keep, ...protect],
    faceWords,
    candidates,
    musicTrack: parsed?.items.some((i) => i.kind === "musica" && i.on !== false) || ai.settings?.audio?.music || refCopy?.settings.audio?.music ? await firstTrack() : null,
    base,
    baseline: pending?.baseline ?? (mode === "revise" ? (director.active?.baseline ?? null) : null),
    theme: motionTheme(look),
  });
  plan = applied.plan;
  if (refCopy && wantsReference && !mode && refCopy.pace === "fast") plan = { ...plan, pacing: { long_pause: Math.min(plan.pacing?.long_pause ?? 0.3, 0.3) }, director: { version: 1, pace: "fast" } };
  // Las animaciones a medida (composiciones) no las rearma el director: siguen como estaban (las cambia el taller).
  if (base?.compositions?.length && !plan.compositions?.length) plan = { ...plan, compositions: base.compositions };

  const parsedPlan = planSchemaFor(words.length).safeParse(plan);
  if (!parsedPlan.success) {
    console.error("[director] plan inválido:", parsedPlan.error.issues[0]?.message);
    if (!mode) {
      const fallback = await legacyPlan(ctx.project);
      await saveDirector(projectId, { ...director, degraded: [...degraded, "El plan del director no pasó la validación: se usó el editor de antes."], steps: [...director.steps, "direct"] }, { plan: fallback });
      return { next: { step: "finalize" }, status: "PROCESSING" };
    }
    if (pending && base) return applyWithoutAi(ctx, base, parsed, locks, degraded, "El plan de la IA no pasó la validación: apliqué lo que se puede hacer sin IA.");
    await saveDirector(projectId, { ...director, degraded, pending: null });
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }

  let edits = [...director.edits];
  let active = director.active ?? null;
  let nextPending: DirectorState["pending"] = null;
  if (pending && base) {
    const attempt = pending.attempt ?? 0;
    const id = pending.id ?? newEditId();
    const baseline = pending.baseline ?? planBaseline(base, words, duration);
    const changes = mergeChanges(pending.changes ?? [], [...diffPlans(base, plan, words, duration).filter((c) => c !== "No hizo falta cambiar nada."), ...applied.notes, ...locked.restored]);
    const refInfo = pending.reference ? referenceInfo(director.reference, pending.reference.id) : null;
    const compliance = parsed?.items.length ? checkCompliance(parsed, { before: baseline, after: plan, words, duration, reference: refInfo, answers: ai.answers, failed: applied.failed }) : [];
    const entry: EditRequest = {
      at: new Date().toISOString(),
      instruction: pending.instruction,
      changes: changes.length ? changes : ["No hizo falta cambiar nada."],
      note: [ai.warning, ...applied.failed].filter(Boolean).join(" ").slice(0, 400),
      source: pending.kind === "fix" ? "arreglo" : "persona",
      id,
      compliance,
      rounds: attempt + 1,
      costUsd: Math.max(0, spent - (pending.spentAtStart ?? spent)),
      reference: refInfo,
    };
    edits = upsertEdit(edits, entry);
    active = { id, baseline, attempt, spentAtStart: pending.spentAtStart ?? spent, referenceId: pending.reference?.id ?? null, critic: editBudget?.critic ?? null, missingKey: missingKey(compliance) };
    // ¿Otra vuelta? Si una parte no se cumplió, otra vuelta lo puede arreglar y queda tope para hacerla.
    const missing = missingOf(compliance);
    const key = missingKey(compliance);
    const nextCost = estimateRevise(stage, input);
    // Otra vuelta solo si algo cambió desde la anterior (si quedó igual de lejos, insistir no suma y gasta).
    if (pending.kind !== "fix" && missing.length && key !== pending.missingKey && attempt < MAX_EDIT_ROUNDS && ctx.cap - (await spentUsd(projectId)) >= nextCost + (editBudget?.estimate.critic ?? 0)) {
      nextPending = { ...pending, id, attempt: attempt + 1, focus: missing, missingKey: key, baseline, changes, spentAtStart: active.spentAtStart };
    }
  }
  const variants = mode === "revise" ? director.variants : assembled.variants;
  const next: DirectorState = {
    ...director,
    map,
    edits: edits.slice(-20),
    variants,
    degraded,
    pending: nextPending,
    active,
    ...(pending ? { request: hasLocks(locks) || parsed?.items.length ? locks : null } : {}),
    steps: [...director.steps, mode ?? "direct"],
    // Un pedido empieza un ciclo nuevo de segunda mirada.
    ...(pending ? { cycle: "edit" as const, rounds: [] } : {}),
  };
  await saveDirector(projectId, next, { plan, ...(format !== ctx.format ? { format } : {}) });
  if (nextPending) return { next: { step: "edit", label: `Aplicando tus cambios (vuelta ${(nextPending.attempt ?? 0) + 1})` }, status: "PROCESSING" };

  // Animaciones a medida (lib/video/compos): "Copiar edición", pedidos de animaciones en "Edítalo así" y, sin
  // referencia, la variedad del director en los momentos clave.
  if (mode !== "revise") {
    if (pending && wantsCopy(director)) {
      const started = await startCopy(projectId);
      if (started) return { next: { step: "recipe", label: "Desarmando la edición de la referencia" }, status: "PROCESSING" };
    } else if (pending && !pending.copy && (pending.attempt ?? 0) === 0 && asksForAnimation(pending.instruction) && (await startEditRequest(projectId, pending.instruction))) {
      return { next: { step: "compos", label: "Programando las animaciones que pediste" }, status: "PROCESSING" };
    } else if (!mode && !reference && (await startVariety(projectId))) {
      return { next: { step: "compos", label: "Programando animaciones a medida para los momentos clave" }, status: "PROCESSING" };
    }
  }

  // ¿Segunda mirada? Mientras queden vueltas en este ciclo; si no, verificaciones y arreglos seguros al cerrar.
  if (next.rounds.length < roundLimit(next)) {
    return { next: await previewNext(ctx.project, plan, words, duration, next.rounds.length + 1, ctx.eyes), status: "PROCESSING" };
  }
  return { next: { step: "finalize" }, status: "PROCESSING" };
}

/** Un pedido sin IA (sin tope, la IA no respondió o su plan no sirvió): se aplica lo que se puede con reglas. */
async function applyWithoutAi(ctx: Ctx, base: EditPlan, parsed: ParsedRequest | null, locks: RequestLocks | null, degraded: string[], note: string): Promise<{ next: DirectorNext; status: string }> {
  const { words, duration, director } = ctx;
  const pending = director.pending!;
  const map = director.map ?? mapFromMeasures(ctx.eyes, words);
  const zones = protectedZones(map, words);
  const applied = applyRequest(base, parsed, {
    ai: null,
    reference: null,
    words,
    duration,
    forbidden: zones.zones,
    mustKeep: mustKeepRanges(effectiveBrief(ctx.own, map.inferredBrief).mustKeep, words),
    faceWords: faceWordsOf(ctx.eyes, words),
    candidates: detectCandidates(words, {}),
    musicTrack: parsed?.items.some((i) => i.kind === "musica" && i.on !== false) ? await firstTrack() : null,
    base,
    baseline: pending.baseline ?? null,
    theme: motionTheme(brandGraphicLook(ctx.brand)),
  });
  const locked = enforceLocks(applied.plan, base, locks, zones.zones);
  const plan = planSchemaFor(words.length).safeParse(locked.plan).success ? locked.plan : base;
  const baseline = pending.baseline ?? planBaseline(base, words, duration);
  const id = pending.id ?? newEditId();
  const refInfo = pending.reference ? referenceInfo(director.reference, pending.reference.id) : null;
  const compliance = parsed?.items.length ? checkCompliance(parsed, { before: baseline, after: plan, words, duration, reference: refInfo, failed: applied.failed }).map((c) => (c.status === "revisar" ? { ...c, status: "no" as const, detail: "Sin IA no se pudo: vuelve a pedirlo cuando haya tope." } : c)) : [];
  const changes = mergeChanges(pending.changes ?? [], [...diffPlans(base, plan, words, duration).filter((c) => c !== "No hizo falta cambiar nada."), ...applied.notes]);
  const spent = await spentUsd(ctx.project.id);
  const entry: EditRequest = { at: new Date().toISOString(), instruction: pending.instruction, changes: changes.length ? changes : ["No hizo falta cambiar nada."], note, source: pending.kind === "fix" ? "arreglo" : "persona", id, compliance, rounds: (pending.attempt ?? 0) + 1, costUsd: Math.max(0, spent - (pending.spentAtStart ?? spent)), reference: refInfo };
  await saveDirector(ctx.project.id, { ...director, degraded: [...degraded, note], pending: null, active: null, edits: upsertEdit(director.edits, entry).slice(-20), request: hasLocks(locks) || parsed?.items.length ? locks : director.request ?? null }, { plan });
  return { next: { step: "finalize" }, status: "PROCESSING" };
}

let editCounter = 0;
const newEditId = () => `e${Date.now().toString(36)}${(editCounter++).toString(36)}`;

/** Las vueltas de un mismo pedido actualizan su entrada (no se apilan). */
function upsertEdit(edits: EditRequest[], entry: EditRequest): EditRequest[] {
  const i = edits.findIndex((e) => e.id && e.id === entry.id);
  if (i < 0) return [...edits, entry];
  const out = [...edits];
  out[i] = entry;
  return out;
}

function mergeChanges(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].slice(0, 12);
}

function referenceInfo(ref: DirectorReference | null | undefined, id: string): EditRequest["reference"] {
  if (!ref || ref.id !== id) return { ok: false, summary: "", error: "No llegamos a mirar la referencia." };
  if (ref.status !== "ready") return { ok: false, summary: "", error: ref.error ?? "No pudimos mirar la referencia." };
  return { ok: true, summary: referenceSummary(ref.metrics), error: null };
}

/** Los ajustes actuales del plan en texto (para corregir: el director ve qué tiene). */
function settingsText(plan: EditPlan): string {
  const t = plan.captions.transform;
  return [
    `- Subtítulos: estilo ${plan.captions.preset}${t ? ` · tamaño ${Math.round(t.scale * 100)} % · corrimiento vertical ${t.y.toFixed(2)}` : ""}${plan.captions.emoji ? " · con emojis" : ""}`,
    `- Audio: ${plan.audio.music_asset_id ? `con música (${plan.audio.music_db} dB)` : "sin música"} · efectos de sonido ${plan.audio.sfx ?? "off"} · audio de estudio ${plan.audio.studio ?? "off"}`,
    `- Formato ${plan.format} · densidad ${plan.rhythm?.density ?? "según el formato"}${plan.zooms_enabled === false ? " · zooms apagados" : ""}`,
  ].join("\n");
}

/** Lo prohibido para el director, en texto (con medida: ver protect.ts). */
function forbiddenText(words: Word[], map: VideoMap, base: EditPlan | null): string[] {
  const hook = base && base.selected_hook != null ? (base.hook_candidates[base.selected_hook] ?? null) : null;
  const removed = base ? removedIds(base, words.length) : new Set<number>();
  const zones = protectedZones(map, words).zones;
  const cover = coverForbidden(words, removed, hook, map).filter((z) => !zones.some((p) => p.from === z.from && p.to === z.to));
  return [
    ...zones.map((z) => `- PROHIBIDO b-roll, gráficos y efectos en [${z.from}–${z.to}]: ${z.label}`),
    ...cover.map((z) => `- PROHIBIDO b-roll de video y gráficos "full" en [${z.from}–${z.to}]: ${z.label} (ahí sí van gráficos "overlay" y efectos)`),
  ];
}

async function previewNext(project: Project, plan: EditPlan, words: Word[], duration: number, round: number, eyes: Eyes | null): Promise<DirectorNext> {
  const transcript = project.transcript as Transcript;
  const { input, timeline } = await renderInputFor(project, plan, plan.format, transcript, duration);
  const frames = keyFrames({ plan, words, timeline, eyes, max: 36 });
  return { step: "preview", round, render: input, frames };
}

async function critique(projectId: string, round: number, sheets: { key: string; width: number; height: number }[]): Promise<{ next: DirectorNext; status: string }> {
  const ctx = await load(projectId);
  if (ctx.project.status !== "PROCESSING" || !ctx.project.plan) return { next: null, status: ctx.project.status };
  const plan = ctx.project.plan as EditPlan;
  const { words, duration, director } = ctx;
  const map = director.map;
  const rules = checkPlan({ plan, words, duration, map, eyes: ctx.eyes });
  const timeline = buildTimeline(words, plan, duration);
  const frames = keyFrames({ plan, words, timeline, eyes: ctx.eyes, max: 36 });
  const budget = budgetOf(director);
  const active = director.cycle === "edit" ? (director.active ?? null) : null;
  const stage: StagePlan = active?.critic ?? budget?.critic ?? { model: "main", effort: null };
  const brief = effectiveBrief(ctx.own, map?.inferredBrief ?? null);
  const remaining = ctx.cap - (await spentUsd(projectId));
  // En un pedido: el crítico también mira si cada parte se cumplió (y la referencia, si la hay, va al final).
  const parsed = active ? (director.request?.parsed ?? null) : null;
  const reference = active?.referenceId && director.reference?.id === active.referenceId && director.reference.status === "ready" ? director.reference : null;
  const refSheets = reference?.sheets ?? [];
  let wire: CriticWire | null = null;
  const degraded = [...director.degraded];
  if (remaining >= estimateStage("round", stage, { ...costInput(ctx, 0), refSheets: refSheets.length }) * 0.6) {
    try {
      const common = {
        feature: "video.director.critica",
        model: stage.model,
        thinking: stage.effort ? { effort: stage.effort } : null,
        context: `${CRITIC_RULES}\n\n${ctx.brandCtx}`,
        task: criticTask({
          round,
          brief: briefText(brief),
          map: mapText(map, words),
          plan: planText(plan, words),
          frames: frames.map((f, i) => `#${i + 1} ${f.t.toFixed(1)} s: ${f.label}`).join("\n"),
          checks: rules.map((i) => `- [${i.kind}, ${i.severity}, segundo ${i.at.toFixed(1)}] ${i.note}`).join("\n"),
          duration: timeline.duration,
          rhythm: rhythmText(planRhythm(plan, words, duration)),
          locks: locksText(director.request),
          request: parsed ? requestText(parsed) : undefined,
          reference: reference ? referenceText(reference, sheets.length) : undefined,
        }),
        images: [...(await sheetImages(sheets)), ...(await sheetImages(refSheets))],
        imageSizes: [...sheets, ...refSheets].map((s) => ({ width: s.width, height: s.height })),
        maxTokens: 12000,
        timeoutMs: 280_000,
      };
      wire = parsed?.items.length
        ? await generateStructured({ ...common, schema: criticEditWireSchema, fake: () => ({ ...simulateCritic(rules, frames), request: simulateRequestCheck(parsed, director.edits.find((e) => e.id === active?.id)?.compliance ?? []) }) })
        : await generateStructured({ ...common, schema: criticWireSchema, fake: () => simulateCritic(rules, frames) });
    } catch (error) {
      console.error("[director] crítica sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    }
  } else degraded.push("La segunda mirada usó solo las verificaciones automáticas para no pasar el tope.");

  const raw: CriticIssue[] = wire
    ? wire.issues.map((i) => ({ kind: i.kind, severity: i.severity, at: frames[i.frame - 1]?.t ?? 0, note: i.note.slice(0, 300), fix: i.fix.slice(0, 300), by: "ai" as const }))
    : rules;
  // El crítico no puede deshacer lo que pidió la persona (un efecto pedido, el ritmo rápido): eso se descarta.
  const guarded = guardIssues(raw, director.request);
  if (guarded.dropped.length) console.info(`[director] crítica: ${guarded.dropped.length} pedidos descartados porque deshacían lo que pidió la persona`);
  const issues = guarded.kept;
  // Lo que las reglas encontraron y el crítico no mencionó queda igual (es medible), salvo los saltos (los juzga mejor la vista).
  for (const r of rules) if (r.kind !== "salto" && !issues.some((i) => i.kind === r.kind && Math.abs(i.at - r.at) < 1.5)) issues.push(r);
  const score = wire ? Math.max(0, Math.min(100, wire.score)) : Math.max(35, 96 - issues.reduce((a, i) => a + (i.severity === "alta" ? 18 : i.severity === "media" ? 9 : 4), 0));
  const record: CriticRound = {
    n: round,
    score,
    verdict: (wire?.verdict ?? (issues.length ? "Las verificaciones automáticas encontraron detalles." : "Las verificaciones automáticas no encontraron problemas.")).slice(0, 400),
    issues: issues.slice(0, 20),
    sheets: sheets.map((s) => s.key),
    frames: frames.length,
    fixed: false,
    at: new Date().toISOString(),
  };
  const rounds = [...director.rounds, record];
  // Pedido: lo que el crítico vio de cada parte se junta con lo medido. Si falta algo que se puede arreglar y queda
  // tope, otra vuelta del director dirigida a eso (con lo que encontró el crítico).
  // En "Copiar edición" no hay otra vuelta del director por el pedido: ya se copió momento a momento.
  const copying = Boolean(active?.id) && (readCopy(director)?.editId === active?.id || readWork(director)?.editId === active?.id);
  if (active && parsed?.items.length && !copying) {
    const entry = director.edits.find((e) => e.id === active.id);
    if (entry) {
      const compliance = mergeCompliance(entry.compliance ?? [], wire?.request ?? null);
      const edits = upsertEdit(director.edits, { ...entry, compliance });
      const missing = missingOf(compliance);
      const input = { ...costInput(ctx, 6), refSheets: refSheets.length };
      const again = planEdit({ ...input, remaining: ctx.cap - (await spentUsd(projectId)) });
      // El crítico vio algo nuevo que falta (no lo mismo que ya se intentó sin éxito) y queda tope: otra vuelta.
      const seen = active.missingKey ?? "";
      if (entry.source !== "arreglo" && missing.length && missingKey(compliance) !== seen && active.attempt < MAX_EDIT_ROUNDS && ctx.cap - (await spentUsd(projectId)) >= estimateRevise(again.director, input)) {
        const focus = [...missing, ...issues.filter((i) => i.severity !== "baja").slice(0, 3).map((i) => `${i.note} → ${i.fix}`)];
        const pending: PendingRequest = { kind: "edit", instruction: entry.instruction, id: entry.id, attempt: active.attempt + 1, focus, missingKey: missingKey(compliance), baseline: active.baseline, changes: entry.changes.filter((c) => c !== "No hizo falta cambiar nada."), spentAtStart: active.spentAtStart, reference: active.referenceId && director.reference?.id === active.referenceId ? { id: active.referenceId, source: director.reference.source } : null };
        record.fixed = true;
        await saveDirector(projectId, { ...director, rounds, degraded, edits, pending });
        return { next: { step: "edit", label: `Corrigiendo lo que faltó de tu pedido (vuelta ${active.attempt + 2})` }, status: "PROCESSING" };
      }
      director.edits = edits;
    }
  }
  const serious = issues.some((i) => i.severity !== "baja");
  const revisions = director.rounds.filter((r) => r.fixed).length;
  if (serious && score < 90 && revisions < roundLimit(director)) {
    // El director corrige con lo que encontró (y, si quedan vueltas, se vuelve a mirar).
    record.fixed = true;
    await saveDirector(projectId, { ...director, rounds, degraded });
    return { next: { step: "revise" }, status: "PROCESSING" };
  }
  await saveDirector(projectId, { ...director, rounds, degraded });
  return { next: { step: "finalize" }, status: "PROCESSING" };
}

/**
 * Terminó el taller de animaciones (o no hacía falta): el informe de la copia y lo que sigue. Un pedido del Estudio
 * (VIDEO_COMPOS) termina ahí; en un análisis o un pedido de "Edítalo así", sigue la segunda mirada o el cierre.
 */
async function afterCompos(projectId: string): Promise<{ next: DirectorNext; status: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  const director = readDirector(project.director);
  const work = readWork(director);
  const copy = readCopy(director);
  if (copy && copy.status !== "done" && copy.status !== "failed") await finishCopy(projectId);
  if (work?.mode === "request" || project.status !== "PROCESSING") return { next: null, status: project.status };
  const fresh = readDirector((await loadProject(projectId))!.director);
  if (fresh.rounds.length < roundLimit(fresh) && project.plan) {
    const transcript = project.transcript as Transcript;
    const duration = ((project.media ?? {}) as MediaInfo).duration || transcript.duration;
    return { next: await previewNext(project, project.plan as EditPlan, transcript.words, duration, fresh.rounds.length + 1, readEyes(project.eyes)), status: "PROCESSING" };
  }
  return { next: { step: "finalize" }, status: "PROCESSING" };
}

async function finalize(projectId: string): Promise<{ next: DirectorNext; status: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "PROCESSING") return { next: null, status: project.status };
  if (!project.plan) throw new VideoError("No pudimos armar el plan de edición de este video. Vuelve a intentarlo.");
  const director = readDirector(project.director);
  // Lo medible que haya quedado (b-roll sobre algo importante, subtítulos sobre texto, tomas malas): arreglos seguros.
  const transcript = project.transcript as Transcript;
  const duration = ((project.media ?? {}) as MediaInfo).duration || transcript.duration;
  const fixed = safeFixes({ plan: project.plan as EditPlan, words: transcript.words, duration, map: director.map, eyes: readEyes(project.eyes) });
  let plan = fixed.changes.length && planSchemaFor(transcript.words.length).safeParse(fixed.plan).success ? fixed.plan : (project.plan as EditPlan);
  // Lo que pidió la persona vuelve si un arreglo lo quitó (salvo que tape el producto o la pantalla).
  const locked = enforceLocks(plan, project.plan as EditPlan, director.request, protectedZones(director.map, transcript.words).zones);
  if (locked.restored.length && planSchemaFor(transcript.words.length).safeParse(locked.plan).success) plan = locked.plan;
  // El piso del pedido otra vez (un arreglo seguro no puede deshacer lo que pidió la persona).
  const parsed = director.request?.parsed ?? null;
  if (parsed?.items.length && fixed.changes.length) {
    const words = transcript.words;
    const kept = enforceRequest(plan, parsed, { words, duration, forbidden: protectedZones(director.map, words).zones, mustKeep: [], faceWords: faceWordsOf(readEyes(project.eyes), words) });
    if (planSchemaFor(words.length).safeParse(kept.plan).success) plan = kept.plan;
  }
  const rounds = [...director.rounds];
  const last = rounds.at(-1);
  if (last && fixed.changes.length) rounds[rounds.length - 1] = { ...last, fixed: true, verdict: `${last.verdict} ${fixed.changes.join(" ")}`.slice(0, 600) };
  // Cierre del pedido: lo que se cumplió medido sobre el plan final y lo que costó.
  let edits = director.edits;
  const active = director.active;
  if (active) {
    const entry = edits.find((e) => e.id === active.id);
    if (entry && parsed?.items.length) {
      const words = transcript.words;
      const rules = checkCompliance(parsed, { before: active.baseline, after: plan, words, duration, reference: entry.reference ?? null, answers: (entry.compliance ?? []).filter((c) => c.by === "ai").map((c) => ({ item: c.n, status: c.status === "revisar" ? "hecho" : c.status, note: c.detail })) });
      const byN = new Map((entry.compliance ?? []).map((c) => [c.n, c]));
      // Lo que ya juzgó la IA (y no se mide) se queda como estaba; lo medible se vuelve a medir.
      const compliance = rules.map((r) => (r.by === "ai" || r.status === "revisar" ? (byN.get(r.n) ?? r) : r));
      edits = upsertEdit(edits, { ...entry, compliance, costUsd: Math.max(0, (await spentUsd(projectId)) - active.spentAtStart) });
    }
  }
  await saveDirector(projectId, { ...director, rounds, edits, pending: null, active: null, steps: [...director.steps, "finalize"] }, { plan, status: "AWAITING_REVIEW", errorMessage: null });
  // "Hazlo por mí" (y los clips con "Exportar directo"): se exporta apenas está el plan.
  const { maybeAutoExport } = await import("../auto-export");
  await maybeAutoExport(projectId);
  return { next: null, status: "AWAITING_REVIEW" };
}

/** Un pedido de "Edítalo así" que falló: el video vuelve a la revisión como estaba, con el aviso. */
async function abort(projectId: string, error: string | null): Promise<{ next: DirectorNext; status: string }> {
  const project = await loadProject(projectId);
  if (!project || project.status !== "PROCESSING" || !project.plan) return { next: null, status: project?.status ?? "FAILED" };
  const director = readDirector(project.director);
  await saveDirector(projectId, { ...director, pending: null }, { status: "AWAITING_REVIEW", errorMessage: error ? `No pudimos aplicar el cambio: ${error}`.slice(0, 500) : null });
  return { next: null, status: "AWAITING_REVIEW" };
}

// ─── Revisión final (después del render) ─────────────────────────────────


// ─── Pedidos de la persona ────────────────────────────────────────────────

/**
 * "Edítalo así" (y "Arreglarlo" de la revisión final): el pedido pasa por el director con todo el contexto. El video
 * vuelve a "procesando" un momento (el worker arma la vista previa para la segunda mirada) y después a la revisión.
 */
export async function requestEdit(projectId: string, instruction: string, kind: "edit" | "fix", userId: string | null, attach: { link?: string | null; upload?: boolean; copy?: boolean } = {}): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (!project.plan || !project.transcript) throw new VideoError("Este video todavía no está listo para editar.");
  if (project.status !== "AWAITING_REVIEW" && project.status !== "DONE") throw new VideoError("Espera a que termine lo que se está procesando.");
  const clean = instruction.trim().slice(0, 600);
  if (clean.length < 3) throw new VideoError("Escribe qué quieres cambiar.");
  const director = readDirector(project.director);
  // Referencia: el link adjunto, uno pegado en el texto o el archivo que se acaba de subir.
  let source: ReferenceSource | null = null;
  const link = attach.link?.trim() || findLinks(clean)[0] || null;
  if (attach.upload) {
    const up = director.refUpload;
    if (!up) throw new VideoError("No encontramos el video de referencia. Vuelve a subirlo.");
    const info = await fileInfo(up.key);
    if (!info || info.size === 0) throw new VideoError("La subida de la referencia no terminó. Vuelve a elegir el archivo.");
    source = { kind: "upload", key: up.key, name: up.name };
  } else if (link) {
    if (!isReferenceLink(link)) throw new VideoError("Ese link no es de Instagram, TikTok ni YouTube. Pega otro o sube el video.");
    source = { kind: "link", url: link };
  }
  const reference = source ? { id: newReferenceId(), source } : null;
  const transcript = project.transcript as Transcript;
  const duration = ((project.media ?? {}) as MediaInfo).duration || transcript.duration;
  if (attach.copy && !reference) throw new VideoError("Pega el link del video que quieres copiar o súbelo.");
  const pending: PendingRequest = { kind, instruction: clean, id: newEditId(), attempt: 0, baseline: planBaseline(project.plan as EditPlan, transcript.words, duration), changes: [], spentAtStart: await spentUsd(projectId), reference, ...(attach.copy ? { copy: true } : {}) };
  await getDb()
    .update(schema.videoProjects)
    .set({
      status: "PROCESSING",
      errorMessage: null,
      autoExport: false,
      director: {
        ...director,
        pending,
        active: null,
        ...(attach.copy ? { copy: null, compos: null } : {}),
        ...(reference ? { reference: { id: reference.id, source: reference.source, status: "pending", at: new Date().toISOString() } satisfies DirectorReference } : {}),
        ...(attach.upload ? { refUpload: null } : {}),
        updatedAt: new Date().toISOString(),
      } as unknown as Record<string, unknown>,
    })
    .where(and(eq(schema.videoProjects.id, projectId), sql`${schema.videoProjects.status} in ('AWAITING_REVIEW', 'DONE')`));
  await enqueueJob({ type: "VIDEO_ANALYZE", videoProjectId: projectId, createdBy: userId, stage: "En cola", input: { projectId, sourceKey: project.sourceKey, mode: "edit" } });
}

/** Reserva la ruta para subir un video de referencia desde el Estudio (va directo del navegador al almacenamiento). */
export async function reserveReferenceUpload(projectId: string, file: { fileName: string; fileType: string; fileSize: number }): Promise<{ key: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "AWAITING_REVIEW" && project.status !== "DONE") throw new VideoError("Espera a que termine lo que se está procesando.");
  const ext = VIDEO_TYPES[file.fileType.toLowerCase()] ?? file.fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]?.slice(1);
  if (!ext || !VIDEO_EXTENSIONS.includes(`.${ext}`)) throw new VideoError("Ese formato no es compatible. Sube un video MP4, MOV, WEBM o MKV.");
  if (file.fileSize <= 0) throw new VideoError("El archivo está vacío.");
  if (file.fileSize > REFERENCE_MAX_BYTES) throw new VideoError("La referencia pesa más de 500 MB. Usa un reel o un video corto.");
  const key = `editor/${projectId}/referencia/subida-${Date.now().toString(36)}.${ext}`;
  const director = readDirector(project.director);
  await saveDirector(projectId, { ...director, refUpload: { key, bytes: file.fileSize, name: file.fileName.slice(0, 120), at: new Date().toISOString() } });
  return { key };
}

/** Tamaño máximo de un video de referencia subido desde el Estudio. */
export const REFERENCE_MAX_BYTES = 500 * 1024 * 1024;

/** El worker terminó de mirar la referencia (o no pudo): se guarda y se borra el archivo subido. */
async function saveReference(projectId: string, body: ReferencePayload): Promise<{ next: DirectorNext; status: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  const director = readDirector(project.director);
  const brief = readBrief(project.brief);
  const prev: DirectorReference =
    director.reference?.id === body.id
      ? director.reference
      : { id: body.id, source: director.pending?.reference?.id === body.id ? director.pending.reference.source : { kind: "link", url: brief?.reference ?? "" }, status: "pending", at: new Date().toISOString() };
  // Las hojas tienen que ser de este proyecto.
  const sheets = (body.sheets ?? []).filter((s) => s.key.startsWith(`editor/${projectId}/referencia/`));
  const next = referenceFromPayload(prev, { ...body, sheets });
  if (prev.source.kind === "upload") await deleteKeys([prev.source.key]).catch(() => undefined);
  await saveDirector(projectId, { ...director, reference: next });
  return { next: null, status: project.status };
}

/** Cambia a una de las versiones propuestas (la actual queda como "Versión anterior"). */
export async function applyPlanVariant(projectId: string, variantId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project?.plan || !project.transcript) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const director = readDirector(project.director);
  const variant = director.variants.find((v) => v.id === variantId);
  if (!variant) throw new VideoError("Esa versión ya no existe. Recarga la página.");
  const transcript = project.transcript as Transcript;
  const duration = ((project.media ?? {}) as MediaInfo).duration || transcript.duration;
  const { plan, previous } = applyVariant(project.plan as EditPlan, variant, transcript.words, duration);
  const parsed = planSchemaFor(transcript.words.length).safeParse(plan);
  if (!parsed.success) throw new VideoError("Esa versión ya no encaja con los cambios que hiciste. Pide una nueva con \"Edítalo así\".");
  const variants = [...director.variants.filter((v) => v.id !== variantId), { ...previous, label: "Versión anterior" }].slice(-4);
  await saveDirector(projectId, { ...director, variants }, { plan });
}

/** Guarda el brief y el tope (en la subida o en la revisión). */
export async function saveBrief(projectId: string, brief: Brief, budgetUsd: number | null): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set({ brief: brief as unknown as Record<string, unknown>, ...(budgetUsd != null ? { aiBudgetUsd: clampBudget(budgetUsd) } : {}) })
    .where(eq(schema.videoProjects.id, projectId));
}

/** Estimación del costo de un "Edítalo así" (corrección + una segunda mirada), para mostrarla antes de pedirlo. */
export function editEstimate(project: Pick<Project, "director" | "transcript" | "eyes" | "brollMode" | "format">, remaining: number = BUDGET.max): EditEstimate {
  const words = (project.transcript as Transcript | null)?.words.length ?? 0;
  const eyes = readEyes(project.eyes);
  const sheet = eyes?.sheets[0] ?? { width: 1296, height: 1218 };
  const input: CostInput = { words, sheets: eyes?.sheets.length ?? 0, sheet: { width: sheet.width, height: sheet.height }, broll: project.brollMode === "auto" ? 6 : 0 };
  const plan = planEdit({ ...input, remaining });
  const withRef = planEdit({ ...input, refSheets: 2, remaining });
  return { usd: plan.estimate.first + plan.estimate.critic, max: plan.estimate.total, withReference: withRef.estimate.first + withRef.estimate.critic, model: plan.director.model === "deep" ? "Opus" : "Sonnet", rounds: 1 + plan.extraRounds, degraded: plan.degraded };
}
