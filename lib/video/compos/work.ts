import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import {
  composCodeTask,
  composCodeWireSchema,
  composLookTask,
  composLookWireSchema,
  composPlanTask,
  composPlanWireSchema,
  COMPOS_RULES,
  imageLookTask,
  imageLookWireSchema,
  type ComposCodeWire,
} from "@/lib/ai/prompts/compos";
import { providersStatus } from "@/lib/carousels/images";
import { getDb, schema } from "@/lib/db";
import { readBytes } from "@/lib/storage";
import { faceAnchor, sourceFramesOf, sourceRangesOf } from "../fx/compile";
import { fxBrand } from "../fx-service";
import { brandGraphicLook } from "../graphics";
import { planSchemaFor } from "../plan";
import { buildTimeline, outputRange, type Timeline } from "../timeline";
import type { EditPlan, MediaInfo, Transcript, VideoFormat, Word } from "../types";
import { readDirector, type DirectorState } from "../director/types";
import { clampBudget } from "../director/cost";
import { COMPOS_LIMITS } from "./contract";
import { compileComposition, composSegments, newComposId, type ComposImage, type Composition } from "./schema";
import { codeHash, validateComposition } from "./validate";
import { fakeCode, fakeImageLook, fakeLook, fakePlan } from "./fake";
import { buildFromEffect, effectCandidates, EffectUseError, type PlaceCtx } from "./library-service";
import { candidatesText } from "./library";

/**
 * Taller de composiciones: una cola de animaciones por hacer en un video, que avanza un paso por llamada (cada paso,
 * una llamada de IA como mucho), igual que el director. La manejan el worker (VIDEO_ANALYZE en "Copiar edición" y en
 * los pedidos de "Edítalo así"; VIDEO_COMPOS en los pedidos del Estudio) y el servicio del director.
 *
 * Etapas de cada animación:
 *   plan (¿necesita imágenes generadas?) → images (las genera el worker con la cuenta del cliente) → vision (Claude mira
 *   las imágenes y marca dónde está cada cosa) → code (Claude escribe el módulo; se valida en el sandbox y, si falla,
 *   se reescribe con el error) → look (el worker dibuja cuadros sobre el video real) → looking (Claude los compara con
 *   la referencia o con el pedido y corrige) → done.
 *
 * Todo el consumo se carga al video y respeta el tope por video: si no alcanza, se saltan las vueltas de revisión y,
 * si tampoco alcanza para escribir, la animación queda sin hacer con el motivo.
 */

export type ComposImageTask = {
  id: string;
  purpose: string;
  prompt: string;
  aspect: "vertical" | "horizontal" | "square";
  status: "pending" | "ready" | "failed";
  key?: string;
  width?: number;
  height?: number;
  focus?: ComposImage["focus"];
  notes?: string;
  error?: string;
};

export type ComposTask = {
  id: string;
  compId: string;
  from_word: number;
  to_word: number;
  brief: string;
  source: Composition["source"];
  /** Momento de la receta (Copiar edición) y su ficha. */
  moment?: string;
  momentDetail?: string;
  /** Cuadros de la referencia (R#n) de ese momento. */
  refFrames?: number[];
  /** Pedido de la persona (Estudio o "Edítalo así"). */
  request?: string;
  /** Animación que se cambia ("Pídele un cambio a esta animación"). */
  base?: Composition | null;
  /** Para variedad: familia que se buscaba. */
  family?: string;
  images: ComposImageTask[];
  status: "plan" | "images" | "vision" | "code" | "look" | "looking" | "done" | "failed";
  attempts: number;
  round: number;
  approach?: string;
  lastError?: string;
  result?: Composition;
  score?: number;
  note?: string;
  sheet?: { key: string; width: number; height: number; times: number[] } | null;
  error?: string;
  /** Efecto de Mis efectos que se reusó en lugar de escribir uno nuevo (más barato). */
  reused?: { id: string; name: string; version: number } | null;
};

export type ComposWork = {
  id: string;
  mode: "copy" | "request" | "edit" | "variety";
  tasks: ComposTask[];
  startedAt: string;
  spentAtStart: number;
  /** Vueltas de revisión con cuadros por animación (2 o 3; 0 sin tope). */
  lookRounds: number;
  done: boolean;
  /** Lo que no se pudo del pedido (lo dijo Claude al planear). */
  cannot?: string;
  error?: string | null;
  /** Para el Estudio: qué pidió y en qué tramo. */
  request?: { instruction: string; from_word: number; to_word: number; replaceId: string | null } | null;
  finishedAt?: string;
  /** El pedido de "Edítalo así" que lo abrió (para no repetir vueltas del director por lo mismo). */
  editId?: string | null;
  /** Pedidos del Estudio (uno por fila en compos_requests): lo reservado del tope al encolarse y lo gastado. */
  reservedUsd?: number;
  usedUsd?: number;
};

export type WorkerNext =
  | { step: "compos"; label?: string }
  | { step: "compos-images"; items: { taskId: string; imageId: string; prompt: string; aspect: string }[]; label: string }
  | { step: "compos-stills"; render: Record<string, unknown>; items: Record<string, unknown>[]; label: string };

export const readWork = (d: DirectorState): ComposWork | null => ((d as DirectorState & { compos?: ComposWork | null }).compos ?? null);

let seq = 0;
export const newTaskId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newWorkId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newTask(input: Omit<ComposTask, "id" | "compId" | "images" | "status" | "attempts" | "round"> & { compId?: string }): ComposTask {
  return { ...input, id: newTaskId(), compId: input.compId ?? newComposId(), images: [], status: "plan", attempts: 0, round: 0 };
}

// ─── Contexto ────────────────────────────────────────────────────────────

export type WorkCtx = {
  projectId: string;
  project: NonNullable<Awaited<ReturnType<typeof loadRow>>>;
  plan: EditPlan;
  words: Word[];
  duration: number;
  format: VideoFormat;
  timeline: Timeline;
  director: DirectorState;
  brandCtx: string;
  fx: ReturnType<typeof fxBrand>;
  cap: number;
  spent: number;
  media: MediaInfo;
  /** Pedido del Estudio que se está avanzando (su fila en compos_requests); sin él, el taller del director. */
  requestId?: string | null;
};

async function loadRow(projectId: string) {
  const [row] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  return row ?? null;
}

export async function spentOn(projectId: string): Promise<number> {
  const { spentUsd } = await import("../director/service");
  return spentUsd(projectId);
}

export async function loadWorkCtx(projectId: string): Promise<WorkCtx | null> {
  const project = await loadRow(projectId);
  if (!project?.plan || !project.transcript) return null;
  const transcript = project.transcript as Transcript;
  const media = (project.media ?? {}) as MediaInfo;
  const plan = project.plan as EditPlan;
  const duration = media.duration || transcript.duration;
  const brand = await getBrand();
  return {
    projectId,
    project,
    plan,
    words: transcript.words,
    duration,
    format: plan.format,
    timeline: buildTimeline(transcript.words, plan, duration),
    director: readDirector(project.director),
    brandCtx: await brandContext(brand),
    fx: fxBrand(brandGraphicLook(brand)),
    cap: clampBudget(project.aiBudgetUsd),
    spent: await spentOn(projectId),
    media,
  };
}

/**
 * Guarda el taller. Un pedido del Estudio escribe solo su fila (varios pedidos avanzan a la vez sin pisarse) y nunca
 * revive un pedido cancelado; el taller del director (copiar, "Edítalo así", variedad) va en el estado del director.
 */
async function saveTarget(ctx: WorkCtx, work: ComposWork, extra: Partial<typeof schema.videoProjects.$inferInsert> = {}): Promise<void> {
  if (ctx.requestId) {
    const failed = work.done && !work.tasks.some((t) => t.status === "done" && t.result);
    await getDb()
      .update(schema.composRequests)
      .set({
        work: work as unknown as Record<string, unknown>,
        usedUsd: work.usedUsd ?? 0,
        status: work.done ? (failed ? "failed" : "done") : "running",
        error: failed ? (work.tasks.find((t) => t.error)?.error ?? work.error ?? "No pudimos hacer la animación.").slice(0, 400) : null,
      })
      .where(and(eq(schema.composRequests.id, ctx.requestId), inArray(schema.composRequests.status, ["queued", "running"])));
    return;
  }
  await saveWork(ctx.projectId, ctx.director, work, extra);
}

async function saveWork(projectId: string, director: DirectorState, work: ComposWork, extra: Partial<typeof schema.videoProjects.$inferInsert> = {}): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set({ director: { ...director, compos: work, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>, ...extra })
    .where(eq(schema.videoProjects.id, projectId));
}

// ─── Tramo, cara y datos de una animación ────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function span(ctx: WorkCtx, t: Pick<ComposTask, "from_word" | "to_word">): { start: number; end: number } | null {
  const stub = { id: "x", from_word: t.from_word, to_word: t.to_word, name: "x", code: "x", params: [], source: "director" as const };
  const seg = composSegments(ctx.timeline, [stub])[0];
  return seg ? { start: seg.start, end: seg.end } : null;
}

function faceFor(ctx: WorkCtx, s: { start: number; end: number }) {
  const eyes = ctx.project.eyes as { samples?: { t: number; face: { x: number; y: number; w: number; h: number } | null }[] } | null;
  return faceAnchor(eyes?.samples ?? [], sourceRangesOf(ctx.timeline, s.start, s.end), ctx.media.width || 1080, ctx.media.height || 1920, ctx.format, ctx.plan.framing.offset_x);
}

/** La composición de una tarea como item del plan (con un código dado). */
function itemOf(task: ComposTask, code: ComposCodeWire | { code: string; name: string; why: string; params: Composition["params"]; sounds: NonNullable<Composition["sounds"]>; hide_captions: boolean; tags: string[] }): Composition {
  const images: ComposImage[] = task.images
    .filter((i) => i.status === "ready" && i.key && i.width && i.height)
    .map((i) => ({ id: i.id, key: i.key!, width: i.width!, height: i.height!, prompt: i.prompt.slice(0, 600), ...(i.focus ? { focus: i.focus } : {}), ...(i.notes ? { notes: i.notes.slice(0, 600) } : {}) }));
  return {
    id: task.compId,
    from_word: task.from_word,
    to_word: task.to_word,
    name: code.name.slice(0, 60) || "Animación",
    code: code.code,
    params: cleanParams(code.params),
    sounds: (code.sounds ?? []).filter((s) => s.at >= 0 && s.at <= COMPOS_LIMITS.maxSeconds).slice(0, 8).map((s) => ({ ...s, gain: Math.max(-30, Math.min(0, s.gain)) })),
    hide_captions: code.hide_captions,
    why: code.why.slice(0, 300),
    source: task.source,
    ...(task.moment ? { moment: task.moment } : {}),
    tags: code.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9ñ-]+/g, "-").slice(0, 40)).filter(Boolean).slice(0, 6),
    ...(images.length ? { images } : {}),
    ...(task.request ? { request: task.request.slice(0, 1500) } : {}),
  };
}

function cleanParams(params: { key: string; label: string; value: string }[]): Composition["params"] {
  const seen = new Set<string>();
  const out: Composition["params"] = [];
  for (const p of params) {
    const key = p.key.replace(/[^a-zA-Z0-9_]/g, "").replace(/^[^a-zA-Z]+/, "").slice(0, 31);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: (p.label || key).slice(0, 40), value: String(p.value ?? "").slice(0, 160) });
  }
  return out.slice(0, 12);
}

/** Lo que necesita Mis efectos para armar y validar una composición en este video. */
export function placeCtxOf(ctx: WorkCtx): PlaceCtx {
  return {
    projectId: ctx.projectId,
    timeline: ctx.timeline,
    format: ctx.format,
    brand: ctx.fx,
    captionsVisible: ctx.plan.captions.preset !== "ninguno",
    face: (s) => faceFor(ctx, s),
    spoken: (from, to) => ctx.timeline.words.filter((w) => w.id >= from && w.id <= to).map((w) => ({ text: ctx.plan.corrections[String(w.id)] ?? w.text, emphasis: Boolean(w.emphasis) })),
  };
}

function envFor(ctx: WorkCtx, item: Composition) {
  const s = span(ctx, item);
  if (!s) return null;
  return compileComposition({ item, start: s.start, end: s.end, timeline: ctx.timeline, format: ctx.format, brand: ctx.fx, face: faceFor(ctx, s), captionsVisible: ctx.plan.captions.preset !== "ninguno" });
}

// ─── Imágenes para la IA ─────────────────────────────────────────────────

async function imagesOf(keys: { key: string; width: number; height: number }[]): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[]> {
  const out: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[] = [];
  for (const k of keys) {
    try {
      const buf = await readBytes(k.key, 8 * 1024 * 1024);
      const mediaType = k.key.endsWith(".png") ? "image/png" : k.key.endsWith(".webp") ? "image/webp" : "image/jpeg";
      out.push({ mediaType, data: buf.toString("base64") });
    } catch (error) {
      console.error("[compos] no se pudo leer una imagen:", error instanceof Error ? error.message : error);
    }
  }
  return out;
}

/** Hojas de la referencia donde están los cuadros de un momento (como mucho 2). */
function refSheetsFor(ctx: WorkCtx, frames: number[] | undefined) {
  const sheets = ctx.director.reference?.status === "ready" ? (ctx.director.reference.sheets ?? []) : [];
  if (!frames?.length || !sheets.length) return [];
  return sheets.filter((s) => s.frames.some((f) => frames.includes(f))).slice(0, 2);
}

// ─── Costo ───────────────────────────────────────────────────────────────

/**
 * Estimaciones por etapa (USD, precios de oct-2026 en lib/ai/pricing.ts), para no pasarse del tope:
 * - plan: Sonnet, reglas en caché (~17 mil tokens leídos) + ~600 de tarea → ~500 de salida ≈ USD 0,01.
 * - vision: Sonnet con 1 o 2 imágenes (~1.600 tokens c/u) ≈ USD 0,03.
 * - code: Opus con razonamiento alto: reglas en caché, tarea + 2 hojas de la referencia (~5.500 tokens) y ~3 mil de
 *   código + ~8 mil de razonamiento ≈ USD 0,25 (0,40 con margen para un reintento por validación).
 * - look: Opus con razonamiento medio: hoja de la animación + 2 de la referencia + el código (~9 mil) y el código
 *   corregido + razonamiento (~6 mil) ≈ USD 0,16 por vuelta.
 * - reuse: reusar un efecto de Mis efectos no escribe código (solo el plan, que ya se contó): lo que se ahorra es la
 *   etapa de código. Se registra en la tarea (`reused`) y en el reporte del taller.
 * La primera escritura de las reglas en caché (~USD 0,14 en Opus) se suma una vez por video.
 */
export const STAGE_COST = { plan: 0.02, vision: 0.04, code: 0.4, look: 0.2, reuse: 0 } as const;

/**
 * Lo que queda para esta animación: el tope del video menos lo gastado; en un pedido del Estudio, además, lo que le
 * queda de su reserva (así varios pedidos a la vez nunca pasan el tope entre todos).
 */
function remaining(ctx: WorkCtx, work?: ComposWork): number {
  const video = ctx.cap - ctx.spent;
  if (!ctx.requestId || !work || work.reservedUsd == null) return video;
  return Math.min(video + (work.reservedUsd - (work.usedUsd ?? 0)), work.reservedUsd - (work.usedUsd ?? 0));
}

/** Suma al pedido lo que cuesta una etapa (estimado, para su reserva). */
function charge(work: ComposWork, usd: number): void {
  work.usedUsd = Math.round(((work.usedUsd ?? 0) + usd) * 1000) / 1000;
}

// ─── Paso ────────────────────────────────────────────────────────────────

export type StepResult = { next: WorkerNext | null; finished: boolean };

/**
 * Un paso del taller. `body` trae lo que devolvió el worker (imágenes generadas u hojas de cuadros). Devuelve qué
 * tiene que hacer el worker a continuación o `finished` cuando todas las animaciones terminaron (el que llama decide
 * qué sigue: la segunda mirada del director, cerrar, o nada en un pedido del Estudio).
 */
export async function advanceWork(projectId: string, body: { step: string; results?: unknown; sheets?: unknown; workId?: string } = { step: "compos" }): Promise<StepResult> {
  const ctx = await loadWorkCtx(projectId);
  if (!ctx) return { next: null, finished: true };
  let work: ComposWork | null;
  if (body.workId) {
    // Un pedido del Estudio: su fila. Cancelado, terminado o de otro video: no se avanza.
    const [row] = await getDb().select().from(schema.composRequests).where(and(eq(schema.composRequests.id, body.workId), eq(schema.composRequests.projectId, projectId))).limit(1);
    if (!row || (row.status !== "queued" && row.status !== "running")) return { next: null, finished: true };
    ctx.requestId = row.id;
    work = row.work as unknown as ComposWork;
    work.reservedUsd ??= row.reservedUsd;
  } else work = readWork(ctx.director);
  if (!work || work.done) return { next: null, finished: true };

  // Lo que devuelve el worker.
  if (body.step === "compos-images-done") applyImages(work, body.results);
  if (body.step === "compos-look") applySheets(work, body.sheets);

  // 1) Imágenes por generar: todas juntas en un pedido al worker.
  const pendingImages = work.tasks.filter((t) => t.status === "images");
  if (pendingImages.length && body.step !== "compos-images-done") {
    const items = pendingImages.flatMap((t) => t.images.filter((i) => i.status === "pending").map((i) => ({ taskId: t.id, imageId: i.id, prompt: i.prompt, aspect: i.aspect })));
    if (items.length) {
      await saveTarget(ctx, work);
      return { next: { step: "compos-images", items, label: `Generando ${items.length === 1 ? "la imagen" : `${items.length} imágenes`} con IA` }, finished: false };
    }
  }
  for (const t of pendingImages) if (!t.images.some((i) => i.status === "pending")) t.status = t.images.some((i) => i.status === "ready") ? "vision" : "code";

  // 2) Una tarea que necesita IA: una llamada por paso.
  const task = work.tasks.find((t) => t.status === "plan" || t.status === "vision" || t.status === "code" || t.status === "looking");
  if (task) {
    const label = await stepTask(ctx, work, task);
    await saveTarget(ctx, work);
    return { next: { step: "compos", label }, finished: false };
  }

  // 3) Cuadros por dibujar (revisión): todas las que esperan, en un pedido al worker.
  const toDraw = work.tasks.filter((t) => t.status === "look" && t.result);
  if (toDraw.length) {
    const stills = await stillsRequest(ctx, toDraw);
    await saveTarget(ctx, work);
    if (stills) return { next: stills, finished: false };
    for (const t of toDraw) t.status = "done";
  }

  // 4) Todo listo: al plan.
  await finishWork(ctx, work);
  return { next: null, finished: true };
}

function applyImages(work: ComposWork, raw: unknown): void {
  const results = Array.isArray(raw) ? (raw as { taskId?: string; imageId?: string; key?: string; width?: number; height?: number; error?: string }[]) : [];
  for (const r of results) {
    const task = work.tasks.find((t) => t.id === r.taskId);
    const img = task?.images.find((i) => i.id === r.imageId);
    if (!task || !img || img.status !== "pending") continue;
    if (r.key && typeof r.width === "number" && typeof r.height === "number") Object.assign(img, { status: "ready", key: r.key, width: r.width, height: r.height });
    else Object.assign(img, { status: "failed", error: String(r.error ?? "No se pudo generar.").slice(0, 300) });
  }
  // Las que el worker no devolvió quedan como fallidas (no se vuelven a pedir en un bucle).
  for (const t of work.tasks) for (const i of t.images) if (t.status === "images" && i.status === "pending") Object.assign(i, { status: "failed", error: "El generador no devolvió la imagen." });
}

function applySheets(work: ComposWork, raw: unknown): void {
  const sheets = Array.isArray(raw) ? (raw as { taskId?: string; key?: string; width?: number; height?: number; times?: number[] }[]) : [];
  for (const t of work.tasks.filter((x) => x.status === "look")) {
    const s = sheets.find((x) => x.taskId === t.id);
    if (s?.key && s.width && s.height) {
      t.sheet = { key: s.key, width: s.width, height: s.height, times: Array.isArray(s.times) ? s.times.slice(0, 12) : [] };
      t.status = "looking";
    } else t.status = "done"; // sin cuadros, se queda como está
  }
}

/** Lo que pide el worker para dibujar cuadros de cada animación sobre el video real (la misma entrada del render). */
async function stillsRequest(ctx: WorkCtx, tasks: ComposTask[]): Promise<WorkerNext | null> {
  const { renderInputFor } = await import("../service");
  const transcript = ctx.project.transcript as Transcript;
  // El video base: el plan actual sin las animaciones de esta tanda (se dibujan aparte, encima).
  const { input } = await renderInputFor(ctx.project as Parameters<typeof renderInputFor>[0], ctx.plan, ctx.format, transcript, ctx.duration);
  const items: Record<string, unknown>[] = [];
  for (const t of tasks) {
    const spec = envFor(ctx, t.result!);
    if (!spec) continue;
    const d = spec.duration;
    const times = [0.12, 0.3, 0.5, 0.7, 0.9].map((p) => round3(Math.min(d - 0.04, d * p)));
    const frames = Math.max(1, Math.round(spec.duration * 30));
    items.push({
      taskId: t.id,
      round: t.round + 1,
      spec,
      times,
      sourceFrames: spec.mask ? sourceFramesOf(ctx.timeline, spec.start, frames) : [],
      ...((t.result!.images ?? []).length ? { imageKeys: Object.fromEntries(t.result!.images!.map((g) => [g.id, g.key])), projectId: ctx.projectId } : {}),
    });
  }
  if (!items.length) return null;
  return { step: "compos-stills", render: { ...input, effects: [], broll: [] }, items, label: `Mirando ${items.length === 1 ? "la animación" : `${items.length} animaciones`} sobre tu video` };
}

const said = (ctx: WorkCtx, t: Pick<ComposTask, "from_word" | "to_word">) =>
  ctx.timeline.words
    .filter((w) => w.id >= t.from_word && w.id <= t.to_word)
    .map((w) => ctx.plan.corrections[String(w.id)] ?? w.text)
    .join(" ")
    .slice(0, 600);

/** Hace la etapa de una tarea (una llamada de IA). Devuelve la etiqueta de progreso. */
async function stepTask(ctx: WorkCtx, work: ComposWork, task: ComposTask): Promise<string> {
  const n = work.tasks.indexOf(task) + 1;
  const of = `${n} de ${work.tasks.length}`;
  const s = span(ctx, task);
  if (!s) {
    task.status = "failed";
    task.error = "Ese tramo ya no está en el video (se cortó).";
    return `Animación ${of}`;
  }
  const brief = task.brief;
  const duration = s.end - s.start;
  try {
    switch (task.status) {
      case "plan": {
        // Sin tope para escribir, todavía se puede reusar un efecto guardado (solo cuesta el plan).
        const onlyReuse = remaining(ctx, work) < STAGE_COST.code + STAGE_COST.plan;
        if (remaining(ctx, work) < STAGE_COST.plan) {
          task.status = "failed";
          task.error = "No alcanzó el tope de IA de este video para escribir esta animación.";
          return `Animación ${of}`;
        }
        const status = await providersStatus().catch(() => null);
        const canImages = Boolean(status?.preferred);
        // Mis efectos que encajan (rotación: lo que ya está en este video o en esta tanda no se ofrece otra vez).
        // Un cambio sobre una animación existente siempre se escribe (es otra cosa).
        const inUse = [...(ctx.plan.compositions ?? []).flatMap((c) => (c.lib_id ? [c.lib_id] : [])), ...work.tasks.flatMap((t) => (t.reused ? [t.reused.id] : []))];
        const library = task.base ? [] : await effectCandidates({ brief, said: said(ctx, task), exclude: inUse, duration }).catch(() => []);
        const plan = await generateStructured({
          feature: "video.compos.plan",
          model: "main",
          context: `${COMPOS_RULES}\n\n${ctx.brandCtx}`,
          task: composPlanTask({ brief, said: said(ctx, task), duration, format: ctx.format, hasImages: canImages, library: library.length ? candidatesText(library) : null, copy: work.mode === "copy" }),
          schema: composPlanWireSchema,
          maxTokens: 8000,
          videoProjectId: ctx.projectId,
          fake: () => fakePlan(brief, library),
        });
        charge(work, STAGE_COST.plan);
        task.approach = plan.approach.slice(0, 1200);
        const pick = plan.reuse ? library.find((e) => e.id === plan.reuse.trim()) : null;
        if (pick) {
          try {
            const params = pick.row.params.map((p) => {
              const v = plan.reuse_params.find((x) => x.key === p.key)?.value;
              return typeof v === "string" && v.trim() ? { ...p, value: v.trim().slice(0, 160) } : p;
            });
            const built = await buildFromEffect(placeCtxOf(ctx), pick.row, { from: task.from_word, to: task.to_word, params, source: task.source, compId: task.compId });
            task.result = { ...built, ...(task.moment ? { moment: task.moment } : {}), ...(task.request ? { request: task.request.slice(0, 1500) } : {}) };
            task.reused = { id: pick.id, name: pick.name, version: pick.row.version };
            task.note = [task.note, `Reusamos «${pick.name}» de Mis efectos.`].filter(Boolean).join(" ").slice(0, 300);
            task.status = work.lookRounds > task.round && remaining(ctx, work) >= STAGE_COST.look ? "look" : "done";
            return `Reusando «${pick.name}» de Mis efectos (${of})`;
          } catch (error) {
            // No funciona en este tramo: se escribe una nueva.
            console.warn("[compos] no se pudo reusar un efecto:", error instanceof EffectUseError ? error.message : error);
          }
        }
        if (onlyReuse) {
          task.status = "failed";
          task.error = "No alcanzó el tope de IA de este video para escribir esta animación (y ninguno de Mis efectos encajaba).";
          return `Animación ${of}`;
        }
        const wanted = plan.images.slice(0, 2);
        if (wanted.length && canImages) {
          task.images = wanted.map((im, i) => ({ id: `g${task.id.slice(1, 9)}${i}`, purpose: im.purpose.slice(0, 200), prompt: `${im.prompt.slice(0, 900)}\nNo text, no letters, no numbers, no watermark.`, aspect: im.aspect, status: "pending" as const }));
          task.status = "images";
        } else {
          if (wanted.length) {
            task.note = "Pediste una imagen generada, pero no hay ChatGPT ni API key de OpenAI conectados (Ajustes → Claves de servicios): la animación se dibujó sin ella.";
            task.approach = `${task.approach ?? ""}\nNO HAY GENERADOR DE IMÁGENES: dibuja todo con código (formas simplificadas, siluetas, íconos geométricos) y texto; no uses env.assets.`.slice(0, 1400);
          }
          task.status = "code";
        }
        return `Planeando la animación ${of}`;
      }
      case "vision": {
        const ready = task.images.filter((i) => i.status === "ready");
        if (ready.length && remaining(ctx, work) >= STAGE_COST.vision + STAGE_COST.code) {
          const wire = await generateStructured({
            feature: "video.compos.imagenes",
            model: "main",
            context: `${COMPOS_RULES}\n\n${ctx.brandCtx}`,
            task: imageLookTask({ brief, images: ready.map((i) => ({ purpose: i.purpose, width: i.width!, height: i.height! })) }),
            images: await imagesOf(ready.map((i) => ({ key: i.key!, width: i.width!, height: i.height! }))),
            imageSizes: ready.map((i) => ({ width: i.width!, height: i.height! })),
            schema: imageLookWireSchema,
            maxTokens: 3000,
            videoProjectId: ctx.projectId,
            fake: () => fakeImageLook(ready.length),
          });
          charge(work, STAGE_COST.vision);
          for (const r of wire.images) {
            const img = ready[r.index - 1];
            if (!img) continue;
            const c = (v: number) => Math.max(0, Math.min(1, v));
            img.focus = { x: c(r.focus.x), y: c(r.focus.y), w: c(r.focus.w), h: c(r.focus.h), label: r.label.slice(0, 80) };
            img.notes = r.notes.slice(0, 600);
            if (!r.usable) img.notes = `NO SIRVE TAL CUAL: ${img.notes}`.slice(0, 600);
          }
        }
        task.status = "code";
        return `Mirando las imágenes de la animación ${of}`;
      }
      case "code": {
        const refSheets = work.mode === "copy" ? refSheetsFor(ctx, task.refFrames) : [];
        const readyImages = task.images.filter((i) => i.status === "ready");
        const wire = await generateStructured({
          feature: "video.compos.codigo",
          model: "deep",
          thinking: { effort: task.attempts > 0 ? "medium" : "high" },
          context: `${COMPOS_RULES}\n\n${ctx.brandCtx}`,
          task: composCodeTask({
            brief: `${brief}${task.approach ? `\nENFOQUE: ${task.approach}` : ""}`,
            said: said(ctx, task),
            words: wordsText(ctx, task, s.start),
            duration,
            format: ctx.format,
            width: ctx.format === "9:16" ? 1080 : 1920,
            height: ctx.format === "9:16" ? 1920 : 1080,
            face: faceText(faceFor(ctx, s)),
            recipeGlobal: work.mode === "copy" ? recipeGlobalText(ctx.director) : null,
            momentDetail: task.momentDetail ?? null,
            images: readyImages.length ? readyImages.map((im, i) => `${i + 1}. env.assets (id "${im.id}", ${im.width}×${im.height}): ${im.purpose}. Zona importante: ${im.focus ? `x ${im.focus.x.toFixed(3)}, y ${im.focus.y.toFixed(3)}, ancho ${im.focus.w.toFixed(3)}, alto ${im.focus.h.toFixed(3)} (${im.focus.label ?? ""})` : "no marcada"}. ${im.notes ?? ""}`).join("\n") : null,
            avoid: familiesToAvoid(ctx, task),
            base: task.base ? { code: task.base.code, params: JSON.stringify(Object.fromEntries(task.base.params.map((p) => [p.key, p.value]))), request: task.request ?? "" } : null,
            previousError: task.lastError ?? null,
            refFrames: refSheets.length,
          }),
          images: refSheets.length ? await imagesOf(refSheets) : undefined,
          imageSizes: refSheets.map((r) => ({ width: r.width, height: r.height })),
          schema: composCodeWireSchema,
          // Con razonamiento alto, el pensamiento y el código comparten el tope: con 24 mil, las animaciones grandes
          // salían cortadas a la mitad ("Unterminated string").
          maxTokens: 48000,
          timeoutMs: 700_000,
          videoProjectId: ctx.projectId,
          fake: () => fakeCode({ brief, said: said(ctx, task), base: task.base ?? null, request: task.request ?? null, attempt: task.attempts, hasImage: readyImages.length > 0 }),
        });
        charge(work, STAGE_COST.code / 1.6);
        task.attempts++;
        const item = itemOf(task, wire);
        const spec = envFor(ctx, item);
        const check = spec ? await validateComposition(item.code, spec.compos!.env) : { ok: false as const, error: "Sin tramo.", line: null, hash: "" };
        if (!check.ok) {
          task.lastError = `${check.error}${check.line ? ` (línea ${check.line})` : ""}`.slice(0, 600);
          if (task.attempts >= 3) {
            task.status = "failed";
            task.error = `No pudimos dejar la animación sin errores: ${task.lastError}`;
          }
          return `Corrigiendo la animación ${of}`;
        }
        task.lastError = undefined;
        // Los textos editables con los valores por defecto del módulo si Claude no los listó.
        const params = item.params.length ? item.params : Object.entries(check.defaults).map(([key, value]) => ({ key, label: key, value }));
        task.result = { ...item, params, checked: check.hash };
        task.status = work.lookRounds > task.round && remaining(ctx, work) >= STAGE_COST.look ? "look" : "done";
        return `Programando la animación ${of}`;
      }
      case "looking": {
        if (!task.result || !task.sheet || remaining(ctx, work) < STAGE_COST.look * 0.6) {
          task.status = "done";
          return `Revisando la animación ${of}`;
        }
        const refSheets = work.mode === "copy" ? refSheetsFor(ctx, task.refFrames) : [];
        const wire = await generateStructured({
          feature: "video.compos.mirar",
          model: "deep",
          thinking: { effort: "medium" },
          context: `${COMPOS_RULES}\n\n${ctx.brandCtx}`,
          task: composLookTask({ brief, momentDetail: task.momentDetail ?? null, code: task.result.code, times: task.sheet.times, refFrames: refSheets.length, round: task.round + 1 }),
          images: await imagesOf([task.sheet, ...refSheets]),
          imageSizes: [task.sheet, ...refSheets].map((r) => ({ width: r.width, height: r.height })),
          schema: composLookWireSchema,
          // Con razonamiento alto, el pensamiento y el código comparten el tope: con 24 mil, las animaciones grandes
          // salían cortadas a la mitad ("Unterminated string").
          maxTokens: 48000,
          timeoutMs: 700_000,
          videoProjectId: ctx.projectId,
          fake: () => fakeLook(task.round),
        });
        charge(work, STAGE_COST.look);
        task.round++;
        task.score = Math.round(Math.max(0, Math.min(100, wire.score)));
        task.note = [task.note, wire.note].filter(Boolean).join(" ").slice(0, 300);
        task.sheet = null;
        if (!wire.ok && wire.fixed.trim() && task.round < work.lookRounds) {
          const fixedItem = { ...task.result, code: wire.fixed };
          const spec = envFor(ctx, fixedItem);
          const check = spec ? await validateComposition(fixedItem.code, spec.compos!.env) : null;
          if (check?.ok) {
            task.result = { ...fixedItem, checked: check.hash };
            task.status = remaining(ctx, work) >= STAGE_COST.look ? "look" : "done";
            return `Puliendo la animación ${of} (vuelta ${task.round + 1})`;
          }
        }
        task.status = "done";
        return `Revisando la animación ${of}`;
      }
    }
  } catch (error) {
    console.error("[compos]", task.status, error instanceof AiError ? error.detail : error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 4).join(" · ") : error);
    task.attempts++;
    if (task.attempts >= 3 || task.status === "plan") {
      // Sin plan: se escribe directo; sin mirar: queda como está.
      if (task.status === "plan") task.status = "code";
      else if (task.status === "looking" || task.status === "vision") task.status = task.status === "vision" ? "code" : "done";
      else {
        task.status = "failed";
        task.error = error instanceof AiError ? error.userMessage : "La IA no respondió.";
      }
    }
  }
  return `Animación ${of}`;
}

function wordsText(ctx: WorkCtx, t: Pick<ComposTask, "from_word" | "to_word">, start: number): string {
  return ctx.timeline.words
    .filter((w) => w.id >= t.from_word && w.id <= t.to_word)
    .map((w) => `${ctx.plan.corrections[String(w.id)] ?? w.text}@${Math.max(0, w.start - start).toFixed(2)}${w.emphasis ? "*" : ""}`)
    .join(" ");
}

function faceText(f: { x: number; y: number; w: number; h: number }): string {
  return `x ${Math.round(f.x)}, y ${Math.round(f.y)}, ancho ${Math.round(f.w)}, alto ${Math.round(f.h)}`;
}

function recipeGlobalText(d: DirectorState): string | null {
  const copy = (d as DirectorState & { copy?: { recipe?: { global?: Record<string, unknown>; summary?: string } } }).copy;
  const g = copy?.recipe?.global;
  if (!g) return null;
  return [copy?.recipe?.summary, ...Object.entries(g).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)].filter(Boolean).join("\n");
}

/** Familias usadas en este video y en los últimos de la marca (variedad), salvo en una copia (manda la referencia). */
function familiesToAvoid(ctx: WorkCtx, task: ComposTask): string | null {
  if (task.source === "copy") return null;
  const here = (ctx.plan.compositions ?? []).filter((c) => c.id !== task.compId).flatMap((c) => c.tags ?? []);
  const recent = (ctx.director as DirectorState & { recentFamilies?: string[] }).recentFamilies ?? [];
  const all = [...new Set([...here, ...recent])].slice(0, 16);
  return all.length ? all.join(", ") : null;
}

// ─── Cierre ──────────────────────────────────────────────────────────────

const overlapsW = (a: { from_word: number; to_word: number }, b: { from_word: number; to_word: number }) => a.from_word <= b.to_word && b.from_word <= a.to_word;

type Spanned = { from_word: number; to_word: number; layer?: number };

/**
 * Capa para una animación nueva: encima de todo lo que se le pisa (b-roll, efectos y otras animaciones). Nada se
 * reemplaza: lo de abajo sigue ahí y se ve cuando la animación termina o si deja partes sin pintar.
 */
export function layerOnTop(plan: Pick<EditPlan, "broll" | "effects" | "compositions">, x: { from_word: number; to_word: number }, also: Spanned[] = []): number {
  const under: Spanned[] = [...plan.broll.filter((b) => b.choice), ...(plan.effects ?? []), ...(plan.compositions ?? []), ...also];
  const hit = under.filter((u) => overlapsW(u, x));
  return hit.length ? Math.min(999, Math.max(...hit.map((u) => u.layer ?? 0)) + 1) : 0;
}

/** Pone las animaciones hechas en el plan encima de lo que se pisa con ellas (en capas, sin quitar nada) y cierra el taller. */
async function finishWork(ctx: WorkCtx, work: ComposWork): Promise<void> {
  if (ctx.requestId) {
    // Un pedido del Estudio no toca el plan: el Estudio lo agrega sobre lo que la persona tenga (con deshacer).
    work.done = true;
    work.finishedAt = new Date().toISOString();
    await saveTarget(ctx, work);
    return;
  }
  const made = work.tasks.filter((t) => t.status === "done" && t.result).map((t) => t.result!);
  let plan = ctx.plan;
  if (made.length) {
    // Una tarea que rehace una animación existente (mismo id) la cambia en su lugar y conserva su capa.
    const keep = (plan.compositions ?? []).filter((c) => !made.some((m) => m.id === c.id));
    const base = { ...plan, compositions: keep };
    const placed: Composition[] = [];
    for (const m of [...made].sort((a, b) => a.from_word - b.from_word)) {
      const old = (plan.compositions ?? []).find((c) => c.id === m.id);
      placed.push({ ...m, layer: m.layer ?? old?.layer ?? layerOnTop(base, m, placed) });
    }
    const next: EditPlan = { ...plan, compositions: [...keep, ...placed].sort((a, b) => a.from_word - b.from_word).slice(0, 24) };
    if (planSchemaFor(ctx.words.length).safeParse(next).success) plan = next;
    else console.error("[compos] el plan con las animaciones no pasó la validación");
  }
  work.done = true;
  work.finishedAt = new Date().toISOString();
  await saveWork(ctx.projectId, ctx.director, work, plan !== ctx.plan ? { plan } : {});
}

/** Lo que muestra el Estudio de un taller (sin el código). */
export function workView(work: ComposWork | null) {
  if (!work) return null;
  return {
    id: work.id,
    mode: work.mode,
    done: work.done,
    cannot: work.cannot ?? "",
    error: work.error ?? null,
    request: work.request ?? null,
    tasks: work.tasks.map((t) => ({ id: t.id, compId: t.compId, from_word: t.from_word, to_word: t.to_word, brief: t.brief.slice(0, 200), status: t.status, score: t.score ?? null, note: t.note ?? "", error: t.error ?? "", moment: t.moment ?? null, reused: t.reused ?? null, images: t.images.map((i) => ({ status: i.status, error: i.error ?? "" })) })),
    /** Lo que se ahorró reusando Mis efectos (la etapa de código que no se pagó). */
    savedUsd: Math.round(work.tasks.filter((t) => t.reused).length * STAGE_COST.code * 100) / 100,
  };
}
export type WorkView = NonNullable<ReturnType<typeof workView>>;

export { codeHash, outputRange };
