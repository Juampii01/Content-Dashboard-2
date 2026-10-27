import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Credencial de imágenes del propio cliente, cifrada en `service_credentials` (mismo patrón que HeyGen): su API key de
 * OpenAI. Se descifra solo en el servidor y solo para mandársela al worker dentro de un trabajo en curso.
 * (La sesión de ChatGPT por Codex se quitó: los productos de terceros no pueden usar la cuenta personal del usuario.)
 */
const CONTEXT = { OPENAI: "openai.api_key" } as const;
export type ImageCredentialKind = keyof typeof CONTEXT;

export class CredentialError extends Error {}

export async function credentialRow(kind: ImageCredentialKind) {
  const [row] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, kind)).limit(1);
  return row ?? null;
}

export async function readSecret(kind: ImageCredentialKind): Promise<string | null> {
  const row = await credentialRow(kind);
  return row ? decryptSecret(row.secretEnc, CONTEXT[kind]) : null;
}

async function upsert(kind: ImageCredentialKind, secret: string, label: string | null, userId: string | null) {
  const values = { secretEnc: encryptSecret(secret, CONTEXT[kind]), label, updatedBy: userId, updatedAt: new Date() };
  await getDb()
    .insert(schema.serviceCredentials)
    .values({ provider: kind, ...values })
    .onConflictDoUpdate({ target: schema.serviceCredentials.provider, set: values });
}

export async function removeCredential(kind: ImageCredentialKind): Promise<void> {
  await getDb().delete(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, kind));
}

// ─── API key de OpenAI ────────────────────────────────────────────────────

/** Valida la key contra OpenAI (lista de modelos: no gasta nada) y la guarda cifrada. */
export async function saveOpenAiKey(key: string, userId: string): Promise<{ label: string; imageModel: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${env().OPENAI_API_BASE.replace(/\/+$/, "")}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new CredentialError("No pudimos comunicarnos con OpenAI para validar la key. Prueba de nuevo en unos minutos.");
  }
  if (res.status === 401) throw new CredentialError("OpenAI dice que esa API key no es válida. Cópiala de nuevo desde platform.openai.com/api-keys.");
  if (res.status === 429) throw new CredentialError("Tu cuenta de OpenAI no tiene saldo o está limitada. Revisa la facturación en platform.openai.com.");
  if (!res.ok) throw new CredentialError("OpenAI no pudo validar la key en este momento. Prueba de nuevo en unos minutos.");
  const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  const imageModel = Boolean(body?.data?.some((m) => m.id?.startsWith("gpt-image")));
  const label = key.slice(-4);
  await upsert("OPENAI", key, label, userId);
  return { label, imageModel };
}
