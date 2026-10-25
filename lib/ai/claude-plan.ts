import "server-only";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";

/**
 * La suscripción de Claude del propio cliente (Pro o Max), para que las animaciones del Editor gasten su uso semanal y
 * no dólares de la API. Se guarda el token de larga duración que da `claude setup-token` (empieza con sk-ant-oat),
 * cifrado en `service_credentials` con su propio contexto. Solo se descifra para mandárselo al worker dentro de un
 * trabajo en curso; el worker lo usa con el SDK de agentes de Claude (worker/video/compos_agent.py).
 */
const CONTEXT = "claude.oauth";
const TOKEN_RE = /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,400}$/;

export class ClaudePlanError extends Error {}

export type ClaudePlanStatus = {
  connected: boolean;
  label: string | null;
  updatedAt: string | null;
};

async function row() {
  const [r] = await getDb()
    .select()
    .from(schema.serviceCredentials)
    .where(eq(schema.serviceCredentials.provider, "CLAUDE"))
    .limit(1);
  return r ?? null;
}

export async function claudePlanStatus(): Promise<ClaudePlanStatus> {
  const r = await row();
  return {
    connected: Boolean(r),
    label: r?.label ?? null,
    updatedAt: r?.updatedAt?.toISOString() ?? null,
  };
}

export async function claudePlanConnected(): Promise<boolean> {
  return Boolean(await row());
}

/** El token descifrado (solo para el worker). */
export async function readClaudePlanToken(): Promise<string | null> {
  const r = await row();
  return r ? decryptSecret(r.secretEnc, CONTEXT) : null;
}

/** Limpia lo que se pega (espacios, saltos de línea, comillas, `CLAUDE_CODE_OAUTH_TOKEN=` delante) y revisa la forma. */
export function parseClaudePlanToken(raw: string): string {
  const token = raw
    .trim()
    .replace(/^export\s+/i, "")
    .replace(/^CLAUDE_CODE_OAUTH_TOKEN\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (token.startsWith("sk-ant-api"))
    throw new ClaudePlanError(
      "Eso es una API key, no el token de tu suscripción. Corre `claude setup-token` y pega el que empieza con sk-ant-oat.",
    );
  if (!TOKEN_RE.test(token))
    throw new ClaudePlanError(
      "Ese token no tiene la forma esperada. Corre `claude setup-token` y copia la línea completa que empieza con sk-ant-oat.",
    );
  return token;
}

export async function saveClaudePlanToken(
  raw: string,
  userId: string | null,
): Promise<{ label: string }> {
  const token = parseClaudePlanToken(raw);
  const label = token.slice(-4);
  const values = {
    secretEnc: encryptSecret(token, CONTEXT),
    label,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(schema.serviceCredentials)
    .values({ provider: "CLAUDE", ...values })
    .onConflictDoUpdate({
      target: schema.serviceCredentials.provider,
      set: values,
    });
  return { label };
}

export async function removeClaudePlanToken(): Promise<void> {
  await getDb()
    .delete(schema.serviceCredentials)
    .where(eq(schema.serviceCredentials.provider, "CLAUDE"));
}
