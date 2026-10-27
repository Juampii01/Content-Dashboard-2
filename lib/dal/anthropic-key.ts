import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { anthropicKeyStatus, type AnthropicKeyStatus } from "@/lib/ai/anthropic-key";
import { env } from "@/lib/env";

export type AnthropicKeyPanelStatus = { isOwner: boolean; key: AnthropicKeyStatus; serverKey: boolean };

/** Ajustes → Claves de servicios: la clave de API de Anthropic del cliente (sin la clave). */
export async function getAnthropicKeyStatus(): Promise<AnthropicKeyPanelStatus> {
  const me = await getCurrentUser();
  const key = await anthropicKeyStatus().catch(() => ({ configured: false, label: null, updatedAt: null }));
  return { isOwner: me.role === "OWNER", key, serverKey: Boolean(env().ANTHROPIC_API_KEY) };
}
