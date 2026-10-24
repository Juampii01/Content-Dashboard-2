"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { fileDriver } from "@/lib/storage";
import { applyPlanVariant, requestEdit, reserveReferenceUpload, saveBrief } from "@/lib/video/director/service";
import { BUDGET, briefSchema } from "@/lib/video/director/types";
import { loadProject, VideoError } from "@/lib/video/service";

/**
 * Acciones del director de edición: el brief (y el tope de IA), "Edítalo así", los arreglos de la revisión final y
 * las versiones. Todo pasa por requireEditor y se valida con Zod.
 */
type Result = { ok: true } | { ok: false; error: string };

const idSchema = z.uuid();
const budgetSchema = z.number().min(BUDGET.min).max(BUDGET.max);

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof VideoError) return { ok: false, error: error.message };
  console.error("[editor/director]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Algo salió mal. Prueba de nuevo." };
}

/** Guarda el brief y el tope de IA del video (en la subida o en la revisión). */
export async function saveBriefAction(projectId: string, brief: z.input<typeof briefSchema>, budgetUsd: number | null): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = briefSchema.safeParse(brief);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Datos no válidos." };
  if (budgetUsd != null && !budgetSchema.safeParse(budgetUsd).success) return { ok: false, error: `El tope va de USD ${BUDGET.min} a USD ${BUDGET.max}.` };
  try {
    if (!(await loadProject(projectId))) return { ok: false, error: "No encontramos ese proyecto." };
    await saveBrief(projectId, parsed.data, budgetUsd);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const instructionSchema = z.string().trim().min(3, "Escribe qué quieres cambiar.").max(600, "El pedido es demasiado largo: resúmelo en pocas frases.");

const attachSchema = z
  .object({
    link: z
      .string()
      .trim()
      .max(500)
      .refine((v) => !v || /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//i.test(v), "Pega un link de Instagram, TikTok o YouTube.")
      .optional(),
    upload: z.boolean().optional(),
  })
  .optional();

/** "Edítalo así": el pedido pasa por el director con todo el contexto y vuelve a la revisión. Puede llevar una referencia (link o el video que se acaba de subir). */
export async function editAction(projectId: string, instruction: string, kind: "edit" | "fix" = "edit", attach?: z.input<typeof attachSchema>): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = instructionSchema.safeParse(instruction);
  const ref = attachSchema.safeParse(attach);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Proyecto no válido." };
  if (!ref.success) return { ok: false, error: ref.error.issues[0]?.message ?? "La referencia no es válida." };
  try {
    await requestEdit(projectId, parsed.data, kind === "fix" ? "fix" : "edit", user.id, { link: ref.data?.link || null, upload: Boolean(ref.data?.upload) });
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const referenceFileSchema = z.object({ fileName: z.string().trim().min(1).max(300), fileType: z.string().max(100), fileSize: z.number().int().positive() });

/** Reserva la subida de un video de referencia para "Edítalo así" (el archivo va directo al almacenamiento). */
export async function reserveReferenceAction(projectId: string, file: z.input<typeof referenceFileSchema>): Promise<{ ok: true; data: { key: string; mode: "blob" | "local" } } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = referenceFileSchema.safeParse(file);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: "Archivo no válido." };
  const mode = fileDriver();
  if (!mode) return { ok: false, error: "Falta configurar el almacenamiento de videos en esta instalación. Avísale a soporte." };
  try {
    const { key } = await reserveReferenceUpload(projectId, parsed.data);
    return { ok: true, data: { key, mode } };
  } catch (error) {
    return fail(error);
  }
}

/** Cambia a una versión propuesta por el director (la actual queda guardada como "Versión anterior"). */
export async function applyVariantAction(projectId: string, variantId: string): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !/^v[a-z0-9]{1,20}$/.test(variantId)) return { ok: false, error: "Versión no válida." };
  try {
    await applyPlanVariant(projectId, variantId);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
