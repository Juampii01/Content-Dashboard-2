import "server-only";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { GrowthGoals } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { addDays, todayIn } from "@/lib/metrics/params";
import type { Platform } from "@/lib/social/types";

const MILESTONES = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];

/** El próximo número redondo por encima de los seguidores actuales (sugerencia de meta). */
export function nextMilestone(current: number): number {
  return MILESTONES.find((m) => m > current * 1.05) ?? Math.ceil((current * 1.5) / 1_000_000) * 1_000_000;
}

export type WeekStat = { weekStart: string; pieces: number; followerGain: number | null; hitTarget: boolean; current: boolean };

export type Growth = {
  goals: GrowthGoals | null;
  suggested: GrowthGoals;
  platforms: Platform[];
  current: number | null;
  /** Seguidores por día (pendiente de la recta de los últimos 28 días). */
  perDay: number | null;
  gained28d: number | null;
  /** Fecha estimada para llegar a la meta al ritmo actual (null si no se llega o no hay datos). */
  eta: string | null;
  /** Seguidores por semana que hacen falta para llegar a la fecha límite. */
  neededPerWeek: number | null;
  series: { day: string; followers: number }[];
  weeks: WeekStat[];
  streak: number;
  /** "Las semanas que publicaste N o más piezas ganaste ×X seguidores" (null si no hay datos suficientes). */
  insight: { target: number; ratio: number; withTarget: number; withoutTarget: number } | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Pendiente de mínimos cuadrados (seguidores por día). */
function slope(points: { x: number; y: number }[]): number | null {
  if (points.length < 7) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den === 0 ? null : num / den;
}

/** Lunes (local) de la semana de un día YYYY-MM-DD. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/**
 * Datos del bloque "Tu camino a la meta" de Inicio: meta, ritmo, proyección y constancia semanal.
 * Todo sale de datos reales (account_snapshots y content_items); si faltan datos, los campos quedan en null.
 */
export async function getGrowth(): Promise<Growth> {
  await getCurrentUser();
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const today = todayIn(tz);

  const [brand] = await db.select({ goals: schema.brandProfile.goals }).from(schema.brandProfile).limit(1);
  const goals = brand?.goals ?? null;

  const accounts = await db.execute<{ platform: Platform }>(sql`select platform from social_accounts where current order by platform`);
  const platforms = accounts.rows.map((r) => r.platform);
  const scope = goals && goals.platform !== "TOTAL" ? goals.platform : null;

  // Seguidores por día, sumando las cuentas actuales. Si una cuenta no tiene dato un día, se usa su último valor conocido.
  const rows = await db.execute<{ day: string; followers: number }>(sql`
    with days as (
      select generate_series(${addDays(today, -97)}::date, ${today}::date, interval '1 day')::date as day
    ), accts as (
      select id from social_accounts where current ${scope ? sql`and platform = ${scope}` : sql``}
    ), filled as (
      select d.day, a.id,
        (select s.followers from account_snapshots s where s.social_account_id = a.id and s.followers is not null and s.captured_on <= d.day order by s.captured_on desc limit 1) as followers
      from days d cross join accts a
    )
    select day::text as day, sum(followers)::int as followers from filled
    group by day having count(followers) = (select count(*) from accts)
    order by day
  `);
  const series = rows.rows.map((r) => ({ day: r.day, followers: Number(r.followers) }));
  const current = series.at(-1)?.followers ?? null;
  const last28 = series.filter((p) => p.day > addDays(today, -28));
  const perDay = slope(last28.map((p, i) => ({ x: i, y: p.followers })));
  const gained28d = last28.length >= 2 ? last28.at(-1)!.followers - last28[0]!.followers : null;

  const suggested: GrowthGoals = { followers: nextMilestone(current ?? 0), platform: "TOTAL", weeklyPieces: 4, deadline: null };
  const target = goals?.followers ?? null;
  let eta: string | null = null;
  if (target && current != null && perDay && perDay > 0 && current < target) {
    const days = Math.ceil((target - current) / perDay);
    if (days < 365 * 5) eta = addDays(today, days);
  }
  let neededPerWeek: number | null = null;
  if (target && current != null && goals?.deadline && goals.deadline > today && current < target) {
    const days = Math.max(1, (new Date(`${goals.deadline}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
    neededPerWeek = Math.ceil(((target - current) / days) * 7);
  }

  // Constancia: piezas publicadas por semana (lunes a domingo, hora local) en las últimas 12 semanas.
  const thisMonday = mondayOf(today);
  const firstMonday = addDays(thisMonday, -7 * 11);
  const pieceRows = await db.execute<{ day: string; n: number }>(sql`
    select (published_at at time zone ${tz})::date::text as day, count(*)::int as n
    from content_items
    where published_at >= (${firstMonday}::date::timestamp at time zone ${tz})
      ${scope ? sql`and platform = ${scope}` : sql``}
    group by 1
  `);
  const piecesByWeek = new Map<string, number>();
  for (const r of pieceRows.rows) piecesByWeek.set(mondayOf(r.day), (piecesByWeek.get(mondayOf(r.day)) ?? 0) + Number(r.n));
  const byDay = new Map(series.map((p) => [p.day, p.followers]));
  const weeklyTarget = goals?.weeklyPieces ?? suggested.weeklyPieces;
  const weeks: WeekStat[] = [];
  for (let i = 0; i < 12; i++) {
    const start = addDays(firstMonday, i * 7);
    const end = addDays(start, 6) > today ? today : addDays(start, 6);
    const before = byDay.get(addDays(start, -1));
    const after = byDay.get(end);
    const pieces = piecesByWeek.get(start) ?? 0;
    weeks.push({ weekStart: start, pieces, followerGain: before != null && after != null ? after - before : null, hitTarget: pieces >= weeklyTarget, current: start === thisMonday });
  }
  // Racha: semanas completas seguidas (hacia atrás) que cumplieron la meta; la semana en curso suma si ya la cumplió.
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i]!;
    if (w.current && !w.hitTarget) continue;
    if (!w.hitTarget) break;
    streak++;
  }

  const complete = weeks.filter((w) => !w.current && w.followerGain != null);
  const hit = complete.filter((w) => w.hitTarget).map((w) => w.followerGain!);
  const miss = complete.filter((w) => !w.hitTarget).map((w) => w.followerGain!);
  const mHit = median(hit);
  const mMiss = median(miss);
  const insight =
    hit.length >= 2 && miss.length >= 2 && mHit != null && mMiss != null && mMiss > 0 && mHit > mMiss * 1.15
      ? { target: weeklyTarget, ratio: mHit / mMiss, withTarget: Math.round(mHit), withoutTarget: Math.round(mMiss) }
      : null;

  return { goals, suggested, platforms, current, perDay, gained28d, eta, neededPerWeek, series, weeks, streak, insight };
}
