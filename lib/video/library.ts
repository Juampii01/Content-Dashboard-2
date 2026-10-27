import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { deletePrefix, fileDriver, fileInfo, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";

/**
 * Biblioteca de b-roll del cliente: clips propios que sube una vez (subida directa al almacenamiento privado)
 * y el editor reutiliza. El worker genera la miniatura y lee duración y tamaño (VIDEO_CLIP).
 * Ciclo: UPLOADING → PROCESSING (worker) → READY o FAILED.
 */
export class LibraryError extends Error {}

export const MAX_CLIP_BYTES = 2 * 1024 ** 3;
const prefix = (id: string) => `editor/biblioteca/${id}/`;

export async function loadClip(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.brollClips).where(eq(schema.brollClips.id, id)).limit(1);
  return row ?? null;
}

/** Etiquetas limpias: minúsculas, sin repetir, hasta 12 de 30 caracteres. */
export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30)).filter((t) => t.length >= 2))].slice(0, 12);
}

/** Etiquetas sugeridas a partir del nombre del archivo ("cliente-llamando_telefono.mp4" → cliente, llamando, telefono). */
export function tagsFromFileName(name: string): string[] {
  return cleanTags(
    name
      .replace(/\.[^.]+$/, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^(img|vid|mov|dsc|pxl)$/i.test(w)),
  ).slice(0, 5);
}

export async function createClipUpload(input: { fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new LibraryError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = VIDEO_TYPES[input.fileType.toLowerCase()] ?? input.fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]?.slice(1);
  if (!ext || !VIDEO_EXTENSIONS.includes(`.${ext}`)) throw new LibraryError("Ese formato no es compatible. Sube clips MP4, MOV, WEBM o MKV.");
  if (input.fileSize <= 0) throw new LibraryError("El archivo está vacío.");
  if (input.fileSize > MAX_CLIP_BYTES) throw new LibraryError("El clip pesa más de 2 GB. Para b-roll alcanza con clips cortos.");
  const id = randomUUID();
  const key = `${prefix(id)}clip.${ext}`;
  const title = input.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Clip sin nombre";
  await getDb().insert(schema.brollClips).values({
    id,
    title,
    tags: tagsFromFileName(input.fileName),
    status: "UPLOADING",
    fileKey: key,
    fileName: input.fileName.slice(0, 200),
    fileBytes: input.fileSize,
    createdBy: input.userId,
  });
  return { id, key };
}

export async function completeClipUpload(id: string, userId: string): Promise<void> {
  const clip = await loadClip(id);
  if (!clip) throw new LibraryError("No encontramos ese clip.");
  if (clip.status !== "UPLOADING") return;
  const info = await fileInfo(clip.fileKey);
  if (!info || info.size === 0) throw new LibraryError("La subida no terminó. Vuelve a elegir el archivo.");
  if (clip.fileBytes && info.size !== clip.fileBytes) throw new LibraryError("El archivo llegó incompleto. Vuelve a subirlo.");
  await getDb().update(schema.brollClips).set({ status: "PROCESSING", errorMessage: null }).where(and(eq(schema.brollClips.id, id), eq(schema.brollClips.status, "UPLOADING")));
  await enqueueJob({ type: "VIDEO_CLIP", createdBy: userId, stage: "En cola", maxAttempts: 3, input: { clipId: id } });
}

export async function updateClip(id: string, data: { title?: string; tags?: string[] }): Promise<void> {
  const next: { title?: string; tags?: string[] } = {};
  if (data.title != null) next.title = data.title.trim().slice(0, 120) || "Clip sin nombre";
  if (data.tags) next.tags = cleanTags(data.tags);
  await getDb().update(schema.brollClips).set(next).where(eq(schema.brollClips.id, id));
}

export async function deleteClip(id: string): Promise<void> {
  const clip = await loadClip(id);
  if (!clip) return;
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "VIDEO_CLIP"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'clipId' = ${id}`));
  await deletePrefix(prefix(id)).catch((e) => console.error("[biblioteca] no se borraron los archivos:", e instanceof Error ? e.message : e));
  await getDb().delete(schema.brollClips).where(eq(schema.brollClips.id, id));
}

export async function retryClip(id: string, userId: string): Promise<void> {
  const clip = await loadClip(id);
  if (!clip || clip.status !== "FAILED") return;
  await getDb().update(schema.brollClips).set({ status: "PROCESSING", errorMessage: null }).where(eq(schema.brollClips.id, id));
  await enqueueJob({ type: "VIDEO_CLIP", createdBy: userId, stage: "En cola", maxAttempts: 3, input: { clipId: id } });
}
