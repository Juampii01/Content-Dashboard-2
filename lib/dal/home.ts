import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Platform } from "@/lib/social/types";

/** Qué pasos del arranque faltan (para mostrar solo lo pendiente en Inicio). */
export async function getSetupProgress(): Promise<{ connected: boolean; brand: boolean; planned: boolean }> {
  await getCurrentUser();
  const result = await getDb().execute<{ connected: boolean; brand: boolean; planned: boolean }>(sql`
    select
      exists(select 1 from social_accounts where current) as connected,
      exists(select 1 from brand_profile where coalesce(niche, '') <> '' or coalesce(audience, '') <> '') as brand,
      exists(select 1 from calendar_entries) as planned
  `);
  return result.rows[0] ?? { connected: false, brand: false, planned: false };
}

/** Seguidores actuales y variación en 7 días por red conectada. */
export async function getFollowerSummary(): Promise<{ platform: Platform; handle: string; followers: number | null; change7d: number | null }[]> {
  await getCurrentUser();
  const result = await getDb().execute<{ platform: Platform; handle: string; now: number | null; before: number | null }>(sql`
    select sa.platform, sa.handle,
      (select followers from account_snapshots s where s.social_account_id = sa.id and followers is not null order by captured_on desc limit 1) as now,
      (select followers from account_snapshots s where s.social_account_id = sa.id and followers is not null and captured_on <= current_date - 7 order by captured_on desc limit 1) as before
    from social_accounts sa where sa.current
    order by array_position(array['INSTAGRAM','YOUTUBE','TIKTOK']::platform[], sa.platform)
  `);
  return result.rows.map((r) => ({
    platform: r.platform,
    handle: r.handle,
    followers: r.now == null ? null : Number(r.now),
    change7d: r.now != null && r.before != null ? Number(r.now) - Number(r.before) : null,
  }));
}
