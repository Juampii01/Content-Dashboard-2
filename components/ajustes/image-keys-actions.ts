"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { CredentialError, removeCredential, saveOpenAiKey } from "@/lib/carousels/images/credentials";

/** Ajustes → Claves de servicios: la API key de OpenAI del cliente para generar imágenes. Solo el dueño la cambia. */
export type KeyState = { ok?: boolean; error?: string; label?: string; note?: string };

const keySchema = z
  .string()
  .trim()
  .min(20, "Esa API key es demasiado corta. Cópiala completa desde platform.openai.com/api-keys.")
  .max(300, "Esa API key es demasiado larga. Revisa que copiaste solo la clave.")
  .regex(/^sk-[A-Za-z0-9_\-]+$/, "Las API keys de OpenAI empiezan con sk-. Cópiala de nuevo, sin espacios ni comillas.");

export async function saveOpenAiKeyAction(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const parsed = keySchema.safeParse(String(formData.get("apiKey") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    const saved = await saveOpenAiKey(parsed.data, owner.id);
    refresh();
    return { ok: true, label: saved.label, note: saved.imageModel ? undefined : "La key es válida, pero tu cuenta todavía no muestra los modelos de imágenes. Puede que OpenAI pida verificar tu organización." };
  } catch (error) {
    if (error instanceof CredentialError) return { error: error.message };
    console.error("[openai] guardar key:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar la API key. Prueba de nuevo en unos minutos." };
  }
}

export async function removeOpenAiKeyAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await removeCredential("OPENAI");
  refresh();
  return { ok: true };
}
