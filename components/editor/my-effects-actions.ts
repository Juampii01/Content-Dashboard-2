"use server";

import { z } from "zod";
import { getCurrentUser, isDenied, requireEditor } from "@/lib/auth";
import type { Composition } from "@/lib/video/compos/schema";
import { composImageUrls } from "@/lib/video/compos/service";
import { EffectUseError, listMyEffects, loadEffect, placeEffect, removeEffect, renameEffect, saveComposition, setFavorite, type MyEffect } from "@/lib/video/compos/library-service";
import { composSegments } from "@/lib/video/compos/schema";
import { buildTimeline } from "@/lib/video/timeline";
import type { EditPlan, MediaInfo, Transcript } from "@/lib/video/types";
import { loadProject } from "@/lib/video/service";

/**
 * Mis efectos en el Estudio: listar, poner uno en un tramo (sus textos se adaptan a lo que se dice ahí), guardar o
 * quitar una animación del video, renombrar y marcar favoritos. Las animaciones que quedan en un video se guardan
 * solas al renderizar (lib/video/service.ts).
 */
const idSchema = z.uuid();
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function listMyEffectsAction(): Promise<Result<MyEffect[]>> {
  await getCurrentUser();
  try {
    return { ok: true, data: await listMyEffects() };
  } catch (error) {
    console.error("[mis-efectos] lista:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos cargar Mis efectos." };
  }
}

const placeSchema = z.object({ from_word: z.number().int().min(0), to_word: z.number().int().min(0) });

/** Pone un efecto guardado en un tramo del video. Devuelve la animación lista (validada) y las URLs de sus imágenes. */
export async function placeMyEffectAction(projectId: string, effectId: string, span: z.input<typeof placeSchema>): Promise<Result<{ comp: Composition; images: Record<string, string> }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = placeSchema.safeParse(span);
  if (!idSchema.safeParse(projectId).success || !idSchema.safeParse(effectId).success || !parsed.success) return { ok: false, error: "Pedido no válido." };
  try {
    const from = Math.min(parsed.data.from_word, parsed.data.to_word);
    const to = Math.max(parsed.data.from_word, parsed.data.to_word);
    const comp = await placeEffect(projectId, effectId, from, to);
    return { ok: true, data: { comp, images: await composImageUrls([], comp.images ?? []) } };
  } catch (error) {
    if (error instanceof EffectUseError) return { ok: false, error: error.message };
    console.error("[mis-efectos] poner:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos poner ese efecto. Prueba de nuevo." };
  }
}

/**
 * "Guardar en mis efectos": la animación tal como está guardada en el video (el código se toma del servidor, nunca
 * del navegador). Si todavía no se guardó la revisión, se pide esperar un segundo.
 */
export async function saveToMyEffectsAction(projectId: string, compId: string): Promise<Result<{ id: string; status: string; name: string; version: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !/^[\w-]{1,40}$/.test(compId)) return { ok: false, error: "Pedido no válido." };
  const project = await loadProject(projectId);
  if (!project?.plan || !project.transcript) return { ok: false, error: "No encontramos ese video." };
  const plan = project.plan as EditPlan;
  const comp = (plan.compositions ?? []).find((c) => c.id === compId);
  if (!comp) return { ok: false, error: "Estamos guardando tus cambios: prueba de nuevo en un segundo." };
  if (!comp.checked) return { ok: false, error: "Esta animación todavía no pasó la revisión de seguridad. Prueba de nuevo en un segundo." };
  try {
    const transcript = project.transcript as Transcript;
    const media = (project.media ?? {}) as MediaInfo;
    const timeline = buildTimeline(transcript.words, plan, media.duration || transcript.duration);
    const seg = composSegments(timeline, [comp])[0];
    const saved = await saveComposition({ id: project.id, title: project.title, director: project.director }, comp, seg ? seg.end - seg.start : 3, "manual", user.id);
    return { ok: true, data: saved };
  } catch (error) {
    console.error("[mis-efectos] guardar:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos guardarla en Mis efectos." };
  }
}

export async function removeMyEffectAction(effectId: string): Promise<Result<null>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(effectId).success) return { ok: false, error: "Pedido no válido." };
  return (await removeEffect(effectId)) ? { ok: true, data: null } : { ok: false, error: "Ese efecto ya no existe." };
}

export async function renameMyEffectAction(effectId: string, name: string): Promise<Result<null>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(effectId).success) return { ok: false, error: "Pedido no válido." };
  if (!name.trim()) return { ok: false, error: "Escribe un nombre." };
  return (await renameEffect(effectId, name)) ? { ok: true, data: null } : { ok: false, error: "Ese efecto ya no existe." };
}

export async function favoriteMyEffectAction(effectId: string, favorite: boolean): Promise<Result<null>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(effectId).success) return { ok: false, error: "Pedido no válido." };
  return (await setFavorite(effectId, favorite)) ? { ok: true, data: null } : { ok: false, error: "Ese efecto ya no existe." };
}

/** ¿Esta animación está en Mis efectos? (para el botón del inspector). */
export async function myEffectStateAction(effectId: string): Promise<Result<{ saved: boolean; name: string } | null>> {
  await getCurrentUser();
  if (!idSchema.safeParse(effectId).success) return { ok: true, data: null };
  const row = await loadEffect(effectId);
  return { ok: true, data: row ? { saved: !row.removedAt, name: row.name } : null };
}
