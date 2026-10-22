"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { applyPlanVariant, requestEdit, saveBrief } from "@/lib/video/director/service";
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

/** "Edítalo así": el pedido pasa por el director con todo el contexto y vuelve a la revisión. */
export async function editAction(projectId: string, instruction: string, kind: "edit" | "fix" = "edit"): Promise<Result> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = instructionSchema.safeParse(instruction);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Proyecto no válido." };
  try {
    await requestEdit(projectId, parsed.data, kind === "fix" ? "fix" : "edit", user.id);
    refresh();
    return { ok: true };
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
