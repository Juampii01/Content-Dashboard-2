import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { get, put } from "@vercel/blob";
import { env } from "@/lib/env";
import { assertKey, fileDriver, localPath, writeLocal } from "@/lib/storage/files";
import { isStoredUrl } from "@/lib/storage/copy";
import { HeyGenError, MAX_DIRECT_UPLOAD_BYTES, type HeyGenClient } from "./client";

/**
 * Archivos entre nuestro almacenamiento privado y HeyGen, sin cargarlos enteros en memoria.
 *
 * - `openFile`: abre un archivo nuestro (por clave del Editor o URL de Blob) o una URL de HeyGen, con su tamaño.
 * - `uploadToHeyGen`: subida directa de HeyGen (POST /v3/assets/direct-uploads → PUT a la URL firmada de S3 con las
 *   cabeceras que da HeyGen → POST /v3/assets/{id}/complete). Acepta hasta 200 MB de video; un asset no vence.
 *   Se usa siempre, aunque el archivo pese poco: una URL nuestra no es pública y el límite por URL es de 32 MB.
 * - `saveToKey`: guarda un archivo remoto (audio o video de HeyGen, que vencen) en una clave fija del almacenamiento.
 */

export type OpenedFile = { body: ReadableStream<Uint8Array>; size: number; contentType: string };

const blobToken = () => env().VIDEO_BLOB_READ_WRITE_TOKEN;

export class TransferError extends Error {
  constructor(readonly userMessage: string, detail: string) {
    super(detail);
  }
}

/** Abre un archivo de nuestro almacenamiento privado por su clave (`editor/<id>/render-x.mp4`, `clon/…`). */
export async function openKey(key: string): Promise<OpenedFile> {
  assertKey(key);
  const driver = fileDriver();
  if (driver === "blob") {
    const result = await get(key, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) throw new TransferError("No encontramos el archivo del video. Puede que se haya borrado.", `blob ${key}`);
    return { body: result.stream, size: result.blob.size, contentType: result.blob.contentType };
  }
  if (driver === "local") {
    const path = localPath(key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new TransferError("No encontramos el archivo del video. Puede que se haya borrado.", `local ${key}`);
    return { body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, size: info.size, contentType: contentTypeOf(key) };
  }
  throw new TransferError("Esta instalación no tiene almacenamiento de archivos configurado.", "sin driver");
}

/** Abre una URL: de nuestro Blob privado (con la clave del store) o pública (por ejemplo, una URL firmada de HeyGen). */
export async function openUrl(url: string): Promise<OpenedFile> {
  if (isStoredUrl(url)) {
    const result = await get(url, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) throw new TransferError("No encontramos el archivo del video. Puede que se haya borrado.", "blob url");
    return { body: result.stream, size: result.blob.size, contentType: result.blob.contentType };
  }
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(300_000) });
  const size = Number(res.headers.get("content-length"));
  if (!res.ok || !res.body) throw new TransferError("No pudimos bajar el archivo de HeyGen. Vuelve a intentarlo.", `descarga ${res.status}`);
  if (!Number.isFinite(size) || size <= 0) throw new TransferError("No pudimos saber cuánto pesa el archivo. Vuelve a intentarlo.", "sin content-length");
  return { body: res.body, size, contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim() || "application/octet-stream" };
}

function contentTypeOf(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : ext === "wav" ? "audio/wav" : ext === "mp3" ? "audio/mpeg" : "application/octet-stream";
}

/** Tipos que HeyGen acepta como asset (docs/upload-assets.md): mp4 y webm para video, mp3 y wav para audio. */
const HEYGEN_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" };

/** Sube un archivo a la cuenta de HeyGen del cliente y devuelve su `asset_id`. */
export async function uploadToHeyGen(client: HeyGenClient, file: OpenedFile, input: { filename: string; contentType: string; idempotencyKey: string }): Promise<string> {
  const contentType = input.contentType === "audio/x-wav" || input.contentType === "audio/wave" ? "audio/wav" : input.contentType;
  if (!HEYGEN_TYPES[contentType]) {
    await file.body.cancel().catch(() => undefined);
    throw new TransferError("HeyGen solo acepta videos MP4 o WebM. Exporta tu video en MP4 y vuelve a intentarlo.", `tipo ${contentType}`);
  }
  if (contentType.startsWith("video/") && file.size > MAX_DIRECT_UPLOAD_BYTES) {
    await file.body.cancel().catch(() => undefined);
    throw new TransferError(
      `El video pesa ${Math.round(file.size / 1024 ** 2)} MB y HeyGen acepta hasta 200 MB. Exporta una versión más liviana (por ejemplo en 1080p) y vuelve a intentarlo.`,
      `tamaño ${file.size}`,
    );
  }
  const slot = await client.createDirectUpload({ filename: input.filename, content_type: contentType, size_bytes: file.size }, `${input.idempotencyKey}-slot`);
  let res: Response;
  try {
    res = await fetch(slot.upload_url, {
      method: "PUT",
      headers: { ...(slot.upload_headers ?? {}), "content-length": String(file.size) },
      body: file.body,
      // Node necesita `duplex` para mandar un cuerpo en streaming.
      ...({ duplex: "half" } as Record<string, string>),
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch (error) {
    throw new HeyGenError("UNAVAILABLE", "Se cortó la subida del video a HeyGen. Vuelve a intentarlo.", `PUT asset: ${error instanceof Error ? error.name : "error"}`);
  }
  if (!res.ok) throw new HeyGenError("UNAVAILABLE", "HeyGen no aceptó la subida del video. Vuelve a intentarlo en unos minutos.", `PUT asset ${res.status}`);
  await client.completeAssetUpload(slot.asset_id, `${input.idempotencyKey}-complete`);
  return slot.asset_id;
}

/** Guarda en una clave fija del almacenamiento privado un archivo remoto (o abierto). Devuelve los bytes guardados. */
export async function saveToKey(source: string | OpenedFile, key: string, options: { contentType: string; maxBytes: number }): Promise<number> {
  assertKey(key);
  const file = typeof source === "string" ? await openUrl(source) : source;
  if (file.size > options.maxBytes) {
    await file.body.cancel().catch(() => undefined);
    throw new TransferError("El archivo de HeyGen es demasiado grande.", `tamaño ${file.size}`);
  }
  const driver = fileDriver();
  if (driver === "blob") {
    await put(key, file.body, { access: "private", contentType: options.contentType, addRandomSuffix: false, allowOverwrite: true, multipart: file.size > 50 * 1024 ** 2, token: blobToken() });
    return file.size;
  }
  if (driver === "local") return writeLocal(key, file.body, options.maxBytes);
  throw new TransferError("Esta instalación no tiene almacenamiento de archivos configurado.", "sin driver");
}
