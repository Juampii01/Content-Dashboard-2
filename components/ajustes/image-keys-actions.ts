"use server";

import { refresh } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireOwner } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { allowAttempt } from "@/lib/rate-limit";
import { CredentialError, removeCredential, saveChatGptAuth, saveOpenAiKey } from "@/lib/carousels/images/credentials";

/**
 * Ajustes → Claves de servicios: la cuenta de ChatGPT del cliente (para generar imágenes con Codex en el worker)
 * y, aparte, su API key de OpenAI (respaldo). Solo el dueño las cambia.
 */
export type KeyState = { ok?: boolean; error?: string; label?: string; note?: string };

/** Encola el login de ChatGPT por código de dispositivo (lo corre el worker). Cancela uno anterior a medias. */
export async function startChatGptLoginAction(): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  if (!(await allowAttempt(`chatgpt-login:${owner.id}`, 10, 3600))) return { ok: false, error: "Intentaste conectar muchas veces seguidas. Espera unos minutos." };
  await cancelLogins();
  const jobId = await enqueueJob({ type: "CODEX_LOGIN", input: {}, createdBy: owner.id, maxAttempts: 1, stage: "En cola" });
  return { ok: true, jobId };
}

async function cancelLogins() {
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "CODEX_LOGIN"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"])));
}

export async function cancelChatGptLoginAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await cancelLogins();
  return { ok: true };
}

/** Alternativa sin el worker: el dueño pega el contenido de su ~/.codex/auth.json. */
export async function saveChatGptAuthAction(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { error: owner.error };
  const raw = String(formData.get("authJson") ?? "");
  if (raw.trim().length < 20) return { error: "Pega el contenido completo del archivo auth.json." };
  if (raw.length > 50_000) return { error: "Eso es demasiado largo para un auth.json. Revisa que copiaste solo ese archivo." };
  try {
    const saved = await saveChatGptAuth(raw, owner.id);
    refresh();
    return { ok: true, label: saved.label };
  } catch (error) {
    if (error instanceof CredentialError) return { error: error.message };
    console.error("[chatgpt] guardar auth:", error instanceof Error ? error.message : "error");
    return { error: "No pudimos guardar la conexión. Prueba de nuevo." };
  }
}

export async function removeChatGptAction(): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (isDenied(owner)) return { ok: false, error: owner.error };
  await cancelLogins();
  await removeCredential("CHATGPT");
  refresh();
  return { ok: true };
}

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
