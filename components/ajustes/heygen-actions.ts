"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { HeyGenError, type HeyGenBalance } from "@/lib/heygen/client";
import { removeApiKey, retryWebhookRegistration, saveApiKey } from "@/lib/heygen/service";

export type HeyGenKeyState = { ok?: boolean; error?: string; balance?: HeyGenBalance; webhookError?: string | null };

const keySchema = z
  .string()
  .trim()
  .min(20, "Esa API key es demasiado corta. Cópiala completa desde HeyGen.")
  .max(300, "Esa API key es demasiado larga. Revisa que copiaste solo la clave.")
  .regex(/^[A-Za-z0-9_\-.=+/]+$/, "La API key tiene caracteres raros. Cópiala de nuevo, sin espacios ni comillas.");

/** Solo el dueño: valida la key contra HeyGen, la guarda cifrada y registra el webhook. */
export async function saveHeyGenKeyAction(_prev: HeyGenKeyState, formData: FormData): Promise<HeyGenKeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = keySchema.safeParse(String(formData.get("apiKey") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    const result = await saveApiKey(parsed.data, owner.id);
    refresh();
    return { ok: true, balance: result.balance, webhookError: result.webhookError };
  } catch (error) {
    if (error instanceof HeyGenError) {
      console.error("[heygen] guardar key:", error.detail);
      return { error: error.userMessage };
    }
    console.error("[heygen] guardar key:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar la API key. Vuelve a intentarlo en unos minutos." };
  }
}

export async function removeHeyGenKeyAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeApiKey();
  refresh();
  return { ok: true };
}

export async function retryHeyGenWebhookAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  const problem = await retryWebhookRegistration();
  refresh();
  return problem ? { ok: false, error: problem } : { ok: true };
}
