import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBrand, type Brand } from "@/lib/ai/brand-context";

export type { Brand };

export async function getBrandProfile(): Promise<Brand | null> {
  await getCurrentUser();
  return getBrand();
}

/** Textos de las piezas propias que mejor rindieron: sirven como punto de partida para las muestras de voz. */
export async function getVoiceSuggestions(limit = 5): Promise<{ id: string; label: string; text: string }[]> {
  await getCurrentUser();
  const rows = await getDb().execute<{ id: string; platform: string; title: string | null; caption: string | null; perf_score: number | null }>(sql`
    select id, platform, title, caption, perf_score from content_items
    where available and coalesce(length(caption), 0) > 80
    order by perf_score desc nulls last, views desc nulls last limit ${limit}
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    label: `${r.platform === "INSTAGRAM" ? "Instagram" : r.platform === "YOUTUBE" ? "YouTube" : "TikTok"}${r.perf_score ? ` · ×${Number(r.perf_score).toFixed(1)}` : ""}`,
    text: [r.title, r.caption].filter(Boolean).join("\n\n").slice(0, 2500),
  }));
}

/** true si la marca tiene lo mínimo para que los guiones suenen a ella. */
export function brandIsReady(brand: Brand | null): boolean {
  return Boolean(brand && brand.niche && brand.audience && (brand.audiencePains.length > 0 || brand.voiceSamples.length > 0));
}
