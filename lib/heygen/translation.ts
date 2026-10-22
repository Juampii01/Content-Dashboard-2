import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { notify } from "@/lib/notifications";
import { getDb, schema } from "@/lib/db";
import { deleteKeys } from "@/lib/storage/files";
import { storedKey } from "@/lib/storage/copy";
import { balanceFromUser, HeyGenError, type HeyGenClient, type HeyGenTranslation } from "./client";
import { balanceShortfall, estimateTranslation, type TranslationModeKey } from "./pricing";
import { openKey, openUrl, TransferError, uploadToHeyGen, type OpenedFile } from "./transfer";

/**
 * Traducción de un video con la voz del cliente (POST /v3/video-translations).
 *
 * HeyGen clona la voz del que habla en el video original ("By default, Video Translation clones the original speaker",
 * /docs/video-translate) y, salvo en "solo audio", redibuja la boca para que coincida. El video se sube como asset
 * (subida directa, hasta 200 MB) y la traducción se sigue con GET /v3/video-translations/{id} (polling) o con el
 * webhook `video_translate.success|fail`. La fila es un `clone_videos` con kind = "translation": así reutiliza la
 * lista, el detalle, los avisos, la copia de archivos, el vínculo con el Calendario y "Usar en el editor".
 */

export type CloneVideoRow = typeof schema.cloneVideos.$inferSelect;

/** Abre el video original de una traducción: render del Editor, video con clon o archivo subido. */
export async function openTranslationSource(row: CloneVideoRow, client: HeyGenClient): Promise<{ file: OpenedFile; filename: string }> {
  const source = row.source;
  if (!source) throw new TransferError("No sabemos de qué video salió esta traducción.", "sin source");
  if (source.type === "editor" || source.type === "upload") {
    if (!source.key) throw new TransferError("No encontramos el archivo del video original.", "sin key");
    return { file: await openKey(source.key), filename: `${source.type === "editor" ? "editor" : "subido"}-${row.id}.${source.key.split(".").pop() ?? "mp4"}` };
  }
  // Video con clon: la copia propia o, si sigue solo en HeyGen, una URL vigente.
  const [clone] = await getDb().select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, source.id ?? "00000000-0000-0000-0000-000000000000")).limit(1);
  if (!clone || clone.status !== "COMPLETED") throw new TransferError("El video con clon original ya no está disponible.", "clon no listo");
  let url = clone.videoUrl;
  if ((!url || !storedKey(url)) && clone.heygenVideoId) {
    const fresh = clone.kind === "translation" ? await client.getVideoTranslation(clone.heygenVideoId) : await client.getVideo(clone.heygenVideoId);
    url = fresh.video_url ?? url;
  }
  if (!url) throw new TransferError("El video con clon original ya no tiene archivo.", "sin url");
  return { file: await openUrl(url), filename: `clon-${clone.id}.mp4` };
}

/**
 * Sube el original a HeyGen y crea la traducción. Se llama con `after()` (la subida puede tardar unos minutos) y
 * desde el reintento. Es idempotente: el Idempotency-Key sale del id de la fila.
 */
export async function submitTranslation(row: CloneVideoRow, client: HeyGenClient): Promise<CloneVideoRow> {
  const db = getDb();
  const mode = (row.source?.mode ?? "speed") as TranslationModeKey;
  const { file, filename } = await openTranslationSource(row, client);
  const contentType = file.contentType === "application/octet-stream" || file.contentType === "binary/octet-stream" ? (filename.endsWith(".webm") ? "video/webm" : "video/mp4") : file.contentType;
  const assetId = await uploadToHeyGen(client, file, { filename, contentType, idempotencyKey: `clone-translation-${row.id}` });

  const ids = await client.createVideoTranslation(
    {
      video: { type: "asset_id", asset_id: assetId },
      output_languages: [row.language ?? "English"],
      title: row.title,
      mode: mode === "precision" ? "precision" : "speed",
      translate_audio_only: mode === "audio_only",
      // Un solo hablante (talking head): ayuda a separar la voz. Es el caso de todos los videos de la app.
      speaker_num: 1,
      keep_the_same_format: true,
      callback_id: row.id,
    },
    `clone-translation-${row.id}`,
  );
  const id = ids[0];
  if (!id) throw new HeyGenError("UNKNOWN", "HeyGen no devolvió la traducción. Vuelve a intentarlo.", "sin video_translation_ids");
  const [updated] = await db
    .update(schema.cloneVideos)
    .set({ heygenVideoId: id, status: "QUEUED", errorMessage: null, lastCheckedAt: new Date() })
    .where(eq(schema.cloneVideos.id, row.id))
    .returning();
  return updated ?? row;
}

/** Mensaje para la persona cuando la traducción no se pudo enviar. */
export function translationSubmitError(error: unknown): string {
  if (error instanceof TransferError) return error.userMessage;
  if (error instanceof HeyGenError) {
    if (error.kind === "INVALID") return "HeyGen rechazó el video para traducir. Revisa que se escuche una sola persona hablando y que sea un MP4, y vuelve a intentarlo.";
    return error.userMessage;
  }
  return "No pudimos enviar el video a HeyGen. Vuelve a intentarlo en unos minutos.";
}

/** Traducción → la forma de video que usa el seguimiento (lib/heygen/service.ts). */
export function translationAsVideo(t: HeyGenTranslation) {
  const status = t.status === "running" ? "processing" : t.status;
  return {
    id: t.id,
    status,
    video_url: t.video_url ?? null,
    subtitle_url: t.srt_caption_url ?? null,
    thumbnail_url: null,
    captioned_video_url: null,
    duration: t.duration ?? null,
    completed_at: null,
    failure_message: t.failure_message ?? null,
  };
}

/** El archivo subido a mano solo hace falta hasta que la traducción sale bien (para poder reintentarla). */
export async function cleanupUploadedSource(row: CloneVideoRow): Promise<void> {
  if (row.kind === "translation" && row.source?.type === "upload" && row.source.key) await deleteKeys([row.source.key]).catch(() => undefined);
}

/**
 * Manda la traducción en segundo plano (con `after()` quien llama): sube el original y crea la traducción.
 * Si falla, la fila queda en FAILED con el motivo y se avisa.
 */
export async function runTranslation(rowId: string, client: HeyGenClient): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, rowId)).limit(1);
  if (!row || row.heygenVideoId || row.status !== "QUEUED") return;
  try {
    await submitTranslation(row, client);
  } catch (error) {
    if (error instanceof HeyGenError) console.error("[clon] traducción:", error.detail);
    else console.error("[clon] traducción:", error instanceof Error ? error.message : "error");
    const message = translationSubmitError(error);
    await db.update(schema.cloneVideos).set({ status: "FAILED", errorMessage: message }).where(eq(schema.cloneVideos.id, rowId));
    await notify({ key: `clone-video:${rowId}`, userId: row.createdBy, tone: "error", title: "No pudimos traducir tu video", body: message, href: `/clon/${rowId}`, email: false });
  }
}

/**
 * Reintentar una traducción fallida: si nunca llegó a HeyGen se reenvía la misma fila; si HeyGen la rechazó,
 * se crea una fila nueva con los mismos datos (vuelve a cobrar, así que se revisa el saldo antes).
 */
export async function retryTranslation(row: CloneVideoRow, userId: string): Promise<{ ok: true; data: { id: string } } | { ok: false; error: string }> {
  const db = getDb();
  const conn = await loadClient();
  if (!conn) return { ok: false, error: "Todavía no hay una API key de HeyGen guardada. El dueño de la cuenta la agrega en Ajustes → Claves de servicios." };
  const mode = (row.source?.mode ?? "speed") as TranslationModeKey;
  const estimate = estimateTranslation(row.sourceSeconds ?? row.estimatedSeconds ?? 0, mode);
  try {
    const blocked = balanceShortfall(balanceFromUser(await conn.getMe()), estimate);
    if (blocked) return { ok: false, error: `${blocked} Carga saldo en HeyGen y vuelve a intentarlo.` };
  } catch (error) {
    return { ok: false, error: error instanceof HeyGenError ? error.userMessage : "No pudimos consultar tu saldo en HeyGen." };
  }
  if (!row.heygenVideoId) {
    const [claimed] = await db
      .update(schema.cloneVideos)
      .set({ status: "QUEUED", errorMessage: null, createdAt: new Date() })
      .where(and(eq(schema.cloneVideos.id, row.id), eq(schema.cloneVideos.status, "FAILED")))
      .returning({ id: schema.cloneVideos.id });
    if (claimed) after(() => runTranslation(row.id, conn));
    return { ok: true, data: { id: row.id } };
  }
  const freshId = randomUUID();
  const [claim] = await db
    .update(schema.cloneVideos)
    .set({ retriedInto: freshId })
    .where(and(eq(schema.cloneVideos.id, row.id), eq(schema.cloneVideos.status, "FAILED"), isNull(schema.cloneVideos.retriedInto)))
    .returning({ id: schema.cloneVideos.id });
  if (!claim) return { ok: false, error: "Esa traducción ya se está reintentando." };
  await db.insert(schema.cloneVideos).values({
    id: freshId,
    kind: "translation",
    title: row.title,
    scriptText: row.scriptText,
    engine: row.engine,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    language: row.language,
    source: row.source,
    sourceSeconds: row.sourceSeconds,
    estimatedSeconds: row.estimatedSeconds,
    estimatedCostUsd: estimate.usd,
    createdBy: userId,
  });
  after(() => runTranslation(freshId, conn));
  return { ok: true, data: { id: freshId } };
}

async function loadClient(): Promise<HeyGenClient | null> {
  const { loadHeyGen } = await import("./service");
  return (await loadHeyGen())?.client ?? null;
}
