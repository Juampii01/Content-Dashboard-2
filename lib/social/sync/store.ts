import "server-only";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { copyRemoteImage } from "@/lib/storage";
import { env } from "@/lib/env";
import { todayIn } from "@/lib/metrics/params";
import { mapLimit, type SyncContext } from "../http";
import type { AccountDay, AccountProfile, ItemMetrics, NormalizedItem, Platform } from "../types";

/**
 * Escritura de lo sincronizado. Reglas:
 * - Upsert por (red, id externo). Si la API no trae un dato, se conserva el anterior (nunca se escribe 0 por "sin dato").
 * - Una foto de métricas por pieza y por día.
 * - Nada se borra: lo que no vuelve en un listado completo se marca como no disponible.
 */
const METRIC_COLUMNS: { key: keyof ItemMetrics; column: string }[] = [
  { key: "views", column: "views" },
  { key: "reach", column: "reach" },
  { key: "likes", column: "likes" },
  { key: "comments", column: "comments" },
  { key: "shares", column: "shares" },
  { key: "saves", column: "saves" },
  { key: "totalInteractions", column: "total_interactions" },
  { key: "follows", column: "follows" },
  { key: "profileVisits", column: "profile_visits" },
  { key: "avgWatchSec", column: "avg_watch_sec" },
  { key: "totalWatchSec", column: "total_watch_sec" },
  { key: "skipRate", column: "skip_rate" },
  { key: "engagedViews", column: "engaged_views" },
  { key: "watchTimeMinutes", column: "watch_time_minutes" },
  { key: "avgViewPercentage", column: "avg_view_percentage" },
  { key: "subscribersGained", column: "subscribers_gained" },
];

const keep = (column: string) => sql.raw(`coalesce(excluded.${column}, content_items.${column})`);

/** Guarda una tanda de piezas y su foto del día. Devuelve cuántas se guardaron. */
export async function saveItems(accountId: string, platform: Platform, items: NormalizedItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const db = getDb();
  const now = new Date();

  const values = items.map((item) => {
    const metrics = Object.fromEntries(METRIC_COLUMNS.map(({ key }) => [key, item.metrics[key] ?? null]));
    return {
      socialAccountId: accountId,
      platform,
      externalId: item.externalId,
      type: item.type,
      caption: item.caption,
      title: item.title,
      permalink: item.permalink,
      thumbnailSourceUrl: item.thumbnailSourceUrl,
      publishedAt: item.publishedAt,
      durationSec: item.durationSec,
      insightsStatus: item.insightsStatus,
      available: true,
      unavailableSince: null,
      lastSeenAt: now,
      metricsUpdatedAt: now,
      raw: item.raw as object,
      ...metrics,
    };
  });

  const set: Record<string, unknown> = {
    socialAccountId: sql.raw("excluded.social_account_id"),
    type: sql.raw("excluded.type"),
    caption: sql.raw("excluded.caption"),
    title: sql.raw("excluded.title"),
    permalink: sql.raw("coalesce(excluded.permalink, content_items.permalink)"),
    thumbnailSourceUrl: sql.raw("coalesce(excluded.thumbnail_source_url, content_items.thumbnail_source_url)"),
    publishedAt: sql.raw("excluded.published_at"),
    durationSec: sql.raw("coalesce(excluded.duration_sec, content_items.duration_sec)"),
    // Si ya hubo estadísticas, un "pendiente" o "no disponible" momentáneo no las tapa.
    insightsStatus: sql.raw("case when content_items.insights_status = 'OK' and excluded.insights_status <> 'OK' then content_items.insights_status else excluded.insights_status end"),
    available: true,
    unavailableSince: null,
    lastSeenAt: now,
    metricsUpdatedAt: now,
    raw: sql.raw("excluded.raw"),
  };
  for (const { key, column } of METRIC_COLUMNS) set[key] = keep(column);

  const saved = await db
    .insert(schema.contentItems)
    .values(values)
    .onConflictDoUpdate({ target: [schema.contentItems.platform, schema.contentItems.externalId], set })
    .returning({
      id: schema.contentItems.id,
      publishedAt: schema.contentItems.publishedAt,
      views: schema.contentItems.views,
      reach: schema.contentItems.reach,
      likes: schema.contentItems.likes,
      comments: schema.contentItems.comments,
      shares: schema.contentItems.shares,
      saves: schema.contentItems.saves,
      avgWatchSec: schema.contentItems.avgWatchSec,
      watchTimeMinutes: schema.contentItems.watchTimeMinutes,
    });

  const today = todayIn(env().APP_TIMEZONE, now);
  await db
    .insert(schema.metricSnapshots)
    .values(
      saved.map((row) => ({
        contentItemId: row.id,
        capturedOn: today,
        capturedAt: now,
        ageHours: Math.max(0, Math.round((now.getTime() - row.publishedAt.getTime()) / 3_600_000)),
        views: row.views,
        reach: row.reach,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: row.saves,
        avgWatchSec: row.avgWatchSec,
        watchTimeMinutes: row.watchTimeMinutes,
      })),
    )
    .onConflictDoUpdate({
      target: [schema.metricSnapshots.contentItemId, schema.metricSnapshots.capturedOn],
      set: {
        capturedAt: sql.raw("excluded.captured_at"),
        ageHours: sql.raw("excluded.age_hours"),
        views: sql.raw("coalesce(excluded.views, metric_snapshots.views)"),
        reach: sql.raw("coalesce(excluded.reach, metric_snapshots.reach)"),
        likes: sql.raw("coalesce(excluded.likes, metric_snapshots.likes)"),
        comments: sql.raw("coalesce(excluded.comments, metric_snapshots.comments)"),
        shares: sql.raw("coalesce(excluded.shares, metric_snapshots.shares)"),
        saves: sql.raw("coalesce(excluded.saves, metric_snapshots.saves)"),
        avgWatchSec: sql.raw("coalesce(excluded.avg_watch_sec, metric_snapshots.avg_watch_sec)"),
        watchTimeMinutes: sql.raw("coalesce(excluded.watch_time_minutes, metric_snapshots.watch_time_minutes)"),
      },
    });

  return saved.length;
}

/**
 * Fija las views a 24 h, 72 h y 7 días cuando la pieza pasa por esa edad.
 * Con eso se comparan piezas a la misma edad, no el total de una vieja contra una nueva.
 */
export async function fixCheckpoints(accountId: string): Promise<void> {
  await getDb().execute(sql`
    update content_items set
      views_24h = case when views_24h is null and metrics_updated_at >= published_at + interval '22 hours' and published_at > now() - interval '40 hours' then views else views_24h end,
      views_72h = case when views_72h is null and metrics_updated_at >= published_at + interval '70 hours' and published_at > now() - interval '100 hours' then views else views_72h end,
      views_7d  = case when views_7d  is null and metrics_updated_at >= published_at + interval '7 days'   and published_at > now() - interval '9 days'    then views else views_7d end
    where social_account_id = ${accountId} and views is not null and published_at > now() - interval '9 days'
  `);
}

/**
 * Puntaje de rendimiento: views ÷ mediana de su red y tipo (últimos 180 días, o todo el histórico si ahí no hay 5; mínimo 5 piezas), comparando
 * siempre piezas comparables: las que tienen dato a 7 días contra las que tienen dato a 7 días, y las importadas
 * viejas (solo tienen el total de por vida) contra otras importadas. Si un grupo no llega a 5 piezas, no hay puntaje.
 */
export async function recomputePerfScores(): Promise<void> {
  await getDb().execute(sql`
    with base as (
      select id, platform, type, published_at, (views_7d is not null) as fresh,
        coalesce(views_7d, case when published_at < now() - interval '7 days' then views end)::float8 as v
      from content_items
      where available
    ), recent as (
      select platform, type, fresh, count(*) as n
      from base where v is not null and published_at > now() - interval '180 days'
      group by platform, type, fresh
    ), med as (
      -- Últimos 180 días; si el grupo no llega a 5 ahí (cuentas que publican poco), todo el histórico.
      select b.platform, b.type, b.fresh, percentile_cont(0.5) within group (order by b.v) as m, count(*) as n
      from base b left join recent r on r.platform = b.platform and r.type = b.type and r.fresh = b.fresh
      where b.v is not null and (b.published_at > now() - interval '180 days' or coalesce(r.n, 0) < 5)
      group by b.platform, b.type, b.fresh
    ), scored as (
      select b.id, case when b.v is not null and med.n >= 5 and med.m > 0 then round((b.v / med.m)::numeric, 2)::real end as score
      from base b left join med on med.platform = b.platform and med.type = b.type and med.fresh = b.fresh
    )
    update content_items ci set perf_score = scored.score
    from scored
    where ci.id = scored.id and ci.perf_score is distinct from scored.score
  `);
}

/** Después de un listado completo: lo que no apareció se marca como no disponible (nunca se borra). */
export async function markUnseenUnavailable(accountId: string, listingStartedAt: Date): Promise<void> {
  await getDb()
    .update(schema.contentItems)
    .set({ available: false, unavailableSince: new Date() })
    .where(
      and(
        eq(schema.contentItems.socialAccountId, accountId),
        eq(schema.contentItems.available, true),
        lt(schema.contentItems.lastSeenAt, listingStartedAt),
      ),
    );
}

export async function saveAccountData(accountId: string, profile: AccountProfile | null, days: AccountDay[]): Promise<void> {
  const db = getDb();
  if (profile) {
    await db
      .update(schema.socialAccounts)
      .set({ handle: profile.handle, displayName: profile.displayName, avatarUrl: profile.avatarUrl })
      .where(eq(schema.socialAccounts.id, accountId));
  }

  const rows = new Map<string, typeof schema.accountSnapshots.$inferInsert>();
  for (const d of days) {
    rows.set(d.day, {
      socialAccountId: accountId,
      capturedOn: d.day,
      views: d.views ?? null,
      reach: d.reach ?? null,
      accountsEngaged: d.accountsEngaged ?? null,
      interactions: d.interactions ?? null,
      profileLinksTaps: d.profileLinksTaps ?? null,
      follows: d.follows ?? null,
      unfollows: d.unfollows ?? null,
      subscribersGained: d.subscribersGained ?? null,
      subscribersLost: d.subscribersLost ?? null,
      watchTimeMinutes: d.watchTimeMinutes ?? null,
    });
  }
  if (profile) {
    const today = todayIn(env().APP_TIMEZONE);
    rows.set(today, {
      ...(rows.get(today) ?? { socialAccountId: accountId, capturedOn: today }),
      followers: profile.followers,
      following: profile.following,
      mediaCount: profile.mediaCount,
      totalLikes: profile.totalLikes,
    });
  }
  if (rows.size === 0) return;

  const k = (c: string) => sql.raw(`coalesce(excluded.${c}, account_snapshots.${c})`);
  await db
    .insert(schema.accountSnapshots)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: [schema.accountSnapshots.socialAccountId, schema.accountSnapshots.capturedOn],
      set: {
        followers: k("followers"),
        following: k("following"),
        mediaCount: k("media_count"),
        totalLikes: k("total_likes"),
        views: k("views"),
        reach: k("reach"),
        accountsEngaged: k("accounts_engaged"),
        interactions: k("interactions"),
        profileLinksTaps: k("profile_links_taps"),
        follows: k("follows"),
        unfollows: k("unfollows"),
        subscribersGained: k("subscribers_gained"),
        subscribersLost: k("subscribers_lost"),
        watchTimeMinutes: k("watch_time_minutes"),
      },
    });
}

/** Copia las miniaturas nuevas al almacenamiento propio (las de Instagram y TikTok vencen en horas o días). */
export async function copyThumbnails(ctx: SyncContext, accountId: string, limit = 60): Promise<void> {
  const db = getDb();
  const pending = await db
    .select({ id: schema.contentItems.id, source: schema.contentItems.thumbnailSourceUrl, platform: schema.contentItems.platform })
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.socialAccountId, accountId), isNull(schema.contentItems.thumbnailUrl), isNotNull(schema.contentItems.thumbnailSourceUrl)))
    .orderBy(sql`${schema.contentItems.publishedAt} desc`)
    .limit(limit);

  await mapLimit(pending, 4, async (row) => {
    if (ctx.outOfTime(5_000) || !row.source) return;
    const url = await copyRemoteImage(row.source, `miniaturas/${row.platform.toLowerCase()}/${row.id}`);
    if (url) await db.update(schema.contentItems).set({ thumbnailUrl: url }).where(eq(schema.contentItems.id, row.id));
  });
}
