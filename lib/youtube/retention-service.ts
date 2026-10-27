import "server-only";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { generateStructured } from "@/lib/ai/client";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { RETENTION_RULES, retentionExplanationSchema, retentionTask } from "@/lib/ai/prompts/youtube";
import { getDb, schema } from "@/lib/db";
import { allowAttempt } from "@/lib/rate-limit";
import { SyncContext } from "@/lib/social/http";
import { getValidToken } from "@/lib/social/tokens";
import { SocialApiError } from "@/lib/social/types";
import { youtubeRetention } from "@/lib/social/youtube/client";
import type { EditPlan, Transcript } from "@/lib/video/types";
import { curveAsText, detectDrops, quoteForDrop, retentionMarks } from "./retention";
import { editorSegments } from "./transcript";
import type { RetentionPoint, TranscriptSegment, TranscriptSource } from "./types";

/**
 * Curva de retención bajo demanda (al abrir la pieza) y explicación con IA de las caídas.
 * Sin sesión: lo llaman la capa de datos y las acciones, que ya la validan.
 */
const DAY = 86_400_000;

export type EnsureOutcome =
  | { status: "fresh" | "updated" }
  | { status: "too-new" | "empty" | "not-youtube" | "no-account" | "demo" | "throttled" }
  | { status: "error"; message: string };

/** Una curva sirve si es de los últimos 3 días, o si se tomó con el video de más de 30 días (ya casi no cambia). */
export function curveIsFresh(capturedAt: Date, publishedAt: Date, now = Date.now()): boolean {
  if (now - capturedAt.getTime() < 3 * DAY) return true;
  return capturedAt.getTime() - publishedAt.getTime() > 30 * DAY;
}

export async function ensureRetention(contentItemId: string): Promise<EnsureOutcome> {
  const db = getDb();
  const [item] = await db
    .select({ id: schema.contentItems.id, platform: schema.contentItems.platform, externalId: schema.contentItems.externalId, publishedAt: schema.contentItems.publishedAt, accountId: schema.contentItems.socialAccountId })
    .from(schema.contentItems)
    .where(eq(schema.contentItems.id, contentItemId))
    .limit(1);
  if (!item) return { status: "error", message: "No encontramos esa pieza." };
  if (item.platform !== "YOUTUBE") return { status: "not-youtube" };
  const [curve] = await db.select({ capturedAt: schema.retentionCurves.capturedAt }).from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, item.id)).limit(1);
  if (curve && curveIsFresh(curve.capturedAt, item.publishedAt)) return { status: "fresh" };
  if (Date.now() - item.publishedAt.getTime() < 2 * DAY) return { status: "too-new" };

  const [account] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, item.accountId)).limit(1);
  if ((account?.meta as { demo?: boolean } | null)?.demo) return { status: "demo" };
  if (!account || !account.current || account.status !== "ACTIVE") return { status: "no-account" };
  // Una consulta por pieza cada 6 horas como mucho (abrir y cerrar la pieza no gasta cuota).
  if (!(await allowAttempt(`retencion:${item.id}`, 1, 6 * 3600))) return { status: "throttled" };

  try {
    const { token } = await getValidToken(account.id);
    const ctx = new SyncContext("YOUTUBE", Date.now() + 25_000);
    const points = await youtubeRetention(ctx, token, item.externalId, item.publishedAt);
    if (points.length === 0) return { status: "empty" };
    await db
      .insert(schema.retentionCurves)
      .values({ contentItemId: item.id, points, capturedAt: new Date() })
      .onConflictDoUpdate({ target: schema.retentionCurves.contentItemId, set: { points, capturedAt: new Date() } });
    return { status: "updated" };
  } catch (error) {
    if (error instanceof SocialApiError) {
      console.error("[youtube] retención:", error.detail);
      if (error.kind === "NOT_SUPPORTED") return { status: "empty" };
      return { status: "error", message: error.userMessage };
    }
    console.error("[youtube] retención:", error instanceof Error ? error.message : error);
    return { status: "error", message: "No pudimos traer la curva de YouTube. Prueba de nuevo más tarde." };
  }
}

// ─── Transcripción de la pieza ──────────────────────────────────────────

export type PieceTranscript = { source: TranscriptSource; segments: TranscriptSegment[]; videoProjectId: string | null; label: string; updatedAt: Date | null };

const SOURCE_LABEL: Record<TranscriptSource, string> = {
  editor: "Transcripción del video editado en el Editor",
  subtitulos: "Subtítulos que subiste",
  youtube: "Subtítulos de YouTube",
};

/** Transcripción de un video del Editor con los tiempos del video exportado. null si todavía no tiene. */
export async function editorTranscript(videoProjectId: string): Promise<TranscriptSegment[] | null> {
  const [p] = await getDb()
    .select({ transcript: schema.videoProjects.transcript, plan: schema.videoProjects.plan, media: schema.videoProjects.media, outputMeta: schema.videoProjects.outputMeta })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, videoProjectId))
    .limit(1);
  if (!p?.transcript) return null;
  const duration = Number((p.media as { duration?: number } | null)?.duration ?? 0) || null;
  const segments = editorSegments(p.transcript as Transcript, p.plan as EditPlan | null, duration);
  return segments.length ? segments : null;
}

/**
 * La transcripción que se usa para una pieza: la guardada (subtítulos o un video del Editor que se eligió) o, si no
 * hay, la del video del Editor vinculado en el Calendario.
 */
export async function pieceTranscript(contentItemId: string): Promise<PieceTranscript | null> {
  const db = getDb();
  const [stored] = await db.select().from(schema.pieceTranscripts).where(eq(schema.pieceTranscripts.contentItemId, contentItemId)).limit(1);
  if (stored?.segments.length) return { source: stored.source, segments: stored.segments, videoProjectId: stored.videoProjectId, label: SOURCE_LABEL[stored.source], updatedAt: stored.updatedAt };

  const [linked] = await db
    .select({ videoProjectId: schema.calendarEntries.videoProjectId })
    .from(schema.calendarTargets)
    .innerJoin(schema.calendarEntries, eq(schema.calendarEntries.id, schema.calendarTargets.entryId))
    .where(and(eq(schema.calendarTargets.contentItemId, contentItemId), eq(schema.calendarTargets.linkStatus, "LINKED"), isNotNull(schema.calendarEntries.videoProjectId)))
    .orderBy(desc(schema.calendarEntries.updatedAt))
    .limit(1);
  if (linked?.videoProjectId) {
    const segments = await editorTranscript(linked.videoProjectId);
    if (segments) return { source: "editor", segments, videoProjectId: linked.videoProjectId, label: "Transcripción del video del Editor que vinculaste en el Calendario", updatedAt: null };
  }
  return null;
}

export async function saveTranscript(input: { contentItemId: string; source: TranscriptSource; segments: TranscriptSegment[]; language?: string | null; videoProjectId?: string | null; userId: string | null }) {
  const values = { source: input.source, segments: input.segments, language: input.language ?? null, videoProjectId: input.videoProjectId ?? null, createdBy: input.userId };
  await getDb()
    .insert(schema.pieceTranscripts)
    .values({ contentItemId: input.contentItemId, ...values })
    .onConflictDoUpdate({ target: schema.pieceTranscripts.contentItemId, set: { ...values, updatedAt: new Date() } });
  // La explicación vieja se hizo sin este texto: se borra para no mostrar algo que ya no corresponde.
  await getDb().delete(schema.retentionInsights).where(eq(schema.retentionInsights.contentItemId, input.contentItemId));
}

/** Videos del Editor que se pueden elegir como transcripción de una pieza (los que ya tienen transcripción). */
export async function editorChoices(limit = 30) {
  return getDb()
    .select({ id: schema.videoProjects.id, title: schema.videoProjects.title, updatedAt: schema.videoProjects.updatedAt })
    .from(schema.videoProjects)
    .where(and(isNotNull(schema.videoProjects.transcript), or(eq(schema.videoProjects.status, "DONE"), eq(schema.videoProjects.status, "AWAITING_REVIEW"), eq(schema.videoProjects.status, "RENDERING"))))
    .orderBy(desc(schema.videoProjects.updatedAt))
    .limit(limit);
}

// ─── Explicación con IA ─────────────────────────────────────────────────

export class RetentionError extends Error {}

export async function explainRetention(contentItemId: string, userId: string): Promise<void> {
  const db = getDb();
  const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, contentItemId)).limit(1);
  if (!item || item.platform !== "YOUTUBE") throw new RetentionError("Solo los videos de YouTube tienen curva de retención.");
  const [curve] = await db.select().from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, item.id)).limit(1);
  if (!curve?.points.length) throw new RetentionError("Todavía no tenemos la curva de retención de este video.");
  const points = curve.points as RetentionPoint[];
  const drops = detectDrops(points, item.durationSec);
  if (!drops.length) throw new RetentionError("Este video no tiene caídas fuertes: no hay nada que explicar.");
  const transcript = await pieceTranscript(item.id);
  const marks = retentionMarks(points, item.durationSec);

  const brand = await getBrand();
  const result = await generateStructured({
    feature: "youtube.retencion",
    model: "main",
    context: `${RETENTION_RULES}\n\n${await brandContext(brand)}`,
    task: retentionTask({
      title: item.title ?? item.caption?.split("\n")[0] ?? "(sin título)",
      type: item.type === "SHORT" ? "Short" : "Video",
      durationSec: item.durationSec,
      avgViewPercentage: item.avgViewPercentage,
      introAt: marks.introAt,
      introRetention: marks.intro,
      curve: curveAsText(points, item.durationSec),
      drops: drops.map((d, i) => ({ n: i + 1, drop: d, quote: transcript ? quoteForDrop(transcript.segments, d)?.text ?? null : null })),
      hasTranscript: Boolean(transcript),
    }),
    schema: retentionExplanationSchema,
    maxTokens: 2000,
    userId,
  });
  const explanation = { ...result, drops: result.drops.filter((d) => d.n >= 1 && d.n <= drops.length) };
  const values = { curveCapturedAt: curve.capturedAt, transcriptSource: transcript?.source ?? null, drops, explanation, createdBy: userId };
  await db
    .insert(schema.retentionInsights)
    .values({ contentItemId: item.id, ...values })
    .onConflictDoUpdate({ target: schema.retentionInsights.contentItemId, set: { ...values, updatedAt: new Date() } });
}
