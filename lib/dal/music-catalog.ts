import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { jamendoKeyStatus } from "@/lib/video/music-providers";

/** Ajustes y Estudio: si el cliente conectó el catálogo de música (Jamendo) y quién puede cambiar la clave. */
export async function getMusicCatalogStatus(): Promise<{ isOwner: boolean; jamendo: { configured: boolean; label: string | null; updatedAt: string | null } }> {
  const me = await getCurrentUser();
  const s = await jamendoKeyStatus().catch(() => ({ configured: false, label: null, updatedAt: null }));
  return { isOwner: me.role === "OWNER", jamendo: { configured: s.configured, label: s.label, updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null } };
}
