import "server-only";
import sharp from "sharp";
import { env } from "@/lib/env";
import { fileDriver, readUrl } from "@/lib/storage";
import { localPath } from "@/lib/storage/files";
import { readFile } from "node:fs/promises";

/**
 * Imágenes para el PDF (miniaturas y foto de la marca). El PDF solo acepta JPG y PNG, y las miniaturas pueden
 * venir en WebP o SVG (los datos de demostración): se bajan y se pasan a JPG chico con sharp.
 * Si una imagen no se puede bajar, devuelve null y el PDF dibuja un recuadro en su lugar (nunca falla por esto).
 */
const MAX_BYTES = 8 * 1024 * 1024;

async function fetchBytes(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) return null;
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES ? bytes : null;
}

/** Bytes de una imagen guardada: URL pública, ruta de /public ("/demo/v1.svg") o clave del almacenamiento privado. */
async function sourceBytes(source: string): Promise<Buffer | null> {
  if (/^https:\/\//i.test(source) || (process.env.NODE_ENV !== "production" && /^http:\/\//i.test(source))) return fetchBytes(source);
  if (source.startsWith("/") && !source.startsWith("//")) {
    // Archivo de /public: se pide a la propia app (en Vercel no está en el disco de la función).
    return fetchBytes(new URL(source, env().NEXT_PUBLIC_APP_URL).toString());
  }
  if (/^[\w./-]+$/.test(source) && !source.includes("..")) {
    if (fileDriver() === "local") return readFile(localPath(source)).catch(() => null);
    if (fileDriver() === "blob") return fetchBytes(await readUrl(source, { ttlSec: 300 }));
  }
  return null;
}

/** Imagen lista para el PDF (JPG). `width`/`height` en píxeles; recorta al centro para llenar el recuadro. */
export async function pdfImage(source: string | null, width: number, height: number): Promise<Buffer | null> {
  if (!source) return null;
  try {
    const bytes = await sourceBytes(source);
    if (!bytes) return null;
    return await sharp(bytes, { density: 144, limitInputPixels: 40_000_000 })
      .resize(width, height, { fit: "cover", position: "attention" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Baja varias imágenes en paralelo (con un límite para no saturar la red). */
export async function pdfImages(sources: (string | null)[], width: number, height: number): Promise<(Buffer | null)[]> {
  const out: (Buffer | null)[] = new Array(sources.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, sources.length) }, async () => {
    while (next < sources.length) {
      const i = next++;
      out[i] = await pdfImage(sources[i] ?? null, width, height);
    }
  });
  await Promise.all(workers);
  return out;
}
