"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { MusicProviderError, removeJamendoKey, saveJamendoKey } from "@/lib/video/music-providers";

/** Ajustes → Claves de servicios: el client_id de Jamendo del cliente (música con licencia CC BY). Solo el dueño. */
export type MusicKeyState = { ok?: boolean; error?: string; label?: string };

const keySchema = z.string().trim().min(6, "Ese client_id es demasiado corto. Cópialo completo.").max(64, "Ese client_id es demasiado largo.");

export async function saveJamendoKeyAction(_prev: MusicKeyState, formData: FormData): Promise<MusicKeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = keySchema.safeParse(String(formData.get("clientId") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!(await allowAttempt(`jamendo-key:${owner.id}`, 10, 3600))) return { error: "Probaste muchas veces seguidas. Espera unos minutos." };
  try {
    const saved = await saveJamendoKey(parsed.data, owner.id);
    refresh();
    return { ok: true, label: saved.label };
  } catch (error) {
    if (error instanceof MusicProviderError) return { error: error.message };
    console.error("[jamendo] guardar:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar el client_id. Prueba de nuevo." };
  }
}

export async function removeJamendoKeyAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeJamendoKey();
  refresh();
  return { ok: true };
}
