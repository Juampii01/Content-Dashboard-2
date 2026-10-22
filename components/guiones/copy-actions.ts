"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { OBJECTIVES, type ObjectiveKey } from "@/lib/ai/prompts/guiones";
import { allowAttempt } from "@/lib/rate-limit";
import { fileDriver } from "@/lib/storage";
import { completeCopyUpload, createCopyFromLink, createCopyUpload, deleteCopy, ReelCopyError, retryCopy } from "@/lib/scripts/reel-copy-service";
import { StyleError } from "@/lib/video/styles";

/**
 * Acciones de "Copia este reel". Exigen permiso de edición; cada copia usa la IA dos veces y el worker, así que
 * tienen tope por hora.
 */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const LIMIT_MSG = "Pediste muchas copias seguidas. Espera unos minutos y vuelve a intentar.";

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof ReelCopyError || error instanceof StyleError) return { ok: false, error: error.message };
  console.error("[copia]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

const options = z.object({
  topic: z.string().trim().max(300, "El tema es demasiado largo: cuéntalo en una o dos frases.").optional(),
  objective: z.enum(Object.keys(OBJECTIVES) as [ObjectiveKey, ...ObjectiveKey[]]),
});
const linkSchema = options.extend({ link: z.string().trim().min(8, "Pega el link del video.").max(600, "Ese link es demasiado largo.") });
const fileSchema = options.extend({ fileName: z.string().min(1).max(300), fileType: z.string().max(100), fileSize: z.number().int().positive() });
const idSchema = z.uuid();
const mode = () => (fileDriver() === "blob" ? ("blob" as const) : ("local" as const));

async function guard() {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!aiConfigured()) return { ok: false as const, error: "La IA no está configurada en esta instalación. Avísale a soporte." };
  if (!(await allowAttempt(`copia:${user.id}`, 12, 3600))) return { ok: false as const, error: LIMIT_MSG };
  return user;
}

export async function createCopyLinkAction(input: z.input<typeof linkSchema>): Promise<ActionResult<{ id: string }>> {
  const user = await guard();
  if ("ok" in user) return user;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  try {
    const id = await createCopyFromLink({ link: parsed.data.link, topic: parsed.data.topic || null, objective: parsed.data.objective, userId: user.id });
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function createCopyUploadAction(input: z.input<typeof fileSchema>): Promise<ActionResult<{ id: string; styleId: string; key: string; mode: "blob" | "local" }>> {
  const user = await guard();
  if ("ok" in user) return user;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  try {
    const created = await createCopyUpload({ ...parsed.data, topic: parsed.data.topic || null, userId: user.id });
    return { ok: true, data: { ...created, mode: mode() } };
  } catch (error) {
    return fail(error);
  }
}

export async function completeCopyUploadAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Copia no válida." };
  try {
    await completeCopyUpload(id, user.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function retryCopyAction(id: string): Promise<ActionResult> {
  const user = await guard();
  if ("ok" in user) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Copia no válida." };
  try {
    await retryCopy(id, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteCopyAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Copia no válida." };
  try {
    await deleteCopy(id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
