"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import { clipMedia, signBrollOptions, type SignedOption } from "@/lib/dal/editor-media";
import { fileDriver } from "@/lib/storage";
import { BrollError, libraryOptions, searchOptions } from "@/lib/video/broll";
import { analyzeMissing, completeClipUpload, createClipUpload, deleteClip, generateFicha, LibraryError, missingFichaIds, retryClip, retryFicha, searchLibrary, updateClip, updateFicha } from "@/lib/video/library";
import { fichaSchema, type Ficha } from "@/lib/video/library-ficha";
import { completeTrackUpload, createTrackUpload, deleteTrack, MusicError, renameTrack } from "@/lib/video/music";
import { completeSplitUpload, createSplitFromLink, createSplitUpload, retrySplit } from "@/lib/video/music-split";
import { completeStyleUpload, createStyleFromLink, createStyleUpload, deleteStyle, renameStyle, retryStyle, StyleError } from "@/lib/video/styles";

/**
 * Acciones de "Edita como este" (estilos), de la biblioteca de b-roll y de la búsqueda de b-roll en la revisión.
 * Todas exigen un usuario con permiso de edición; los datos se validan con Zod.
 */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof StyleError || error instanceof LibraryError || error instanceof BrollError || error instanceof MusicError) return { ok: false, error: error.message };
  console.error("[editor]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1, "Ponle un nombre al estilo.").max(80, "El nombre es demasiado largo.");
const fileSchema = z.object({ fileName: z.string().min(1).max(300), fileType: z.string().max(100), fileSize: z.number().int().positive() });
const mode = () => (fileDriver() === "blob" ? ("blob" as const) : ("local" as const));

// ─── Estilos ──────────────────────────────────────────────────────────────

export async function createStyleUploadAction(input: { name: string } & z.input<typeof fileSchema>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = fileSchema.extend({ name: nameSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  try {
    const { id, key } = await createStyleUpload({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: mode() } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeStyleUploadAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Estilo no válido." };
  try {
    await completeStyleUpload(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createStyleLinkAction(input: { name: string; link: string }): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ name: nameSchema, link: z.string().trim().min(8, "Pega el link del video.").max(600) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  try {
    const id = await createStyleFromLink({ ...parsed.data, userId: user.id });
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function renameStyleAction(id: string, name: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = nameSchema.safeParse(name);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Estilo no válido." };
  await renameStyle(id, parsed.data);
  refresh();
  return { ok: true };
}

export async function retryStyleAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Estilo no válido." };
  try {
    await retryStyle(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteStyleAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Estilo no válido." };
  try {
    await deleteStyle(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Biblioteca de b-roll ─────────────────────────────────────────────────

export async function createClipUploadAction(input: z.input<typeof fileSchema>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  try {
    const { id, key } = await createClipUpload({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: mode() } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeClipUploadAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Clip no válido." };
  try {
    const done = await completeClipUpload(id, user.id);
    // Una imagen ya está lista: Claude escribe su ficha después de responder (un video, cuando el worker termina).
    if (done.ficha) after(() => generateFicha(id));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function updateClipAction(id: string, data: { title?: string; tags?: string[] }): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ title: z.string().max(200).optional(), tags: z.array(z.string().max(60)).max(30).optional() }).safeParse(data);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "Datos no válidos." };
  await updateClip(id, parsed.data);
  refresh();
  return { ok: true };
}

export async function deleteClipAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Clip no válido." };
  try {
    await deleteClip(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function retryClipAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Clip no válido." };
  await retryClip(id, user.id);
  refresh();
  return { ok: true };
}

/** Vuelve a escribir la ficha de una pieza (falló, o es de antes de las fichas). */
export async function retryFichaAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Archivo no válido." };
  try {
    const r = await retryFicha(id, user.id);
    if (r.ficha) after(() => generateFicha(id));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * «Analizar»: escribe la ficha de las piezas que no tienen (las de antes de que hubiera fichas). Sin ids, todas las que
 * faltan (hasta 30 por vez). Los videos van al worker a sacar sus hojas; las imágenes se escriben enseguida.
 */
export async function analyzeMissingAction(ids?: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.array(idSchema).max(30).optional().safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Archivos no válidos." };
  try {
    const targets = parsed.data?.length ? parsed.data : await missingFichaIds();
    const r = await analyzeMissing(targets, user.id);
    if (r.now.length) after(async () => {
      for (const id of r.now) await generateFicha(id);
    });
    refresh();
    return { ok: true, data: { count: r.now.length + r.queued.length } };
  } catch (error) {
    return fail(error);
  }
}

/** Guarda la ficha corregida por la persona. */
export async function updateFichaAction(id: string, ficha: Ficha): Promise<ActionResult<{ ficha: Ficha }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Archivo no válido." };
  const parsed = fichaSchema.safeParse(ficha);
  if (!parsed.success) return { ok: false, error: "Revisa la ficha: hay un campo demasiado largo o un tramo sin descripción." };
  try {
    const saved = await updateFicha(id, parsed.data);
    refresh();
    return { ok: true, data: { ficha: saved } };
  } catch (error) {
    return fail(error);
  }
}

/** Búsqueda por texto en la biblioteca (nombre, etiquetas y ficha): los ids que coinciden, lo mejor primero. */
export async function searchLibraryAction(query: string): Promise<ActionResult<{ ids: string[] }>> {
  // Solo lectura: también para usuarios de solo lectura.
  await getCurrentUser();
  const parsed = z.string().trim().max(120).safeParse(query);
  if (!parsed.success) return { ok: false, error: "Búsqueda no válida." };
  return { ok: true, data: { ids: await searchLibrary(parsed.data) } };
}

/** El archivo y las hojas de cuadros de una pieza, firmados (al abrir su ficha). */
export async function clipMediaAction(id: string): Promise<ActionResult<{ mediaUrl: string | null; sheetUrls: string[] }>> {
  // Solo lectura: también para usuarios de solo lectura.
  await getCurrentUser();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Archivo no válido." };
  const media = await clipMedia(id);
  return media ? { ok: true, data: media } : { ok: false, error: "Ese archivo todavía no está listo." };
}

// ─── B-roll en la revisión ────────────────────────────────────────────────

/** "Buscar otro": alternativas para un tramo (biblioteca que coincide y Pexels). */
export async function searchBrollAction(input: { query: string; keywords: string[]; format: "9:16" | "16:9"; minDuration: number }): Promise<ActionResult<{ options: SignedOption[]; warning: string | null }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z
    .object({ query: z.string().trim().min(2, "Escribe qué quieres mostrar.").max(100), keywords: z.array(z.string().max(40)).max(6), format: z.enum(["9:16", "16:9"]), minDuration: z.number().min(0).max(30) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Búsqueda no válida." };
  try {
    const words = parsed.data.query.split(/\s+/);
    const { options, warning } = await searchOptions({ queryEn: parsed.data.query, keywords: [...parsed.data.keywords, ...words], format: parsed.data.format, minDuration: parsed.data.minDuration });
    return { ok: true, data: { options: await signBrollOptions(options), warning } };
  } catch (error) {
    return fail(error);
  }
}

/** Todos los clips listos de la biblioteca (pestaña "Mi biblioteca" del selector). */
export async function libraryOptionsAction(): Promise<ActionResult<{ options: SignedOption[] }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  return { ok: true, data: { options: await signBrollOptions(await libraryOptions()) } };
}

// ─── Música ───────────────────────────────────────────────────────────────

export async function createTrackUploadAction(input: z.input<typeof fileSchema>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  try {
    const { id, key } = await createTrackUpload({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: mode() } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeTrackUploadAction(id: string, duration: number | null): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ id: idSchema, duration: z.number().nonnegative().max(24 * 3600).nullable() }).safeParse({ id, duration });
  if (!parsed.success) return { ok: false, error: "Pista no válida." };
  try {
    await completeTrackUpload(parsed.data.id, parsed.data.duration);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function renameTrackAction(id: string, title: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ id: idSchema, title: z.string().trim().min(1, "Ponle un nombre a la pista.").max(120, "El nombre es demasiado largo.") }).safeParse({ id, title });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pista no válida." };
  await renameTrack(parsed.data.id, parsed.data.title);
  refresh();
  return { ok: true };
}

export async function deleteTrackAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Pista no válida." };
  try {
    await deleteTrack(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ─── Sacar la música de un reel ───────────────────────────────────────────

export async function createSplitFromLinkAction(link: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.string().trim().min(8).max(500).safeParse(link);
  if (!parsed.success) return { ok: false, error: "Pega un link de Instagram, TikTok o YouTube." };
  try {
    const id = await createSplitFromLink({ link: parsed.data, userId: user.id });
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function createSplitUploadAction(input: z.input<typeof fileSchema>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  try {
    const { id, key } = await createSplitUpload({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: mode() } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeSplitUploadAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Pista no válida." };
  try {
    await completeSplitUpload(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function retrySplitAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Pista no válida." };
  try {
    await retrySplit(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
