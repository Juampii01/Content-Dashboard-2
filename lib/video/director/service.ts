import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, aiConfigured, generateStructured, withAiScope } from "@/lib/ai/client";
import {
  CRITIC_RULES,
  criticTask,
  criticWireSchema,
  DIRECTOR_RULES,
  directorTask,
  directorApiSchema,
  directorFromApi,
  directorToApi,
  FINAL_RULES,
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
import { readBytes } from "@/lib/storage";
import { brollSourcesReady, libraryTags, searchOptions } from "../broll";
import { detectCandidates } from "../candidates";
import { brandGraphicLook, GRAPHIC_MAX_SECONDS } from "../graphics";
import { motionRetry } from "../motion-ai";
import { resolveScenes } from "../motion-build";
import { brollGraphicOption } from "../motion-graphics";
import { planSchemaFor, type PlanStyle } from "../plan";
import { alignScript } from "../script-align";
import { proofreadTranscript } from "../transcript-fix";
import { legacyPlan, loadProject, renderInputFor, scriptText, VideoError, withEditorDefaults, type Project } from "../service";
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
import { densityFor, DENSITY_TARGETS, fillRhythm, planRhythm, rhythmTaskText, rhythmText, syncGraphics, type Density } from "../rhythm";
import { motionTheme } from "../motion-graphics";
import { removedIds } from "../timeline";
import { briefText, mapText, planText, sentencesText, transcriptText, tramosText } from "./context";
import { clampBudget, estimateRevise, estimateStage, planBudget, type BudgetPlan, type CostInput, type StagePlan } from "./cost";
import { diffPlans } from "./diff";
import { keyFrames, type KeyFrame } from "./keyframes";
import { mapFromMeasures, mapFromWire, mustKeepRanges } from "./map";
import { mapToWire, simulateCritic, simulateDirector } from "./simulate";
import { effectiveBrief, readBrief, readDirector, type Brief, type CriticIssue, type CriticRound, type DirectorState, type Eyes, type FinalReview, type VideoMap } from "./types";

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
 * Todo el consumo se carga al video (ai_usage.video_project_id) y respeta el tope por video (lib/video/director/cost.ts).
 */

export type DirectorNext =
  | { step: "understand" | "direct" | "revise" | "finalize" | "edit" }
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
  | { step: "final"; sheets: { key: string; width: number; height: number }[]; frames: KeyFrame[] };

const STAGE_LABEL: Record<string, string> = {
  "video.director.mapa": "Entender el video",
  "video.director.plan": "Dirigir la edición",
  "video.director.revisar": "Corregir",
  "video.director.critica": "Segunda mirada",
  "video.director.final": "Revisión final",
  "video.motion.retry": "Gráficos",
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
    .select({ total: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)` })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.videoProjectId, projectId));
  return Number(row?.total ?? 0);
}

export type CostSummary = { totalUsd: number; capUsd: number; simulated: boolean; stages: { label: string; usd: number; calls: number }[] };

export async function costSummary(projectId: string, capUsd: number): Promise<CostSummary> {
  const rows = await getDb()
    .select({ feature: schema.aiUsage.feature, provider: schema.aiUsage.provider, usd: sql<number>`sum(${schema.aiUsage.costUsd})`, calls: sql<number>`count(*)` })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.videoProjectId, projectId))
    .groupBy(schema.aiUsage.feature, schema.aiUsage.provider);
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
      case "final":
        await finalReview(projectId, body.sheets, body.frames);
        return { next: null, status: "DONE" };
    }
  });
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

/** Vueltas de segunda mirada del ciclo: las del tope en el análisis; una en un pedido de la persona. */
function roundLimit(d: DirectorState): number {
  const rounds = d.budget?.critic?.rounds ?? 0;
  return d.cycle === "edit" ? Math.min(1, rounds) : rounds;
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

/**
 * Dirige (primera vez), corrige con lo que encontró la segunda mirada (`revise`) o aplica un pedido de la persona
 * (`edit`, "Edítalo así"). Arma el plan con las reglas duras, resuelve gráficos y stock, y pide la vista previa.
 */
async function direct(projectId: string, mode: "revise" | "edit" | null): Promise<{ next: DirectorNext; status: string }> {
  const ctx = await load(projectId);
  if (ctx.project.status !== "PROCESSING") return { next: null, status: ctx.project.status };
  const { words, duration, format, director } = ctx;
  const base = (ctx.project.plan as EditPlan | null) ?? null;
  const map = director.map ?? mapFromMeasures(ctx.eyes, words);
  const brief = effectiveBrief(ctx.own, map.inferredBrief);
  const script = await scriptText(ctx.project.scriptId);
  const alignment = script ? alignScript(words, script) : null;
  const candidates = detectCandidates(words, { script });
  const style = await styleFor(ctx.project);
  // Lo que pidió la persona en "Edítalo así" (o en el pedido anterior, al corregir) no se deshace.
  const locks: RequestLocks | null = mode === "edit" && director.pending ? parseLocks(director.pending.instruction) : (director.request ?? null);
  const density = densityOf(ctx, base, locks);
  const limits = brollLimits(ctx, style?.every ?? null, density);
  const tags = limits.count ? await libraryTags() : [];
  const stockReady = brollSourcesReady().stock || tags.length > 0;
  const look = brandGraphicLook(ctx.brand);
  const keep = [...mustKeepRanges(brief.mustKeep, words)];
  // La CTA siempre queda; en anuncios y ventas también la oferta y lo que se muestra (producto, pantalla).
  const protect: { from: number; to: number; label: string }[] = map.beats.filter((b) => b.role === "cta").map((b) => ({ from: b.from, to: b.to, label: "la llamada a la acción" }));
  if (brief.goal === "anuncio" || brief.goal === "vender") {
    for (const b of map.beats) if (b.role === "oferta") protect.push({ from: b.from, to: b.to, label: "la oferta" });
    for (const s of map.shots) if (s.important) protect.push({ from: s.from, to: s.to, label: s.shows.toLowerCase() });
  }
  const instruction = mode === "edit" ? (director.pending?.instruction ?? "") : null;
  if (instruction) keep.push(...mustKeepRanges(instruction.match(/no (?:cortes|quites|saques)[^.]*/i)?.[0] ?? "", words));
  const lastRound = director.rounds.at(-1);
  const issues = mode === "revise" ? guardIssues(lastRound?.issues ?? [], locks).kept : [];
  const budget = budgetOf(director);
  const stage: StagePlan = budget?.director ?? { model: "deep", effort: "high" };
  const remaining = ctx.cap - (await spentUsd(projectId));
  const degraded = [...director.degraded];
  const est = mode ? estimateRevise(stage, costInput(ctx, limits.count)) : estimateStage("director", stage, costInput(ctx, limits.count));
  let effective = stage;
  if (remaining < est) {
    effective = { model: "main", effort: null };
    if (remaining < estimateStage("director", effective, costInput(ctx, limits.count)) * 0.5 && mode) {
      // Sin presupuesto para corregir: se quedan los arreglos seguros (sin IA).
      degraded.push(mode === "edit" ? "No quedó presupuesto de IA para este pedido: se aplicaron solo arreglos automáticos." : "No quedó presupuesto para otra corrección con IA.");
      await saveDirector(projectId, { ...director, degraded, pending: null });
      return { next: { step: "finalize" }, status: "PROCESSING" };
    }
    degraded.push("La dirección la hizo un modelo más económico para no pasar el tope.");
  }

  // Efectos de la biblioteca: los que permite Mi marca, cuántos para este largo, y dónde se ve la cara (los que te
  // recortan necesitan verte a cámara).
  const fxAsk = instruction ? parseFxRequest(instruction) : null;
  const fxSettings = fxLimits(readEditorDefaults(ctx.brand).effects, duration * 0.85);
  // La densidad multiplica la cantidad de efectos de Mi marca (Editor de reels: más, y más seguidos).
  const factor = DENSITY_TARGETS[density].fxFactor;
  const baseFx = fxSettings.max > 0 ? { ...fxSettings, max: Math.max(1, Math.round(fxSettings.max * factor)), minGap: Math.max(2, fxSettings.minGap / factor) } : fxSettings;
  // Un efecto pedido en "Edítalo así" entra aunque se llegue al tope (uno más), siempre que Mi marca lo permita.
  const fx = fxAsk && "kind" in fxAsk && baseFx.allowed.includes(fxAsk.kind) ? { ...baseFx, max: baseFx.max + 1 } : baseFx;
  const faceWords = faceWordsOf(ctx.eyes, words);
  // Palabras mal transcritas ("desancado" → "estancado"): solo en la primera dirección, en paralelo con el director.
  // Después las correcciones viajan en el plan (y la persona las ajusta en la revisión).
  const proofread = !mode && !base ? proofreadTranscript({ words, brandCtx: ctx.brandCtx, script }) : Promise.resolve({} as Record<string, string>);
  const simInput = { words, duration, format, candidates, map, brief, broll: { ...limits, stock: stockReady }, mustKeep: keep, preset: ctx.project.captionPreset, base, issues, instruction, fx };
  let ai: DirectorWire | null = null;
  try {
    const api = await generateStructured({
      feature: mode ? "video.director.revisar" : "video.director.plan",
      model: effective.model,
      thinking: effective.effort ? { effort: effective.effort } : null,
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
        revise:
          mode && base
            ? {
                plan: planText(base, words),
                issues: issues.map((i) => `- [${i.kind}, ${i.severity}, segundo ${i.at.toFixed(1)}] ${i.note} → ${i.fix}`).join("\n"),
                instruction,
              }
            : null,
      })}`,
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
    fx: { limits: fx, faceWords, keepUser: !(fxAsk && "none" in fxAsk) },
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
  });
  plan = filled.plan;
  if (filled.added.length) console.info(`[director] ritmo (${density}): ${filled.added.length} agregados`);
  const locked = enforceLocks(plan, base, locks, zones.zones);
  plan = locked.plan;
  if (zones.trimmed.length) plan = { ...plan, warning: [plan.warning, "Había demasiado marcado como intocable: protegí solo lo que se muestra más importante."].filter(Boolean).join(" ").slice(0, 1000) };

  const parsed = planSchemaFor(words.length).safeParse(plan);
  if (!parsed.success) {
    console.error("[director] plan inválido:", parsed.error.issues[0]?.message);
    if (!mode) {
      const fallback = await legacyPlan(ctx.project);
      await saveDirector(projectId, { ...director, degraded: [...degraded, "El plan del director no pasó la validación: se usó el editor de antes."], steps: [...director.steps, "direct"] }, { plan: fallback });
      return { next: { step: "finalize" }, status: "PROCESSING" };
    }
    await saveDirector(projectId, { ...director, degraded, pending: null });
    return { next: { step: "finalize" }, status: "PROCESSING" };
  }

  const edits = [...director.edits];
  if (mode === "edit" && base && director.pending) {
    const changes = [...diffPlans(base, plan, words, duration), ...locked.restored];
    edits.push({ at: new Date().toISOString(), instruction: director.pending.instruction, changes, note: ai.warning.slice(0, 400), source: director.pending.kind === "fix" ? "arreglo" : "persona" });
  }
  const variants = mode === "revise" ? director.variants : assembled.variants;
  const next: DirectorState = {
    ...director,
    map,
    edits: edits.slice(-20),
    variants,
    degraded,
    pending: null,
    ...(mode === "edit" ? { request: hasLocks(locks) ? locks : null } : {}),
    steps: [...director.steps, mode ?? "direct"],
    // Un pedido empieza un ciclo nuevo de segunda mirada.
    ...(mode === "edit" ? { cycle: "edit" as const, rounds: [] } : {}),
  };
  await saveDirector(projectId, next, { plan });

  // ¿Segunda mirada? Mientras queden vueltas en este ciclo; si no, verificaciones y arreglos seguros al cerrar.
  if (budget?.critic && next.rounds.length < roundLimit(next)) {
    return { next: await previewNext(ctx.project, plan, words, duration, next.rounds.length + 1, ctx.eyes), status: "PROCESSING" };
  }
  return { next: { step: "finalize" }, status: "PROCESSING" };
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
  const stage: StagePlan = budget?.critic ?? { model: "main", effort: null };
  const brief = effectiveBrief(ctx.own, map?.inferredBrief ?? null);
  const remaining = ctx.cap - (await spentUsd(projectId));
  let wire: CriticWire | null = null;
  const degraded = [...director.degraded];
  if (remaining >= estimateStage("round", stage, costInput(ctx, 0)) * 0.6) {
    try {
      wire = await generateStructured({
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
        }),
        images: await sheetImages(sheets),
        imageSizes: sheets.map((s) => ({ width: s.width, height: s.height })),
        schema: criticWireSchema,
        maxTokens: 12000,
        timeoutMs: 280_000,
        fake: () => simulateCritic(rules, frames),
      });
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
  const rounds = [...director.rounds];
  const last = rounds.at(-1);
  if (last && fixed.changes.length) rounds[rounds.length - 1] = { ...last, fixed: true, verdict: `${last.verdict} ${fixed.changes.join(" ")}`.slice(0, 600) };
  await saveDirector(projectId, { ...director, rounds, pending: null, steps: [...director.steps, "finalize"] }, { plan, status: "AWAITING_REVIEW", errorMessage: null });
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

async function finalReview(projectId: string, sheets: { key: string; width: number; height: number }[], frames: KeyFrame[]): Promise<void> {
  const ctx = await load(projectId);
  const plan = ctx.project.plan as EditPlan | null;
  if (!plan) return;
  const { words, duration, director } = ctx;
  const rules = checkPlan({ plan, words, duration, map: director.map, eyes: ctx.eyes });
  const budget = budgetOf(director);
  const stage: StagePlan | null = budget ? budget.final : { model: "main", effort: null };
  const remaining = ctx.cap - (await spentUsd(projectId));
  let wire: CriticWire | null = null;
  if (stage && sheets.length && remaining >= estimateStage("final", stage, costInput(ctx, 0)) * 0.6) {
    try {
      wire = await generateStructured({
        feature: "video.director.final",
        model: stage.model,
        thinking: stage.effort ? { effort: stage.effort } : null,
        context: `${FINAL_RULES}\n\n${ctx.brandCtx}`,
        task: criticTask({
          round: 0,
          final: true,
          brief: briefText(effectiveBrief(ctx.own, director.map?.inferredBrief ?? null)),
          map: mapText(director.map, words),
          plan: planText(plan, words),
          frames: frames.map((f, i) => `#${i + 1} ${f.t.toFixed(1)} s: ${f.label}`).join("\n"),
          checks: rules.map((i) => `- [${i.kind}, ${i.severity}, segundo ${i.at.toFixed(1)}] ${i.note}`).join("\n"),
          duration: buildTimeline(words, plan, duration).duration,
        }),
        images: await sheetImages(sheets),
        imageSizes: sheets.map((s) => ({ width: s.width, height: s.height })),
        schema: criticWireSchema,
        maxTokens: 10000,
        timeoutMs: 240_000,
        fake: () => simulateCritic(rules, frames),
      });
    } catch (error) {
      console.error("[director] revisión final sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    }
  }
  const issues: CriticIssue[] = wire ? wire.issues.map((i) => ({ kind: i.kind, severity: i.severity, at: frames[i.frame - 1]?.t ?? 0, note: i.note.slice(0, 300), fix: i.fix.slice(0, 300), by: "ai" as const })) : rules;
  const score = wire ? Math.max(0, Math.min(100, wire.score)) : Math.max(35, 96 - issues.reduce((a, i) => a + (i.severity === "alta" ? 18 : i.severity === "media" ? 9 : 4), 0));
  const final: FinalReview = {
    score,
    ok: !issues.some((i) => i.severity === "alta") && score >= 75,
    verdict: (wire?.verdict ?? (issues.length ? "Las verificaciones automáticas encontraron detalles." : "Las verificaciones automáticas no encontraron problemas.")).slice(0, 400),
    issues: issues.slice(0, 12),
    sheets: sheets.map((s) => s.key),
    frames: frames.map((f) => f.t),
    at: new Date().toISOString(),
    by: wire ? "ai" : "reglas",
  };
  await saveDirector(projectId, { ...director, final });
}

// ─── Pedidos de la persona ────────────────────────────────────────────────

/**
 * "Edítalo así" (y "Arreglarlo" de la revisión final): el pedido pasa por el director con todo el contexto. El video
 * vuelve a "procesando" un momento (el worker arma la vista previa para la segunda mirada) y después a la revisión.
 */
export async function requestEdit(projectId: string, instruction: string, kind: "edit" | "fix", userId: string | null): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (!project.plan || !project.transcript) throw new VideoError("Este video todavía no está listo para editar.");
  if (project.status !== "AWAITING_REVIEW" && project.status !== "DONE") throw new VideoError("Espera a que termine lo que se está procesando.");
  const clean = instruction.trim().slice(0, 600);
  if (clean.length < 3) throw new VideoError("Escribe qué quieres cambiar.");
  const director = readDirector(project.director);
  await getDb()
    .update(schema.videoProjects)
    .set({
      status: "PROCESSING",
      errorMessage: null,
      autoExport: false,
      director: { ...director, pending: { kind, instruction: clean }, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>,
    })
    .where(and(eq(schema.videoProjects.id, projectId), sql`${schema.videoProjects.status} in ('AWAITING_REVIEW', 'DONE')`));
  await enqueueJob({ type: "VIDEO_ANALYZE", videoProjectId: projectId, createdBy: userId, stage: "En cola", input: { projectId, sourceKey: project.sourceKey, mode: "edit" } });
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
export function editEstimate(project: Pick<Project, "director" | "transcript" | "eyes" | "brollMode" | "format">): number {
  const words = (project.transcript as Transcript | null)?.words.length ?? 0;
  const eyes = readEyes(project.eyes);
  const sheet = eyes?.sheets[0] ?? { width: 1296, height: 1218 };
  const input: CostInput = { words, sheets: eyes?.sheets.length ?? 0, sheet: { width: sheet.width, height: sheet.height }, broll: project.brollMode === "auto" ? 6 : 0 };
  const budget = budgetOf(readDirector(project.director));
  const director = budget?.director ?? { model: "deep" as const, effort: "high" as const };
  const critic = budget?.critic ?? null;
  return estimateRevise(director, input) + (critic ? estimateStage("round", critic, input) : 0);
}
