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

export type ActiveWork = {
  id: string;
  kind: "video" | "clon";
  title: string;
  label: string; // etapa en español
  progress: number | null; // 0 a 100 si se conoce
  needsAction: boolean; // por ejemplo, un video listo para revisar
  href: string;
};

/** Trabajos en curso para Inicio: videos del editor procesando o esperando revisión, y videos con clon generándose. */
export async function getActiveWork(): Promise<ActiveWork[]> {
  await getCurrentUser();
  const db = getDb();
  const videos = await db.execute<{ id: string; title: string; status: string; stage: string | null; progress: number | null }>(sql`
    select p.id, p.title, p.status,
      (select j.stage from jobs j where j.video_project_id = p.id order by j.created_at desc limit 1) as stage,
      (select j.progress from jobs j where j.video_project_id = p.id and j.status in ('QUEUED', 'RUNNING') order by j.created_at desc limit 1) as progress
    from video_projects p
    where p.status in ('PROCESSING', 'AWAITING_REVIEW', 'RENDERING')
    order by p.updated_at desc limit 5
  `);
  const clones = await db.execute<{ id: string; title: string; status: string }>(sql`
    select id, title, status from clone_videos where status in ('QUEUED', 'PROCESSING') order by created_at desc limit 5
  `);
  return [
    ...videos.rows.map((v) => ({
      id: v.id,
      kind: "video" as const,
      title: v.title,
      label: v.status === "AWAITING_REVIEW" ? "Listo para revisar" : (v.stage ?? (v.status === "RENDERING" ? "Renderizando" : "Procesando")),
      progress: v.status === "AWAITING_REVIEW" ? null : v.progress == null ? null : Number(v.progress),
      needsAction: v.status === "AWAITING_REVIEW",
      href: `/editor/${v.id}`,
    })),
    ...clones.rows.map((c) => ({
      id: c.id,
      kind: "clon" as const,
      title: c.title,
      label: c.status === "QUEUED" ? "En cola en HeyGen" : "Generando con tu clon",
      progress: null,
      needsAction: false,
      href: `/clon/${c.id}`,
    })),
  ];
}
