import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { del, head, issueSignedToken, list, parseStoreIdFromDelegationToken, presignUrl, type IssuedSignedToken } from "@vercel/blob";
import { env } from "@/lib/env";

/**
 * Archivos privados (videos del Editor): originales, proxies y renders.
 *
 * Dos drivers detrás de la misma interfaz:
 * - "blob": Vercel Blob en un store **privado** (VIDEO_BLOB_READ_WRITE_TOKEN). El navegador y el worker
 *   nunca reciben la clave: la app firma URLs de corta duración (Signed URLs) para cada archivo y operación.
 * - "local": disco en `.data/storage/`, solo en desarrollo, servido por rutas protegidas
 *   (`/api/editor/files/…` con sesión y `/api/worker/files/…` con WORKER_SECRET).
 * El worker no conoce el proveedor: pide a la app un "acceso" (método, URL y cabeceras) y hace la petición.
 */
export type FileDriver = "blob" | "local";

export function fileDriver(): FileDriver | null {
  if (env().VIDEO_BLOB_READ_WRITE_TOKEN) return "blob";
  if (env().NODE_ENV !== "production") return "local";
  return null;
}

/** Tipos de video aceptados para el original, con su extensión. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-m4v": "m4v",
};
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
/** Pistas de música (Biblioteca → Música), con su extensión. */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};
export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"];
/** 8 GB: un video 4K de 10 minutos de un teléfono pesa unos 4 GB. */
export const MAX_VIDEO_BYTES = 8 * 1024 ** 3;

const KEY_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_.-]*)+$/i;

/** Las claves las arma la app (`editor/<id>/original.mp4`); nunca vienen libres del usuario. */
export function assertKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes("..") || key.length > 300) throw new Error("Clave de archivo no válida.");
  return key;
}

// ─── Driver local (solo desarrollo) ──────────────────────────────────────

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");

export function localPath(key: string): string {
  const full = path.join(LOCAL_ROOT, assertKey(key));
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Clave de archivo no válida.");
  return full;
}

/** Guarda un cuerpo de petición en disco (escribe en un temporal y lo renombra al terminar). */
export async function writeLocal(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.part-${process.pid}-${Date.now()}`;
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) controller.error(new Error("El archivo supera el tamaño máximo."));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body.pipeThrough(counter) as import("node:stream/web").ReadableStream), createWriteStream(temp));
    await rename(temp, target);
    return bytes;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
  srt: "application/x-subrip",
  jpg: "image/jpeg",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Respuesta con soporte de Range (el reproductor de video lo necesita para saltar). */
export async function serveLocal(key: string, request: Request, options: { download?: string | null } = {}): Promise<Response> {
  let info;
  try {
    info = await stat(localPath(key));
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
  const size = info.size;
  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(key),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (options.download) headers["Content-Disposition"] = `attachment; filename="${options.download.replace(/[^\w.-]+/g, "_")}"`;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(localPath(key), { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(localPath(key))) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

// ─── Driver Vercel Blob (store privado) ──────────────────────────────────

const blobToken = () => env().VIDEO_BLOB_READ_WRITE_TOKEN!;

/** Las delegaciones se reutilizan mientras les quede vida (cada una es una llamada a la API de Blob). */
const tokenCache = new Map<string, IssuedSignedToken>();

async function signedToken(pathname: string, operations: ("get" | "head" | "put" | "delete")[], minValidMs: number, extra?: { allowedContentTypes?: string[]; maximumSizeInBytes?: number }) {
  const cacheKey = `${pathname}|${operations.join(",")}|${extra?.maximumSizeInBytes ?? ""}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.validUntil - Date.now() > minValidMs) return cached;
  const token = await issueSignedToken({
    pathname,
    operations,
    validUntil: Date.now() + Math.max(minValidMs * 2, 2 * 3600_000),
    token: blobToken(),
    ...extra,
  });
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(cacheKey, token);
  return token;
}

/** Delegación para que el navegador suba el original directo a Blob (la usa /api/editor/upload). */
export async function uploadDelegation(pathname: string, kind: "video" | "audio" = "video"): Promise<IssuedSignedToken> {
  return issueSignedToken({
    pathname: assertKey(pathname),
    operations: ["put"],
    allowedContentTypes: Object.keys(kind === "audio" ? AUDIO_TYPES : VIDEO_TYPES),
    maximumSizeInBytes: MAX_VIDEO_BYTES,
    validUntil: Date.now() + 6 * 3600_000,
    token: blobToken(),
  });
}

// ─── Interfaz común ──────────────────────────────────────────────────────

/** URL para que el navegador lea un archivo (reproducir o descargar). Vence en `ttlSec`. */
export async function readUrl(key: string, options: { ttlSec?: number; download?: string } = {}): Promise<string> {
  assertKey(key);
  const ttlMs = (options.ttlSec ?? 90 * 60) * 1000; // corto: alguien que sale del equipo pierde el acceso enseguida
  if (fileDriver() === "blob") {
    const token = await signedToken(key, ["get"], ttlMs);
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil: Date.now() + ttlMs });
    // `download=1` no forma parte de la firma: le pide al CDN que mande el archivo como descarga.
    return options.download ? `${presignedUrl}&download=1` : presignedUrl;
  }
  const qs = options.download ? `?download=${encodeURIComponent(options.download)}` : "";
  return `/api/editor/files/${key}${qs}`;
}

export type Transfer = { method: "GET" | "PUT"; url: string; headers: Record<string, string> };

/** Acceso de corta duración para el worker: bajar o subir un archivo sin conocer el proveedor. */
export async function workerTransfer(key: string, op: "get" | "put", contentType?: string): Promise<Transfer> {
  assertKey(key);
  if (fileDriver() === "blob") {
    if (op === "get") {
      const token = await signedToken(key, ["get"], 3 * 3600_000);
      const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", useCache: false, validUntil: Date.now() + 3 * 3600_000 });
      return { method: "GET", url: presignedUrl, headers: {} };
    }
    const type = contentType ?? contentTypeFor(key);
    const token = await signedToken(key, ["put"], 3600_000);
    const { presignedUrl } = await presignUrl(token, { operation: "put", pathname: key, access: "private", allowOverwrite: true, addRandomSuffix: false, validUntil: Date.now() + 3600_000 });
    // Las mismas cabeceras que manda el SDK de Blob en un PUT firmado (la firma va en la URL).
    const delegation = new URL(presignedUrl).searchParams.get("vercel-blob-delegation") ?? "";
    return {
      method: "PUT",
      url: presignedUrl,
      headers: {
        "content-type": type,
        "x-content-type": type,
        "x-vercel-blob-access": "private",
        "x-allow-overwrite": "1",
        "x-add-random-suffix": "0",
        "x-api-version": "13",
        ...(delegation ? { "x-vercel-blob-store-id": parseStoreIdFromDelegationToken(delegation) } : {}),
      },
    };
  }
  const secret = env().WORKER_SECRET;
  if (!secret) throw new Error("Falta WORKER_SECRET.");
  return {
    method: op === "get" ? "GET" : "PUT",
    url: `${env().NEXT_PUBLIC_APP_URL}/api/worker/files/${key}`,
    headers: { authorization: `Bearer ${secret}`, ...(op === "put" ? { "content-type": contentType ?? contentTypeFor(key) } : {}) },
  };
}

/**
 * Lee un archivo chico entero (por ejemplo, las hojas de contacto del director de edición, ~200 KB). Para videos no:
 * esos se leen con URLs firmadas. Tope de 12 MB.
 */
export async function readBytes(key: string, maxBytes = 12 * 1024 * 1024): Promise<Buffer> {
  assertKey(key);
  if (fileDriver() === "blob") {
    const access = await workerTransfer(key, "get");
    const res = await fetch(access.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`lectura ${key}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error(`lectura ${key}: demasiado grande`);
    return buf;
  }
  const info = await stat(localPath(key));
  if (info.size > maxBytes) throw new Error(`lectura ${key}: demasiado grande`);
  return readFile(localPath(key));
}

/** Tamaño de un archivo, o null si no existe. */
export async function fileInfo(key: string): Promise<{ size: number } | null> {
  assertKey(key);
  if (fileDriver() === "blob") {
    try {
      const info = await head(key, { token: blobToken() });
      return { size: info.size };
    } catch {
      return null;
    }
  }
  try {
    const info = await stat(localPath(key));
    return info.isFile() ? { size: info.size } : null;
  } catch {
    return null;
  }
}

/** Borra todos los archivos bajo un prefijo (por ejemplo `editor/<id>/`). */
export async function deletePrefix(prefix: string): Promise<void> {
  // `editor/<id>/`, `clon/<id>/` o, en el Editor, `editor/estilos/<id>/` y `editor/biblioteca/<id>/`.
  if (!/^[a-z0-9_-]+\/((estilos|biblioteca)\/)?[0-9a-f-]{36}\/$/i.test(prefix)) throw new Error("Prefijo no válido.");
  if (fileDriver() === "blob") {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token: blobToken(), limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url), { token: blobToken() });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return;
  }
  await rm(path.join(LOCAL_ROOT, prefix), { recursive: true, force: true });
}

/** Borra archivos sueltos (renders reemplazados). */
export async function deleteKeys(keys: string[]): Promise<void> {
  const valid = keys.filter((k) => KEY_RE.test(k));
  if (!valid.length) return;
  if (fileDriver() === "blob") {
    await del(valid, { token: blobToken() });
    return;
  }
  await Promise.all(valid.map((k) => rm(localPath(k), { force: true })));
}
