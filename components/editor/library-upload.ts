"use client";

import {
  completeClipUploadAction,
  createClipUploadAction,
} from "./media-actions";
import { VIDEO_ACCEPT } from "./constants";
import { putFile } from "./upload-manager";

export const IMAGE_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
];
/** Tipos que acepta la biblioteca (clips de video e imágenes). */
export const LIBRARY_ACCEPT = [...VIDEO_ACCEPT, ...IMAGE_ACCEPT];
export const MAX_LIBRARY_FILE = 2 * 1024 ** 3;

/** ¿El archivo entra en la biblioteca? Devuelve el motivo en español si no. */
export function libraryFileProblem(file: File): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!LIBRARY_ACCEPT.includes(file.type) && !LIBRARY_ACCEPT.includes(ext))
    return `«${file.name}» no es un video ni una imagen que podamos usar (MP4, MOV, WEBM, MKV, JPG, PNG o WebP).`;
  if (file.size > MAX_LIBRARY_FILE) return `«${file.name}» pesa más de 2 GB.`;
  return null;
}

/**
 * Sube un archivo a la biblioteca (en la carpeta `folderId`, o en la raíz): prepara la subida, manda el archivo directo
 * al almacenamiento y avisa que terminó (un video se encola para el worker; una imagen queda lista enseguida). La usan
 * la Biblioteca y el panel de clips del Estudio. Devuelve el id de la pieza o lanza un error con un mensaje en español.
 */
export async function uploadToLibrary(
  file: File,
  opts: {
    folderId?: string | null;
    onProgress?: (pct: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const created = await createClipUploadAction({
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    folderId: opts.folderId ?? null,
  });
  if (!created.ok || !created.data)
    throw new Error(
      created.ok ? "No pudimos preparar la subida." : created.error,
    );
  const { id, key, mode } = created.data;
  try {
    await putFile({
      file,
      key,
      mode,
      clientPayload: `clip:${id}`,
      signal: opts.signal ?? new AbortController().signal,
      onProgress: (loaded) =>
        opts.onProgress?.((loaded / Math.max(1, file.size)) * 100),
    });
  } catch {
    throw new Error("La subida falló. Vuelve a intentarlo.");
  }
  const done = await completeClipUploadAction(id);
  if (!done.ok) throw new Error(done.error);
  return id;
}
