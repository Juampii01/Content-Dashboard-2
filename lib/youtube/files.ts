import "server-only";
import { deleteKeys, deletePrefix } from "@/lib/storage";

/**
 * Archivos de "Títulos y miniaturas", en el almacenamiento privado (el mismo store que Carruseles y el Editor):
 * - `marca/fotos/<azar>.<ext>`: fotos del personaje (Mi marca → characterPhotos).
 * - `miniaturas/recortes/<hash>-<azar>.png`: la foto sin fondo (la hace el worker una vez por foto).
 * - `miniaturas/<paquete>/<concepto>-<azar>.jpg`: fondos sin texto generados para cada concepto.
 * El navegador los lee por `/api/miniaturas/archivos/<clave>` (mismo origen y con sesión): así la exportación a JPG
 * puede dibujarlos y nadie sin sesión llega a ellos.
 */
const UUID = "[0-9a-f-]{36}";
export const PHOTO_KEY_RE = /^marca\/fotos\/[0-9a-f]{16}\.(jpg|png|webp)$/;
export const CUTOUT_KEY_RE = /^miniaturas\/recortes\/[0-9a-f]{16}-[0-9a-f]{8}\.png$/;
export const BACKGROUND_KEY_RE = new RegExp(`^miniaturas/${UUID}/[a-z0-9]{1,20}-[0-9a-f]{8}\\.jpg$`);

export const MAX_PHOTOS = 8;

export function servableKey(key: string): boolean {
  return PHOTO_KEY_RE.test(key) || CUTOUT_KEY_RE.test(key) || BACKGROUND_KEY_RE.test(key);
}

export function thumbFileUrl(key: string | null | undefined): string | null {
  return key && servableKey(key) ? `/api/miniaturas/archivos/${key}` : null;
}

export async function deleteThumbFiles(keys: (string | null | undefined)[]): Promise<void> {
  const valid = keys.filter((k): k is string => Boolean(k && servableKey(k)));
  if (valid.length) await deleteKeys(valid).catch((e) => console.error("[miniaturas] borrar archivos:", e instanceof Error ? e.message : "error"));
}

export async function deletePackageFolder(packageId: string): Promise<void> {
  await deletePrefix(`miniaturas/${packageId}/`).catch((e) => console.error("[miniaturas] borrar carpeta:", e instanceof Error ? e.message : "error"));
}
