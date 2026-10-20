import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Credenciales de imágenes del propio cliente, cifradas en `service_credentials` (mismo patrón que HeyGen):
 * - CHATGPT: el `auth.json` de Codex (sesión de su cuenta de ChatGPT). Lo guarda el worker al conectar o al refrescar.
 * - OPENAI: su API key de OpenAI (respaldo).
 * Se descifran solo en el servidor y solo para mandárselas al worker dentro de un trabajo en curso.
 */
const CONTEXT = { CHATGPT: "chatgpt.auth", OPENAI: "openai.api_key" } as const;
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

// ─── ChatGPT (auth.json de Codex) ─────────────────────────────────────────

/** Correo de la cuenta, leído del id_token (sin verificar la firma: solo para mostrar a quién está conectado). */
function emailFromAuth(auth: Record<string, unknown>): string | null {
  const tokens = auth.tokens as Record<string, unknown> | undefined;
  const idToken = typeof tokens?.id_token === "string" ? tokens.id_token : null;
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  return `${user.slice(0, 2)}${"·".repeat(Math.max(1, Math.min(4, user.length - 2)))}@${domain}`;
}

/** Revisa que el texto sea un auth.json de Codex con sesión de ChatGPT. Devuelve el JSON normalizado. */
export function parseChatGptAuth(raw: string): { json: string; label: string } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    throw new CredentialError("Eso no es un auth.json válido. Copia el archivo completo, desde la primera { hasta la última }.");
  }
  const tokens = data.tokens as Record<string, unknown> | undefined;
  const hasSession = typeof tokens?.access_token === "string" && typeof tokens?.refresh_token === "string";
  if (!hasSession) {
    throw new CredentialError(
      typeof data.OPENAI_API_KEY === "string" && data.OPENAI_API_KEY
        ? "Ese auth.json usa una API key, no tu cuenta de ChatGPT. Pega la API key en “API key de OpenAI” o entra a Codex con tu cuenta de ChatGPT."
        : "Ese auth.json no tiene una sesión de ChatGPT. Entra a Codex con tu cuenta (codex login) y vuelve a copiarlo.",
    );
  }
  const email = emailFromAuth(data);
  return { json: JSON.stringify(data), label: email ? maskEmail(email) : "Cuenta de ChatGPT" };
}

export async function saveChatGptAuth(raw: string, userId: string | null): Promise<{ label: string }> {
  const parsed = parseChatGptAuth(raw);
  await upsert("CHATGPT", parsed.json, parsed.label, userId);
  return { label: parsed.label };
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
