import { getScrapeCreatorsKeyStatus } from "@/lib/dal/scrapecreators-key";
import { ScrapeCreatorsKeyPanel } from "./scrapecreators-key-panel";

/** Ajustes → Claves de servicios: la clave de ScrapeCreators para bajar links de Instagram y TikTok. Solo el dueño la cambia. */
export async function ScrapeCreatorsKeySection() {
  const status = await getScrapeCreatorsKeyStatus();
  return <ScrapeCreatorsKeyPanel status={status} />;
}
