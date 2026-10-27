import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";

/**
 * La clave de API de Anthropic del propio cliente (Ajustes → Claves de servicios). Todas las llamadas a Claude de la
 * app usan esta clave si está; si no, la del servidor (ANTHROPIC_API_KEY), si la instalación tiene una. Así el consumo
 * de IA se le cobra directo al cliente en su cuenta de Anthropic, que es lo que permiten los términos de Anthropic
 * para productos de terceros (no se puede usar la suscripción Pro o Max del usuario).
 * Se guarda cifrada en `service_credentials` con su propio contexto y nunca se muestra completa.
 */
const CONTEXT = "anthropic.api_key";
const KEY_RE = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{40,300}$/;

export class AnthropicKeyError extends Error {}

export type AnthropicKeyStatus = { configured: boolean; label: string | null; updatedAt: string | null };

let cache: { key: string | null; at: number } | null = null;
const CACHE_MS = 60_000;

async function row() {
  const [r] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "ANTHROPIC")).limit(1);
  return r ?? null;
}

export async function anthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  const r = await row();
  return { configured: Boolean(r), label: r?.label ?? null, updatedAt: r?.updatedAt?.toISOString() ?? null };
}

/** La clave del cliente descifrada (con caché de un minuto por instancia), o null si no cargó una. */
export async function readAnthropicKey(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.key;
  const r = await row();
  const key = r ? decryptSecret(r.secretEnc, CONTEXT) : null;
  cache = { key, at: Date.now() };
  return key;
}

/** Limpia lo que se pega (espacios, comillas, `ANTHROPIC_API_KEY=` delante) y revisa la forma. */
export function parseAnthropicKey(raw: string): string {
  const key = raw
    .trim()
    .replace(/^export\s+/i, "")
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (key.startsWith("sk-ant-oat")) throw new AnthropicKeyError("Eso es el token de una suscripción de Claude, no una clave de API. Crea una clave en console.anthropic.com → API Keys.");
  if (!KEY_RE.test(key)) throw new AnthropicKeyError("Esa clave no tiene la forma esperada. Copia la clave completa que empieza con sk-ant-api.");
  return key;
}

/** Prueba la clave contra Anthropic sin gastar tokens (lista de modelos). */
export async function checkAnthropicKey(key: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new AnthropicKeyError("No pudimos comunicarnos con Anthropic para probar la clave. Prueba de nuevo en un minuto.");
  }
  if (res.status === 401 || res.status === 403) throw new AnthropicKeyError("Anthropic no aceptó esa clave. Revisa que esté activa y copiada completa.");
  if (!res.ok) throw new AnthropicKeyError("Anthropic no respondió bien al probar la clave. Prueba de nuevo en un minuto.");
}

export async function saveAnthropicKey(raw: string, userId: string | null): Promise<{ label: string }> {
  const key = parseAnthropicKey(raw);
  await checkAnthropicKey(key);
  const label = key.slice(-4);
  const values = { secretEnc: encryptSecret(key, CONTEXT), label, updatedBy: userId, updatedAt: new Date() };
  await getDb()
    .insert(schema.serviceCredentials)
    .values({ provider: "ANTHROPIC", ...values })
    .onConflictDoUpdate({ target: schema.serviceCredentials.provider, set: values });
  cache = null;
  return { label };
}

export async function removeAnthropicKey(): Promise<void> {
  await getDb().delete(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, "ANTHROPIC"));
  cache = null;
}
