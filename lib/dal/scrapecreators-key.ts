import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { scrapeCreatorsKeyStatus, type ScrapeCreatorsKeyStatus } from "@/lib/scrapecreators/key";

export type ScrapeCreatorsKeyPanelStatus = { isOwner: boolean; key: ScrapeCreatorsKeyStatus };

/** Ajustes → Claves de servicios: la clave de ScrapeCreators del cliente (sin la clave). */
export async function getScrapeCreatorsKeyStatus(): Promise<ScrapeCreatorsKeyPanelStatus> {
  const me = await getCurrentUser();
  const key = await scrapeCreatorsKeyStatus().catch(() => ({ configured: false, label: null, updatedAt: null }));
  return { isOwner: me.role === "OWNER", key };
}
