import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { readUrl, writeBytes } from "@/lib/storage/files";
import { refImageSchema, type RefImage } from "./compos/schema";

/**
 * Imágenes que la persona le manda a Claude en un pedido de animación o en la charla del taller:
 * - "style": referencia de estilo (colores, composición, tipografía, look). Claude la mira, no la copia.
 * - "inside": va dentro de la animación tal cual (un logo, una captura, una foto propia), como env.assets.
 * Se guardan achicadas (lado mayor 1568 px, WebP) en `editor/<proyecto>/refs/<uuid>.webp`.
 */
export class RefError extends Error {}

export const MAX_REF_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_REFS = 4;
const MAX_SIDE = 1568;

const keyRe = (projectId: string) => new RegExp(`^editor/${projectId}/refs/[0-9a-f-]{36}\\.webp$`, "i");

export { refImageSchema, type RefImage };

/** Solo imágenes de este proyecto (las claves nunca se aceptan libres del navegador). */
export function cleanRefs(projectId: string, refs: unknown): RefImage[] {
  const parsed = z.array(refImageSchema).max(MAX_REFS * 2).safeParse(refs ?? []);
  if (!parsed.success) return [];
  const re = keyRe(projectId);
  const seen = new Set<string>();
  return parsed.data.filter((r) => re.test(r.key) && !seen.has(r.key) && seen.add(r.key)).slice(0, MAX_REFS);
}

/** Valida, gira según EXIF, achica y guarda una imagen subida. */
export async function saveRefImage(projectId: string, input: Buffer): Promise<{ key: string; width: number; height: number }> {
  if (!input.byteLength) throw new RefError("La imagen está vacía.");
  if (input.byteLength > MAX_REF_INPUT_BYTES) throw new RefError("La imagen pesa más de 12 MB.");
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(input, { limitInputPixels: 60_000_000, animated: false })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RefError("No pudimos leer esa imagen. Sube un JPG, PNG o WebP.");
  }
  if (out.info.width < 16 || out.info.height < 16) throw new RefError("La imagen es demasiado chica.");
  const key = `editor/${projectId}/refs/${randomUUID()}.webp`;
  await writeBytes(key, out.data, "image/webp");
  return { key, width: out.info.width, height: out.info.height };
}

/** URL de corta duración para ver la imagen en el navegador. */
export const refUrl = (key: string) => readUrl(key, { ttlSec: 3 * 3600 });

/** Texto para los pedidos a Claude: qué es cada imagen adjunta (en el orden en que van). */
export function refsText(refs: RefImage[]): string | null {
  const style = refs.filter((r) => r.use === "style");
  if (!style.length) return null;
  return `REFERENCIAS DE ESTILO QUE MANDÓ LA PERSONA (${style.length === 1 ? "la imagen adjunta" : `las ${style.length} imágenes adjuntas`}${style.some((r) => r.note) ? `: ${style.map((r, i) => `${i + 1}. ${r.note ?? "sin nombre"}`).join(" · ")}` : ""}): adapta a esta animación su estilo (paleta, composición, tipografía, materiales, luz, nivel de detalle y movimiento que sugiere). No la copies literal ni dibujes la imagen: es la dirección visual. Si contradice los colores de la marca, manda la referencia.`;
}
