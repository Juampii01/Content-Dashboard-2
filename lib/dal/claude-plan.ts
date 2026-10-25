import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { claudePlanStatus, type ClaudePlanStatus } from "@/lib/ai/claude-plan";

/** Ajustes → Claves de servicios: la suscripción de Claude conectada (sin el token). */
export async function getClaudePlanStatus(): Promise<{ isOwner: boolean; claude: ClaudePlanStatus }> {
  const me = await getCurrentUser();
  const claude = await claudePlanStatus().catch(() => ({ connected: false, label: null, updatedAt: null }));
  return { isOwner: me.role === "OWNER", claude };
}
