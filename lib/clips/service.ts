import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { brandContext, getBrand, type Brand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { CLIPS_RULES, clipsAiSchema, clipsTask, type ClipsAiOutput } from "@/lib/ai/prompts/clips";
import { HOOK_CATEGORIES, type HookCategory } from "@/lib/ai/prompts/metricas";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { hookRankingUnchecked } from "@/lib/metrics/hooks";
import { deletePrefix, fileDriver, fileInfo, MAX_VIDEO_BYTES, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";
import { startRender, VideoError } from "@/lib/video/service";
import { parseReferenceLink } from "@/lib/video/styles";
import { CAPTION_PRESET_KEYS, type CaptionPresetKey, type EditPlan, type Transcript } from "@/lib/video/types";
import {
  clipBounds,
  generateCandidates,
  previewWindow,
  scoreRange,
  targetClipCount,
  validRange,
  videoStats,
  type ClipCandidate,
  type HookRankingEntry,
  type ScoreDetail,
} from "./score";

/**
 * "Clips desde un video largo" (dentro del Editor de video).
 *
 * UPLOADING (subida directa) → PROCESSING (worker LONG_VIDEO_CLIPS: baja, transcribe, pide los momentos a la app,
 * sigue las caras de cada momento y arma su vista previa) → READY. Cualquier etapa puede terminar en FAILED.
 *
 * Cada clip se abre como un proyecto nuevo del Editor (ya cortado y reencuadrado a 9:16 por el worker, con la
 * transcripción del tramo) o se exporta directo con los subtítulos por defecto de Mi marca.
 */
export class ClipsError extends Error {}

export const MIN_LONG_SECONDS = 3 * 60;
export const MAX_LONG_SECONDS = 150 * 60;

type LongVideo = typeof schema.longVideos.$inferSelect;
type Clip = typeof schema.longVideoClips.$inferSelect;

const prefix = (id: string) => `editor/largos/${id}/`;
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function loadLongVideo(id: string): Promise<LongVideo | null> {
  if (!isId(id)) return null;
  const [row] = await getDb().select().from(schema.longVideos).where(eq(schema.longVideos.id, id)).limit(1);
  return row ?? null;
}

export async function loadClipRow(id: string): Promise<Clip | null> {
  if (!isId(id)) return null;
  const [row] = await getDb().select().from(schema.longVideoClips).where(eq(schema.longVideoClips.id, id)).limit(1);
  return row ?? null;
}

async function language(): Promise<string> {
  const brand = await getBrand();
  return brand?.language?.startsWith("en") ? "en" : "es";
}

function extensionFor(name: string, type: string): string | null {
  const byType = VIDEO_TYPES[type.toLowerCase()];
  if (byType) return byType;
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return ext && VIDEO_EXTENSIONS.includes(ext) ? ext.slice(1) : null;
}

// ─── Crear ────────────────────────────────────────────────────────────────

export async function createLongVideoUpload(input: { title: string; fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new ClipsError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = extensionFor(input.fileName, input.fileType);
  if (!ext) throw new ClipsError("Ese formato no es compatible. Sube un video MP4, MOV, WEBM o MKV.");
  if (input.fileSize <= 0) throw new ClipsError("El archivo está vacío.");
  if (input.fileSize > MAX_VIDEO_BYTES) throw new ClipsError("El video pesa más de 8 GB. Expórtalo en una calidad menor y vuelve a intentarlo.");
  const id = randomUUID();
  const key = `${prefix(id)}original.${ext}`;
  await getDb().insert(schema.longVideos).values({
    id,
    title: input.title,
    status: "UPLOADING",
    sourceKind: "upload",
    sourceKey: key,
    sourceName: input.fileName.slice(0, 200),
    sourceBytes: input.fileSize,
    createdBy: input.userId,
  });
  return { id, key };
}

export async function completeLongVideoUpload(id: string, userId: string): Promise<void> {
  const row = await loadLongVideo(id);
  if (!row) throw new ClipsError("No encontramos ese video.");
  if (row.status !== "UPLOADING") return;
  const info = row.sourceKey ? await fileInfo(row.sourceKey) : null;
  if (!info || info.size === 0) throw new ClipsError("La subida no terminó. Vuelve a elegir el archivo.");
  if (row.sourceBytes && info.size !== row.sourceBytes) throw new ClipsError("El archivo llegó incompleto. Vuelve a subirlo.");
  await getDb()
    .update(schema.longVideos)
    .set({ status: "PROCESSING", sourceBytes: info.size, errorMessage: null })
    .where(and(eq(schema.longVideos.id, id), eq(schema.longVideos.status, "UPLOADING")));
  await enqueueLongVideo({ ...row, sourceBytes: info.size }, userId);
}

export async function createLongVideoFromLink(input: { title: string; link: string; userId: string }): Promise<string> {
  const parsed = parseReferenceLink(input.link);
  if (!parsed) throw new ClipsError("Pega un link de YouTube (o de Instagram o TikTok) que empiece con https://.");
  const id = randomUUID();
  const row = {
    id,
    title: input.title,
    status: "PROCESSING" as const,
    sourceKind: "link",
    sourceUrl: parsed.url,
    // El worker deja el video bajado en el almacenamiento con esta clave (así los clips lo vuelven a usar).
    sourceKey: `${prefix(id)}original.mp4`,
    createdBy: input.userId,
  };
  await getDb().insert(schema.longVideos).values(row);
  await enqueueLongVideo((await loadLongVideo(id))!, input.userId);
  return id;
}

async function enqueueLongVideo(row: LongVideo, userId: string | null): Promise<void> {
  await enqueueJob({
    type: "LONG_VIDEO_CLIPS",
    createdBy: userId,
    stage: "En cola",
    maxAttempts: 3,
    input: { longVideoId: row.id, sourceKind: row.sourceKind, sourceKey: row.sourceKey, url: row.sourceUrl, language: await language() },
  });
}

export async function retryLongVideo(id: string, userId: string): Promise<void> {
  const row = await loadLongVideo(id);
  if (!row) throw new ClipsError("No encontramos ese video.");
  if (row.status !== "FAILED") return;
  await getDb().update(schema.longVideos).set({ status: "PROCESSING", errorMessage: null }).where(eq(schema.longVideos.id, id));
  await enqueueLongVideo(row, userId);
}

export async function renameLongVideo(id: string, title: string): Promise<void> {
  await getDb().update(schema.longVideos).set({ title }).where(eq(schema.longVideos.id, id));
}

/** Borra el video largo, sus clips y sus archivos. Los proyectos del Editor creados desde sus clips se conservan. */
export async function deleteLongVideo(id: string): Promise<void> {
  const row = await loadLongVideo(id);
  if (!row) return;
  await getDb().execute(sql`
    update jobs set status = 'CANCELED', finished_at = now(), locked_until = null
    where type = 'LONG_VIDEO_CLIPS' and input->>'longVideoId' = ${id} and status in ('QUEUED', 'RUNNING')
  `);
  await deletePrefix(prefix(id)).catch((error) => console.error("[clips] no se borraron los archivos:", error instanceof Error ? error.message : error));
  await getDb().delete(schema.longVideos).where(eq(schema.longVideos.id, id));
}

// ─── Momentos (lo pide el worker al terminar de transcribir) ──────────────

export type MomentWindow = { id: string; start: number; end: number; windowStart: number; windowEnd: number };

async function ranking(): Promise<HookRankingEntry[]> {
  const result = await hookRankingUnchecked().catch(() => null);
  return result?.stats.map((s) => ({ type: s.type, medianScore: s.medianScore, count: s.count })) ?? [];
}

type Pick = { from: number; to: number; title: string; hookText: string; reason: string; hookType: HookCategory | null; ai: number | null };

/** Elección sin IA (si Claude falla o no está configurado): los mejores candidatos por reglas, explicados con sus medidas. */
function rulePicks(candidates: ClipCandidate[], count: number): Pick[] {
  return [...candidates]
    .sort((a, b) => b.rule - a.rule)
    .slice(0, count)
    .map((c) => {
      const f = c.features;
      const why = [
        f.hookType === "pregunta" ? "abre con una pregunta" : f.startsWithConnector ? null : "arranca con una frase que se entiende sola",
        f.numbers > 0 ? `menciona ${f.numbers === 1 ? "una cifra" : `${f.numbers} cifras`}` : null,
        c.parts.density >= 0.6 ? "habla con buen ritmo" : null,
        c.parts.pauses >= 0.8 ? "casi no tiene pausas" : null,
        f.endsClean ? "cierra la frase" : null,
      ].filter(Boolean);
      const text = f.hookText.replace(/\s+/g, " ").trim();
      const cut = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, t.lastIndexOf(" ", max - 1))}…`);
      return {
        from: c.from,
        to: c.to,
        title: cut(text.replace(/[¿?¡!.,;:]/g, ""), 58),
        hookText: cut(text, 68),
        reason: why.length ? `${why.join(", ").replace(/^./, (m) => m.toUpperCase())}.` : "Es de los tramos con mejores medidas del video.",
        hookType: f.hookType,
        ai: null,
      };
    });
}

/** Lo que propuso Claude, validado contra los candidatos (ids existentes, bordes cerca del candidato, largo razonable). */
function aiPicks(ai: ClipsAiOutput, candidates: ClipCandidate[], wordCount: number): Pick[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: Pick[] = [];
  for (const p of ai.clips.slice(0, 10)) {
    const c = byId.get(p.candidate.trim().toUpperCase());
    if (!c) continue;
    let from = p.from_word;
    let to = p.to_word;
    const near = Number.isInteger(from) && Number.isInteger(to) && from >= Math.max(0, c.from - 40) && to <= Math.min(wordCount - 1, c.to + 40) && from < to;
    if (!near) {
      from = c.from;
      to = c.to;
    }
    if (out.some((o) => from <= o.to && o.from <= to)) continue;
    out.push({
      from,
      to,
      title: p.title.trim().slice(0, 80) || c.features.hookText.slice(0, 60),
      hookText: p.hook_text.trim().slice(0, 100) || c.features.hookText.slice(0, 70),
      reason: p.reason.trim().slice(0, 400),
      hookType: (HOOK_CATEGORIES as readonly string[]).includes(p.hook_type) ? p.hook_type : null,
      ai: Math.max(0, Math.min(100, Math.round(p.ai_score))),
    });
  }
  return out;
}

/**
 * Elige los momentos del video: candidatos por reglas, Claude elige y explica, y el puntaje final combina las dos
 * cosas con el ranking de ganchos. Idempotente: si ya hay clips, los devuelve sin volver a llamar a la IA.
 */
export async function findMoments(id: string): Promise<{ clips: MomentWindow[]; plannedBy: "ai" | "rules" }> {
  const row = await loadLongVideo(id);
  if (!row) throw new ClipsError("Ese video ya no existe.");
  const existing = await getDb().select().from(schema.longVideoClips).where(eq(schema.longVideoClips.longVideoId, id)).orderBy(asc(schema.longVideoClips.rank));
  if (existing.length) {
    return { clips: existing.map((c) => ({ id: c.id, start: c.start, end: c.end, windowStart: c.windowStart, windowEnd: c.windowEnd })), plannedBy: ((row.analysis as { plannedBy?: "ai" | "rules" } | null)?.plannedBy ?? "rules") };
  }
  const transcript = row.transcript as Transcript | null;
  const words = transcript?.words ?? [];
  if (words.length < 40) throw new ClipsError("Casi no encontramos voz en el video. Para sacar clips tiene que haber alguien hablando.");
  const duration = Number((row.media as { duration?: number } | null)?.duration ?? transcript!.duration);
  const candidates = generateCandidates(words, { limit: 24 });
  if (!candidates.length) throw new ClipsError("No encontramos tramos de 30 a 90 segundos con frases completas. Prueba con un video donde se hable de corrido.");
  const count = Math.min(targetClipCount(duration), candidates.length);
  const hookRanking = await ranking();

  let picks: Pick[] = [];
  let warning: string | null = null;
  let plannedBy: "ai" | "rules" = "ai";
  try {
    const brand = await getBrand();
    const ai = await generateStructured({
      feature: "clips.momentos",
      model: "main",
      context: `${CLIPS_RULES}\n\n${await brandContext(brand)}`,
      task: clipsTask({ words, candidates, duration, count, ranking: hookRanking, title: row.title }),
      schema: clipsAiSchema,
      maxTokens: 6000,
    });
    picks = aiPicks(ai, candidates, words.length);
    if (ai.note.trim()) warning = ai.note.trim().slice(0, 300);
  } catch (error) {
    console.error("[clips] momentos sin IA:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    warning = error instanceof AiError ? `${error.userMessage} Elegimos los momentos con las medidas del video, sin IA.` : "Elegimos los momentos con las medidas del video, sin IA.";
  }
  if (picks.length < Math.min(5, count)) {
    if (picks.length) warning = warning ?? null;
    else plannedBy = "rules";
    // Completa con los mejores por reglas que no se pisen con lo elegido.
    for (const p of rulePicks(candidates, candidates.length)) {
      if (picks.length >= count) break;
      if (!picks.some((o) => p.from <= o.to && o.from <= p.to)) picks.push(p);
    }
  }

  const stats = videoStats(words);
  const scored = picks
    .map((p) => {
      const { score, detail } = scoreRange(words, p.from, p.to, stats, p.ai, hookRanking, p.hookType);
      const bounds = clipBounds(words, p.from, p.to, duration);
      return { ...p, score, detail, ...bounds, ...previewWindow(bounds.start, bounds.end, duration) };
    })
    .sort((a, b) => b.score - a.score);

  const db = getDb();
  const inserted = await db.transaction(async (tx) => {
    // Otro intento ya los guardó (dos llamadas a la vez): se usan esos.
    const again = await tx.select({ id: schema.longVideoClips.id }).from(schema.longVideoClips).where(eq(schema.longVideoClips.longVideoId, id)).limit(1);
    if (again.length) return null;
    const rows = await tx
      .insert(schema.longVideoClips)
      .values(
        scored.map((c, i) => ({
          longVideoId: id,
          rank: i + 1,
          fromWord: c.from,
          toWord: c.to,
          start: c.start,
          end: c.end,
          windowStart: c.windowStart,
          windowEnd: c.windowEnd,
          title: c.title,
          hookText: c.hookText,
          reason: c.reason,
          hookType: c.hookType,
          score: c.score,
          scoreDetail: c.detail as unknown as Record<string, unknown>,
        })),
      )
      .returning();
    await tx
      .update(schema.longVideos)
      .set({ analysis: { plannedBy, warning, candidates: candidates.length, ranking: hookRanking.length > 0 } })
      .where(eq(schema.longVideos.id, id));
    return rows;
  });
  if (!inserted) return findMoments(id);
  return { clips: inserted.map((c) => ({ id: c.id, start: c.start, end: c.end, windowStart: c.windowStart, windowEnd: c.windowEnd })), plannedBy };
}

/** El worker entrega el reencuadre y la vista previa de cada clip: el video queda listo para elegir. */
export async function saveFraming(
  id: string,
  payload: { posterKey: string | null; clips: { id: string; framing: Record<string, unknown>; previewKey: string | null; posterKey: string | null }[] },
): Promise<{ status: string }> {
  const row = await loadLongVideo(id);
  if (!row) throw new ClipsError("Ese video ya no existe.");
  const own = (key: string | null) => (key && key.startsWith(prefix(id)) ? key : null);
  const db = getDb();
  for (const c of payload.clips) {
    await db
      .update(schema.longVideoClips)
      .set({ framing: c.framing, previewKey: own(c.previewKey), posterKey: own(c.posterKey) })
      .where(and(eq(schema.longVideoClips.id, c.id), eq(schema.longVideoClips.longVideoId, id)));
  }
  const media = { ...(row.media ?? {}), ...(own(payload.posterKey) ? { posterKey: own(payload.posterKey) } : {}) };
  await db.update(schema.longVideos).set({ status: "READY", media, errorMessage: null }).where(eq(schema.longVideos.id, id));
  return { status: "READY" };
}

// ─── Ajustes de un clip ───────────────────────────────────────────────────

async function clipWithVideo(clipId: string): Promise<{ clip: Clip; video: LongVideo; words: Transcript["words"] }> {
  const clip = await loadClipRow(clipId);
  if (!clip) throw new ClipsError("No encontramos ese clip.");
  const video = await loadLongVideo(clip.longVideoId);
  if (!video || video.status !== "READY") throw new ClipsError("Ese video todavía no está listo.");
  return { clip, video, words: (video.transcript as Transcript | null)?.words ?? [] };
}

/** Mueve el inicio y el fin por palabra (dentro de la ventana de la vista previa). Recalcula el puntaje de reglas. */
export async function updateClipRange(clipId: string, fromWord: number, toWord: number): Promise<{ score: number }> {
  const { clip, video, words } = await clipWithVideo(clipId);
  const error = validRange(words, fromWord, toWord, clip);
  if (error) throw new ClipsError(error);
  const duration = Number((video.media as { duration?: number } | null)?.duration ?? words[words.length - 1]!.end);
  const prev = clip.scoreDetail as unknown as ScoreDetail;
  const { score, detail } = scoreRange(words, fromWord, toWord, videoStats(words), prev?.ai ?? null, await ranking(), (clip.hookType as HookCategory | null) ?? null);
  const bounds = clipBounds(words, fromWord, toWord, duration);
  // Un proyecto creado con el tramo anterior ya no corresponde: el próximo "Abrir" o "Exportar" crea uno nuevo.
  const changed = fromWord !== clip.fromWord || toWord !== clip.toWord;
  await getDb()
    .update(schema.longVideoClips)
    .set({ fromWord, toWord, ...bounds, score, scoreDetail: detail as unknown as Record<string, unknown>, ...(changed ? { projectId: null, exportMode: null } : {}) })
    .where(eq(schema.longVideoClips.id, clipId));
  return { score };
}

export async function updateClipText(clipId: string, input: { title: string; hookText: string }): Promise<void> {
  await getDb().update(schema.longVideoClips).set({ title: input.title, hookText: input.hookText }).where(eq(schema.longVideoClips.id, clipId));
}

export async function setClipDiscarded(clipId: string, discarded: boolean): Promise<void> {
  await getDb().update(schema.longVideoClips).set({ discarded }).where(eq(schema.longVideoClips.id, clipId));
}

// ─── Del clip al Editor ───────────────────────────────────────────────────

// "Del estilo" necesita un video de referencia y "Sin subtítulos" no sirve de valor por defecto.
const CAPTION_PRESETS: CaptionPresetKey[] = CAPTION_PRESET_KEYS.filter((k) => k !== "estilo" && k !== "ninguno");

/** Subtítulos por defecto de Mi marca (`subtitle_preset`: "caja" o { preset: "caja" }); si no hay, Clásico. */
export function brandCaptionPreset(brand: Brand | null): CaptionPresetKey {
  const raw = brand?.subtitlePreset as unknown;
  const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { preset?: unknown }).preset : null;
  return typeof value === "string" && (CAPTION_PRESETS as string[]).includes(value) ? (value as CaptionPresetKey) : "clasico";
}

/** La transcripción del tramo, con tiempos desde el inicio del clip e ids desde 0 (como la de un video subido). */
export function clipTranscript(words: Transcript["words"], fromWord: number, toWord: number, start: number, end: number, language: string): Transcript {
  const slice = words.slice(fromWord, toWord + 1);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    version: 1,
    provider: "clip",
    language,
    duration: round(end - start),
    words: slice.map((w, i) => ({ id: i, text: w.text, start: round(Math.max(0, w.start - start)), end: round(Math.min(end - start, w.end - start)), ...(w.conf != null ? { conf: w.conf } : {}) })),
  };
}

/**
 * Crea (o reutiliza) el proyecto del Editor de un clip. El worker corta y reencuadra el tramo a 9:16 al empezar
 * el análisis (no hace falta volver a transcribir) y arma el plan como con cualquier video.
 * "export": apenas está el plan, se exporta solo con los subtítulos por defecto de Mi marca.
 */
export async function createClipProject(clipId: string, mode: "editor" | "export", userId: string): Promise<string> {
  const { clip, video, words } = await clipWithVideo(clipId);
  if (!clip.framing) throw new ClipsError("Este clip todavía no tiene el reencuadre. Espera a que termine el análisis.");
  if (!video.sourceKey) throw new ClipsError("No encontramos el video original. Vuelve a subirlo.");
  const db = getDb();

  if (clip.projectId) {
    const [project] = await db.select().from(schema.videoProjects).where(eq(schema.videoProjects.id, clip.projectId)).limit(1);
    if (project) {
      if (mode === "export" && clip.exportMode !== "export") {
        await db.update(schema.longVideoClips).set({ exportMode: "export" }).where(eq(schema.longVideoClips.id, clipId));
        if (project.status === "AWAITING_REVIEW") await autoExport(project.id, userId);
      }
      return project.id;
    }
  }

  const brand = await getBrand();
  const lang = brand?.language?.startsWith("en") ? "en" : "es";
  const id = randomUUID();
  const sourceKey = `editor/${id}/original.mp4`;
  const transcript = clipTranscript(words, clip.fromWord, clip.toWord, clip.start, clip.end, lang);
  const clipInput = { longVideoId: video.id, clipId: clip.id, sourceKey: video.sourceKey, start: clip.start, end: clip.end, framing: clip.framing };
  await db.insert(schema.videoProjects).values({
    id,
    title: clip.title.slice(0, 120),
    status: "PROCESSING",
    format: "9:16",
    captionPreset: brandCaptionPreset(brand),
    brollMode: "off",
    sourceKey,
    sourceName: `${clip.title.slice(0, 80)}.mp4`,
    transcript,
    // `clip` marca que el original lo genera el worker (ver /api/worker/storage).
    media: { clip: { longVideoId: video.id, clipId: clip.id, start: clip.start, end: clip.end } },
    createdBy: userId,
  });
  await db.update(schema.longVideoClips).set({ projectId: id, exportMode: mode }).where(eq(schema.longVideoClips.id, clipId));
  await enqueueJob({
    type: "VIDEO_ANALYZE",
    videoProjectId: id,
    createdBy: userId,
    stage: "En cola",
    input: { projectId: id, sourceKey, language: lang, clip: { ...clipInput, autoExport: mode === "export" } },
  });
  return id;
}

/** Revisión por defecto: los cortes que el plan ya da por seguros, sin cambiar el gancho ni el encuadre. */
async function autoExport(projectId: string, userId: string | null): Promise<void> {
  const [project] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (!project || project.status !== "AWAITING_REVIEW" || !project.plan) return;
  const plan = project.plan as EditPlan;
  const removed: number[] = [];
  for (const r of plan.removals) for (let w = r.from_word; w <= r.to_word; w++) removed.push(w);
  try {
    await startRender(
      projectId,
      { removed, selectedHook: null, preset: project.captionPreset as CaptionPresetKey, offsetX: 0, corrections: plan.corrections ?? {} },
      "9:16",
      userId ?? project.createdBy ?? (null as unknown as string),
    );
  } catch (error) {
    // Si no se pudo exportar solo, queda en revisión: la persona lo exporta desde el Editor.
    console.error("[clips] exportación directa:", error instanceof VideoError ? error.message : error instanceof Error ? error.message : error);
  }
}

/** Lo llama la ruta del plan del worker: si el proyecto viene de "Exportar directo", se exporta apenas está el plan. */
export async function maybeAutoExport(projectId: string): Promise<void> {
  const [clip] = await getDb()
    .select({ id: schema.longVideoClips.id, exportMode: schema.longVideoClips.exportMode })
    .from(schema.longVideoClips)
    .where(eq(schema.longVideoClips.projectId, projectId))
    .limit(1);
  if (clip?.exportMode === "export") await autoExport(projectId, null);
}

/** Proyectos de varios clips, para mostrar su estado en las tarjetas. */
export async function clipProjects(ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({ id: schema.videoProjects.id, status: schema.videoProjects.status, outputKey: schema.videoProjects.outputKey, errorMessage: schema.videoProjects.errorMessage, title: schema.videoProjects.title })
    .from(schema.videoProjects)
    .where(inArray(schema.videoProjects.id, ids));
}
