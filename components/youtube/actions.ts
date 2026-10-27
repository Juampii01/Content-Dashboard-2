"use server";

import { refresh } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { allowAttempt } from "@/lib/rate-limit";
import { editorTranscript, ensureRetention, explainRetention, RetentionError, saveTranscript } from "@/lib/youtube/retention-service";
import { MAX_SUBTITLE_BYTES, parseSubtitles, sanitizeSegments } from "@/lib/youtube/transcript";

/** Acciones de "Dónde se fue la gente" (detalle de una pieza en Métricas). */
type Result = { ok: true; message?: string } | { ok: false; error: string };
const uuid = z.string().uuid();

/**
 * Trae la curva de YouTube si falta o quedó vieja. La llama la pantalla al abrir la pieza (también para usuarios de
 * solo lectura: no cambia nada del contenido, solo lee la red). Responde qué pasó para mostrarlo.
 */
export async function refreshRetentionAction(id: string): Promise<{ status: string; message?: string }> {
  await getCurrentUser();
  if (!uuid.safeParse(id).success) return { status: "error", message: "Pieza no válida." };
  const outcome = await ensureRetention(id);
  if (outcome.status === "updated") refresh();
  return outcome;
}

export async function explainRetentionAction(id: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  if (!aiConfigured()) return { ok: false, error: "La IA todavía no está configurada en esta instalación." };
  if (!(await allowAttempt(`retencion-ia:${user.id}`, 30, 3600))) return { ok: false, error: "Pediste muchas explicaciones seguidas. Prueba de nuevo en un rato." };
  try {
    await explainRetention(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof RetentionError) return { ok: false, error: error.message };
    if (error instanceof AiError) {
      console.error("[ia]", error.detail);
      return { ok: false, error: error.userMessage };
    }
    console.error("[youtube] explicación", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos explicar la curva. Prueba de nuevo." };
  }
}

async function youtubeItem(id: string) {
  const [item] = await getDb()
    .select({ id: schema.contentItems.id, platform: schema.contentItems.platform, externalId: schema.contentItems.externalId, permalink: schema.contentItems.permalink })
    .from(schema.contentItems)
    .where(eq(schema.contentItems.id, id))
    .limit(1);
  return item?.platform === "YOUTUBE" ? item : null;
}

/** Usa la transcripción de un video del Editor (con los tiempos del video exportado). */
export async function applyEditorTranscriptAction(id: string, videoProjectId: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success || !uuid.safeParse(videoProjectId).success) return { ok: false, error: "Pedido no válido." };
  if (!(await youtubeItem(id))) return { ok: false, error: "Solo los videos de YouTube tienen curva de retención." };
  const segments = await editorTranscript(videoProjectId);
  if (!segments) return { ok: false, error: "Ese video del Editor todavía no tiene transcripción." };
  await saveTranscript({ contentItemId: id, source: "editor", segments, videoProjectId, userId: user.id });
  refresh();
  return { ok: true, message: "Listo: usamos la transcripción del video editado." };
}

/** Subtítulos que el cliente baja de YouTube Studio (.srt o .vtt). El navegador manda el texto del archivo. */
export async function uploadSubtitlesAction(id: string, fileName: string, content: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  if (!/\.(srt|vtt|sbv|txt)$/i.test(fileName)) return { ok: false, error: "Sube el archivo de subtítulos en formato .srt o .vtt." };
  if (content.length > MAX_SUBTITLE_BYTES) return { ok: false, error: "El archivo es demasiado grande (máximo 2 MB)." };
  if (!(await youtubeItem(id))) return { ok: false, error: "Solo los videos de YouTube tienen curva de retención." };
  const segments = sanitizeSegments(parseSubtitles(content));
  if (segments.length < 2) return { ok: false, error: "No encontramos tiempos en ese archivo. Descárgalo de YouTube Studio → Subtítulos en formato .srt o .vtt." };
  await saveTranscript({ contentItemId: id, source: "subtitulos", segments, userId: user.id });
  refresh();
  return { ok: true, message: `Listo: leímos ${segments.length} frases con sus tiempos.` };
}

/** Pide al worker los subtítulos públicos del video (los que YouTube muestra, manuales o automáticos). */
export async function fetchYoutubeTranscriptAction(id: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  const item = await youtubeItem(id);
  if (!item) return { ok: false, error: "Solo los videos de YouTube tienen curva de retención." };
  if (!(await allowAttempt(`yt-subtitulos:${id}`, 4, 3600))) return { ok: false, error: "Ya lo intentamos varias veces en la última hora. Prueba más tarde o sube el archivo de subtítulos." };
  const [running] = await getDb()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "YOUTUBE_TRANSCRIPT"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'contentItemId' = ${id}`))
    .limit(1);
  if (running) return { ok: true, message: "Ya lo estamos trayendo." };
  await enqueueJob({ type: "YOUTUBE_TRANSCRIPT", input: { contentItemId: id, videoId: item.externalId }, createdBy: user.id, maxAttempts: 2, stage: "En cola" });
  refresh();
  return { ok: true, message: "Estamos trayendo los subtítulos de YouTube. Tarda unos segundos." };
}

export async function clearTranscriptAction(id: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return { ok: false, error: user.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  await getDb().delete(schema.pieceTranscripts).where(eq(schema.pieceTranscripts.contentItemId, id));
  await getDb().delete(schema.retentionInsights).where(eq(schema.retentionInsights.contentItemId, id));
  refresh();
  return { ok: true, message: "Quitamos la transcripción." };
}
