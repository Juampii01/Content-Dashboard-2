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
import { captionLook, captionTracks, isCaptionStyle } from "./caption-styles";
import { captionBlocks, dropWords, hideDuring, toSrt, USER_CAPTION_HIDE, userHiddenWords } from "./captions";
import { brollRenderEdit } from "./broll-edit";
import { brollCredits, brollSegments, computeZooms, directorZooms, graphicEntries, graphicHidesCaptions } from "./effects";
import { fxSegments } from "./fx/compile";
import { planDensity } from "./rhythm";
import { transitionSounds, TRANSITION_SOUND_GAIN } from "./fx/transitions";
import { isSfxName, type SfxName } from "./sfx-library";
import { ensureFxMasks, fxForRender } from "./fx-service";
import { layerKey, stackIndex } from "./layers";
import { brandGraphicLook, graphicSpecSchema, type GraphicLook } from "./graphics";
import { requestGraphic, type GraphicRequestResult } from "./motion-ai";
import { placeCaptionBlocks } from "./canvas/captions";
import { brollGraphicSchema, graphicSeconds, isMotionScene, withBrandTheme, graphicWithPlace } from "./motion-graphics";
import { sceneSchema } from "./motion/schema";
import { loadTrack } from "./music";
import { assemblePlan, planSchemaFor } from "./plan";
import { phraseFixesForRender } from "./phrase-fix-service";
import { alignScript } from "./script-align";
import { proofreadTranscript } from "./transcript-fix";
import { hookEnd, sfxCues, sfxLevel, soundCueTimes } from "./sfx";
import { studioLevel } from "./studio-audio";
import type { StyleMetrics } from "./style";
import { stylePreset } from "./styles";
import { readEditorDefaults } from "./defaults";
import { buildTimeline, outputRange } from "./timeline";
import { evenFrames, keyFrames, mergeFrames } from "./director/keyframes";
import { clampBudget, eyesMaxFrames } from "./director/cost";
import { briefIsEmpty, type Brief } from "./director/types";
import { FPS, type BrollOption, type CaptionPresetKey, type EditPlan, type MediaInfo, type Transcript, type VideoFormat } from "./types";

/**
 * Ciclo de vida de un proyecto del Editor de video:
 * UPLOADING → (subida directa al almacenamiento) → PROCESSING (worker: ingesta, transcripción; app: plan)
 * → AWAITING_REVIEW (la persona revisa) → RENDERING (worker) → DONE. Cualquier etapa puede terminar en FAILED.
 */
export class VideoError extends Error {}

export type Project = typeof schema.videoProjects.$inferSelect;

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
  /** "Hazlo por mí": se exporta solo apenas está el plan. */
  autoExport?: boolean;
  origin?: ProjectOrigin;
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
    autoExport: input.autoExport ?? false,
    origin: input.origin ?? "upload",
    sourceKey: key,
    sourceName: input.fileName.slice(0, 200),
    sourceBytes: input.fileSize,
    createdBy: input.userId,
  });
  return { id, key };
}

export type BrollMode = "auto" | "off";
export type ProjectOrigin = "upload" | "recorder" | "clone" | "clip";

export type DraftSettings = {
  title: string;
  format: VideoFormat;
  preset: CaptionPresetKey;
  scriptId: string | null;
  styleId?: string | null;
  brollMode?: BrollMode;
  autoExport?: boolean;
  /** Brief del director de edición (opcional; vacío = lo infiere la IA) y tope de IA del video. */
  brief?: Brief | null;
  budgetUsd?: number;
};

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
    ...(settings.autoExport != null ? { autoExport: settings.autoExport } : {}),
    ...(settings.brief !== undefined ? { brief: briefIsEmpty(settings.brief) ? null : (settings.brief as unknown as Record<string, unknown>) } : {}),
    ...(settings.budgetUsd != null ? { aiBudgetUsd: clampBudget(settings.budgetUsd) } : {}),
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
  await enqueueAnalyze((await loadProject(projectId)) ?? project, userId);
  const scriptId = settings ? settings.scriptId : project.scriptId;
  if (project.origin === "recorder" && scriptId) {
    // Grabado desde el teleprompter: el guion pasa a "Grabado" (si todavía no estaba grabado o publicado).
    await getDb()
      .update(schema.scripts)
      .set({ status: "RECORDED" })
      .where(and(eq(schema.scripts.id, scriptId), inArray(schema.scripts.status, ["IDEA", "DRAFT", "READY"])));
  }
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
    // Cuántos cuadros mira el director depende del tope de IA del video (menos cuadros = menos tokens).
    input: { projectId: project.id, sourceKey: project.sourceKey, language: await transcriptionLanguage(), eyesMaxFrames: eyesMaxFrames(clampBudget(project.aiBudgetUsd)) },
  });
}

/** Proyecto a partir de un video generado en "Videos con clon" (ya está en el almacenamiento). */
export async function createFromClone(
  cloneVideoId: string,
  format: VideoFormat,
  preset: CaptionPresetKey,
  userId: string,
  extra: { styleId?: string | null; brollMode?: BrollMode; autoExport?: boolean; brief?: Brief | null; budgetUsd?: number } = {},
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
    autoExport: extra.autoExport ?? false,
    origin: "clone",
    brief: extra.brief && !briefIsEmpty(extra.brief) ? (extra.brief as unknown as Record<string, unknown>) : null,
    aiBudgetUsd: clampBudget(extra.budgetUsd),
    sourceKey,
    sourceName: `${clone.title}.mp4`,
    createdBy: userId,
  });
  const project = (await loadProject(id))!;
  await enqueueAnalyze(project, userId);
  return id;
}

// ─── Plan (lo pide el worker al terminar de transcribir) ─────────────────

export async function scriptText(scriptId: string | null): Promise<string | null> {
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
  const plan = await legacyPlan(project);
  await getDb()
    .update(schema.videoProjects)
    .set({ plan, status: "AWAITING_REVIEW", errorMessage: null })
    .where(and(eq(schema.videoProjects.id, projectId), eq(schema.videoProjects.status, "PROCESSING")));
  return { status: "AWAITING_REVIEW", plannedBy: plan.planned_by };
}

/**
 * Plan sin el director (el de antes): Sonnet sobre la transcripción y el b-roll aparte. Lo usa la ruta vieja del worker
 * y el director como respaldo si su llamada falla. No guarda nada.
 */
export async function legacyPlan(project: Project): Promise<EditPlan> {
  const projectId = project.id;
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
    corrections: { ...(await proofreadTranscript({ words, brandCtx: context, script })), ...(alignment?.corrections ?? {}) },
    offScript: alignment?.offScript ?? [],
    aiError,
    style: style
      ? { id: style.id, aggressiveness: style.preset.pacing.aggressiveness, hookTarget: style.preset.hook.targetSeconds, longPause: style.preset.pacing.longPause, zoom: style.preset.zoom.enabled }
      : null,
  });
  plan = await withEditorDefaults(plan, brand);
  if (project.brollMode === "auto") {
    const timeline = buildTimeline(words, plan, duration);
    const { items, warning } = await planBroll({ words, plan, outputDuration: timeline.duration, format: project.format as VideoFormat, preset: style?.preset ?? null, context, look: brandGraphicLook(brand), bannedWords: brand?.bannedWords ?? [] });
    plan = { ...plan, broll: items, warning: [plan.warning, warning].filter(Boolean).join(" ").slice(0, 1000) };
  }
  const parsed = planSchemaFor(words.length).safeParse(plan);
  if (!parsed.success) {
    console.error("[editor] plan inválido:", projectId, parsed.error.issues[0]?.message);
    throw new VideoError("No pudimos armar el plan de edición de este video. Vuelve a intentarlo.");
  }
  return plan;
}

/**
 * Sonido, música y emojis de un plan nuevo según los valores por defecto del editor (Mi marca). La música solo si la
 * pista existe y está lista; los emojis solo en los estilos de la galería.
 */
export async function withEditorDefaults(plan: EditPlan, brand: Awaited<ReturnType<typeof getBrand>>): Promise<EditPlan> {
  const d = readEditorDefaults(brand);
  const track = d.music.trackId ? await loadTrack(d.music.trackId) : null;
  const music = track?.status === "READY" ? { music_asset_id: track.id, music_db: d.music.db } : {};
  return {
    ...plan,
    captions: { ...plan.captions, ...(isCaptionStyle(plan.captions.preset) && d.emoji ? { emoji: true } : {}) },
    audio: { ...plan.audio, sfx: d.sfx, studio: d.studio, ...music },
  };
}

// ─── Revisión y render ────────────────────────────────────────────────────

import { applyReview, previewMismatch, type Review } from "./review";
export { applyReview, previewMismatch, type Review };

async function projectForEdit(projectId: string) {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (!project.plan || !project.transcript) throw new VideoError("Este video todavía no está listo para revisar.");
  return { project, plan: project.plan as EditPlan, transcript: project.transcript as Transcript, media: (project.media ?? {}) as MediaInfo };
}

export async function saveReview(projectId: string, review0: Review, format: VideoFormat): Promise<void> {
  const { project, plan, transcript, media } = await projectForEdit(projectId);
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const review = await withTrustedCompositions(project, review0, plan, transcript, media, format);
  const next = applyReview(plan, review, transcript.words, media.duration || transcript.duration, format);
  const parsed = planSchemaFor(transcript.words.length).safeParse(next);
  if (!parsed.success) throw new VideoError("Los cambios no son válidos. Recarga la página y vuelve a intentarlo.");
  await getDb().update(schema.videoProjects).set({ plan: next, format, captionPreset: review.preset }).where(eq(schema.videoProjects.id, projectId));
  // Efectos con recorte: el worker prepara la máscara de esos segundos para la vista previa (si falta).
  if (next.effects?.length || next.compositions?.length) {
    const timeline = buildTimeline(transcript.words, next, media.duration || transcript.duration);
    await ensureFxMasks({ projectId, plan: next, timeline, media, userId: null }).catch((error) => console.error("[efectos] no se pudo pedir el recorte:", error instanceof Error ? error.message : error));
  }
}

/**
 * Las animaciones (composiciones) que manda el navegador: el código que no estaba en el plan guardado se valida en el
 * sandbox con sus datos reales antes de guardarse (lib/video/compos/service.ts); lo que no pasa se descarta.
 */
async function withTrustedCompositions(project: Project, review: Review, plan: EditPlan, transcript: Transcript, media: MediaInfo, format: VideoFormat): Promise<Review> {
  if (!review.compositions) return review;
  const { trustedCompositions } = await import("./compos/service");
  // El plan con lo que cambió la revisión (cortes, gancho, formato): los tramos de las animaciones se miden sobre eso.
  const draft = applyReview(plan, { ...review, compositions: undefined }, transcript.words, media.duration || transcript.duration, format);
  return { ...review, compositions: await trustedCompositions(project, review.compositions, draft) };
}

const DEFAULT_CAPTION_ACCENT = "#FFD84D";
/** El worker dibuja hasta 24 emojis por video (worker/video/pipeline.py); los pop siguen a esos. */
const MAX_EMOJIS = 24;

/** `manual`: lo exporta la persona desde la revisión (deja de ser "Hazlo por mí"). */
export async function startRender(projectId: string, review0: Review, format: VideoFormat, userId: string | null, opts: { manual?: boolean } = {}): Promise<void> {
  const { project, plan, transcript, media } = await projectForEdit(projectId);
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const review = await withTrustedCompositions(project, review0, plan, transcript, media, format);
  const duration = media.duration || transcript.duration;
  const next = applyReview(plan, review, transcript.words, duration, format);
  const parsed = planSchemaFor(transcript.words.length).safeParse(next);
  if (!parsed.success) throw new VideoError("Los cambios no son válidos. Recarga la página y vuelve a intentarlo.");
  const { input, timeline, preset } = await renderInputFor(project, next, format, transcript, duration);
  if (timeline.clips.length === 0 || timeline.duration < 1) throw new VideoError("Cortaste todo el video. Restaura algunas palabras antes de renderizar.");
  // Lo que sale en el MP4 tiene que ser lo que se vio: si el plan guardado cambió por detrás (otra pestaña, una
  // versión del director) y el servidor arma otro orden de tramos u otro gancho, no se exporta.
  const mismatch = previewMismatch(review.preview, next, timeline);
  if (mismatch) {
    console.error(`[editor] render ${projectId}: la vista previa no coincide con el plan guardado (${mismatch})`);
    throw new VideoError("La revisión cambió mientras la tenías abierta, así que el video final no iba a ser igual a la vista previa. Recarga la página, revisa y vuelve a exportar.");
  }
  // Revisión final del director: cuadros del MP4 en los momentos clave del plan (lib/video/director).
  const finalFrames = mergeFrames(keyFrames({ plan: next, words: transcript.words, timeline, eyes: null, max: 24 }), evenFrames(timeline.duration, 12), 30);
  // Mis efectos: las animaciones que quedaron en el video se guardan solas (sin duplicados) y el worker saca su muestra
  // de este mismo render. Si falla, el render sigue igual.
  const { saveFromRender } = await import("./compos/library-service");
  const lib = await saveFromRender({ id: project.id, title: project.title, director: project.director }, next, timeline).catch((error) => {
    console.error("[mis-efectos] no se pudieron guardar las animaciones:", error instanceof Error ? error.message : error);
    return { plan: next, samples: [] as { effectId: string; compId: string }[] };
  });

  await getDb()
    .update(schema.videoProjects)
    .set({ plan: lib.plan, format, captionPreset: preset, status: "RENDERING", errorMessage: null, ...(opts.manual ? { autoExport: false } : {}) })
    .where(eq(schema.videoProjects.id, projectId));
  await enqueueJob({
    type: "VIDEO_RENDER",
    videoProjectId: projectId,
    createdBy: userId,
    stage: "En cola",
    input: { ...input, finalFrames, ...(lib.samples.length ? { effectSamples: lib.samples } : {}) },
  });
}

/**
 * Entrada del render (la misma para el MP4 final y para la vista previa de la segunda mirada del director): tramos,
 * subtítulos, zooms, b-roll verificado, sonido y claves de salida. No toca la base.
 */
export async function renderInputFor(project: Project, next: EditPlan, format: VideoFormat, transcript: Transcript, duration: number) {
  const projectId = project.id;
  const timeline = buildTimeline(transcript.words, next, duration);
  const brand = await getBrand();
  const accent = [brand?.colors?.accent, brand?.colors?.primary].find((c) => c && /^#[0-9a-f]{6}$/i.test(c)) ?? DEFAULT_CAPTION_ACCENT;
  const stamp = Date.now().toString(36);
  const style = await stylePreset(next.style_id ?? project.styleId);
  const captionStyle = style?.preset.captions ?? null;
  const preset: CaptionPresetKey = next.captions.preset === "estilo" && !captionStyle ? "clasico" : next.captions.preset;
  // B-roll: cada clip elegido se verifica contra su fuente (nunca se confía en lo que manda el navegador).
  const look = brandGraphicLook(brand);
  // En el tramo de una animación (composición) manda la animación: el b-roll que se pisa con ella no va.
  const broll = await verifiedBroll(brollSegments(timeline, next.broll), look);
  // Durante un gráfico no hay subtítulos: el gráfico ya muestra la idea. Tampoco donde el director los ocultó (texto quemado).
  const graphicSpans = broll.filter((b) => b.option.source === "graphic" && graphicHidesCaptions(b.option.graphic));
  // Lo que quitó la persona sale palabra por palabra (el bloque sigue); lo que ocultó el director, por tramos de tiempo.
  const userHidden = userHiddenWords(next.captions.hide);
  const hiddenSpans = (next.captions.hide ?? []).filter((h) => h.why !== USER_CAPTION_HIDE).map((h) => outputRange(timeline, h.from_word, h.to_word)).filter((r): r is { start: number; end: number } => Boolean(r));
  // Efectos de la biblioteca: lo que dibuja el worker (el mismo spec que la vista previa); algunos llevan sus propios
  // subtítulos y ninguno lleva zooms del estilo encima (traen su propia cámara).
  const fx = await fxForRender({ plan: next, timeline, format, look, media: (project.media ?? {}) as MediaInfo, eyes: project.eyes, offsetX: next.framing.offset_x, corrections: next.corrections, broll, projectId, captionsVisible: preset !== "ninguno" });
  const blocks = preset === "ninguno" ? [] : hideDuring(dropWords(captionBlocks(timeline.words, preset, captionStyle), userHidden), [...graphicSpans, ...hiddenSpans, ...fx.hides]);
  const noZoom = [...broll, ...fx.avoid];
  const zooms =
    style && style.preset.zoom.enabled && next.zooms_enabled !== false
      ? computeZooms(timeline, style.preset.zoom, { emphasis: next.captions.emphasis_words, avoid: noZoom })
      : directorZooms(timeline, next.zoom_moments, noZoom);
  const stockCredits = brollCredits(broll);
  const capLook = isCaptionStyle(preset) ? captionLook(preset, { format, accent, brandFont: look.font, emoji: next.captions.emoji === true }) : null;
  const focusY = (style?.metrics as StyleMetrics | undefined)?.faces?.center?.y;
  const faceY = focusY ? Math.max(0.25, Math.min(0.6, focusY)) : 0.42;
  // Ubicación, encuadre, look y tiempo de cada b-roll, en píxeles de salida (los mismos números que la vista previa).
  const brollEdit = (b: (typeof broll)[number]) => {
    const g = b.option.source === "graphic" && isMotionScene(b.option.graphic) ? b.option.graphic : null;
    return brollRenderEdit({
      edit: b.edit,
      format,
      duration: b.end - b.start,
      clipWidth: b.option.width,
      clipHeight: b.option.height,
      focusY: faceY,
      accent: look.theme.accent,
      ground: look.theme.bg,
      graphic: b.option.source === "graphic" ? { mode: g?.mode ?? (b.option.graphic as { mode?: string } | null)?.mode, position: g?.position } : null,
    });
  };
  // Lugar de los subtítulos del lienzo (solo galería): cada bloque lleva el suyo, como en la vista previa.
  const captionPayload = capLook ? placeCaptionBlocks(blocks, next.captions).map((b) => captionTracks(capLook, b, format, accent)) : null;
  // Efectos de sonido: whoosh al entrar cada b-roll o gráfico, riser hasta el fin del gancho y pop en los emojis.
  const emojiTimes = (captionPayload ?? []).flatMap((b) => b.words.flatMap((w) => (w.emoji ? [w.emoji.alpha[0]?.t ?? b.start] : []))).slice(0, MAX_EMOJIS);
  // Con la voz: un toque en cada ítem que entra en un gráfico, al empezar cada efecto y en cada punch-in.
  const sfx = sfxCues({
    level: sfxLevel(next.audio.sfx),
    duration: timeline.duration,
    broll,
    hookEnd: hookEnd(timeline),
    emojiTimes,
    entries: [...graphicEntries(broll), ...fxSegments(timeline, next.effects ?? []).map((f) => f.start)],
    punches: zooms.filter((z) => z.kind === "punch").map((z) => z.start),
    dense: planDensity(next) === "reels",
    // Los que puso la persona en la pista de Sonido y el de cada transición (en su corte).
    manual: [
      ...soundCueTimes(timeline, next.audio.cues ?? []).map(({ cue, hitAt }) => ({ name: cue.name, hitAt, gain: cue.gain })),
      ...transitionSounds(fx.transitions).filter((s) => isSfxName(s.name)).map((s) => ({ name: s.name as SfxName, hitAt: s.hitAt, gain: TRANSITION_SOUND_GAIN })),
      // Los sonidos de las animaciones (en sus momentos).
      ...fx.sounds.filter((s) => isSfxName(s.name)).map((s) => ({ name: s.name as SfxName, hitAt: s.hitAt, gain: s.gain })),
    ],
  });
  // Música: una pista generada (la arma el worker con el mismo generador que la vista previa) o una pista lista de la
  // biblioteca (la clave sale de la base, no del navegador).
  const track = !next.audio.music_gen && next.audio.music_asset_id ? await loadTrack(next.audio.music_asset_id) : null;
  const music = next.audio.music_gen
    ? { gen: next.audio.music_gen, db: next.audio.music_db }
    : track?.status === "READY"
      ? { trackId: track.id, key: track.fileKey, db: next.audio.music_db, ...(track.attribution ? { attribution: track.attribution } : {}) }
      : null;
  // Créditos: los del b-roll de stock y la atribución que pide la licencia de la música (catálogo CC BY).
  const credits = [stockCredits, track?.status === "READY" && !next.audio.music_gen && track.attribution ? `Música\n\n${track.attribution}` : ""].filter(Boolean).join("\n\n");
  // Frases corregidas con la voz clonada (lib/video/phrase-fix-service.ts): el worker las aplica sobre el original.
  const phraseFixes = await phraseFixesForRender(projectId);

  // Orden de dibujo de todo lo que se superpone (b-roll, gráficos, efectos y transiciones), el mismo que la vista previa.
  const z = stackIndex([
    ...broll.map((b) => ({ key: layerKey("broll", b.id), kind: "broll" as const, layer: b.layer, start: b.start })),
    ...fx.items.map((f) => ({ key: layerKey(f.layerKind ?? "fx", f.spec.id), kind: f.layerKind ?? ("fx" as const), layer: f.layer, start: f.spec.start })),
  ]);
  const input = {
    projectId,
    sourceKey: project.sourceKey,
    format,
    fps: FPS,
    clips: timeline.clips.map((c) => ({ start: c.startFrame, end: c.endFrame, role: c.role })),
    expectedDuration: timeline.duration,
    framing: { offsetX: next.framing.offset_x, focusY: faceY },
    captions: capLook
      ? // Galería: la app arma renglones y pistas (lib/video/caption-styles.ts); el worker solo mide y dibuja.
        { preset, accent, look: capLook, blocks: captionPayload }
      : {
          preset,
          accent,
          font: "Montserrat",
          ...(preset === "estilo" && captionStyle ? { style: captionStyle } : {}),
          blocks: blocks.map((b) => ({ start: b.start, end: b.end, words: b.words.map((w) => ({ text: w.text, start: w.start, end: w.end, emphasis: w.emphasis })) })),
        },
    zooms: zooms.map((z) => ({ start: z.start, end: z.end, scale: z.scale, ramp: z.ramp })),
    broll: broll.map((b) =>
      b.option.source === "graphic"
        ? { start: b.start, end: b.end, source: "graphic", spec: b.option.graphic, edit: brollEdit(b), z: z.get(layerKey("broll", b.id)) ?? 0 }
        : b.option.source !== "library"
          ? { start: b.start, end: b.end, source: b.option.source, url: b.option.file, edit: brollEdit(b), z: z.get(layerKey("broll", b.id)) ?? 0 }
          : { start: b.start, end: b.end, source: "library", clipId: b.option.id, key: b.option.key, edit: brollEdit(b), z: z.get(layerKey("broll", b.id)) ?? 0 },
    ),
    effects: fx.items.map(({ layerKind, ...f }) => ({ spec: f.spec, sourceFrames: f.sourceFrames, ...(f.images ? { images: f.images } : {}), ...(f.imageKeys ? { imageKeys: f.imageKeys, projectId: f.projectId } : {}), z: z.get(layerKey(layerKind ?? "fx", f.spec.id)) ?? 0 })),
    credits,
    creditsKey: credits ? `${keyPrefix(projectId)}render-${stamp}-creditos.txt` : null,
    srt: toSrt(timeline.words),
    audio: { targetLufs: next.audio.target_lufs, truePeak: -1, sfx, music, studio: studioLevel(next.audio.studio) },
    phraseFixes,
    outputKey: `${keyPrefix(projectId)}render-${stamp}.mp4`,
    srtKey: `${keyPrefix(projectId)}render-${stamp}.srt`,
    posterKey: `${keyPrefix(projectId)}render-${stamp}.jpg`,
    previousKeys: [
      project.outputKey,
      project.srtKey,
      (project.outputMeta as { posterKey?: string } | null)?.posterKey,
      (project.outputMeta as { creditsKey?: string } | null)?.creditsKey,
    ].filter(Boolean),
  };
  return { input, timeline, preset };
}

/**
 * Deja solo los b-roll que se pueden renderizar: un clip de la biblioteca que existe y está listo (con su clave
 * real, de la base), un video de stock con su archivo en el CDN de su banco (Pixabay o Pexels) o un gráfico
 * con un diseño válido (se vuelve a validar aquí; lo dibuja el worker).
 */
async function verifiedBroll(segments: ReturnType<typeof brollSegments>, look: GraphicLook): Promise<ReturnType<typeof brollSegments>> {
  if (!segments.length) return [];
  const library = new Map<string, BrollOption>();
  const ids = segments.filter((s) => s.option.source === "library").map((s) => s.option.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length) {
    const rows = await getDb().select().from(schema.brollClips).where(and(inArray(schema.brollClips.id, ids), eq(schema.brollClips.status, "READY")));
    for (const r of rows) library.set(r.id, { source: "library", id: r.id, duration: r.duration ?? 0, width: r.width ?? 0, height: r.height ?? 0, key: r.fileKey, thumbKey: r.thumbKey, title: r.title });
  }
  const out: ReturnType<typeof brollSegments> = [];
  for (const seg of segments) {
    if (seg.option.source === "graphic") {
      // Escena v2: siempre con los colores y la fuente actuales de Mi marca. Spec v1 (planes viejos): tal cual.
      if (isMotionScene(seg.option.graphic)) {
        const scene = sceneSchema.safeParse(seg.option.graphic);
        if (scene.success) out.push({ ...seg, option: { ...seg.option, graphic: graphicWithPlace(withBrandTheme(scene.data, look), seg.edit) } });
        continue;
      }
      const spec = graphicSpecSchema.safeParse(seg.option.graphic);
      // El lugar del lienzo (si lo movieron) se vuelve a armar desde la edición del tramo: no se confía en el navegador.
      if (spec.success) out.push({ ...seg, option: { ...seg.option, graphic: graphicWithPlace(spec.data, seg.edit) } });
    } else if (seg.option.source === "library") {
      const clip = library.get(seg.option.id);
      if (clip?.key) out.push({ ...seg, option: clip });
    } else if (seg.option.file && stockFileAllowed(seg.option.source, seg.option.file)) {
      out.push(seg);
    }
  }
  return out;
}

/** Los archivos de stock vienen del CDN de su banco; con un simulador (*_API_BASE), del mismo host. */
function stockFileAllowed(source: BrollOption["source"], url: string): boolean {
  const base = source === "pixabay" ? { domain: "pixabay.com", api: env().PIXABAY_API_BASE } : source === "pexels" ? { domain: "pexels.com", api: env().PEXELS_API_BASE } : null;
  if (!base) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === base.domain || host.endsWith(`.${base.domain}`)) return true;
    return host === new URL(base.api).hostname.toLowerCase();
  } catch {
    return false;
  }
}

// ─── "Pide tu gráfico" (revisión) ─────────────────────────────────────────

/**
 * Gráfico pedido en lenguaje natural para un tramo del proyecto (o un ajuste del actual). Lo que se dice en el tramo
 * sale de la transcripción guardada (no del navegador); colores, fuente, idioma y palabras prohibidas, de Mi marca.
 */
export async function requestProjectGraphic(input: {
  projectId: string;
  fromWord: number;
  toWord: number;
  request: string;
  kind: "pedido" | "ajuste";
  current: unknown;
  format: VideoFormat;
}): Promise<GraphicRequestResult> {
  const { project, plan, transcript } = await projectForEdit(input.projectId);
  if (project.status !== "AWAITING_REVIEW") throw new VideoError("Este video no está en revisión.");
  const words = transcript.words;
  const from = Math.max(0, Math.min(input.fromWord, input.toWord));
  const to = Math.min(words.length - 1, Math.max(input.fromWord, input.toWord));
  if (from >= words.length || to < from) throw new VideoError("Ese tramo ya no existe. Recarga la página.");
  const text = (a: number, b: number) =>
    words
      .slice(a, b + 1)
      .map((w) => plan.corrections[String(w.id)] ?? w.text)
      .join(" ");
  // La frase completa alrededor: da contexto (y sus cifras, si el tramo corta una frase a la mitad).
  const around = (() => {
    let a = from;
    let b = to;
    while (a > 0 && from - a < 25 && !/[.!?…]$/.test(words[a - 1]!.text)) a--;
    while (b < words.length - 1 && b - to < 25 && !/[.!?…]$/.test(words[b]!.text)) b++;
    return text(a, b);
  })();
  const current = input.current == null ? null : brollGraphicSchema.safeParse(input.current);
  if (input.kind === "ajuste" && !current?.success) throw new VideoError("No encontramos el gráfico que quieres ajustar. Pide uno nuevo.");
  const brand = await getBrand();
  const look = brandGraphicLook(brand);
  const result = await requestGraphic({
    kind: input.kind,
    request: input.request,
    spoken: text(from, to),
    around,
    current: current?.success ? current.data : null,
    look,
    format: input.format,
    duration: graphicSeconds(words[to]!.end - words[from]!.start),
    bannedWords: brand?.bannedWords ?? [],
    brandContext: await brandContext(brand),
  });
  return result.ok ? { ...result, scene: withBrandTheme(result.scene, look) } : result;
}

/** Vuelve a la revisión desde un video terminado (el render anterior se conserva hasta el próximo). */
export async function reopenProject(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status !== "DONE" && project.status !== "FAILED") throw new VideoError("Este video todavía se está procesando.");
  if (!project.plan) throw new VideoError("Este video todavía no tiene plan de edición.");
  // Al volver a la revisión, lo que siga lo decide la persona: deja de exportarse solo.
  await getDb().update(schema.videoProjects).set({ status: "AWAITING_REVIEW", errorMessage: null, autoExport: false }).where(eq(schema.videoProjects.id, projectId));
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
