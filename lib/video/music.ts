import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { AUDIO_EXTENSIONS, AUDIO_TYPES, deletePrefix, fileDriver, fileInfo } from "@/lib/storage";

/**
 * Música de fondo del cliente (Biblioteca → Música): pistas propias que sube una vez y elige en la revisión.
 * La app no trae música de terceros (las licencias son del cliente). La subida va directo al almacenamiento
 * privado; al terminar queda lista (READY). El worker la valida y la mezcla bajo la voz al renderizar.
 */
export class MusicError extends Error {}

export const MAX_TRACK_BYTES = 200 * 1024 ** 2;
export const MAX_TRACK_SECONDS = 30 * 60;
const prefix = (id: string) => `editor/musica/${id}/`;

export async function loadTrack(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.musicTracks).where(eq(schema.musicTracks.id, id)).limit(1);
  return row ?? null;
}

/** Extensión de una pista por su tipo o su nombre, o null si no es un formato aceptado. */
export function audioExtension(fileType: string, fileName: string): string | null {
  const ext = AUDIO_TYPES[fileType.toLowerCase()] ?? fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]?.slice(1);
  return ext && AUDIO_EXTENSIONS.includes(`.${ext}`) ? ext : null;
}

export async function createTrackUpload(input: { fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string }> {
  if (!fileDriver()) throw new MusicError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const ext = audioExtension(input.fileType, input.fileName);
  if (!ext) throw new MusicError("Ese formato no es compatible. Sube pistas MP3, M4A, WAV, AAC, OGG o FLAC.");
  if (input.fileSize <= 0) throw new MusicError("El archivo está vacío.");
  if (input.fileSize > MAX_TRACK_BYTES) throw new MusicError("La pista pesa más de 200 MB. Sube una versión MP3 o M4A.");
  const id = randomUUID();
  const key = `${prefix(id)}pista.${ext}`;
  const title = input.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Pista sin nombre";
  await getDb().insert(schema.musicTracks).values({ id, title, status: "UPLOADING", fileKey: key, fileName: input.fileName.slice(0, 200), fileBytes: input.fileSize, createdBy: input.userId });
  return { id, key };
}

/** La subida terminó: se verifica el archivo y queda lista. `duration` la mide el navegador (solo para mostrarla). */
export async function completeTrackUpload(id: string, duration: number | null): Promise<void> {
  const track = await loadTrack(id);
  if (!track) throw new MusicError("No encontramos esa pista.");
  if (track.status !== "UPLOADING") return;
  const info = await fileInfo(track.fileKey);
  if (!info || info.size === 0) throw new MusicError("La subida no terminó. Vuelve a elegir el archivo.");
  if (track.fileBytes && info.size !== track.fileBytes) throw new MusicError("El archivo llegó incompleto. Vuelve a subirlo.");
  const seconds = duration != null && Number.isFinite(duration) && duration > 0 ? Math.min(duration, MAX_TRACK_SECONDS) : null;
  await getDb().update(schema.musicTracks).set({ status: "READY", duration: seconds }).where(eq(schema.musicTracks.id, id));
}

export async function renameTrack(id: string, title: string): Promise<void> {
  await getDb()
    .update(schema.musicTracks)
    .set({ title: title.trim().slice(0, 120) || "Pista sin nombre" })
    .where(eq(schema.musicTracks.id, id));
}

export async function deleteTrack(id: string): Promise<void> {
  const track = await loadTrack(id);
  if (!track) return;
  await deletePrefix(prefix(id)).catch((e) => console.error("[musica] no se borraron los archivos:", e instanceof Error ? e.message : e));
  await getDb().delete(schema.musicTracks).where(eq(schema.musicTracks.id, id));
}
