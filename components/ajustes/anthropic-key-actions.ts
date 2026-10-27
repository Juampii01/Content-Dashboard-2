"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AnthropicKeyError, removeAnthropicKey, saveAnthropicKey } from "@/lib/ai/anthropic-key";
import { isDenied, requireOwner } from "@/lib/auth";

export type AnthropicKeyState = { ok?: boolean; error?: string };

const keySchema = z.string().trim().min(20, "Esa clave es demasiado corta. Cópiala completa.").max(400, "Esa clave es demasiado larga. Revisa que copiaste solo la clave.");

/** Solo el dueño: revisa la clave con Anthropic (sin gastar tokens) y la guarda cifrada. */
export async function saveAnthropicKeyAction(_prev: AnthropicKeyState, formData: FormData): Promise<AnthropicKeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = keySchema.safeParse(String(formData.get("apiKey") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await saveAnthropicKey(parsed.data, owner.id);
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AnthropicKeyError) return { error: error.message };
    console.error("[anthropic] guardar clave:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar la clave. Vuelve a intentarlo en unos minutos." };
  }
}

export async function removeAnthropicKeyAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeAnthropicKey();
  refresh();
  return { ok: true };
}
