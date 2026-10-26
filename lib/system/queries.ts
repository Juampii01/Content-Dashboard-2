import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { workerStatus } from "@/lib/jobs";
import { platformConfigured } from "@/lib/social/providers";
import type { ConnectionRow, FailStreak, FailedCloneRow, FailedJobRow, ServicesInput, WorkerInput } from "./status";

/**
 * Lecturas del estado del sistema. No revisan la sesión: las usan la página de Ajustes (detrás de lib/dal/system.ts,
 * que exige ser dueño) y el barrido de avisos del cron y del worker (sin sesión). Nunca devuelven secretos.
 */

/** Trabajos que procesa el worker (los de la app, como la sincronización, se ven en las conexiones). */
export const WORKER_JOB_TYPES = ["VIDEO_ANALYZE", "VIDEO_EDIT", "VIDEO_RENDER", "VIDEO_STYLE", "VIDEO_CLIP", "LONG_VIDEO_CLIPS", "CAROUSEL_IMAGES", "CAROUSEL_STYLE", "CODEX_LOGIN", "REEL_COPY", "CAROUSEL_COPY", "CAROUSEL_ANIMATE", "CLAUDE_LOGIN", "AUDIO_SPLIT"] as const;
const workerTypes = sql.raw(WORKER_JOB_TYPES.map((t) => `'${t}'`).join(", "));

export async function readWorker(): Promise<WorkerInput> {
  const w = await workerStatus();
  return { ...w, secretConfigured: Boolean(env().WORKER_SECRET) };
}

/** Trabajos fallidos de los últimos `days` días, con el estado actual de lo que procesaban. */
export async function readFailedJobs(days = 7): Promise<FailedJobRow[]> {
  const result = await getDb().execute<{ id: string; type: string; error_message: string | null; finished_at: Date | string; ref_id: string | null; ref_title: string | null; ref_status: string | null }>(sql`
    with failed as (
      select j.id, j.type::text as type, j.error_message, coalesce(j.finished_at, j.created_at) as finished_at, j.input,
        case
          when j.type in ('VIDEO_ANALYZE', 'VIDEO_EDIT', 'VIDEO_RENDER') then j.video_project_id::text
          when j.type = 'VIDEO_STYLE' then j.input->>'styleId'
          when j.type = 'VIDEO_CLIP' then j.input->>'clipId'
          when j.type = 'LONG_VIDEO_CLIPS' then j.input->>'longVideoId'
          when j.type = 'CAROUSEL_IMAGES' then j.input->>'carouselId'
          when j.type = 'CAROUSEL_STYLE' then j.input->>'templateId'
          when j.type = 'REEL_COPY' then j.input->>'reelCopyId'
          when j.type = 'CAROUSEL_COPY' then j.input->>'copyId'
          when j.type = 'CAROUSEL_ANIMATE' then j.input->>'carouselId'
          when j.type = 'AUDIO_SPLIT' then j.input->>'trackId'
          else null
        end as ref_id
      from jobs j
      where j.status = 'FAILED' and j.type in (${workerTypes})
        and coalesce(j.finished_at, j.created_at) > now() - make_interval(days => ${days})
      order by finished_at desc
      limit 100
    )
    select f.id, f.type, f.error_message, f.finished_at, f.ref_id,
      coalesce(p.title, vs.name, bc.title, lv.title, c.title, ct.name, rc.topic, mt.title, case when rc.id is not null then 'Copia de un reel' end) as ref_title,
      case
        when f.type in ('VIDEO_ANALYZE', 'VIDEO_EDIT', 'VIDEO_RENDER') then p.status::text
        when f.type = 'VIDEO_STYLE' then vs.status::text
        when f.type = 'VIDEO_CLIP' then bc.status::text
        when f.type = 'LONG_VIDEO_CLIPS' then lv.status::text
        when f.type = 'CAROUSEL_STYLE' then ct.status::text
        when f.type = 'REEL_COPY' then rc.status::text
        when f.type = 'AUDIO_SPLIT' then mt.status::text
        when f.type = 'CAROUSEL_IMAGES' and exists(
          select 1 from jobs later where later.type = 'CAROUSEL_IMAGES' and later.status = 'SUCCEEDED'
            and later.input->>'carouselId' = f.ref_id and later.created_at > f.finished_at
        ) then 'RECOVERED'
        when f.type = 'CLAUDE_LOGIN' and exists(
          select 1 from service_credentials sc where sc.provider = 'CLAUDE' and sc.updated_at > f.finished_at
        ) then 'RECOVERED'
        when f.type = 'CODEX_LOGIN' and exists(
          select 1 from service_credentials sc where sc.provider = 'CHATGPT' and sc.updated_at > f.finished_at
        ) then 'RECOVERED'
        else null
      end as ref_status
    from failed f
    left join video_projects p on f.type in ('VIDEO_ANALYZE', 'VIDEO_EDIT', 'VIDEO_RENDER') and p.id::text = f.ref_id
    left join video_styles vs on f.type = 'VIDEO_STYLE' and vs.id::text = f.ref_id
    left join broll_clips bc on f.type = 'VIDEO_CLIP' and bc.id::text = f.ref_id
    left join long_videos lv on f.type = 'LONG_VIDEO_CLIPS' and lv.id::text = f.ref_id
    left join carousels c on f.type = 'CAROUSEL_IMAGES' and c.id::text = f.ref_id
    left join carousel_templates ct on f.type = 'CAROUSEL_STYLE' and ct.id::text = f.ref_id
    left join reel_copies rc on f.type = 'REEL_COPY' and rc.id::text = f.ref_id
    left join music_tracks mt on f.type = 'AUDIO_SPLIT' and mt.id::text = f.ref_id
    order by f.finished_at desc
  `);
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    errorMessage: r.error_message,
    finishedAt: new Date(r.finished_at),
    refId: r.ref_id,
    refTitle: r.ref_title,
    // CODEX_LOGIN no apunta a nada: si no se recuperó, sigue pendiente.
    refStatus: r.ref_status,
  }));
}

export async function readFailedClones(days = 7): Promise<FailedCloneRow[]> {
  const result = await getDb().execute<{ id: string; title: string; error_message: string | null; updated_at: Date | string; heygen_video_id: string | null; retried_into: string | null }>(sql`
    select id, title, error_message, updated_at, heygen_video_id, retried_into
    from clone_videos
    where status = 'FAILED' and updated_at > now() - make_interval(days => ${days})
    order by updated_at desc limit 30
  `);
  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    errorMessage: r.error_message,
    updatedAt: new Date(r.updated_at),
    reachedHeyGen: Boolean(r.heygen_video_id),
    retriedInto: r.retried_into,
  }));
}

export async function readConnections(): Promise<ConnectionRow[]> {
  const result = await getDb().execute<{
    id: string;
    platform: ConnectionRow["platform"];
    handle: string;
    status: ConnectionRow["status"];
    status_message: string | null;
    demo: boolean;
    last_synced_at: Date | string | null;
    refresh_token_expires_at: Date | string | null;
    access_token_expires_at: Date | string | null;
    has_refresh: boolean;
    last_run_status: string | null;
    last_run_error: string | null;
  }>(sql`
    select sa.id, sa.platform, sa.handle, sa.status, sa.status_message,
      coalesce(sa.meta->>'demo', 'false') = 'true' as demo,
      sa.last_synced_at, sa.refresh_token_expires_at, sa.access_token_expires_at,
      sa.refresh_token_enc is not null as has_refresh,
      lr.status::text as last_run_status, lr.error_message as last_run_error
    from social_accounts sa
    left join lateral (
      select r.status, r.error_message from sync_runs r where r.social_account_id = sa.id and r.status <> 'RUNNING' order by r.started_at desc limit 1
    ) lr on true
    where sa.current
    order by array_position(array['INSTAGRAM','YOUTUBE','TIKTOK']::platform[], sa.platform)
  `);
  const date = (v: Date | string | null) => (v == null ? null : new Date(v));
  return result.rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    handle: r.handle,
    status: r.status,
    statusMessage: r.status_message,
    demo: Boolean(r.demo),
    lastSyncedAt: date(r.last_synced_at),
    refreshTokenExpiresAt: date(r.refresh_token_expires_at),
    accessTokenExpiresAt: date(r.access_token_expires_at),
    hasRefreshToken: Boolean(r.has_refresh),
    lastRunFailed: r.last_run_status === "FAILED",
    lastRunError: r.last_run_error,
  }));
}

export async function readServices(): Promise<ServicesInput> {
  const e = env();
  const creds = await getDb().execute<{ provider: string; webhook_error: string | null }>(sql`select provider::text as provider, webhook_error from service_credentials`);
  const has = (p: string) => creds.rows.some((r) => r.provider === p);
  return {
    anthropic: Boolean(e.ANTHROPIC_API_KEY) || has("ANTHROPIC"),
    resend: Boolean(e.RESEND_API_KEY && e.EMAIL_FROM),
    pexels: Boolean(e.PEXELS_API_KEY),
    pixabay: Boolean(e.PIXABAY_API_KEY),
    storage: Boolean(e.BLOB_READ_WRITE_TOKEN),
    videoStorage: Boolean(e.VIDEO_BLOB_READ_WRITE_TOKEN),
    heygen: has("HEYGEN"),
    heygenWebhookError: creds.rows.find((r) => r.provider === "HEYGEN")?.webhook_error ?? null,
    chatgpt: has("CHATGPT"),
    openai: has("OPENAI"),
    platformsConfigured: { INSTAGRAM: platformConfigured("INSTAGRAM"), YOUTUBE: platformConfigured("YOUTUBE"), TIKTOK: platformConfigured("TIKTOK") },
  };
}

/** Trabajos del worker que fallaron seguidos desde el último que salió bien (los cancelados no cuentan). */
export async function readFailStreak(): Promise<FailStreak> {
  const result = await getDb().execute<{ count: number; first_id: string | null }>(sql`
    with last_ok as (
      select max(finished_at) as at from jobs where status = 'SUCCEEDED' and type in (${workerTypes})
    ), streak as (
      select j.id, j.finished_at from jobs j, last_ok
      where j.status = 'FAILED' and j.type in (${workerTypes}) and j.finished_at is not null
        and (last_ok.at is null or j.finished_at > last_ok.at)
    )
    select count(*)::int as count, (select id from streak order by finished_at asc limit 1) as first_id from streak
  `);
  const row = result.rows[0];
  return { count: Number(row?.count ?? 0), firstFailedId: row?.first_id ?? null };
}
