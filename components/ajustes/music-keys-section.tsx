import { getMusicCatalogStatus } from "@/lib/dal/music-catalog";
import { MusicKeysPanel } from "./music-keys-panel";

/** Ajustes → Claves de servicios: catálogo de música con licencia comercial (Jamendo). */
export async function MusicKeysSection() {
  const status = await getMusicCatalogStatus();
  return <MusicKeysPanel status={status} />;
}
