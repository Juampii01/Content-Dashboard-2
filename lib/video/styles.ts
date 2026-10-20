import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getBrand } from "@/lib/ai/brand-context";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { deleteKeys, deletePrefix, fileDriver, fileInfo, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";
import { presetFromMetrics, stylePresetSchema, styleMetricsSchema, type StylePreset } from "./style";

/**
 * Estilos de "Edita como este": la persona sube un video de referencia o pega un link; el worker lo analiza
 * (VIDEO_STYLE) y entrega lo medido; aquí se arma y valida el preset. La referencia se borra al terminar:
 * se guarda el estilo, nunca el contenido.
 *
 * Ciclo: UPLOADING (solo si se sube) → ANALYZING (worker) → READY o FAILED.
 */
export class StyleError extends Error {}

export const MAX_REFERENCE_BYTES = 1024 ** 3; // 1 GB: una referencia es un reel o un video corto

const prefix = (id: string) => `editor/estilos/${id}/`;

/** Links que el worker sabe bajar (con yt-dlp). */
export function parseReferenceLink(raw: string): { url: string; platform: "Instagram" | "TikTok" | "YouTube" } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const platform = host === "instagram.com" || host.endsWith(".instagram.com") ? "Instagram" : host === "tiktok.com" || host.endsWith(".tiktok.com") ? "TikTok" : host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com") ? "YouTube" : null;
  if (!platform) return null;
  url.hash = "";
  return { url: url.toString(), platform };
}

async function language(): Promise<string> {
  const brand = await getBrand();
  return brand?.language?.startsWith("en") ? "en" : "es";
}

export async function loadStyle(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.videoStyles).where(eq(schema.videoStyles.id, id)).limit(1);
  return row ?? null;
}

/** Reserva el estilo y la ruta de la referencia; el archivo va directo del navegador al almacenamiento. */
export async function createStyleUpload(input: { name: string; fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new StyleError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = VIDEO_TYPES[input.fileType.toLowerCase()] ?? input.fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]?.slice(1);
  if (!ext || !VIDEO_EXTENSIONS.includes(`.${ext}`)) throw new StyleError("Ese formato no es compatible. Sube un video MP4, MOV, WEBM o MKV.");
  if (input.fileSize <= 0) throw new StyleError("El archivo está vacío.");
  if (input.fileSize > MAX_REFERENCE_BYTES) throw new StyleError("El video de referencia pesa más de 1 GB. Usa uno más corto: con un reel alcanza.");
  const id = randomUUID();
  const key = `${prefix(id)}referencia.${ext}`;
  await getDb().insert(schema.videoStyles).values({
    id,
    name: input.name,
    status: "UPLOADING",
    sourceKind: "upload",
    sourceKey: key,
    sourceName: input.fileName.slice(0, 200),
    sourceBytes: input.fileSize,
    createdBy: input.userId,
  });
  return { id, key };
}

/** La subida terminó: se verifica el archivo y se encola el análisis. */
export async function completeStyleUpload(id: string, userId: string): Promise<void> {
  const style = await loadStyle(id);
  if (!style) throw new StyleError("No encontramos ese estilo.");
  if (style.status !== "UPLOADING" || !style.sourceKey) return;
  const info = await fileInfo(style.sourceKey);
  if (!info || info.size === 0) throw new StyleError("La subida no terminó. Vuelve a elegir el archivo.");
  if (style.sourceBytes && info.size !== style.sourceBytes) throw new StyleError("El archivo llegó incompleto. Vuelve a subirlo.");
  await getDb().update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(and(eq(schema.videoStyles.id, id), eq(schema.videoStyles.status, "UPLOADING")));
  await enqueueStyle(id, { sourceKind: "upload", sourceKey: style.sourceKey }, userId);
}

export async function createStyleFromLink(input: { name: string; link: string; userId: string }): Promise<string> {
  const parsed = parseReferenceLink(input.link);
  if (!parsed) throw new StyleError("Pega un link de Instagram, TikTok o YouTube (empieza con https://).");
  const id = randomUUID();
  await getDb().insert(schema.videoStyles).values({ id, name: input.name, status: "ANALYZING", sourceKind: "link", sourceUrl: parsed.url, sourceName: parsed.platform, createdBy: input.userId });
  await enqueueStyle(id, { sourceKind: "link", url: parsed.url }, input.userId);
  return id;
}

async function enqueueStyle(id: string, source: Record<string, unknown>, userId: string | null) {
  await enqueueJob({ type: "VIDEO_STYLE", createdBy: userId, stage: "En cola", maxAttempts: 2, input: { styleId: id, ...source, language: await language() } });
}

/** Lo llama el worker al terminar: valida lo medido, arma el preset y borra la referencia subida. */
export async function saveStyleResult(id: string, payload: { metrics: unknown; thumbKey: string | null }): Promise<{ status: string }> {
  const style = await loadStyle(id);
  if (!style) throw new StyleError("Ese estilo ya no existe.");
  if (style.status === "READY") return { status: "READY" };
  const metrics = styleMetricsSchema.safeParse(payload.metrics);
  if (!metrics.success) {
    console.error("[estilos] métricas no válidas:", metrics.error.issues[0]?.path.join("."), metrics.error.issues[0]?.message);
    throw new StyleError("El análisis del video llegó incompleto.");
  }
  const preset = stylePresetSchema.parse(presetFromMetrics(metrics.data));
  const thumbKey = payload.thumbKey && payload.thumbKey.startsWith(prefix(id)) ? payload.thumbKey : null;
  await getDb()
    .update(schema.videoStyles)
    .set({ status: "READY", metrics: metrics.data, preset, thumbKey, sourceKey: null, errorMessage: null })
    .where(eq(schema.videoStyles.id, id));
  // La referencia subida no se guarda: se copia el estilo, nunca el contenido.
  if (style.sourceKey) await deleteKeys([style.sourceKey]).catch((e) => console.error("[estilos] no se borró la referencia:", e instanceof Error ? e.message : e));
  return { status: "READY" };
}

export async function renameStyle(id: string, name: string): Promise<void> {
  await getDb().update(schema.videoStyles).set({ name }).where(eq(schema.videoStyles.id, id));
}

/** Vuelve a analizar un estilo que falló (solo si la referencia era un link o todavía está subida). */
export async function retryStyle(id: string, userId: string): Promise<void> {
  const style = await loadStyle(id);
  if (!style || style.status !== "FAILED") return;
  if (style.sourceKind === "link" && style.sourceUrl) {
    await getDb().update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.videoStyles.id, id));
    await enqueueStyle(id, { sourceKind: "link", url: style.sourceUrl }, userId);
    return;
  }
  if (style.sourceKey && (await fileInfo(style.sourceKey))) {
    await getDb().update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.videoStyles.id, id));
    await enqueueStyle(id, { sourceKind: "upload", sourceKey: style.sourceKey }, userId);
    return;
  }
  throw new StyleError("La referencia ya no está guardada. Crea el estilo de nuevo subiendo el video.");
}

export async function deleteStyle(id: string): Promise<void> {
  const style = await loadStyle(id);
  if (!style) return;
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "VIDEO_STYLE"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'styleId' = ${id}`));
  await deletePrefix(prefix(id)).catch((e) => console.error("[estilos] no se borraron los archivos:", e instanceof Error ? e.message : e));
  await getDb().delete(schema.videoStyles).where(eq(schema.videoStyles.id, id));
}

/** Preset de un estilo listo (para el plan y el render). null si no existe o no está listo. */
export async function stylePreset(id: string | null | undefined): Promise<{ id: string; name: string; preset: StylePreset; metrics: Record<string, unknown> } | null> {
  if (!id) return null;
  const style = await loadStyle(id);
  if (!style || style.status !== "READY" || !style.preset) return null;
  const parsed = stylePresetSchema.safeParse(style.preset);
  return parsed.success ? { id: style.id, name: style.name, preset: parsed.data, metrics: style.metrics ?? {} } : null;
}
