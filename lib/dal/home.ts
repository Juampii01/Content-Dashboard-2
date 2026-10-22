import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { Platform } from "@/lib/social/types";
import type { SetupProgress } from "@/lib/home/onboarding";

/**
 * Qué hizo ya la instalación (guía de primer uso y bloques de Inicio). Las cuentas de demostración no cuentan
 * como redes conectadas; "dismissed" es por persona (cada miembro del equipo cierra su guía). Memorizado por request.
 */
export const getSetupProgress = cache(async (): Promise<SetupProgress> => {
  const user = await getCurrentUser();
  const result = await getDb().execute<Omit<SetupProgress, "dismissed"> & { dismissed: boolean }>(sql`
    select
      exists(select 1 from social_accounts where current and status <> 'DISCONNECTED' and coalesce(meta->>'demo', 'false') <> 'true') as connected,
      exists(select 1 from brand_profile where coalesce(trim(niche), '') <> '' and coalesce(trim(audience), '') <> '' and coalesce(trim(tone), '') <> '') as brand,
      (exists(select 1 from video_projects where status <> 'UPLOADING') or exists(select 1 from long_videos where status <> 'UPLOADING')) as video,
      exists(select 1 from scripts) as script,
      exists(select 1 from strategist_messages where role = 'user') as strategist,
      exists(select 1 from calendar_entries) as planned,
      exists(select 1 from team_members where user_id = ${user.id} and onboarding_dismissed_at is not null) as dismissed
  `);
  const row = result.rows[0];
  return {
    connected: Boolean(row?.connected),
    brand: Boolean(row?.brand),
    video: Boolean(row?.video),
    script: Boolean(row?.script),
    strategist: Boolean(row?.strategist),
    planned: Boolean(row?.planned),
    dismissed: Boolean(row?.dismissed),
  };
});

/** Hay alguna red con datos (reales o de demostración): decide si Inicio muestra el resumen de la semana. */
export async function hasAnyConnection(): Promise<boolean> {
  await getCurrentUser();
  const result = await getDb().execute<{ any: boolean }>(sql`select exists(select 1 from social_accounts where current) as any`);
  return Boolean(result.rows[0]?.any);
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
  kind: "video" | "clon" | "carrusel";
  title: string;
  label: string; // etapa en español
  progress: number | null; // 0 a 100 si se conoce
  needsAction: boolean; // por ejemplo, un video listo para revisar
  href: string;
};

/** Trabajos en curso para Inicio: videos del editor, videos con clon, imágenes de carruseles y plantillas copiándose. */
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
  // Carruseles: imágenes generándose y plantillas copiando un estilo.
  const carousels = await db.execute<{ id: string; type: string; ref: string; title: string | null; stage: string | null; progress: number | null }>(sql`
    select j.id, j.type, coalesce(j.input->>'carouselId', j.input->>'templateId') as ref, j.stage, j.progress,
      coalesce((select c.title from carousels c where c.id::text = j.input->>'carouselId'), (select t.name from carousel_templates t where t.id::text = j.input->>'templateId')) as title
    from jobs j
    where j.type in ('CAROUSEL_IMAGES', 'CAROUSEL_STYLE') and j.status in ('QUEUED', 'RUNNING')
    order by j.created_at desc limit 5
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
    ...carousels.rows
      .filter((c) => c.title)
      .map((c) => ({
        id: c.id,
        kind: "carrusel" as const,
        title: c.type === "CAROUSEL_STYLE" ? `Plantilla: ${c.title}` : c.title!,
        label: c.stage ?? (c.type === "CAROUSEL_STYLE" ? "Copiando el estilo" : "Generando imágenes"),
        progress: c.progress == null ? null : Number(c.progress),
        needsAction: false,
        href: c.type === "CAROUSEL_STYLE" ? `/carruseles/plantillas/${c.ref}` : `/carruseles/${c.ref}`,
      })),
  ];
}
