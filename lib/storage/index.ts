import "server-only";
import { put } from "@vercel/blob";
import { env } from "@/lib/env";

/**
 * Almacenamiento de archivos. Hoy usa Vercel Blob; los módulos solo usan estas funciones,
 * así se puede cambiar de proveedor (por ejemplo, a R2) sin tocarlos.
 *
 * - Este archivo: imágenes públicas (copias de miniaturas de las redes) en el store público.
 * - `./files`: archivos privados (videos del Editor) en un store privado, con URLs firmadas,
 *   o en disco local en desarrollo.
 */
export {
  AUDIO_EXTENSIONS,
  AUDIO_TYPES,
  deleteKeys,
  deletePrefix,
  fileDriver,
  fileInfo,
  MAX_VIDEO_BYTES,
  readBytes,
  readUrl,
  VIDEO_EXTENSIONS,
  VIDEO_TYPES,
  workerTransfer,
  type FileDriver,
  type Transfer,
} from "./files";

export function storageConfigured(): boolean {
  return Boolean(env().BLOB_READ_WRITE_TOKEN);
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Descarga una imagen pública (por ejemplo, la miniatura de una red, que vence) y guarda una copia propia.
 * Las miniaturas ya son públicas en la red, así que la copia es pública con un nombre imposible de adivinar.
 * Devuelve la URL nueva, o null si no hay almacenamiento configurado o la imagen no se pudo bajar.
 */
export async function copyRemoteImage(sourceUrl: string, pathPrefix: string): Promise<string | null> {
  if (!storageConfigured()) return null;
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!IMAGE_TYPES.has(type)) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
    const blob = await put(`${pathPrefix}.${ext}`, bytes, {
      access: "public",
      contentType: type,
      addRandomSuffix: true,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
      token: env().BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch {
    return null;
  }
}
