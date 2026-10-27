import "server-only";
import { sql } from "drizzle-orm";
import { brandContext, getBrand, type Brand } from "@/lib/ai/brand-context";
import { generateStructured } from "@/lib/ai/client";
import { PLANNING_RULES, planSchema, planTask } from "@/lib/ai/prompts/calendario";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, dayLong, diffDays, rangeTitle, startOfWeek, todayIn } from "./dates";
import { defaultPlatformsFor, type CalendarPlatform, type PlannedFormat } from "./labels";

/**
 * Plan semanal con IA: 3 a 5 ideas para la semana siguiente, con gancho y pilar.
 * Usa la marca (pilares y ofertas), lo que ya funcionó (topOwnPieces, dentro del contexto de marca)
 * y lo que ya está programado, para no repetir. No crea nada: devuelve una vista previa que el
 * usuario acepta o descarta idea por idea.
 */
export type PlanIdea = {
  key: string;
  title: string;
  hook: string;
  pillar: string | null;
  format: PlannedFormat;
  platforms: CalendarPlatform[];
  date: string;
  why: string;
};

/** La marca tiene lo mínimo para planear: nicho o pilares. */
export function brandCanPlan(brand: Brand | null): boolean {
  return Boolean(brand && ((brand.niche ?? "").trim() || brand.pillars.length > 0));
}

/** Lunes de la semana que viene (en APP_TIMEZONE). */
export function nextWeekStart(today = todayIn(env().APP_TIMEZONE)): string {
  return addDays(startOfWeek(today), 7);
}

export class PlanError extends Error {}

/** Opciones del autopiloto semanal (lib/autopilot): otra semana, cantidad exacta, indicaciones extra y su propio registro de consumo. */
export type PlanOptions = {
  weekStart?: string;
  count?: number;
  extra?: string;
  feature?: string;
  /** Días en que se puede programar (por defecto, toda la semana). Una idea fuera de estos días se corre al siguiente permitido. */
  allowedDays?: string[];
};

export async function buildWeekPlan(userId: string | null, options: PlanOptions = {}): Promise<{ weekStart: string; ideas: PlanIdea[] }> {
  const brand = await getBrand();
  if (!brandCanPlan(brand)) throw new PlanError("Primero completa Mi marca: con tu nicho y tus pilares el plan sale a tu medida.");
  const db = getDb();
  const weekStart = options.weekStart ?? nextWeekStart();
  const weekEnd = addDays(weekStart, 6);

  const [connected, scheduled, recent, pillarCounts] = await Promise.all([
    db.execute<{ platform: CalendarPlatform }>(sql`select platform from social_accounts where current and status <> 'DISCONNECTED'`),
    db.execute<{ day: string; title: string; pillar: string | null }>(sql`
      select to_char(scheduled_date, 'YYYY-MM-DD') as day, title, pillar from calendar_entries
      where scheduled_date between ${weekStart}::date and ${weekEnd}::date order by scheduled_date, position`),
    db.execute<{ title: string }>(sql`
      (select title from calendar_entries where created_at > now() - interval '45 days' and (scheduled_date is null or scheduled_date < ${weekStart}::date) order by created_at desc limit 25)
      union all
      (select coalesce(title, split_part(caption, E'\n', 1)) as title from content_items where available and published_at > now() - interval '30 days' order by published_at desc limit 15)`),
    db.execute<{ pillar: string; n: number }>(sql`
      select pillar, count(*)::int as n from calendar_entries
      where pillar is not null and scheduled_date between ${addDays(weekStart, -28)}::date and ${weekEnd}::date group by pillar`),
  ]);

  const platforms = connected.rows.map((r) => r.platform);
  const counts = new Map(pillarCounts.rows.map((r) => [r.pillar, r.n]));
  const pillarBalance = brand!.pillars.map((p) => ({ name: p.name, target: p.share, recent: counts.get(p.name) ?? 0 }));

  const plan = await generateStructured({
    feature: options.feature ?? "calendario.plan",
    model: "main",
    context: `${PLANNING_RULES}\n\n${await brandContext(brand)}`,
    task: planTask({
      weekLabel: rangeTitle(weekStart, weekEnd),
      platforms: platforms.map((p) => (p === "INSTAGRAM" ? "Instagram" : p === "YOUTUBE" ? "YouTube" : "TikTok")),
      pillarBalance,
      scheduled: scheduled.rows.map((s) => ({ day: dayLong(s.day), title: s.title, pillar: s.pillar })),
      recent: recent.rows.map((r) => r.title).filter(Boolean).slice(0, 40),
      count: options.count,
      extra: options.extra,
    }),
    schema: planSchema,
    maxTokens: 3000,
    userId,
  });

  const pillarNames = new Map(brand!.pillars.map((p) => [p.name.toLowerCase(), p.name]));
  const allowed = new Set<CalendarPlatform>(platforms.length ? platforms : ["INSTAGRAM", "YOUTUBE", "TIKTOK"]);
  const usedDays = new Set<number>();
  const allowedIdx = options.allowedDays?.length ? new Set(options.allowedDays.map((d) => diffDays(weekStart, d)).filter((n) => n >= 0 && n <= 6)) : null;
  const ideas = plan.ideas.slice(0, options.count ?? 5).map((idea, i): PlanIdea => {
    let day = Math.min(6, Math.max(0, Math.round(idea.day)));
    // Una por día (y dentro de los días permitidos): si el modelo repitió el día, se corre al siguiente libre.
    for (let k = 0; k < 7 && (usedDays.has(day) || (allowedIdx && !allowedIdx.has(day))); k++) day = (day + 1) % 7;
    usedDays.add(day);
    const format = idea.format as PlannedFormat;
    let nets = [...new Set(idea.platforms)].filter((p) => allowed.has(p));
    if (format === "CAROUSEL" || format === "STORY") nets = nets.filter((p) => p === "INSTAGRAM");
    if (nets.length === 0) nets = defaultPlatformsFor[format].filter((p) => allowed.has(p));
    if (nets.length === 0) nets = [...allowed].slice(0, 1);
    return {
      key: `idea-${i}`,
      title: idea.title.trim().slice(0, 140),
      hook: idea.hook.trim().slice(0, 500),
      pillar: pillarNames.get(idea.pillar.trim().toLowerCase()) ?? (idea.pillar.trim() || null),
      format,
      platforms: nets,
      date: addDays(weekStart, day),
      why: idea.why.trim().slice(0, 300),
    };
  });
  ideas.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { weekStart, ideas };
}
