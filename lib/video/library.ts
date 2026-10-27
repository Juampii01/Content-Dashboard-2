import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { AiError, aiConfigured, generateStructured } from "@/lib/ai/client";
import { FICHA_RULES, fakeFicha, fichaAiSchema, fichaTask } from "@/lib/ai/prompts/biblioteca";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { deleteKeys, deletePrefix, fileDriver, fileInfo, IMAGE_TYPES, readBytes, VIDEO_EXTENSIONS, VIDEO_TYPES, writeBytes } from "@/lib/storage";
import { fichaFromAi, fichaSheetSchema, readFicha, searchQueryOf, searchTextOf, type Ficha, type FichaSheet, type LibraryEntry, type LibraryKind } from "./library-ficha";

/**
 * Biblioteca del cliente: videos (b-roll) e imágenes que sube una vez (subida directa al almacenamiento privado) y el
 * editor reutiliza como material o como referencia.
 * - Video: UPLOADING → PROCESSING (worker VIDEO_CLIP: datos, miniatura y hojas de cuadros) → READY o FAILED.
 * - Imagen: UPLOADING → READY al terminar la subida (la app la valida, la gira, la achica a WebP y hace la miniatura).
 * Después, Claude escribe la ficha (paso "biblioteca.ficha"): si falla, la pieza queda READY igual y la ficha se puede
 * reintentar. Claves: `editor/biblioteca/<id>/clip.<ext>`, `imagen.webp`, `miniatura.jpg`, `hoja-NN.jpg`.
 */
export class LibraryError extends Error {}

export const MAX_CLIP_BYTES = 2 * 1024 ** 3;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Lado mayor de la imagen guardada: alcanza para un b-roll a pantalla completa en 1080×1920. */
const IMAGE_SIDE = 2400;
/** Lado mayor de la imagen que mira Claude (lo que la API aprovecha sin achicar). */
const VISION_SIDE = 1568;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const prefix = (id: string) => `editor/biblioteca/${id}/`;
type ClipRow = typeof schema.brollClips.$inferSelect;

export async function loadClip(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.brollClips).where(eq(schema.brollClips.id, id)).limit(1);
  return row ?? null;
}

/** Etiquetas limpias: minúsculas, sin repetir, hasta 12 de 30 caracteres. */
export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30)).filter((t) => t.length >= 2))].slice(0, 12);
}

/** Etiquetas sugeridas a partir del nombre del archivo ("cliente-llamando_telefono.mp4" → cliente, llamando, telefono). */
export function tagsFromFileName(name: string): string[] {
  return cleanTags(
    name
      .replace(/\.[^.]+$/, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^(img|vid|mov|dsc|pxl)$/i.test(w)),
  ).slice(0, 5);
}

/** Video o imagen, por el tipo que manda el navegador o, si no lo manda, por la extensión. */
export function kindOf(fileName: string, fileType: string): { kind: LibraryKind; ext: string } | null {
  const type = fileType.toLowerCase();
  const fromName = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (IMAGE_TYPES[type]) return { kind: "image", ext: IMAGE_TYPES[type]! };
  if (VIDEO_TYPES[type]) return { kind: "video", ext: VIDEO_TYPES[type]! };
  if (!type || type === "application/octet-stream") {
    if (IMAGE_EXTENSIONS.includes(fromName)) return { kind: "image", ext: fromName === ".jpeg" ? "jpg" : fromName.slice(1) };
    if (VIDEO_EXTENSIONS.includes(fromName)) return { kind: "video", ext: fromName.slice(1) };
  }
  return null;
}

export async function createClipUpload(input: { fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; key: string; kind: LibraryKind }> {
  if (!fileDriver()) throw new LibraryError("Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte.");
  const found = kindOf(input.fileName, input.fileType);
  if (!found) throw new LibraryError("Ese formato no es compatible. Sube videos MP4, MOV, WEBM o MKV, o imágenes JPG, PNG o WebP.");
  if (input.fileSize <= 0) throw new LibraryError("El archivo está vacío.");
  if (found.kind === "video" && input.fileSize > MAX_CLIP_BYTES) throw new LibraryError("El clip pesa más de 2 GB. Para b-roll alcanza con clips cortos.");
  if (found.kind === "image" && input.fileSize > MAX_IMAGE_BYTES) throw new LibraryError("La imagen pesa más de 25 MB.");
  const id = randomUUID();
  const key = `${prefix(id)}${found.kind === "image" ? "original" : "clip"}.${found.ext}`;
  const title = input.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || (found.kind === "image" ? "Imagen sin nombre" : "Clip sin nombre");
  const tags = tagsFromFileName(input.fileName);
  await getDb().insert(schema.brollClips).values({
    id,
    title,
    tags,
    kind: found.kind,
    status: "UPLOADING",
    fileKey: key,
    fileName: input.fileName.slice(0, 200),
    fileBytes: input.fileSize,
    searchText: searchTextOf({ title, tags, ficha: null }),
    createdBy: input.userId,
  });
  return { id, key, kind: found.kind };
}

/**
 * La subida terminó. Un video se encola para el worker; una imagen se prepara aquí mismo. Devuelve si hay que escribir
 * la ficha ahora (quien llama la escribe después de responder, con `after`).
 */
export async function completeClipUpload(id: string, userId: string): Promise<{ ficha: boolean }> {
  const clip = await loadClip(id);
  if (!clip) throw new LibraryError("No encontramos ese archivo.");
  if (clip.status !== "UPLOADING") return { ficha: false };
  const info = await fileInfo(clip.fileKey);
  if (!info || info.size === 0) throw new LibraryError("La subida no terminó. Vuelve a elegir el archivo.");
  if (clip.fileBytes && info.size !== clip.fileBytes) throw new LibraryError("El archivo llegó incompleto. Vuelve a subirlo.");
  if (clip.kind === "image") {
    await prepareImage(clip);
    return { ficha: true };
  }
  await getDb()
    .update(schema.brollClips)
    .set({ status: "PROCESSING", errorMessage: null, fichaStatus: "pending", fichaError: null })
    .where(and(eq(schema.brollClips.id, id), eq(schema.brollClips.status, "UPLOADING")));
  await enqueueJob({ type: "VIDEO_CLIP", createdBy: userId, stage: "En cola", maxAttempts: 3, input: { clipId: id } });
  return { ficha: false };
}

/** Valida, gira según EXIF, achica (WebP) y hace la miniatura de una imagen subida. El original se borra. */
async function prepareImage(clip: ClipRow): Promise<void> {
  const fail = async (message: string) => {
    await getDb().update(schema.brollClips).set({ status: "FAILED", errorMessage: message }).where(eq(schema.brollClips.id, clip.id));
    throw new LibraryError(message);
  };
  let input: Buffer;
  try {
    input = await readBytes(clip.fileKey, MAX_IMAGE_BYTES);
  } catch {
    return fail("No pudimos leer la imagen. Vuelve a subirla.");
  }
  let full: { data: Buffer; info: { width: number; height: number } };
  let thumb: Buffer;
  try {
    const base = sharp(input, { limitInputPixels: 80_000_000, animated: false }).rotate();
    full = await base.clone().resize({ width: IMAGE_SIDE, height: IMAGE_SIDE, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    thumb = await base.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return fail("No pudimos abrir esa imagen. Sube un JPG, PNG o WebP.");
  }
  if (full.info.width < 64 || full.info.height < 64) return fail("La imagen es demasiado chica (menos de 64 px).");
  const fileKey = `${prefix(clip.id)}imagen.webp`;
  const thumbKey = `${prefix(clip.id)}miniatura.jpg`;
  await writeBytes(fileKey, full.data, "image/webp");
  await writeBytes(thumbKey, thumb, "image/jpeg");
  await getDb()
    .update(schema.brollClips)
    .set({ status: "READY", fileKey, thumbKey, width: full.info.width, height: full.info.height, duration: null, fileBytes: full.data.byteLength, errorMessage: null, fichaStatus: "pending", fichaError: null })
    .where(eq(schema.brollClips.id, clip.id));
  if (clip.fileKey !== fileKey) await deleteKeys([clip.fileKey]).catch(() => undefined);
}

export async function updateClip(id: string, data: { title?: string; tags?: string[] }): Promise<void> {
  const clip = await loadClip(id);
  if (!clip) return;
  const title = data.title != null ? data.title.trim().slice(0, 120) || "Sin nombre" : clip.title;
  const tags = data.tags ? cleanTags(data.tags) : clip.tags;
  await getDb()
    .update(schema.brollClips)
    .set({ title, tags, searchText: searchTextOf({ title, tags, ficha: readFicha(clip.ficha) }) })
    .where(eq(schema.brollClips.id, id));
}

/** La persona corrige la ficha (lo que se ve, los tramos, los usos): queda lista y se puede buscar por lo nuevo. */
export async function updateFicha(id: string, raw: unknown): Promise<Ficha> {
  const clip = await loadClip(id);
  if (!clip) throw new LibraryError("Ese archivo ya no existe.");
  const ficha = readFicha(raw, clip.duration);
  if (!ficha) throw new LibraryError("La ficha tiene datos que no son válidos. Revisa los tramos y vuelve a guardar.");
  await getDb()
    .update(schema.brollClips)
    .set({ ficha, fichaStatus: "ready", fichaError: null, searchText: searchTextOf({ title: clip.title, tags: clip.tags, ficha }) })
    .where(eq(schema.brollClips.id, id));
  return ficha;
}

export async function deleteClip(id: string): Promise<void> {
  const clip = await loadClip(id);
  if (!clip) return;
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "VIDEO_CLIP"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'clipId' = ${id}`));
  await deletePrefix(prefix(id)).catch((e) => console.error("[biblioteca] no se borraron los archivos:", e instanceof Error ? e.message : e));
  await getDb().delete(schema.brollClips).where(eq(schema.brollClips.id, id));
}

export async function retryClip(id: string, userId: string): Promise<void> {
  const clip = await loadClip(id);
  if (!clip || clip.status !== "FAILED" || clip.kind === "image") return;
  await getDb().update(schema.brollClips).set({ status: "PROCESSING", errorMessage: null, fichaStatus: "pending", fichaError: null }).where(eq(schema.brollClips.id, id));
  await enqueueJob({ type: "VIDEO_CLIP", createdBy: userId, stage: "En cola", maxAttempts: 3, input: { clipId: id } });
}

// ─── Ficha ────────────────────────────────────────────────────────────────

/**
 * Vuelve a escribir la ficha (falló, o la pieza se subió antes de que hubiera fichas). Un video sin hojas de cuadros
 * vuelve al worker solo para sacarlas (sigue usable mientras tanto). Devuelve si hay que escribirla ahora.
 */
export async function retryFicha(id: string, userId: string): Promise<{ ficha: boolean }> {
  const clip = await loadClip(id);
  if (!clip || clip.status !== "READY") throw new LibraryError("Espera a que el archivo esté listo.");
  if (clip.fichaStatus === "thinking" || (clip.fichaStatus === "pending" && clip.kind === "video" && !clip.fichaSheets?.length)) return { ficha: false };
  if (clip.kind === "video" && !clip.fichaSheets?.length) {
    await getDb().update(schema.brollClips).set({ fichaStatus: "pending", fichaError: null }).where(eq(schema.brollClips.id, id));
    await enqueueJob({ type: "VIDEO_CLIP", createdBy: userId, stage: "En cola", maxAttempts: 2, input: { clipId: id, fichaOnly: true } });
    return { ficha: false };
  }
  await getDb().update(schema.brollClips).set({ fichaStatus: "pending", fichaError: null }).where(eq(schema.brollClips.id, id));
  return { ficha: true };
}

/**
 * Analiza las piezas que todavía no tienen ficha (las de antes de que hubiera fichas quedaron en "none" y nunca se
 * miraban): un video vuelve al worker para sacar las hojas (VIDEO_CLIP con fichaOnly) y después Claude escribe la ficha;
 * una imagen o un video que ya tenía hojas se escribe enseguida. Las que ya tienen ficha, la están escribiendo o no están
 * listas no se tocan. Devuelve las que hay que escribir ahora (quien llama corre `generateFicha` después de responder).
 */
export async function analyzeMissing(ids: string[], userId: string): Promise<{ now: string[]; queued: string[] }> {
  const unique = [...new Set(ids)].slice(0, 30);
  if (!unique.length) return { now: [], queued: [] };
  const rows = await getDb()
    .select({ id: schema.brollClips.id })
    .from(schema.brollClips)
    .where(and(inArray(schema.brollClips.id, unique), eq(schema.brollClips.status, "READY"), eq(schema.brollClips.fichaStatus, "none")));
  const now: string[] = [];
  const queued: string[] = [];
  for (const { id } of rows) {
    const r = await retryFicha(id, userId).catch((error) => {
      console.error("[biblioteca] no se pudo pedir la ficha:", error instanceof Error ? error.message : error);
      return null;
    });
    if (r?.ficha) now.push(id);
    else if (r) queued.push(id);
  }
  return { now, queued };
}

/** Las piezas listas sin ficha (para «Analizar» en la Biblioteca), las más nuevas primero. */
export async function missingFichaIds(limit = 30): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.brollClips.id })
    .from(schema.brollClips)
    .where(and(eq(schema.brollClips.status, "READY"), eq(schema.brollClips.fichaStatus, "none")))
    .orderBy(desc(schema.brollClips.updatedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Lo que entrega el worker: las hojas de cuadros del clip (o el aviso de que no se pudieron armar). */
export async function saveClipSheets(id: string, payload: { ok: boolean; error?: string; sheets?: unknown[] }): Promise<boolean> {
  const clip = await loadClip(id);
  if (!clip || clip.status !== "READY" || clip.kind !== "video" || clip.fichaStatus !== "pending") return false;
  const sheets: FichaSheet[] = [];
  for (const raw of payload.sheets ?? []) {
    const s = fichaSheetSchema.safeParse(raw);
    if (s.success && s.data.key.startsWith(prefix(id)) && s.data.frames.length === s.data.times.length) sheets.push(s.data);
  }
  if (!payload.ok || !sheets.length) {
    await getDb()
      .update(schema.brollClips)
      .set({ fichaStatus: "failed", fichaError: (payload.error || "No pudimos sacar los cuadros del clip.").slice(0, 300) })
      .where(eq(schema.brollClips.id, id));
    return false;
  }
  await getDb().update(schema.brollClips).set({ fichaSheets: sheets.slice(0, 3) }).where(eq(schema.brollClips.id, id));
  return true;
}

type VisionImage = { mediaType: "image/jpeg" | "image/webp"; data: string };

/** Lo que mira Claude: las hojas del clip o la imagen (achicada al tamaño que aprovecha la API). */
async function visionOf(clip: ClipRow): Promise<{ images: VisionImage[]; sizes: { width: number; height: number }[] }> {
  if (clip.kind === "image") {
    const buf = await readBytes(clip.fileKey, 12 * 1024 * 1024);
    const out = await sharp(buf).resize({ width: VISION_SIDE, height: VISION_SIDE, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    return { images: [{ mediaType: "image/webp", data: out.data.toString("base64") }], sizes: [{ width: out.info.width, height: out.info.height }] };
  }
  const sheets = clip.fichaSheets ?? [];
  const images: VisionImage[] = [];
  const sizes: { width: number; height: number }[] = [];
  for (const s of sheets) {
    images.push({ mediaType: "image/jpeg", data: (await readBytes(s.key, 6 * 1024 * 1024)).toString("base64") });
    sizes.push({ width: s.width, height: s.height });
  }
  return { images, sizes };
}

/**
 * Claude escribe la ficha (Sonnet con visión, ~0,02–0,05 USD). Se carga a quien subió la pieza y respeta sus créditos
 * del mes (al 100 % no se llama). Si falla, la pieza sigue lista y la ficha queda con el aviso para reintentar.
 */
export async function generateFicha(id: string): Promise<void> {
  const [claimed] = await getDb()
    .update(schema.brollClips)
    .set({ fichaStatus: "thinking", fichaError: null })
    .where(and(eq(schema.brollClips.id, id), eq(schema.brollClips.status, "READY"), eq(schema.brollClips.fichaStatus, "pending")))
    .returning();
  if (!claimed) return;
  const fail = (message: string) =>
    getDb().update(schema.brollClips).set({ fichaStatus: "failed", fichaError: message.slice(0, 300) }).where(and(eq(schema.brollClips.id, id), eq(schema.brollClips.fichaStatus, "thinking")));
  try {
    if (!aiConfigured()) return void (await fail("La IA no está configurada en esta instalación."));
    const kind = claimed.kind;
    const duration = claimed.duration ?? 0;
    const vision = await visionOf(claimed);
    if (!vision.images.length) return void (await fail("No encontramos los cuadros del clip. Reintenta."));
    const frames = (claimed.fichaSheets ?? []).flatMap((s) => s.frames.map((n, i) => ({ n, t: s.times[i] ?? 0 })));
    const ai = await generateStructured({
      feature: "biblioteca.ficha",
      model: "main",
      context: FICHA_RULES,
      task: fichaTask({ title: claimed.title, kind, duration, width: claimed.width ?? 0, height: claimed.height ?? 0, frames, sheets: vision.images.length }),
      schema: fichaAiSchema,
      images: vision.images,
      imageSizes: vision.sizes,
      maxTokens: 3000,
      userId: claimed.createdBy,
      fake: () => fakeFicha({ title: claimed.title, kind, duration }),
    });
    const ficha = fichaFromAi(ai, duration, kind);
    // Si la persona la editó mientras Claude pensaba, gana lo suyo.
    await getDb()
      .update(schema.brollClips)
      .set({ ficha, fichaStatus: "ready", fichaError: null, searchText: searchTextOf({ title: claimed.title, tags: claimed.tags, ficha }) })
      .where(and(eq(schema.brollClips.id, id), eq(schema.brollClips.fichaStatus, "thinking")));
  } catch (error) {
    console.error("[biblioteca] ficha:", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
    await fail(error instanceof AiError ? error.userMessage : "No pudimos escribir la ficha. Reintenta en un momento.");
  }
}

// ─── Lectura para la IA y la búsqueda ─────────────────────────────────────

export type LibraryPiece = LibraryEntry & { fileKey: string; thumbKey: string | null };

export function pieceOf(r: ClipRow): LibraryPiece {
  return {
    id: r.id,
    kind: r.kind === "image" ? "image" : "video",
    title: r.title,
    tags: r.tags,
    duration: r.duration ?? 0,
    width: r.width ?? 0,
    height: r.height ?? 0,
    ficha: r.fichaStatus === "ready" ? readFicha(r.ficha, r.duration) : null,
    fileKey: r.fileKey,
    thumbKey: r.thumbKey,
  };
}

/** Todo lo listo de la biblioteca (lo más nuevo primero). */
export async function readyPieces(opts: { kind?: LibraryKind } = {}): Promise<LibraryPiece[]> {
  const rows = await getDb()
    .select()
    .from(schema.brollClips)
    .where(and(eq(schema.brollClips.status, "READY"), opts.kind ? eq(schema.brollClips.kind, opts.kind) : undefined))
    .orderBy(desc(schema.brollClips.updatedAt))
    .limit(500);
  return rows.map(pieceOf);
}

/**
 * Búsqueda por texto sobre el nombre, las etiquetas y la ficha (índice de texto de Postgres en español, con raíces:
 * "llamadas" encuentra "llamando"), y por parte de palabra como respaldo. Lo que mejor coincide, primero.
 */
export async function searchLibrary(query: string, opts: { kind?: LibraryKind; limit?: number; readyOnly?: boolean } = {}): Promise<string[]> {
  const q = searchQueryOf(query);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const doc = sql`to_tsvector('spanish', ${schema.brollClips.searchText})`;
  const tsq = sql`plainto_tsquery('spanish', ${q})`;
  const rows = await getDb()
    .select({ id: schema.brollClips.id })
    .from(schema.brollClips)
    .where(
      and(
        sql`(${doc} @@ ${tsq} or ${schema.brollClips.searchText} like ${like})`,
        opts.kind ? eq(schema.brollClips.kind, opts.kind) : undefined,
        opts.readyOnly ? eq(schema.brollClips.status, "READY") : undefined,
      ),
    )
    .orderBy(sql`ts_rank(${doc}, ${tsq}) desc`, desc(schema.brollClips.updatedAt))
    .limit(opts.limit ?? 60);
  return rows.map((r) => r.id);
}
