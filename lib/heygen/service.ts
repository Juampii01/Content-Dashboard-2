import "server-only";
import { notify } from "@/lib/notifications";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { blobConfigured, copyRemoteFile } from "@/lib/storage/copy";
import { balanceFromUser, createHeyGenClient, HeyGenError, type HeyGenBalance, type HeyGenClient, type HeyGenVideo } from "./client";

/**
 * Lógica del módulo de clon que no depende de la interfaz: la key del cliente, el webhook,
 * el seguimiento de cada video y la copia de los archivos a nuestro almacenamiento.
 * Quien llama comprueba la sesión antes (acciones con requireEditor/requireOwner, DAL con getCurrentUser);
 * el webhook y el cron no tienen sesión y se autentican con su firma o con CRON_SECRET.
 */

const KEY_CONTEXT = "heygen.api_key";
const WEBHOOK_CONTEXT = "heygen.webhook_secret";
export const WEBHOOK_EVENTS = ["avatar_video.success", "avatar_video.fail"];

export type CloneVideoRow = typeof schema.cloneVideos.$inferSelect;

// ─── Key del cliente ──────────────────────────────────────────────────────

export async function getCredentialRow() {
  const [row] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "HEYGEN")).limit(1);
  return row ?? null;
}

/** Cliente con la key guardada (descifrada solo aquí, en el servidor), o null si no hay key. */
export async function loadHeyGen(): Promise<{ client: HeyGenClient; row: NonNullable<Awaited<ReturnType<typeof getCredentialRow>>> } | null> {
  const row = await getCredentialRow();
  if (!row) return null;
  return { client: createHeyGenClient(decryptSecret(row.secretEnc, KEY_CONTEXT)), row };
}

export function webhookUrl(): string {
  return `${env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/webhooks/heygen`;
}

/**
 * Registra (o vuelve a registrar) nuestro endpoint de webhook en la cuenta de HeyGen del cliente.
 * Borra antes los que apuntan a la misma URL, porque su secreto ya no lo tenemos.
 * Si falla (por ejemplo en localhost, que HeyGen no puede alcanzar), devuelve el motivo y queda el polling.
 */
async function registerWebhook(client: HeyGenClient, previousEndpointId: string | null) {
  const url = webhookUrl();
  try {
    if (previousEndpointId) await client.deleteWebhookEndpoint(previousEndpointId).catch(() => undefined);
    const existing = await client.listWebhookEndpoints().catch(() => null);
    for (const endpoint of existing?.data ?? []) {
      if (endpoint.url === url) await client.deleteWebhookEndpoint(endpoint.endpoint_id).catch(() => undefined);
    }
    const created = await client.createWebhookEndpoint({ url, events: WEBHOOK_EVENTS }, `webhook-${randomUUID()}`);
    if (!created.secret) throw new HeyGenError("UNKNOWN", "HeyGen no devolvió el secreto del webhook.", "sin secret");
    return { webhookEndpointId: created.endpoint_id, webhookSecretEnc: encryptSecret(created.secret, WEBHOOK_CONTEXT), webhookError: null };
  } catch (error) {
    if (error instanceof HeyGenError) console.error("[heygen] registro de webhook:", error.detail);
    const local = !url.startsWith("https://") || /localhost|127\.0\.0\.1/.test(url);
    const reason = local
      ? `HeyGen solo puede avisar a una dirección pública con https, y esta instalación usa ${url}.`
      : `HeyGen no aceptó registrar ${url}${error instanceof HeyGenError ? ` (${error.userMessage})` : ""}.`;
    return {
      webhookEndpointId: null,
      webhookSecretEnc: null,
      webhookError: `${reason} Mientras tanto, la app revisa el estado de cada video cada pocos segundos.`,
    };
  }
}

/** Valida la key contra GET /v3/users/me, la guarda cifrada y registra el webhook. */
export async function saveApiKey(apiKey: string, userId: string): Promise<{ balance: HeyGenBalance; webhookError: string | null; label: string }> {
  const client = createHeyGenClient(apiKey);
  const user = await client.getMe(); // lanza HeyGenError si la key no sirve
  const previous = await getCredentialRow();
  const previousClient = previous ? createHeyGenClient(decryptSecret(previous.secretEnc, KEY_CONTEXT)) : null;
  // Si cambia de cuenta, el webhook viejo se borra con la key vieja (best effort).
  if (previous?.webhookEndpointId && previousClient) await previousClient.deleteWebhookEndpoint(previous.webhookEndpointId).catch(() => undefined);

  const webhook = await registerWebhook(client, null);
  const label = apiKey.slice(-4);
  const values = { secretEnc: encryptSecret(apiKey, KEY_CONTEXT), label, updatedBy: userId, ...webhook };
  await getDb()
    .insert(schema.serviceCredentials)
    .values({ provider: "HEYGEN", ...values })
    .onConflictDoUpdate({ target: schema.serviceCredentials.provider, set: { ...values, updatedAt: new Date() } });
  return { balance: balanceFromUser(user), webhookError: webhook.webhookError, label };
}

export async function retryWebhookRegistration(): Promise<string | null> {
  const conn = await loadHeyGen();
  if (!conn) return "Primero guarda tu API key de HeyGen.";
  const webhook = await registerWebhook(conn.client, conn.row.webhookEndpointId);
  await getDb().update(schema.serviceCredentials).set(webhook).where(eq(schema.serviceCredentials.id, conn.row.id));
  return webhook.webhookError;
}

/** Quita la key: borra el webhook en HeyGen (si se puede) y la fila. Los videos ya generados se conservan. */
export async function removeApiKey(): Promise<void> {
  const conn = await loadHeyGen().catch(() => null);
  if (conn?.row.webhookEndpointId) await conn.client.deleteWebhookEndpoint(conn.row.webhookEndpointId).catch(() => undefined);
  await getDb().delete(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "HEYGEN"));
}

export async function getWebhookSecret(): Promise<string | null> {
  const row = await getCredentialRow();
  if (!row?.webhookSecretEnc) return null;
  return decryptSecret(row.webhookSecretEnc, WEBHOOK_CONTEXT);
}

/** Saldo actual (consulta en vivo). */
export async function fetchBalance(): Promise<{ balance: HeyGenBalance | null; error: string | null }> {
  const conn = await loadHeyGen();
  if (!conn) return { balance: null, error: null };
  try {
    return { balance: balanceFromUser(await conn.client.getMe()), error: null };
  } catch (error) {
    if (error instanceof HeyGenError) {
      console.error("[heygen] saldo:", error.detail);
      return { balance: null, error: error.userMessage };
    }
    throw error;
  }
}

// ─── Seguimiento de videos ────────────────────────────────────────────────

const statusMap: Record<string, CloneVideoRow["status"]> = { pending: "QUEUED", waiting: "QUEUED", processing: "PROCESSING", completed: "COMPLETED", failed: "FAILED" };

/**
 * Toma un video para consultarlo: solo si nadie lo consultó en los últimos `minAgeSec` segundos
 * y si no hay una copia de archivos en curso (en ese caso `last_checked_at` está en el futuro).
 * Es atómico: dos pestañas, el webhook y el cron no consultan el mismo video a la vez.
 */
async function claim(id: string, minAgeSec: number): Promise<CloneVideoRow | null> {
  const [row] = await getDb()
    .update(schema.cloneVideos)
    .set({ lastCheckedAt: sql`now()` })
    .where(
      and(
        eq(schema.cloneVideos.id, id),
        isNotNull(schema.cloneVideos.heygenVideoId),
        or(
          inArray(schema.cloneVideos.status, ["QUEUED", "PROCESSING"]),
          and(eq(schema.cloneVideos.status, "COMPLETED"), eq(schema.cloneVideos.filesStored, false)),
        ),
        sql`(${schema.cloneVideos.lastCheckedAt} is null or ${schema.cloneVideos.lastCheckedAt} <= now() - make_interval(secs => ${minAgeSec}))`,
      ),
    )
    .returning();
  return row ?? null;
}

function failureMessage(video: HeyGenVideo): string {
  const reason = video.failure_message?.trim().replace(/[.\s]+$/, "");
  return reason
    ? `HeyGen no pudo generar el video. Motivo que informa HeyGen (en inglés): «${reason.slice(0, 300)}». Revisa el texto y el avatar, y vuelve a intentarlo.`
    : "HeyGen no pudo generar el video y no informó el motivo. Vuelve a intentarlo; si se repite, revisa el video en tu cuenta de HeyGen.";
}

const VIDEO_TYPES = ["video/mp4"];
const SRT_TYPES = ["application/x-subrip", "text/plain", "text/srt", "application/srt"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Copia MP4, SRT y miniatura. Si algo falla, se queda con las URLs de HeyGen (se pueden volver a pedir). */
async function storeFiles(row: CloneVideoRow, video: HeyGenVideo) {
  const videoSource = (row.captions ? video.captioned_video_url : null) ?? video.video_url ?? null;
  const base = { videoUrl: videoSource, subtitleUrl: video.subtitle_url ?? null, thumbnailUrl: video.thumbnail_url ?? null, filesStored: false };
  if (!blobConfigured() || !videoSource) return base;
  try {
    const prefix = `clon/${row.id}`;
    const [mp4, srt, thumb] = await Promise.all([
      copyRemoteFile(videoSource, `${prefix}/video.mp4`, { allowedTypes: VIDEO_TYPES, fallbackType: "video/mp4", maxBytes: 4 * 1024 ** 3 }),
      video.subtitle_url
        ? copyRemoteFile(video.subtitle_url, `${prefix}/subtitulos.srt`, { allowedTypes: SRT_TYPES, fallbackType: "application/x-subrip", maxBytes: 5 * 1024 ** 2, timeoutMs: 30_000 })
        : null,
      video.thumbnail_url
        ? copyRemoteFile(video.thumbnail_url, `${prefix}/miniatura`, { allowedTypes: IMAGE_TYPES, fallbackType: "image/jpeg", maxBytes: 10 * 1024 ** 2, timeoutMs: 30_000 }).catch(() => null)
        : null,
    ]);
    return {
      videoUrl: mp4?.url ?? videoSource,
      subtitleUrl: srt?.url ?? base.subtitleUrl,
      thumbnailUrl: thumb?.url ?? base.thumbnailUrl,
      filesStored: Boolean(mp4 && (srt || !video.subtitle_url)),
    };
  } catch (error) {
    console.error("[clon] copia de archivos:", row.id, error instanceof Error ? error.message : "error");
    return base;
  }
}

/**
 * Consulta un video en HeyGen y actualiza la fila. Al completarse copia los archivos.
 * Devuelve la fila actualizada, o null si no tocaba consultarlo (freno o copia en curso).
 */
export async function refreshCloneVideo(id: string, options: { minAgeSec?: number } = {}): Promise<CloneVideoRow | null> {
  const row = await claim(id, options.minAgeSec ?? 8);
  if (!row?.heygenVideoId) return null;
  const conn = await loadHeyGen();
  if (!conn) return row;
  const db = getDb();

  let video: HeyGenVideo;
  try {
    video = await conn.client.getVideo(row.heygenVideoId);
  } catch (error) {
    if (error instanceof HeyGenError && error.kind === "NOT_FOUND" && row.status !== "COMPLETED") {
      const [updated] = await db
        .update(schema.cloneVideos)
        .set({ status: "FAILED", errorMessage: "El video ya no existe en tu cuenta de HeyGen (puede que lo hayan borrado desde la web). Vuelve a generarlo." })
        .where(eq(schema.cloneVideos.id, id))
        .returning();
      return updated ?? row;
    }
    if (error instanceof HeyGenError) console.error("[clon] consulta:", error.detail);
    return row;
  }

  const status = statusMap[video.status] ?? row.status;
  if (status === "COMPLETED") {
    if (row.status === "COMPLETED" && (row.filesStored || !blobConfigured())) return row;
    // Candado propio de la copia (más largo que el timeout de descarga de 240 s). Atómico: si otro proceso
    // (webhook, polling o cron) ya está copiando, este no copia de nuevo y no deja archivos huérfanos.
    if (blobConfigured()) {
      const [lock] = await db
        .update(schema.cloneVideos)
        .set({ copyingUntil: sql`now() + interval '330 seconds'`, lastCheckedAt: sql`now() + interval '330 seconds'` })
        .where(and(eq(schema.cloneVideos.id, id), or(isNull(schema.cloneVideos.copyingUntil), sql`${schema.cloneVideos.copyingUntil} < now()`)))
        .returning({ id: schema.cloneVideos.id });
      if (!lock) return row;
    }
    const files = await storeFiles(row, video);
    const [updated] = await db
      .update(schema.cloneVideos)
      .set({
        status: "COMPLETED",
        errorMessage: null,
        ...files,
        durationSeconds: video.duration ?? row.durationSeconds,
        completedAt: row.completedAt ?? (video.completed_at ? new Date(video.completed_at * 1000) : new Date()),
        lastCheckedAt: sql`now()`,
        copyingUntil: null,
      })
      .where(eq(schema.cloneVideos.id, id))
      .returning();
    await notify({ key: `clone-video:${id}`, userId: row.createdBy, tone: "success", title: "Tu video con clon está listo", body: `"${row.title}" ya se puede ver y descargar.`, href: `/clon/${id}`, email: true });
    return updated ?? row;
  }
  if (status === "FAILED") {
    const [updated] = await db
      .update(schema.cloneVideos)
      .set({ status: "FAILED", errorMessage: failureMessage(video) })
      .where(eq(schema.cloneVideos.id, id))
      .returning();
    await notify({ key: `clone-video:${id}`, userId: row.createdBy, tone: "error", title: "No pudimos generar tu video con clon", body: failureMessage(video), href: `/clon/${id}`, email: true });
    return updated ?? row;
  }
  if (status !== row.status) {
    const [updated] = await db.update(schema.cloneVideos).set({ status }).where(eq(schema.cloneVideos.id, id)).returning();
    return updated ?? row;
  }
  return row;
}

/**
 * Polling de respaldo: revisa los videos en curso (y los completados cuyos archivos falta copiar).
 * `ids` limita a los que está mirando el usuario. `limit` evita saturar la API de HeyGen.
 */
export async function pollCloneVideos(options: { ids?: string[]; limit?: number; minAgeSec?: number } = {}): Promise<number> {
  const db = getDb();
  const filters = [
    isNotNull(schema.cloneVideos.heygenVideoId),
    or(
      inArray(schema.cloneVideos.status, ["QUEUED", "PROCESSING"]),
      blobConfigured() ? and(eq(schema.cloneVideos.status, "COMPLETED"), eq(schema.cloneVideos.filesStored, false)) : sql`false`,
    ),
  ];
  if (options.ids) {
    if (options.ids.length === 0) return 0;
    filters.push(inArray(schema.cloneVideos.id, options.ids));
  }
  const rows = await db
    .select({ id: schema.cloneVideos.id })
    .from(schema.cloneVideos)
    .where(and(...filters))
    .orderBy(sql`${schema.cloneVideos.lastCheckedAt} asc nulls first`, asc(schema.cloneVideos.createdAt))
    .limit(options.limit ?? 5);
  let checked = 0;
  for (const { id } of rows) {
    if (await refreshCloneVideo(id, { minAgeSec: options.minAgeSec })) checked++;
  }
  return checked;
}

/**
 * Para el cron: revisa los pendientes y da por fallidos los que nunca llegaron a HeyGen
 * (se cortó la función entre guardar la fila y enviar el pedido).
 */
export async function sweepCloneVideos(): Promise<{ checked: number; abandoned: number }> {
  const db = getDb();
  const abandoned = await db
    .update(schema.cloneVideos)
    .set({ status: "FAILED", errorMessage: "El pedido no llegó a HeyGen. No se cobró nada: vuelve a intentarlo." })
    .where(and(eq(schema.cloneVideos.status, "QUEUED"), sql`${schema.cloneVideos.heygenVideoId} is null`, lt(schema.cloneVideos.createdAt, new Date(Date.now() - 15 * 60_000))))
    .returning({ id: schema.cloneVideos.id });
  if (!(await getCredentialRow())) return { checked: 0, abandoned: abandoned.length };
  const checked = await pollCloneVideos({ limit: 20, minAgeSec: 60 });
  return { checked, abandoned: abandoned.length };
}

/** URL vigente de un archivo que sigue solo en HeyGen (las firmadas vencen; HeyGen da una nueva en cada consulta). */
export async function freshHeyGenFileUrl(row: CloneVideoRow, kind: "video" | "srt" | "miniatura"): Promise<string | null> {
  if (!row.heygenVideoId) return null;
  const conn = await loadHeyGen();
  if (!conn) return null;
  const video = await conn.client.getVideo(row.heygenVideoId);
  if (kind === "srt") return video.subtitle_url ?? null;
  if (kind === "miniatura") return video.thumbnail_url ?? null;
  return (row.captions ? video.captioned_video_url : null) ?? video.video_url ?? null;
}

/** Busca la fila de un evento de webhook por id de HeyGen o por nuestro callback_id. */
export async function findVideoForEvent(heygenVideoId: string | null, callbackId: string | null): Promise<CloneVideoRow | null> {
  const conditions = [];
  if (heygenVideoId) conditions.push(eq(schema.cloneVideos.heygenVideoId, heygenVideoId));
  if (callbackId && /^[0-9a-f-]{36}$/i.test(callbackId)) conditions.push(eq(schema.cloneVideos.id, callbackId));
  if (conditions.length === 0) return null;
  const [row] = await getDb().select().from(schema.cloneVideos).where(or(...conditions)).limit(1);
  return row ?? null;
}
