import "server-only";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { copy, get, put } from "@vercel/blob";
import { env } from "@/lib/env";
import { deleteKeys, deletePrefix, fileDriver } from "@/lib/storage";
import { assertKey, localPath, serveLocal, writeLocal } from "@/lib/storage/files";

/**
 * Archivos de Carruseles en el almacenamiento **privado** (el mismo store que los videos del Editor):
 * - `carruseles/<carrusel>/<slide>-<azar>.<ext>`: imágenes de los slides (subidas por el cliente o generadas con IA).
 * - `carruseles/<carrusel>/anim/<slide>-<azar>.<jpg|mp4>`: el slide dibujado (lo sube el navegador) y su video animado.
 * - `carruseles-ref/<plantilla o copia>/<nn>.<ext>`: imágenes de un carrusel de referencia (o del carrusel que se copia),
 *   solo mientras se analiza; se borran al terminar (nunca se muestran ni se mandan al generador de imágenes).
 * El navegador las lee siempre por `/api/carruseles/archivos/<clave>` (mismo origen y con sesión): así la exportación
 * a JPG puede dibujarlas y nadie sin sesión llega a ellas.
 */
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const UUID = "[0-9a-f-]{36}";
export const SLIDE_KEY_RE = new RegExp(`^carruseles/${UUID}/[a-z0-9]{1,40}-[0-9a-f]{8}\\.(jpg|png|webp)$`, "i");
export const REF_KEY_RE = new RegExp(`^carruseles-ref/${UUID}/\\d{2}\\.(jpg|png|webp)$`, "i");
export const ANIM_KEY_RE = new RegExp(`^carruseles/${UUID}/anim/[a-z0-9]{1,40}-[0-9a-f]{8}\\.(jpg|mp4)$`, "i");
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

export function carouselFilesReady(): boolean {
  return fileDriver() !== null;
}

/** Tipo real del archivo por sus primeros bytes (no se confía en lo que dice el navegador). */
export function sniffImage(bytes: Uint8Array): keyof typeof IMAGE_TYPES | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function fileUrl(key: string): string {
  return `/api/carruseles/archivos/${assertKey(key)}`;
}

/** Clave a partir de la URL guardada en un slide (`/api/carruseles/archivos/<clave>`), o null si no es nuestra. */
export function keyFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^\/api\/carruseles\/archivos\/(carruseles\/[^?#]+)/);
  return m && SLIDE_KEY_RE.test(m[1]!) ? m[1]! : null;
}

/** Clave del video (o del slide dibujado) de un slide animado, a partir de su URL. */
export function animKeyFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^\/api\/carruseles\/archivos\/(carruseles\/[^?#]+)/);
  return m && ANIM_KEY_RE.test(m[1]!) ? m[1]! : null;
}

/** Se puede servir al navegador (con sesión): imágenes de slides y videos animados. Las referencias, nunca. */
export function servableKey(key: string): boolean {
  return SLIDE_KEY_RE.test(key) || ANIM_KEY_RE.test(key);
}

export async function putFile(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  assertKey(key);
  if (fileDriver() === "blob") {
    await put(key, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, token: env().VIDEO_BLOB_READ_WRITE_TOKEN });
    return;
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  await writeLocal(key, body, MAX_IMAGE_BYTES);
}

/** Respuesta con el archivo para el navegador (con caché privada: los nombres no se reutilizan). */
export async function serveFile(key: string, request: Request): Promise<Response> {
  assertKey(key);
  if (fileDriver() === "blob") {
    const result = await get(key, { access: "private", token: env().VIDEO_BLOB_READ_WRITE_TOKEN }).catch(() => null);
    if (!result?.stream) return new Response("No encontrado", { status: 404 });
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const res = await serveLocal(key, request);
  if (res.ok) res.headers.set("Cache-Control", "private, max-age=86400, immutable");
  return res;
}

/**
 * Copia las imágenes de los slides a la carpeta de otro carrusel (al duplicar): así borrar el original no deja a la
 * copia sin imágenes. Devuelve los slides con sus URLs nuevas; si una copia falla, ese slide queda sin imagen.
 */
export async function copySlideImages<T extends { id: string; imageUrl?: string | null }>(slides: T[], toCarouselId: string): Promise<T[]> {
  const out: T[] = [];
  for (const s of slides) {
    const from = keyFromUrl(s.imageUrl);
    if (!from) {
      out.push(s);
      continue;
    }
    const to = `carruseles/${toCarouselId}/${from.split("/")[2]}`;
    try {
      if (fileDriver() === "blob") {
        await copy(from, to, { access: "private", addRandomSuffix: false, allowOverwrite: true, token: env().VIDEO_BLOB_READ_WRITE_TOKEN });
      } else {
        await mkdir(path.dirname(localPath(to)), { recursive: true });
        await copyFile(localPath(from), localPath(to));
      }
      out.push({ ...s, imageUrl: fileUrl(to) });
    } catch (error) {
      console.error("[carruseles] copiar imagen:", error instanceof Error ? error.message : "error");
      out.push({ ...s, imageUrl: null });
    }
  }
  return out;
}

export async function deleteFiles(keys: string[]): Promise<void> {
  const valid = keys.filter((k) => SLIDE_KEY_RE.test(k) || REF_KEY_RE.test(k) || ANIM_KEY_RE.test(k));
  if (valid.length) await deleteKeys(valid).catch((e) => console.error("[carruseles] borrar archivos:", e instanceof Error ? e.message : "error"));
}

export async function deleteCarouselFolder(carouselId: string): Promise<void> {
  await deletePrefix(`carruseles/${carouselId}/`).catch((e) => console.error("[carruseles] borrar carpeta:", e instanceof Error ? e.message : "error"));
}

export async function deleteReferences(templateId: string): Promise<void> {
  await deletePrefix(`carruseles-ref/${templateId}/`).catch((e) => console.error("[carruseles] borrar referencias:", e instanceof Error ? e.message : "error"));
}
