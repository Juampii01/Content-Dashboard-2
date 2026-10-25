"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { ClaudePlanError, removeClaudePlanToken, saveClaudePlanToken } from "@/lib/ai/claude-plan";

/** Ajustes → Claves de servicios: el token de la suscripción de Claude del cliente. Solo el dueño. */
export type ClaudePlanState = { ok?: boolean; error?: string; label?: string };

const tokenSchema = z.string().trim().min(20, "Pega el token completo.").max(2000, "Eso es demasiado largo para un token.");

export async function saveClaudePlanAction(_prev: ClaudePlanState, formData: FormData): Promise<ClaudePlanState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = tokenSchema.safeParse(String(formData.get("token") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!(await allowAttempt(`claude-plan:${owner.id}`, 10, 3600))) return { error: "Probaste muchas veces seguidas. Espera unos minutos." };
  try {
    const saved = await saveClaudePlanToken(parsed.data, owner.id);
    refresh();
    return { ok: true, label: saved.label };
  } catch (error) {
    if (error instanceof ClaudePlanError) return { error: error.message };
    console.error("[claude-plan] guardar:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar el token. Prueba de nuevo." };
  }
}

export async function removeClaudePlanAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeClaudePlanToken();
  refresh();
  return { ok: true };
}
