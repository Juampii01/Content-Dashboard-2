import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";

/**
 * La clave de API de ScrapeCreators del propio cliente (Ajustes → Claves de servicios). Es el plan B del worker para
 * bajar links de Instagram y TikTok cuando la red bloquea la descarga desde el servidor (cada descarga gasta 1 crédito
 * de su cuenta). Se guarda cifrada en `service_credentials` con su propio contexto y nunca se muestra completa; el
 * worker la pide por `/api/worker/scrapecreators` solo mientras corre un trabajo.
 */
const CONTEXT = "scrapecreators.api_key";
const PROVIDER = "SCRAPECREATORS" as const;
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;
export const SCRAPECREATORS_API = "https://api.scrapecreators.com";

export class ScrapeCreatorsKeyError extends Error {}

export type ScrapeCreatorsKeyStatus = { configured: boolean; label: string | null; updatedAt: string | null };

async function row() {
  const [r] = await getDb().select().from(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, PROVIDER)).limit(1);
  return r ?? null;
}

export async function scrapeCreatorsKeyStatus(): Promise<ScrapeCreatorsKeyStatus> {
  const r = await row();
  return { configured: Boolean(r), label: r?.label ?? null, updatedAt: r?.updatedAt?.toISOString() ?? null };
}

/** La clave descifrada, o null si el cliente no cargó una. Sin caché: se lee pocas veces (solo en el plan B). */
export async function readScrapeCreatorsKey(): Promise<string | null> {
  const r = await row();
  return r ? decryptSecret(r.secretEnc, CONTEXT) : null;
}

/** Limpia lo que se pega (espacios, comillas, `SCRAPECREATORS_API_KEY=` delante) y revisa la forma. */
export function parseScrapeCreatorsKey(raw: string): string {
  const key = raw
    .trim()
    .replace(/^export\s+/i, "")
    .replace(/^SCRAPECREATORS_API_KEY\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (!KEY_RE.test(key)) throw new ScrapeCreatorsKeyError("Esa clave no tiene la forma esperada. Copia la clave completa desde tu panel de ScrapeCreators.");
  return key;
}

/**
 * Prueba la clave contra ScrapeCreators sin gastar créditos (saldo de la cuenta) y devuelve los créditos que quedan.
 * `fetcher` existe para las pruebas.
 */
export async function checkScrapeCreatorsKey(key: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  let res: Response;
  try {
    res = await fetcher(`${SCRAPECREATORS_API}/v1/account/credit-balance`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new ScrapeCreatorsKeyError("No pudimos comunicarnos con ScrapeCreators para probar la clave. Prueba de nuevo en un minuto.");
  }
  if (res.status === 401 || res.status === 403) throw new ScrapeCreatorsKeyError("ScrapeCreators no aceptó esa clave. Revisa que esté activa y copiada completa.");
  if (!res.ok) throw new ScrapeCreatorsKeyError("ScrapeCreators no respondió bien al probar la clave. Prueba de nuevo en un minuto.");
  const data = (await res.json().catch(() => ({}))) as { credits_remaining?: unknown; creditCount?: unknown };
  const credits = Number(data.credits_remaining ?? data.creditCount);
  return Number.isFinite(credits) ? credits : null;
}

export async function saveScrapeCreatorsKey(raw: string, userId: string | null, fetcher: typeof fetch = fetch): Promise<{ label: string; credits: number | null }> {
  const key = parseScrapeCreatorsKey(raw);
  const credits = await checkScrapeCreatorsKey(key, fetcher);
  const label = key.slice(-4);
  const values = { secretEnc: encryptSecret(key, CONTEXT), label, updatedBy: userId, updatedAt: new Date() };
  await getDb()
    .insert(schema.serviceCredentials)
    .values({ provider: PROVIDER, ...values })
    .onConflictDoUpdate({ target: schema.serviceCredentials.provider, set: values });
  return { label, credits };
}

export async function removeScrapeCreatorsKey(): Promise<void> {
  await getDb().delete(schema.serviceCredentials).where(eq(schema.serviceCredentials.provider, PROVIDER));
}

/** Botón «Probar»: créditos que quedan con la clave guardada (no gasta créditos). */
export async function testSavedScrapeCreatorsKey(fetcher: typeof fetch = fetch): Promise<number | null> {
  const key = await readScrapeCreatorsKey();
  if (!key) throw new ScrapeCreatorsKeyError("Todavía no hay una clave de ScrapeCreators guardada.");
  return checkScrapeCreatorsKey(key, fetcher);
}
