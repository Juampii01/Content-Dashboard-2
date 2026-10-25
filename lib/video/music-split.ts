import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { AUDIO_EXTENSIONS, AUDIO_TYPES, deleteKeys, fileDriver, fileInfo, VIDEO_EXTENSIONS, VIDEO_TYPES } from "@/lib/storage";
import { loadTrack, MusicError } from "./music";
import { parseReferenceLink } from "./styles";

/**
 * "Sacar la música de un reel" (Biblioteca → Música): la persona pega un link de Instagram, TikTok o YouTube, o sube un
 * video o audio; el worker (AUDIO_SPLIT) lo baja, separa la voz del resto con HT-Demucs y guarda la música con los
 * efectos, sin la voz, como una pista más de su biblioteca. El archivo subido se borra al terminar.
 *
 * Ciclo de la pista: UPLOADING (solo si se sube) → PROCESSING (worker) → READY o FAILED (con `errorMessage`).
 */

/** Reels, TikToks, shorts y canciones: hasta 10 minutos de audio. */
export const MAX_SPLIT_SECONDS = 10 * 60;
export const MAX_SPLIT_BYTES = 1024 ** 3;
const prefix = (id: string) => `editor/musica/${id}/`;
const resultKey = (id: string) => `${prefix(id)}pista.m4a`;

export const SPLIT_TYPES: Record<string, string> = { ...VIDEO_TYPES, ...AUDIO_TYPES };
const SPLIT_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

function titleFrom(name: string): string {
  const clean = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean.slice(0, 100) || "Música"} (sin voz)`;
}

async function enqueueSplit(id: string, source: Record<string, unknown>, userId: string | null) {
  await enqueueJob({ type: "AUDIO_SPLIT", createdBy: userId, stage: "En cola", maxAttempts: 2, input: { trackId: id, ...source } });
}

/** Desde un link: la pista queda en proceso y el worker baja el video. */
export async function createSplitFromLink(input: { link: string; userId: string }): Promise<string> {
  const parsed = parseReferenceLink(input.link);
  if (!parsed) throw new MusicError("Pega un link de Instagram, TikTok o YouTube (empieza con https://).");
  const id = randomUUID();
  await getDb()
    .insert(schema.musicTracks)
    .values({ id, title: `Música de un video de ${parsed.platform} (sin voz)`, status: "PROCESSING", source: "separada", fileKey: resultKey(id), sourceUrl: parsed.url, createdBy: input.userId });
  await enqueueSplit(id, { sourceKind: "link", url: parsed.url }, input.userId);
  return id;
}

/** Desde un archivo: reserva la pista y la ruta; el archivo va directo del navegador al almacenamiento. */
export async function createSplitUpload(input: { fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new MusicError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = SPLIT_TYPES[input.fileType.toLowerCase()] ?? input.fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]?.slice(1);
  if (!ext || !SPLIT_EXTENSIONS.includes(`.${ext}`)) throw new MusicError("Ese formato no es compatible. Sube un video (MP4, MOV, WEBM) o un audio (MP3, M4A, WAV).");
  if (input.fileSize <= 0) throw new MusicError("El archivo está vacío.");
  if (input.fileSize > MAX_SPLIT_BYTES) throw new MusicError("El archivo pesa más de 1 GB. Con un reel o una canción alcanza.");
  const id = randomUUID();
  const key = `${prefix(id)}original.${ext}`;
  await getDb()
    .insert(schema.musicTracks)
    .values({ id, title: titleFrom(input.fileName), status: "UPLOADING", source: "separada", fileKey: resultKey(id), fileName: input.fileName.slice(0, 200), fileBytes: input.fileSize, sourceKey: key, createdBy: input.userId });
  return { id, key };
}

/** La subida terminó: se verifica el archivo y se encola la separación. */
export async function completeSplitUpload(id: string, userId: string): Promise<void> {
  const track = await loadTrack(id);
  if (!track || track.source !== "separada") throw new MusicError("No encontramos esa pista.");
  if (track.status !== "UPLOADING" || !track.sourceKey) return;
  const info = await fileInfo(track.sourceKey);
  if (!info || info.size === 0) throw new MusicError("La subida no terminó. Vuelve a elegir el archivo.");
  if (track.fileBytes && info.size !== track.fileBytes) throw new MusicError("El archivo llegó incompleto. Vuelve a subirlo.");
  await getDb()
    .update(schema.musicTracks)
    .set({ status: "PROCESSING", errorMessage: null })
    .where(and(eq(schema.musicTracks.id, id), eq(schema.musicTracks.status, "UPLOADING")));
  await enqueueSplit(id, { sourceKind: "upload", sourceKey: track.sourceKey }, userId);
}

/** Vuelve a intentar una separación que falló (si era un link o el archivo sigue guardado). */
export async function retrySplit(id: string, userId: string): Promise<void> {
  const track = await loadTrack(id);
  if (!track || track.source !== "separada" || track.status !== "FAILED") return;
  if (track.sourceUrl) {
    await getDb().update(schema.musicTracks).set({ status: "PROCESSING", errorMessage: null }).where(eq(schema.musicTracks.id, id));
    await enqueueSplit(id, { sourceKind: "link", url: track.sourceUrl }, userId);
    return;
  }
  if (track.sourceKey && (await fileInfo(track.sourceKey))) {
    await getDb().update(schema.musicTracks).set({ status: "PROCESSING", errorMessage: null }).where(eq(schema.musicTracks.id, id));
    await enqueueSplit(id, { sourceKind: "upload", sourceKey: track.sourceKey }, userId);
    return;
  }
  throw new MusicError("El archivo ya no está guardado. Vuelve a subirlo.");
}

/** Lo llama el worker al terminar: la pista queda lista y se borra el archivo subido. */
export async function saveSplitResult(id: string, payload: { duration: number; bytes: number }): Promise<{ status: string }> {
  const track = await loadTrack(id);
  if (!track || track.source !== "separada") throw new MusicError("Esa pista ya no existe.");
  if (track.status === "READY") return { status: "READY" };
  const info = await fileInfo(track.fileKey);
  if (!info || info.size === 0) throw new MusicError("La pista separada no llegó al almacenamiento.");
  const duration = Number.isFinite(payload.duration) && payload.duration > 0 ? Math.min(payload.duration, MAX_SPLIT_SECONDS) : null;
  await getDb()
    .update(schema.musicTracks)
    .set({ status: "READY", duration, fileBytes: info.size, sourceKey: null, errorMessage: null })
    .where(eq(schema.musicTracks.id, id));
  if (track.sourceKey) await deleteKeys([track.sourceKey]).catch((e) => console.error("[musica] no se borró el archivo subido:", e instanceof Error ? e.message : e));
  return { status: "READY" };
}
