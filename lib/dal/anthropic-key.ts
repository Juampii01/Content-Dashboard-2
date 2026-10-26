import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { anthropicKeyStatus, type AnthropicKeyStatus } from "@/lib/ai/anthropic-key";
import { legacyClaudePlanSaved } from "@/lib/ai/claude-plan";
import { env } from "@/lib/env";

export type AnthropicKeyPanelStatus = { isOwner: boolean; key: AnthropicKeyStatus; serverKey: boolean; legacyPlan: boolean };

/** Ajustes → Claves de servicios: la clave de API de Anthropic del cliente (sin la clave) y si queda un token viejo. */
export async function getAnthropicKeyStatus(): Promise<AnthropicKeyPanelStatus> {
  const me = await getCurrentUser();
  const [key, legacyPlan] = await Promise.all([
    anthropicKeyStatus().catch(() => ({ configured: false, label: null, updatedAt: null })),
    legacyClaudePlanSaved().catch(() => false),
  ]);
  return { isOwner: me.role === "OWNER", key, serverKey: Boolean(env().ANTHROPIC_API_KEY), legacyPlan };
}
