import "server-only";
import { get, put } from "@vercel/blob";
import { env } from "@/lib/env";

/**
 * Copia de archivos remotos (por ejemplo, los videos de HeyGen, cuyas URLs vencen) a nuestro almacenamiento.
 * Los archivos quedan **privados** en Vercel Blob: solo se leen desde el servidor con `openStoredFile`,
 * detrás de una ruta que comprueba la sesión. Así un video del cliente nunca queda en una URL pública.
 */

export function blobConfigured(): boolean {
  return Boolean(env().BLOB_READ_WRITE_TOKEN);
}

/** true si la URL es de nuestro Vercel Blob (y no, por ejemplo, de HeyGen). */
export function isStoredUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export class CopyError extends Error {}

/**
 * Descarga en streaming `sourceUrl` y la guarda en Blob como `<pathname>-<sufijo aleatorio>.<ext>`.
 * No carga el archivo entero en memoria. Valida el tipo y el tamaño declarados.
 * Devuelve la URL privada nueva, o null si no hay almacenamiento configurado.
 */
export async function copyRemoteFile(
  sourceUrl: string,
  pathname: string,
  options: { allowedTypes: string[]; maxBytes: number; fallbackType: string; timeoutMs?: number },
): Promise<{ url: string; contentType: string; bytes: number | null } | null> {
  if (!blobConfigured()) return null;
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(options.timeoutMs ?? 240_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new CopyError(`descarga ${res.status}`);

  const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  // Algunos servidores mandan application/octet-stream: en ese caso vale el tipo esperado.
  const contentType = options.allowedTypes.includes(declared) ? declared : options.fallbackType;
  if (declared && declared !== "application/octet-stream" && declared !== "binary/octet-stream" && !options.allowedTypes.includes(declared)) {
    throw new CopyError(`tipo no permitido: ${declared}`);
  }
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > options.maxBytes) throw new CopyError(`archivo demasiado grande: ${length}`);

  const blob = await put(pathname, res.body, {
    access: "private",
    contentType,
    addRandomSuffix: true,
    multipart: true,
    token: env().BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url, contentType, bytes: Number.isFinite(length) ? length : null };
}

/**
 * Abre un archivo privado de Blob para mandarlo al navegador. Admite `Range` (para adelantar el video).
 * Devuelve null si no existe.
 */
export async function openStoredFile(url: string, range?: string | null): Promise<Response | null> {
  const result = await get(url, {
    access: "private",
    token: env().BLOB_READ_WRITE_TOKEN,
    headers: range ? { range } : undefined,
  });
  if (!result || !result.stream) return null;
  const headers = new Headers();
  headers.set("Content-Type", result.blob.contentType ?? "application/octet-stream");
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = result.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept-ranges")) headers.set("Accept-Ranges", "bytes");
  const status = headers.has("content-range") ? 206 : 200;
  return new Response(result.stream, { status, headers });
}

