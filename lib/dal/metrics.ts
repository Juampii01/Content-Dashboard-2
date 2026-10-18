import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { PieceAnalysis } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { addDays, previousRange, type MetricsFilters, type SortKey } from "@/lib/metrics/params";
import type { ContentType, Platform } from "@/lib/social/types";

/**
 * Lecturas de Métricas e Inicio. Todo se calcula en la base con los filtros de la URL.
 * Los días se cuentan en la zona horaria de la marca (APP_TIMEZONE), no en UTC.
 */
const tz = () => env().APP_TIMEZONE;

/** Arreglo de Postgres con un parámetro por elemento (Drizzle expande los arreglos de JS como lista). */
function pgArray(values: string[], type: "platform" | "content_type" | "uuid"): SQL {
  return sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::${sql.raw(type)}[]`;
}

// ─── Conexiones ────────────────────────────────────────────────────────────

export type ConnectionSummary = {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "MISSING_SCOPES" | "ERROR" | "DISCONNECTED";
  statusMessage: string | null;
  lastSyncedAt: Date | null;
  backfillDone: boolean;
  lastRun: { status: string; kind: string; finishedAt: Date | null; errorMessage: string | null; itemsUpserted: number } | null;
  itemCount: number;
};

export async function listConnections(): Promise<ConnectionSummary[]> {
  await getCurrentUser();
  const db = getDb();
  const accounts = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.current, true));
  return Promise.all(
    accounts.map(async (a) => {
      const [run] = await db
        .select({
          status: schema.syncRuns.status,
          kind: schema.syncRuns.kind,
          finishedAt: schema.syncRuns.finishedAt,
          errorMessage: schema.syncRuns.errorMessage,
          itemsUpserted: schema.syncRuns.itemsUpserted,
        })
        .from(schema.syncRuns)
        .where(eq(schema.syncRuns.socialAccountId, a.id))
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1);
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.contentItems)
        .where(eq(schema.contentItems.socialAccountId, a.id));
      return {
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        status: a.status,
        statusMessage: a.statusMessage,
        lastSyncedAt: a.lastSyncedAt,
        backfillDone: Boolean(a.backfillCompletedAt),
        lastRun: run ?? null,
        itemCount: count?.n ?? 0,
      };
    }),
  );
}

// ─── Filtros comunes ───────────────────────────────────────────────────────

function itemConditions(f: Pick<MetricsFilters, "platforms" | "types" | "q" | "minViews" | "maxViews">, from: string, to: string): SQL {
  const parts: SQL[] = [
    sql`ci.available`,
    sql`(ci.published_at at time zone ${tz()})::date between ${from}::date and ${to}::date`,
  ];
  if (f.platforms.length) parts.push(sql`ci.platform = any(${pgArray(f.platforms, "platform")})`);
  if (f.types.length) parts.push(sql`ci.type = any(${pgArray(f.types, "content_type")})`);
  if (f.q) {
    parts.push(
      sql`(to_tsvector('simple', coalesce(ci.caption, '') || ' ' || coalesce(ci.title, '')) @@ plainto_tsquery('simple', ${f.q})
           or coalesce(ci.caption, '') || ' ' || coalesce(ci.title, '') ilike ${`%${f.q}%`})`,
    );
  }
  if (f.minViews != null) parts.push(sql`coalesce(ci.views, 0) >= ${f.minViews}`);
  if (f.maxViews != null) parts.push(sql`coalesce(ci.views, 0) <= ${f.maxViews}`);
  return sql.join(parts, sql` and `);
}

// ─── Resumen (KPIs) ────────────────────────────────────────────────────────

export type PeriodTotals = {
  pieces: number;
  views: number | null;
  interactions: number | null;
  saves: number | null;
  shares: number | null;
  /** (me gusta + comentarios + compartidos + guardados) ÷ visualizaciones, en %. */
  engagementRate: number | null;
  /** (guardados + compartidos) por cada 1,000 visualizaciones (solo piezas que dan esos datos). */
  savesSharesPer1k: number | null;
  /** Tiempo medio de visualización en segundos (reels y videos que lo dan). */
  avgWatchSec: number | null;
  followersNet: number | null;
};

async function totals(f: MetricsFilters, from: string, to: string): Promise<PeriodTotals> {
  const db = getDb();
  const where = itemConditions(f, from, to);
  const result = await db.execute<{
    pieces: number;
    views: string | null;
    interactions: string | null;
    saves: string | null;
    shares: string | null;
    er: number | null;
    ss: number | null;
    watch: number | null;
  }>(sql`
    select
      count(*)::int as pieces,
      sum(ci.views)::bigint as views,
      sum(coalesce(ci.likes, 0) + coalesce(ci.comments, 0) + coalesce(ci.shares, 0) + coalesce(ci.saves, 0))::bigint as interactions,
      sum(ci.saves)::bigint as saves,
      sum(ci.shares)::bigint as shares,
      100.0 * sum(coalesce(ci.likes, 0) + coalesce(ci.comments, 0) + coalesce(ci.shares, 0) + coalesce(ci.saves, 0))
        / nullif(sum(ci.views) filter (where ci.views > 0), 0) as er,
      1000.0 * sum(coalesce(ci.saves, 0) + coalesce(ci.shares, 0)) filter (where ci.saves is not null and ci.shares is not null)
        / nullif(sum(ci.views) filter (where ci.saves is not null and ci.shares is not null and ci.views > 0), 0) as ss,
      avg(ci.avg_watch_sec) filter (where ci.avg_watch_sec is not null) as watch
    from content_items ci
    where ${where}
  `);
  const row = result.rows[0];

  // Seguidores netos: último valor del periodo menos el último valor anterior al periodo, por cuenta.
  const followers = await db.execute<{ net: string | null }>(sql`
    with accounts as (
      select id from social_accounts sa
      where sa.current ${f.platforms.length ? sql`and sa.platform = any(${pgArray(f.platforms, "platform")})` : sql``}
    ), ends as (
      select a.id,
        (select followers from account_snapshots s where s.social_account_id = a.id and s.followers is not null and s.captured_on <= ${to}::date order by captured_on desc limit 1) as at_end,
        (select followers from account_snapshots s where s.social_account_id = a.id and s.followers is not null and s.captured_on < ${from}::date order by captured_on desc limit 1) as at_start,
        (select coalesce(sum(follows), 0) - coalesce(sum(unfollows), 0) + coalesce(sum(subscribers_gained), 0) - coalesce(sum(subscribers_lost), 0)
           from account_snapshots s where s.social_account_id = a.id and s.captured_on between ${from}::date and ${to}::date
             and (follows is not null or subscribers_gained is not null)) as from_days
      from accounts a
    )
    select sum(case when at_end is not null and at_start is not null then at_end - at_start else nullif(from_days, 0) end)::bigint as net from ends
  `);

  const n = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
  return {
    pieces: row?.pieces ?? 0,
    views: n(row?.views),
    interactions: n(row?.interactions),
    saves: n(row?.saves),
    shares: n(row?.shares),
    engagementRate: n(row?.er),
    savesSharesPer1k: n(row?.ss),
    avgWatchSec: n(row?.watch),
    followersNet: n(followers.rows[0]?.net),
  };
}

export async function getOverview(f: MetricsFilters): Promise<{ current: PeriodTotals; previous: PeriodTotals }> {
  await getCurrentUser();
  const prev = previousRange(f.from, f.to);
  const [current, previous] = await Promise.all([totals(f, f.from, f.to), totals(f, prev.from, prev.to)]);
  return { current, previous };
}

// ─── Evolución diaria ──────────────────────────────────────────────────────

export type DailySeries = { days: string[]; byPlatform: Partial<Record<Platform, (number | null)[]>> };

/**
 * Visualizaciones por día y por red. Instagram y YouTube dan el total diario de la cuenta;
 * TikTok no, así que se calcula con la diferencia diaria de las fotos de cada video.
 */
export async function getDailyViews(f: MetricsFilters): Promise<DailySeries> {
  await getCurrentUser();
  const db = getDb();
  const days: string[] = [];
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) days.push(d);

  const platforms = f.platforms.length ? f.platforms : (["INSTAGRAM", "YOUTUBE", "TIKTOK"] as Platform[]);
  const account = await db.execute<{ platform: Platform; day: string; views: string | null }>(sql`
    select sa.platform, s.captured_on::text as day, s.views::text as views
    from account_snapshots s join social_accounts sa on sa.id = s.social_account_id
    where s.captured_on between ${f.from}::date and ${f.to}::date and s.views is not null
      and sa.platform = any(${pgArray(platforms.filter((p) => p !== "TIKTOK"), "platform")})
  `);
  const tiktok = platforms.includes("TIKTOK")
    ? await db.execute<{ day: string; views: string | null }>(sql`
        with s as (
          select ms.content_item_id, ms.captured_on, ms.views,
                 lag(ms.views) over (partition by ms.content_item_id order by ms.captured_on) as prev,
                 lag(ms.captured_on) over (partition by ms.content_item_id order by ms.captured_on) as prev_day
          from metric_snapshots ms join content_items ci on ci.id = ms.content_item_id
          where ci.platform = 'TIKTOK' and ms.captured_on between ${addDays(f.from, -1)}::date and ${f.to}::date
        )
        select captured_on::text as day, sum(greatest(views - prev, 0))::text as views
        from s where prev is not null and prev_day = captured_on - 1 and captured_on >= ${f.from}::date
        group by captured_on
      `)
    : { rows: [] };

  const byPlatform: DailySeries["byPlatform"] = {};
  for (const p of platforms) byPlatform[p] = days.map(() => null);
  for (const r of account.rows) {
    const i = days.indexOf(r.day);
    if (i >= 0 && byPlatform[r.platform]) byPlatform[r.platform]![i] = (byPlatform[r.platform]![i] ?? 0) + Number(r.views);
  }
  for (const r of tiktok.rows) {
    const i = days.indexOf(r.day);
    if (i >= 0 && byPlatform.TIKTOK) byPlatform.TIKTOK[i] = Number(r.views);
  }
  // Si una red no tiene ningún dato en el periodo, no se dibuja.
  for (const p of Object.keys(byPlatform) as Platform[]) {
    if (byPlatform[p]!.every((v) => v === null)) delete byPlatform[p];
  }
  return { days, byPlatform };
}

// ─── Listado de piezas ─────────────────────────────────────────────────────

export type ContentRow = {
  id: string;
  platform: Platform;
  type: ContentType;
  title: string;
  permalink: string | null;
  thumbnail: string | null;
  publishedAt: Date;
  durationSec: number | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagementRate: number | null;
  avgWatchSec: number | null;
  avgViewPercentage: number | null;
  perfScore: number | null;
  insightsStatus: "OK" | "PENDING" | "NOT_SUPPORTED";
};

const sortColumn: Record<SortKey, SQL> = {
  fecha: sql`ci.published_at`,
  views: sql`ci.views`,
  alcance: sql`ci.reach`,
  likes: sql`ci.likes`,
  comentarios: sql`ci.comments`,
  compartidos: sql`ci.shares`,
  guardados: sql`ci.saves`,
  interaccion: sql`(coalesce(ci.likes,0) + coalesce(ci.comments,0) + coalesce(ci.shares,0) + coalesce(ci.saves,0))::float / nullif(ci.views, 0)`,
  retencion: sql`coalesce(ci.avg_view_percentage, ci.avg_watch_sec)`,
  puntaje: sql`ci.perf_score`,
};

export const PAGE_SIZE = 48;

export async function listContent(f: MetricsFilters): Promise<{ rows: ContentRow[]; total: number }> {
  await getCurrentUser();
  const db = getDb();
  const where = itemConditions(f, f.from, f.to);
  const order = sql`${sortColumn[f.sort]} ${f.dir === "asc" ? sql`asc` : sql`desc`} nulls last, ci.published_at desc`;

  const [rows, count] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select ci.id, ci.platform, ci.type, coalesce(nullif(ci.title, ''), nullif(split_part(trim(ci.caption), E'\n', 1), ''), 'Sin texto') as title,
        ci.permalink, coalesce(ci.thumbnail_url, ci.thumbnail_source_url) as thumbnail, ci.published_at, ci.duration_sec,
        ci.views, ci.reach, ci.likes, ci.comments, ci.shares, ci.saves, ci.avg_watch_sec, ci.avg_view_percentage, ci.perf_score,
        ci.insights_status,
        100.0 * (coalesce(ci.likes,0) + coalesce(ci.comments,0) + coalesce(ci.shares,0) + coalesce(ci.saves,0)) / nullif(ci.views, 0) as er
      from content_items ci
      where ${where}
      order by ${order}
      limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from content_items ci where ${where}`),
  ]);

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    total: count.rows[0]?.n ?? 0,
    rows: rows.rows.map((r) => ({
      id: String(r.id),
      platform: r.platform as Platform,
      type: r.type as ContentType,
      title: String(r.title).slice(0, 200),
      permalink: (r.permalink as string | null) ?? null,
      thumbnail: (r.thumbnail as string | null) ?? null,
      publishedAt: new Date(r.published_at as string),
      durationSec: num(r.duration_sec),
      views: num(r.views),
      reach: num(r.reach),
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      saves: num(r.saves),
      engagementRate: num(r.er),
      avgWatchSec: num(r.avg_watch_sec),
      avgViewPercentage: num(r.avg_view_percentage),
      perfScore: num(r.perf_score),
      insightsStatus: r.insights_status as ContentRow["insightsStatus"],
    })),
  };
}

// ─── Mejores días y horarios ───────────────────────────────────────────────

/**
 * Mediana de visualizaciones a 7 días (o totales en piezas viejas) por día de la semana y hora de publicación,
 * en los últimos 180 días. Devuelve 7 filas (lunes primero) × 24 columnas, más la cantidad de piezas por celda.
 */
export async function getPostingHeatmap(f: Pick<MetricsFilters, "platforms" | "types">): Promise<{ values: number[][]; counts: number[][]; pieces: number }> {
  await getCurrentUser();
  const parts: SQL[] = [sql`ci.available`, sql`ci.published_at > now() - interval '180 days'`, sql`coalesce(ci.views_7d, ci.views) is not null`];
  if (f.platforms.length) parts.push(sql`ci.platform = any(${pgArray(f.platforms, "platform")})`);
  if (f.types.length) parts.push(sql`ci.type = any(${pgArray(f.types, "content_type")})`);
  const result = await getDb().execute<{ dow: number; hour: number; med: number; n: number }>(sql`
    select extract(isodow from ci.published_at at time zone ${tz()})::int as dow,
           extract(hour from ci.published_at at time zone ${tz()})::int as hour,
           percentile_cont(0.5) within group (order by coalesce(ci.views_7d, ci.views)) as med,
           count(*)::int as n
    from content_items ci
    where ${sql.join(parts, sql` and `)}
    group by 1, 2
  `);
  const values = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const counts = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let pieces = 0;
  for (const r of result.rows) {
    values[r.dow - 1]![r.hour] = Math.round(Number(r.med));
    counts[r.dow - 1]![r.hour] = r.n;
    pieces += r.n;
  }
  return { values, counts, pieces };
}

// ─── Destacadas y alertas ──────────────────────────────────────────────────

/** Piezas que más superaron la mediana de su red y tipo, publicadas en el periodo. */
export async function getTopPieces(f: MetricsFilters, limit = 6): Promise<ContentRow[]> {
  const { rows } = await listContent({ ...f, sort: "puntaje", dir: "desc", page: 1 });
  return rows.filter((r) => (r.perfScore ?? 0) >= 1.2).slice(0, limit);
}

export type RisingPiece = ContentRow & { ratio24h: number };

/**
 * Piezas de los últimos 3 días que a las 24 h ya duplican la mediana de views a 24 h de su red y tipo.
 * Es la alerta "va camino a ser de tus mejores".
 */
export async function getRisingPieces(): Promise<RisingPiece[]> {
  await getCurrentUser();
  const result = await getDb().execute<{ id: string; ratio: number }>(sql`
    with med as (
      select platform, type, percentile_cont(0.5) within group (order by views_24h) as m, count(*) as n
      from content_items where views_24h is not null and published_at > now() - interval '120 days'
      group by platform, type
    )
    select ci.id, (ci.views_24h::float / med.m) as ratio
    from content_items ci join med on med.platform = ci.platform and med.type = ci.type
    where ci.available and ci.published_at > now() - interval '3 days' and ci.views_24h is not null
      and med.n >= 5 and med.m > 0 and ci.views_24h >= 2 * med.m
    order by ratio desc limit 3
  `);
  if (result.rows.length === 0) return [];
  const ids = result.rows.map((r) => r.id);
  const items = await getItemsByIds(ids);
  return result.rows
    .map((r) => {
      const item = items.find((i) => i.id === r.id);
      return item ? { ...item, ratio24h: Math.round(r.ratio * 10) / 10 } : null;
    })
    .filter((x): x is RisingPiece => x !== null);
}

async function getItemsByIds(ids: string[]): Promise<ContentRow[]> {
  const rows = await getDb().select().from(schema.contentItems).where(sql`${schema.contentItems.id} = any(${pgArray(ids, "uuid")})`);
  return rows.map(toRow);
}

function toRow(ci: typeof schema.contentItems.$inferSelect): ContentRow {
  const inter = (ci.likes ?? 0) + (ci.comments ?? 0) + (ci.shares ?? 0) + (ci.saves ?? 0);
  return {
    id: ci.id,
    platform: ci.platform,
    type: ci.type,
    title: (ci.title || ci.caption?.trim().split("\n")[0] || "Sin texto").slice(0, 200),
    permalink: ci.permalink,
    thumbnail: ci.thumbnailUrl ?? ci.thumbnailSourceUrl,
    publishedAt: ci.publishedAt,
    durationSec: ci.durationSec,
    views: ci.views,
    reach: ci.reach,
    likes: ci.likes,
    comments: ci.comments,
    shares: ci.shares,
    saves: ci.saves,
    engagementRate: ci.views ? (100 * inter) / ci.views : null,
    avgWatchSec: ci.avgWatchSec,
    avgViewPercentage: ci.avgViewPercentage,
    perfScore: ci.perfScore,
    insightsStatus: ci.insightsStatus,
  };
}

// ─── Detalle de una pieza ──────────────────────────────────────────────────

export type ContentDetail = {
  item: ContentRow & { caption: string | null; skipRate: number | null; follows: number | null; profileVisits: number | null; watchTimeMinutes: number | null; subscribersGained: number | null; engagedViews: number | null; views24h: number | null; views72h: number | null; views7d: number | null; available: boolean; aiAnalysis: PieceAnalysis | null; aiAnalyzedAt: Date | null };
  snapshots: { day: string; ageHours: number | null; views: number | null }[];
  retention: { at: number; ratio: number }[] | null;
  peerMedian7d: number | null;
  /** Views para comparar con la mediana: a los 7 días, o el total si es una pieza vieja importada. */
  compareViews: number | null;
};

export async function getContentDetail(id: string): Promise<ContentDetail | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [ci] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).limit(1);
  if (!ci) return null;

  const [snapshots, retention, peer] = await Promise.all([
    db
      .select({ day: schema.metricSnapshots.capturedOn, ageHours: schema.metricSnapshots.ageHours, views: schema.metricSnapshots.views })
      .from(schema.metricSnapshots)
      .where(eq(schema.metricSnapshots.contentItemId, id))
      .orderBy(asc(schema.metricSnapshots.capturedOn)),
    db.select().from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, id)).limit(1),
    db.execute<{ m: number | null }>(sql`
      select percentile_cont(0.5) within group (order by coalesce(views_7d, views)) as m
      from content_items
      where platform = ${ci.platform} and type = ${ci.type} and available and id <> ${id}
        and published_at > now() - interval '180 days' and published_at < now() - interval '7 days'
    `),
  ]);

  return {
    item: {
      ...toRow(ci),
      caption: ci.caption,
      skipRate: ci.skipRate,
      follows: ci.follows,
      profileVisits: ci.profileVisits,
      watchTimeMinutes: ci.watchTimeMinutes,
      subscribersGained: ci.subscribersGained,
      engagedViews: ci.engagedViews,
      views24h: ci.views24h,
      views72h: ci.views72h,
      views7d: ci.views7d,
      available: ci.available,
      aiAnalysis: ci.aiAnalysis ?? null,
      aiAnalyzedAt: ci.aiAnalyzedAt ?? null,
    },
    snapshots,
    retention: retention[0]?.points ?? null,
    peerMedian7d: peer.rows[0]?.m != null ? Number(peer.rows[0].m) : null,
    compareViews: ci.views7d ?? (Date.now() - ci.publishedAt.getTime() > 7 * 86_400_000 ? ci.views : null),
  };
}

/** Cantidad de piezas por red (para los contadores de los filtros). */
export async function countByPlatform(): Promise<Partial<Record<Platform, number>>> {
  const rows = await getDb()
    .select({ platform: schema.contentItems.platform, n: sql<number>`count(*)::int` })
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.available, true)))
    .groupBy(schema.contentItems.platform);
  return Object.fromEntries(rows.map((r) => [r.platform, r.n]));
}
