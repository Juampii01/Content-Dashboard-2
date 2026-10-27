"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import {
  ClipsError,
  completeLongVideoUpload,
  createClipProject,
  createLongVideoFromLink,
  createLongVideoUpload,
  deleteLongVideo,
  renameLongVideo,
  retryLongVideo,
  setClipDiscarded,
  updateClipRange,
  updateClipText,
} from "@/lib/clips/service";
import { fileDriver } from "@/lib/storage";
import { VideoError } from "@/lib/video/service";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof ClipsError || error instanceof VideoError) return { ok: false, error: error.message };
  console.error("[clips]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const idSchema = z.uuid();
const title = z.string().trim().min(1, "Ponle un nombre al video.").max(120, "El nombre es demasiado largo.");

const newUpload = z.object({ title, fileName: z.string().min(1).max(300), fileType: z.string().max(100), fileSize: z.number().int().positive() });

/** Reserva el video largo y la ruta del original. El archivo va directo del navegador al almacenamiento. */
export async function createLongUploadAction(input: z.input<typeof newUpload>): Promise<ActionResult<{ id: string; key: string; mode: "blob" | "local" }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = newUpload.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  try {
    const { id, key } = await createLongVideoUpload({ ...parsed.data, userId: user.id });
    return { ok: true, data: { id, key, mode: fileDriver() === "blob" ? "blob" : "local" } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeLongUploadAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Video no válido." };
  try {
    await completeLongVideoUpload(id, user.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createLongLinkAction(input: { title: string; link: string }): Promise<ActionResult<{ id: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ title, link: z.string().trim().min(8, "Pega el link del video.").max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  try {
    return { ok: true, data: { id: await createLongVideoFromLink({ ...parsed.data, userId: user.id }) } };
  } catch (error) {
    return fail(error);
  }
}

export async function retryLongVideoAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Video no válido." };
  try {
    await retryLongVideo(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function renameLongVideoAction(id: string, name: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = title.safeParse(name);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Video no válido." };
  await renameLongVideo(id, parsed.data);
  refresh();
  return { ok: true };
}

export async function deleteLongVideoAction(id: string, redirectTo?: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Video no válido." };
  try {
    await deleteLongVideo(id);
  } catch (error) {
    return fail(error);
  }
  if (redirectTo === "/editor/clips") redirect("/editor/clips");
  refresh();
  return { ok: true };
}

export async function updateClipRangeAction(clipId: string, fromWord: number, toWord: number): Promise<ActionResult<{ score: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ clipId: idSchema, fromWord: z.number().int().min(0), toWord: z.number().int().min(0) }).safeParse({ clipId, fromWord, toWord });
  if (!parsed.success) return { ok: false, error: "Tramo no válido." };
  try {
    const data = await updateClipRange(parsed.data.clipId, parsed.data.fromWord, parsed.data.toWord);
    refresh();
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function updateClipTextAction(clipId: string, input: { title: string; hookText: string }): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z
    .object({ title: z.string().trim().min(1, "Ponle un título al clip.").max(80, "El título es demasiado largo."), hookText: z.string().trim().max(100, "El texto de gancho es demasiado largo.") })
    .safeParse(input);
  if (!idSchema.safeParse(clipId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Clip no válido." };
  await updateClipText(clipId, parsed.data);
  refresh();
  return { ok: true };
}

export async function setClipDiscardedAction(clipId: string, discarded: boolean): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(clipId).success) return { ok: false, error: "Clip no válido." };
  await setClipDiscarded(clipId, Boolean(discarded));
  refresh();
  return { ok: true };
}

/** "Abrir en el editor" (va al proyecto) o "Exportar directo" (se queda en la pantalla de clips). */
export async function createClipProjectAction(clipId: string, mode: "editor" | "export"): Promise<ActionResult<{ projectId: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = z.object({ clipId: idSchema, mode: z.enum(["editor", "export"]) }).safeParse({ clipId, mode });
  if (!parsed.success) return { ok: false, error: "Clip no válido." };
  let projectId: string;
  try {
    projectId = await createClipProject(parsed.data.clipId, parsed.data.mode, user.id);
  } catch (error) {
    return fail(error);
  }
  if (parsed.data.mode === "editor") redirect(`/editor/${projectId}`);
  refresh();
  return { ok: true, data: { projectId } };
}
