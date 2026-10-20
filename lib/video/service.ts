import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { EDITOR_RULES, planAiSchema, planTask, type PlanAiOutput } from "@/lib/ai/prompts/editor";
import { scriptAsText } from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { cancelProjectJobs, enqueueJob } from "@/lib/jobs";
import { deleteKeys, deletePrefix, fileDriver, fileInfo, MAX_VIDEO_BYTES, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";
import { storedKey } from "@/lib/storage/copy";
import { planBroll } from "./broll";
import { detectCandidates } from "./candidates";
import { captionBlocks, toSrt } from "./captions";
import { brollCredits, brollSegments, computeZooms } from "./effects";
import { assemblePlan, brollItemSchema, planSchemaFor, rangesFromIds, withDerived } from "./plan";
import { alignScript } from "./script-align";
import type { StyleMetrics } from "./style";
import { stylePreset } from "./styles";
import { buildTimeline } from "./timeline";
import { FPS, type BrollItem, type BrollOption, type CaptionPresetKey, type EditPlan, type MediaInfo, type Transcript, type VideoFormat } from "./types";

/**
 * Ciclo de vida de un proyecto del Editor de video:
 * UPLOADING → (subida directa al almacenamiento) → PROCESSING (worker: ingesta, transcripción; app: plan)
 * → AWAITING_REVIEW (la persona revisa) → RENDERING (worker) → DONE. Cualquier etapa puede terminar en FAILED.
 */
export class VideoError extends Error {}

type Project = typeof schema.videoProjects.$inferSelect;

export async function loadProject(id: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, id)).limit(1);
  return row ?? null;
}

const keyPrefix = (id: string) => `editor/${id}/`;

function extensionFor(name: string, type: string): string | null {
  const byType = VIDEO_TYPES[type.toLowerCase()];
  if (byType) return byType;
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return ext && VIDEO_EXTENSIONS.includes(ext) ? ext.slice(1) : null;
}

/** Idioma de la transcripción según Mi marca. */
async function transcriptionLanguage(): Promise<string> {
  const brand = await getBrand();
  return brand?.language?.startsWith("en") ? "en" : "es";
}

export async function createProject(input: {
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  format: VideoFormat;
  preset: CaptionPresetKey;
  scriptId: string | null;
  styleId?: string | null;
  brollMode?: BrollMode;
  userId: string;
}): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new VideoError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = extensionFor(input.fileName, input.fileType);
  if (!ext) throw new VideoError("Ese formato no es compatible. Sube un video MP4, MOV, WEBM o MKV.");
  if (input.fileSize <= 0) throw new VideoError("El archivo está vacío.");
  if (input.fileSize > MAX_VIDEO_BYTES) throw new VideoError("El video pesa más de 8 GB. Expórtalo en una calidad menor y vuelve a intentarlo.");
  const id = randomUUID();
  const key = `${keyPrefix(id)}original.${ext}`;
  await getDb().insert(schema.videoProjects).values({
    id,
    title: input.title,
    status: "UPLOADING",
    format: input.format,
    captionPreset: input.preset,
    scriptId: input.scriptId,
    styleId: await readyStyleId(input.styleId),
    brollMode: input.brollMode ?? "off",
    sourceKey: key,
    sourceName: input.fileName.slice(0, 200),
    sourceBytes: input.fileSize,
    createdBy: input.userId,
  });
  return { id, key };
}

export type BrollMode = "auto" | "off";

export type DraftSettings = { title: string; format: VideoFormat; preset: CaptionPresetKey; scriptId: string | null; styleId?: string | null; brollMode?: BrollMode };

/** Solo se guarda un estilo que existe y está listo. */
async function readyStyleId(id: string | null | undefined): Promise<string | null> {
  return (await stylePreset(id))?.id ?? null;
}

async function draftColumns(settings: DraftSettings) {
  return {
    title: settings.title,
    format: settings.format,
    captionPreset: settings.preset,
    scriptId: settings.scriptId,
    ...(settings.styleId !== undefined ? { styleId: await readyStyleId(settings.styleId) } : {}),
    ...(settings.brollMode ? { brollMode: settings.brollMode } : {}),
  };
}

/**
 * Después de la subida: guarda lo elegido en los pasos, verifica que el archivo está completo y encola el análisis.
 */
export async function completeUpload(projectId: string, userId: string, settings?: DraftSettings): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "UPLOADING") return;
  const info = project.sourceKey ? await fileInfo(project.sourceKey) : null;
  if (!info || info.size === 0) throw new VideoError("La subida no terminó. Vuelve a elegir el archivo para continuar.");
  if (project.sourceBytes && info.size !== project.sourceBytes) throw new VideoError("El archivo llegó incompleto. Vuelve a subirlo.");
  const next = settings ? await draftColumns(settings) : {};
  await getDb()
    .update(schema.videoProjects)
    .set({ ...next, status: "PROCESSING", sourceBytes: info.size, errorMessage: null })
    .where(and(eq(schema.videoProjects.id, projectId), eq(schema.videoProjects.status, "UPLOADING")));
  await enqueueAnalyze(project, userId);
}

/** Cambia lo elegido en los pasos mientras el video todavía se sube. */
export async function updateDraft(projectId: string, settings: DraftSettings): Promise<void> {
  await getDb()
    .update(schema.videoProjects)
    .set(await draftColumns(settings))
    .where(and(eq(schema.videoProjects.id, projectId), eq(schema.videoProjects.status, "UPLOADING")));
}

async function enqueueAnalyze(project: Project, userId: string | null) {
  await enqueueJob({
    type: "VIDEO_ANALYZE",
    videoProjectId: project.id,
    createdBy: userId,
    stage: "En cola",
    input: { projectId: project.id, sourceKey: project.sourceKey, language: await transcriptionLanguage() },
  });
}

/** Proyecto a partir de un video generado en "Videos con clon" (ya está en el almacenamiento). */
export async function createFromClone(
  cloneVideoId: string,
  format: VideoFormat,
  preset: CaptionPresetKey,
  userId: string,
  extra: { styleId?: string | null; brollMode?: BrollMode } = {},
): Promise<string> {
  const [clone] = await getDb().select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, cloneVideoId)).limit(1);
  if (!clone || clone.status !== "COMPLETED" || !clone.videoUrl) throw new VideoError("Ese video con clon todavía no está listo.");
  // El original tiene que estar en nuestro almacenamiento privado (las URLs de HeyGen vencen).
  const sourceKey = storedKey(clone.videoUrl);
  if (!sourceKey) throw new VideoError("Ese video todavía está solo en HeyGen. Configura el almacenamiento de videos o descárgalo y súbelo al editor.");
  const id = randomUUID();
  await getDb().insert(schema.videoProjects).values({
    id,
    title: clone.title,
    status: "PROCESSING",
    format,
    captionPreset: preset,
    scriptId: clone.scriptId,
    styleId: await readyStyleId(extra.styleId),
    brollMode: extra.brollMode ?? "off",
    sourceKey,
    sourceName: `${clone.title}.mp4`,
    createdBy: userId,
  });
  const project = (await loadProject(id))!;
  await enqueueAnalyze(project, userId);
  return id;
}

// ─── Plan (lo pide el worker al terminar de transcribir) ─────────────────

async function scriptText(scriptId: string | null): Promise<string | null> {
  if (!scriptId) return null;
  const [row] = await getDb().select({ content: schema.scripts.content }).from(schema.scripts).where(eq(schema.scripts.id, scriptId)).limit(1);
  return row?.content ? scriptAsText(row.content) : null;
}

/**
 * Arma el plan con Claude y deja el proyecto en revisión. Idempotente: si ya hay plan, no vuelve a llamar a la IA.
 * Si la IA falla, el plan se arma igual sin ella (solo los cortes más seguros) y se avisa en la revisión.
 */
export async function generatePlan(projectId: string): Promise<{ status: string; plannedBy: string }> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.plan && project.status !== "PROCESSING") return { status: project.status, plannedBy: (project.plan as EditPlan).planned_by };
  const transcript = project.transcript as Transcript | null;
  if (!transcript?.words?.length) throw new VideoError("Todavía no hay transcripción para este video.");
  const media = (project.media ?? {}) as MediaInfo;
  const duration = media.duration || transcript.duration;
  const words = transcript.words;

  const script = await scriptText(project.scriptId);
  const candidates = detectCandidates(words, { script });
  const alignment = script ? alignScript(words, script) : null;
  const style = await stylePreset(project.styleId);
  const metrics = style?.metrics as StyleMetrics | undefined;
  const brand = await getBrand();
  const context = await brandContext(brand);

  let ai: PlanAiOutput | null = null;
  let aiError: string | null = null;
  try {
    ai = await generateStructured({
      feature: "video.plan",
      model: "main",
      context: `${EDITOR_RULES}\n\n${context}`,
      task: planTask({
        words,
        candidates,
        duration,
        format: project.format,
        script,
        scriptCoverage: alignment?.coverage ?? null,
        style: style
          ? { cutsPerMinute: metrics?.cuts?.perMinute ?? 0, hookSeconds: style.preset.hook.targetSeconds, longPause: style.preset.pacing.longPause, aggressiveness: style.preset.pacing.aggressiveness }
          : null,
      }),
      schema: planAiSchema,
      maxTokens: 6000,
    });
  } catch (error) {
    aiError = error instanceof AiError ? error.userMessage : "error inesperado";
    console.error("[editor] plan sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    // Si la IA no está configurada o falló por saturación, igual se arma un plan útil sin ella.
  }

  const requested = project.captionPreset as CaptionPresetKey;
  let plan = assemblePlan({
    ai,
    candidates,
    words,
    duration,
    format: project.format as VideoFormat,
    // "Del estilo" solo si el estilo trae subtítulos; si no, los de la marca.
    preset: requested === "estilo" && !style?.preset.captions ? "clasico" : requested,
    corrections: alignment?.corrections ?? {},
    offScript: alignment?.offScript ?? [],
    aiError,
    style: style
      ? { id: style.id, aggressiveness: style.preset.pacing.aggressiveness, hookTarget: style.preset.hook.targetSeconds, longPause: style.preset.pacing.longPause, zoom: style.preset.zoom.enabled }
      : null,
  });
  if (project.brollMode === "auto") {
    const timeline = buildTimeline(words, plan, duration);
    const { items, warning } = await planBroll({ words, plan, outputDuration: timeline.duration, format: project.format as VideoFormat, preset: style?.preset ?? null, context });
    plan = { ...plan, broll: items, warning: [plan.warning, warning].filter(Boolean).join(" ").slice(0, 1000) };
  }
  const parsed = planSchemaFor(words.length).safeParse(plan);
  if (!parsed.success) {
    console.error("[editor] plan inválido:", parsed.error.issues[0]?.message);
    throw new VideoError("No pudimos armar el plan de edición de este video. Vuelve a intentarlo.");
  }

  await getDb()
    .update(schema.videoProjects)
    .set({ plan, status: "AWAITING_REVIEW", errorMessage: null })
    .where(and(eq(schema.videoProjects.id, projectId), eq(schema.videoProjects.status, "PROCESSING")));
  return { status: "AWAITING_REVIEW", plannedBy: plan.planned_by };
}

// ─── Revisión y render ────────────────────────────────────────────────────

export type Review = {
  removed: number[];
  selectedHook: number | null;
  preset: CaptionPresetKey;
  offsetX: number;
  corrections: Record<string, string>;
  /** B-roll tal como quedó en la revisión (cambiado, movido o quitado). */
  broll?: BrollItem[];
  /** Zooms del estilo encendidos o apagados. */
  zooms?: boolean;
};

function applyReview(plan: EditPlan, review: Review, words: Transcript["words"], duration: number, format: VideoFormat): EditPlan {
  const valid = review.removed.filter((id) => Number.isInteger(id) && id >= 0 && id < words.length);
  const corrections: Record<string, string> = {};
  for (const [id, text] of Object.entries(review.corrections)) {
    const n = Number(id);
    const clean = text.trim().slice(0, 60);
    if (Number.isInteger(n) && n >= 0 && n < words.length && clean) corrections[String(n)] = clean;
  }
  const next: EditPlan = {
    ...plan,
    format,
    removals: rangesFromIds(valid, [...plan.removals, ...plan.proposed_removals]),
    selected_hook: review.selectedHook != null && plan.hook_candidates[review.selectedHook] ? review.selectedHook : null,
    captions: { ...plan.captions, preset: review.preset },
    framing: { mode: review.offsetX === 0 ? "center" : "manual", offset_x: Math.max(-1, Math.min(1, review.offsetX)) },
    corrections,
    ...(review.broll ? { broll: cleanBroll(review.broll, words.length) } : {}),
    ...(review.zooms != null && plan.style_id ? { zooms_enabled: review.zooms } : {}),
  };
  return withDerived(next, words, duration);
}

/** B-roll que manda el navegador: forma válida, ids dentro de la transcripción, sin superponerse. */
function cleanBroll(items: BrollItem[], wordCount: number): BrollItem[] {
  const out: BrollItem[] = [];
  for (const raw of [...items].sort((a, b) => a.from_word - b.from_word).slice(0, 20)) {
    const parsed = brollItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const b = parsed.data as BrollItem;
    if (b.from_word > b.to_word || b.to_word >= wordCount) continue;
    if (out.some((o) => b.from_word <= o.to_word && o.from_word <= b.to_word)) continue;
    out.push(b);
  }
  return out;
}

async function projectForEdit(projectId: string) {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (!project.plan || !project.transcript) throw new VideoError("Este video todavía no está listo para revisar.");
  return { project, plan: project.plan as EditPlan, transcript: project.transcript as Transcript, media: (project.media ?? {}) as MediaInfo };
}

export async function saveReview(projectId: string, review: Review, format: VideoFormat): Promise<void> {
  const { project, plan, transcript, media } = await projectForEdit(projectId);
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const next = applyReview(plan, review, transcript.words, media.duration || transcript.duration, format);
  const parsed = planSchemaFor(transcript.words.length).safeParse(next);
  if (!parsed.success) throw new VideoError("Los cambios no son válidos. Recarga la página y vuelve a intentarlo.");
  await getDb().update(schema.videoProjects).set({ plan: next, format, captionPreset: review.preset }).where(eq(schema.videoProjects.id, projectId));
}

const DEFAULT_CAPTION_ACCENT = "#FFD84D";

export async function startRender(projectId: string, review: Review, format: VideoFormat, userId: string): Promise<void> {
  const { project, plan, transcript, media } = await projectForEdit(projectId);
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const duration = media.duration || transcript.duration;
  const next = applyReview(plan, review, transcript.words, duration, format);
  const parsed = planSchemaFor(transcript.words.length).safeParse(next);
  if (!parsed.success) throw new VideoError("Los cambios no son válidos. Recarga la página y vuelve a intentarlo.");
  const timeline = buildTimeline(transcript.words, next, duration);
  if (timeline.clips.length === 0 || timeline.duration < 1) throw new VideoError("Cortaste todo el video. Restaura algunas palabras antes de renderizar.");

  const brand = await getBrand();
  const accent = [brand?.colors?.accent, brand?.colors?.primary].find((c) => c && /^#[0-9a-f]{6}$/i.test(c)) ?? DEFAULT_CAPTION_ACCENT;
  const stamp = Date.now().toString(36);
  const style = await stylePreset(next.style_id ?? project.styleId);
  const captionStyle = style?.preset.captions ?? null;
  const preset: CaptionPresetKey = next.captions.preset === "estilo" && !captionStyle ? "clasico" : next.captions.preset;
  const blocks = preset === "ninguno" ? [] : captionBlocks(timeline.words, preset, captionStyle);

  // B-roll: cada clip elegido se verifica contra su fuente (nunca se confía en lo que manda el navegador).
  const broll = await verifiedBroll(brollSegments(timeline, next.broll));
  const zooms = style && next.zooms_enabled !== false ? computeZooms(timeline, style.preset.zoom, { emphasis: next.captions.emphasis_words, avoid: broll }) : [];
  const credits = brollCredits(broll);
  const focusY = (style?.metrics as StyleMetrics | undefined)?.faces?.center?.y;

  await getDb().update(schema.videoProjects).set({ plan: next, format, captionPreset: preset, status: "RENDERING", errorMessage: null }).where(eq(schema.videoProjects.id, projectId));
  await enqueueJob({
    type: "VIDEO_RENDER",
    videoProjectId: projectId,
    createdBy: userId,
    stage: "En cola",
    input: {
      projectId,
      sourceKey: project.sourceKey,
      format,
      fps: FPS,
      clips: timeline.clips.map((c) => ({ start: c.startFrame, end: c.endFrame, role: c.role })),
      expectedDuration: timeline.duration,
      framing: { offsetX: next.framing.offset_x, focusY: focusY ? Math.max(0.25, Math.min(0.6, focusY)) : 0.42 },
      captions: {
        preset,
        accent,
        font: "Montserrat",
        ...(preset === "estilo" && captionStyle ? { style: captionStyle } : {}),
        blocks: blocks.map((b) => ({ start: b.start, end: b.end, words: b.words.map((w) => ({ text: w.text, start: w.start, end: w.end, emphasis: w.emphasis })) })),
      },
      zooms: zooms.map((z) => ({ start: z.start, end: z.end, scale: z.scale, ramp: z.ramp })),
      broll: broll.map((b) =>
        b.option.source === "pexels"
          ? { start: b.start, end: b.end, source: "pexels", url: b.option.file }
          : { start: b.start, end: b.end, source: "library", clipId: b.option.id, key: b.option.key },
      ),
      credits,
      creditsKey: credits ? `${keyPrefix(projectId)}render-${stamp}-creditos.txt` : null,
      srt: toSrt(timeline.words),
      audio: { targetLufs: next.audio.target_lufs, truePeak: -1 },
      outputKey: `${keyPrefix(projectId)}render-${stamp}.mp4`,
      srtKey: `${keyPrefix(projectId)}render-${stamp}.srt`,
      posterKey: `${keyPrefix(projectId)}render-${stamp}.jpg`,
      previousKeys: [
        project.outputKey,
        project.srtKey,
        (project.outputMeta as { posterKey?: string } | null)?.posterKey,
        (project.outputMeta as { creditsKey?: string } | null)?.creditsKey,
      ].filter(Boolean),
    },
  });
}

/**
 * Deja solo los b-roll que se pueden renderizar: un clip de la biblioteca que existe y está listo (con su clave
 * real, de la base) o un video de Pexels con su archivo en el CDN de Pexels.
 */
async function verifiedBroll(segments: ReturnType<typeof brollSegments>): Promise<ReturnType<typeof brollSegments>> {
  if (!segments.length) return [];
  const library = new Map<string, BrollOption>();
  const ids = segments.filter((s) => s.option.source === "library").map((s) => s.option.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length) {
    const rows = await getDb().select().from(schema.brollClips).where(and(inArray(schema.brollClips.id, ids), eq(schema.brollClips.status, "READY")));
    for (const r of rows) library.set(r.id, { source: "library", id: r.id, duration: r.duration ?? 0, width: r.width ?? 0, height: r.height ?? 0, key: r.fileKey, thumbKey: r.thumbKey, title: r.title });
  }
  const out: ReturnType<typeof brollSegments> = [];
  for (const seg of segments) {
    if (seg.option.source === "library") {
      const clip = library.get(seg.option.id);
      if (clip?.key) out.push({ ...seg, option: clip });
    } else if (seg.option.file && pexelsFileAllowed(seg.option.file)) {
      out.push(seg);
    }
  }
  return out;
}

/** Los archivos de Pexels vienen de su CDN; con un simulador (PEXELS_API_BASE), del mismo host. */
function pexelsFileAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "pexels.com" || host.endsWith(".pexels.com")) return true;
    return host === new URL(env().PEXELS_API_BASE).hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** Vuelve a la revisión desde un video terminado (el render anterior se conserva hasta el próximo). */
export async function reopenProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "DONE" && project.status !== "FAILED") throw new VideoError("Este video todavía se está procesando.");
  if (!project.plan) throw new VideoError("Este video todavía no tiene plan de edición.");
  await getDb().update(schema.videoProjects).set({ status: "AWAITING_REVIEW", errorMessage: null }).where(eq(schema.videoProjects.id, projectId));
}

/** Reintenta el último trabajo fallido del proyecto (un trabajo nuevo con la misma entrada). */
export async function retryProject(projectId: string, userId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "FAILED") return;
  const [job] = await getDb()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.videoProjectId, projectId), inArray(schema.jobs.type, ["VIDEO_ANALYZE", "VIDEO_RENDER"])))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  if (!job) {
    await getDb().update(schema.videoProjects).set({ status: "PROCESSING", errorMessage: null }).where(eq(schema.videoProjects.id, projectId));
    await enqueueAnalyze(project, userId);
    return;
  }
  const status = job.type === "VIDEO_RENDER" ? "RENDERING" : "PROCESSING";
  await getDb().update(schema.videoProjects).set({ status, errorMessage: null }).where(eq(schema.videoProjects.id, projectId));
  await enqueueJob({ type: job.type, videoProjectId: projectId, createdBy: userId, input: job.input as Record<string, unknown> });
}

export async function deleteProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) return;
  await cancelProjectJobs(projectId);
  await deletePrefix(keyPrefix(projectId)).catch((error) => console.error("[editor] no se borraron los archivos:", error instanceof Error ? error.message : error));
  await getDb().delete(schema.videoProjects).where(eq(schema.videoProjects.id, projectId));
}

/** Borra los archivos de renders anteriores que el worker dejó anotados como reemplazados. */
export async function cleanupReplaced(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  const meta = project?.outputMeta as { replaced?: string[] } | null;
  if (!project || !meta?.replaced?.length) return;
  const own = meta.replaced.filter((k) => k.startsWith(keyPrefix(projectId)) && k !== project.outputKey && k !== project.srtKey);
  await deleteKeys(own);
  await getDb()
    .update(schema.videoProjects)
    .set({ outputMeta: { ...meta, replaced: [] } })
    .where(eq(schema.videoProjects.id, projectId));
}

/** El tamaño máximo, para mostrarlo en la interfaz. */
export const MAX_UPLOAD_BYTES = MAX_VIDEO_BYTES;
