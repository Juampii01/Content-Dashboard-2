import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { PieceAnalysis } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getBrand } from "@/lib/ai/brand-context";
import { dailyViewsUnchecked, totalsUnchecked, type PeriodTotals } from "@/lib/dal/metrics";
import { computeGrowth } from "@/lib/dal/growth";
import { parseFilters, todayIn } from "@/lib/metrics/params";
import { PLATFORMS, platformLabel, type ContentType, type Platform } from "@/lib/social/types";
import { addMonths, carryForward, daysOf, reportRange, sumKnown, weeklyRhythm } from "./month";
import type { MonthlyReportData, Pair, ReportBrand, ReportPiece, ReportPlatform } from "./types";

/**
 * Junta todos los números de un mes para el informe. No pide sesión: lo llaman las acciones (después de
 * `requireEditor`) y el cron. Reusa las consultas de Métricas (`totalsUnchecked`, `dailyViewsUnchecked`) y de
 * Inicio (`computeGrowth`), así el informe dice lo mismo que la app.
 */
export async function collectReportData(month: string): Promise<Omit<MonthlyReportData, "summary"> | null> {
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);
  const range = reportRange(month, today);
  if (!range) return null;
  const { from, to, monthEnd, partial } = range;
  // Mes anterior con la misma cantidad de días (si el mes está en curso, se compara contra el mismo tramo).
  const prevFrom = `${addMonths(month, -1)}-01`;
  const prevEndFull = reportRange(addMonths(month, -1), today)!.monthEnd;
  const span = daysOf(from, to).length;
  const prevTo = partial ? (daysOf(prevFrom, prevEndFull)[span - 1] ?? prevEndFull) : prevEndFull;

  const db = getDb();
  const base = parseFilters({}, tz);
  const accounts = await db.execute<{ id: string; platform: Platform; handle: string; display_name: string | null; avatar_url: string | null }>(sql`
    select id, platform, handle, display_name, avatar_url from social_accounts where current
    order by array_position(array['INSTAGRAM','YOUTUBE','TIKTOK']::platform[], platform)
  `);
  const connected = accounts.rows.map((a) => a.platform);

  const pair = (a: number | null, b: number | null): Pair => ({ current: a, previous: b });
  const fromTotals = (c: PeriodTotals, p: PeriodTotals) => ({
    followersGained: pair(c.followersNet, p.followersNet),
    views: pair(c.views, p.views),
    interactions: pair(c.interactions, p.interactions),
    engagementRate: pair(c.engagementRate, p.engagementRate),
    pieces: pair(c.pieces, p.pieces),
  });

  const [allNow, allPrev, daily, followerRows, availability] = await Promise.all([
    totalsUnchecked(base, from, to),
    totalsUnchecked(base, prevFrom, prevTo),
    dailyViewsUnchecked({ from, to, platforms: connected }),
    db.execute<{ platform: Platform; day: string; followers: number | null }>(sql`
      select sa.platform, d.day::date::text as day,
        (select s.followers from account_snapshots s
          where s.social_account_id = sa.id and s.followers is not null and s.captured_on <= d.day::date
          order by s.captured_on desc limit 1) as followers
      from social_accounts sa cross join generate_series(${from}::date, ${to}::date, interval '1 day') as d(day)
      where sa.current
    `),
    db.execute<{ platform: Platform; n: number; saves: number; shares: number; views: number }>(sql`
      select platform, count(*)::int as n, count(saves)::int as saves, count(shares)::int as shares, count(views)::int as views
      from content_items
      where available and (published_at at time zone ${tz})::date between ${from}::date and ${to}::date
      group by platform
    `),
  ]);

  const days = daysOf(from, to);
  const platforms: ReportPlatform[] = [];
  for (const account of accounts.rows) {
    const p = account.platform;
    const f = { ...base, platforms: [p] };
    const [now, prev] = await Promise.all([totalsUnchecked(f, from, to), totalsUnchecked(f, prevFrom, prevTo)]);
    const followersByDay = new Map(followerRows.rows.filter((r) => r.platform === p).map((r) => [r.day, r.followers == null ? null : Number(r.followers)]));
    const dailyFollowers = carryForward(days.map((d) => followersByDay.get(d) ?? null));
    const dailyViews = daily.byPlatform[p] ?? days.map(() => null);
    const avail = availability.rows.find((r) => r.platform === p);

    const notes: string[] = [];
    if (dailyViews.every((v) => v == null)) notes.push(`${platformLabel[p]} no dio visualizaciones diarias de la cuenta en este mes.`);
    else if (p === "TIKTOK") notes.push("TikTok no da visualizaciones diarias de la cuenta: se calculan con lo que suma cada video día a día.");
    if (dailyFollowers.every((v) => v == null)) notes.push("Sin datos de seguidores en este mes.");
    if (avail && avail.n > 0 && avail.saves === 0) notes.push(`${platformLabel[p]} no da guardados: no entran en las interacciones.`);
    if (avail && avail.n > 0 && avail.shares === 0) notes.push(`${platformLabel[p]} no dio compartidos de estas piezas.`);
    if (!avail || avail.n === 0) notes.push("No hubo publicaciones en este mes.");

    platforms.push({
      platform: p,
      handle: account.handle,
      followers: dailyFollowers.at(-1) ?? null,
      ...fromTotals(now, prev),
      dailyViews,
      dailyFollowers,
      notes,
    });
  }

  // Seguidores al cierre, sumando las redes que tienen el dato.
  const totalFollowers = sumKnown(platforms.map((p) => p.followers));

  const { top, worst } = await bestAndWorst(from, to, tz);
  const consistency = await consistencyOf(from, to, monthEnd, tz);
  const production = await productionOf(from, to, tz);
  const brand = await brandOf(accounts.rows);

  return {
    version: 1,
    month,
    from,
    to,
    monthEnd,
    partial,
    timezone: tz,
    generatedAt: new Date().toISOString(),
    brand,
    totals: { followers: totalFollowers, ...fromTotals(allNow, allPrev) },
    days,
    platforms: platforms.sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)),
    top,
    worst,
    consistency,
    production,
  };
}

type PieceRow = {
  id: string;
  platform: Platform;
  type: ContentType;
  title: string;
  thumbnail: string | null;
  permalink: string | null;
  published_at: Date | string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  perf_score: number | null;
  ai_analysis: PieceAnalysis | null;
};

function toPiece(r: PieceRow): ReportPiece {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const views = n(r.views);
  const parts = [r.likes, r.comments, r.shares, r.saves].map(n);
  const interactions = parts.every((v) => v == null) ? null : parts.reduce<number>((a, b) => a + (b ?? 0), 0);
  return {
    id: r.id,
    platform: r.platform,
    type: r.type,
    title: String(r.title).replace(/\s+/g, " ").trim().slice(0, 220),
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    publishedAt: new Date(r.published_at).toISOString(),
    views,
    interactions,
    engagementRate: views && interactions != null ? (100 * interactions) / views : null,
    saves: n(r.saves),
    shares: n(r.shares),
    perfScore: n(r.perf_score),
    why: r.ai_analysis?.verdict ?? null,
    lessons: r.ai_analysis?.lessons?.slice(0, 2) ?? [],
  };
}

/** Las 5 piezas del mes que más superaron su mediana y la que menos (siempre distinta de las 5). */
async function bestAndWorst(from: string, to: string, tz: string): Promise<{ top: ReportPiece[]; worst: ReportPiece | null }> {
  const rows = await getDb().execute<PieceRow>(sql`
    select id, platform, type,
      coalesce(nullif(title, ''), nullif(split_part(trim(caption), E'\n', 1), ''), 'Sin texto') as title,
      coalesce(thumbnail_url, thumbnail_source_url) as thumbnail, permalink, published_at,
      views, likes, comments, shares, saves, perf_score, ai_analysis
    from content_items
    where available and (published_at at time zone ${tz})::date between ${from}::date and ${to}::date
    order by perf_score desc nulls last, views desc nulls last
  `);
  const all = rows.rows.map(toPiece);
  if (all.length === 0) return { top: [], worst: null };
  const topCount = Math.min(5, Math.max(1, all.length - 1));
  const top = all.slice(0, topCount);
  // La peor: el puntaje más bajo entre las que tienen puntaje; si ninguna lo tiene, la de menos visualizaciones.
  const rest = all.slice(topCount);
  const scored = rest.filter((p) => p.perfScore != null);
  const pool = scored.length ? scored : rest.filter((p) => p.views != null);
  const worst = pool.length ? pool.reduce((a, b) => ((scored.length ? a.perfScore! <= b.perfScore! : a.views! <= b.views!) ? a : b)) : null;
  return { top, worst };
}

async function consistencyOf(from: string, to: string, monthEnd: string, tz: string): Promise<MonthlyReportData["consistency"]> {
  const db = getDb();
  const [calendar, perDay, growth] = await Promise.all([
    db.execute<{ planned: number; published: number }>(sql`
      select count(*)::int as planned,
        count(*) filter (where e.status = 'PUBLISHED' or exists (
          select 1 from calendar_targets t where t.entry_id = e.id and t.link_status = 'LINKED'))::int as published
      from calendar_entries e
      where e.scheduled_date between ${from}::date and ${monthEnd}::date
    `),
    db.execute<{ day: string; n: number }>(sql`
      select (published_at at time zone ${tz})::date::text as day, count(*)::int as n
      from content_items
      where available and (published_at at time zone ${tz})::date between ${from}::date and ${to}::date
      group by 1
    `),
    computeGrowth(),
  ]);
  const byDay = Object.fromEntries(perDay.rows.map((r) => [r.day, Number(r.n)]));
  const weeklyTarget = growth.goals?.weeklyPieces ?? growth.suggested.weeklyPieces;
  return {
    planned: calendar.rows[0]?.planned ?? 0,
    plannedPublished: calendar.rows[0]?.published ?? 0,
    published: perDay.rows.reduce((a, r) => a + Number(r.n), 0),
    weeklyTarget,
    weeks: weeklyRhythm(byDay, from, to, weeklyTarget),
    goal: growth.goals
      ? {
          followers: growth.goals.followers,
          platform: growth.goals.platform,
          deadline: growth.goals.deadline ?? null,
          current: growth.current,
          perDay: growth.perDay,
          eta: growth.eta,
          neededPerWeek: growth.neededPerWeek,
        }
      : null,
    streak: growth.streak,
  };
}

async function productionOf(from: string, to: string, tz: string): Promise<MonthlyReportData["production"]> {
  const inMonth = (column: string) => sql`(${sql.raw(column)} at time zone ${tz})::date between ${from}::date and ${to}::date`;
  const result = await getDb().execute<{ videos: number; carousels: number; exported: number; clones: number; clone_seconds: number | null; scripts: number }>(sql`
    select
      (select count(distinct video_project_id)::int from jobs where type = 'VIDEO_RENDER' and status = 'SUCCEEDED' and ${inMonth("finished_at")}) as videos,
      (select count(*)::int from carousels where ${inMonth("created_at")}) as carousels,
      (select count(*)::int from carousels where exported_at is not null and ${inMonth("exported_at")}) as exported,
      (select count(*)::int from clone_videos where status = 'COMPLETED' and ${inMonth("completed_at")}) as clones,
      (select sum(duration_seconds)::float from clone_videos where status = 'COMPLETED' and ${inMonth("completed_at")}) as clone_seconds,
      (select count(*)::int from scripts where ${inMonth("created_at")}) as scripts
  `);
  const r = result.rows[0];
  return {
    videosEdited: r?.videos ?? 0,
    carouselsCreated: r?.carousels ?? 0,
    carouselsExported: r?.exported ?? 0,
    cloneVideos: r?.clones ?? 0,
    cloneSeconds: r?.clone_seconds == null ? null : Number(r.clone_seconds),
    scripts: r?.scripts ?? 0,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

async function brandOf(accounts: { platform: Platform; handle: string; display_name: string | null; avatar_url: string | null }[]): Promise<ReportBrand> {
  const brand = await getBrand();
  const main = accounts.find((a) => a.platform === "INSTAGRAM") ?? accounts[0];
  const handle = brand?.handle || (main ? main.handle : null);
  const primary = brand?.colors?.primary && HEX.test(brand.colors.primary) ? brand.colors.primary : null;
  const accent = [brand?.colors?.accent, brand?.colors?.secondary].find((c) => c && HEX.test(c)) ?? null;
  return {
    name: brand?.name || main?.display_name || (handle ? handle.replace(/^@/, "") : "Tu marca"),
    handle: handle ? `@${handle.replace(/^@/, "")}` : null,
    primary,
    accent,
    headingFont: brand?.fonts?.heading ?? null,
    // Foto del personaje de Mi marca; si no hay, la foto de perfil de la red principal.
    image: brand?.characterPhotos[0] ?? accounts.find((a) => a.avatar_url)?.avatar_url ?? null,
    language: brand?.language ?? "es-neutro",
  };
}
