import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { WeeklyReportContent } from "@/lib/db/schema";
import { aiConfigured, generateStructured } from "@/lib/ai/client";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { WEEKLY_RULES, weeklyReportSchema } from "@/lib/ai/prompts/inicio";
import { totalsUnchecked } from "@/lib/dal/metrics";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { typeLabel } from "@/lib/metrics/labels";
import { addDays, parseFilters, todayIn } from "@/lib/metrics/params";
import { platformLabel, type Platform } from "@/lib/social/types";

/** Lunes de la semana pasada (local): la semana que resume el reporte de hoy. */
export function lastWeekStart(tz = env().APP_TIMEZONE): string {
  const today = todayIn(tz);
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -dow - 7);
}

export async function latestWeeklyReport(): Promise<{ weekStart: string; content: WeeklyReportContent; createdAt: Date } | null> {
  await getCurrentUser();
  const [row] = await getDb().select().from(schema.weeklyReports).orderBy(desc(schema.weeklyReports.weekStart)).limit(1);
  return row ?? null;
}

/**
 * Genera (o regenera) el resumen de la semana que empieza en `weekStart`.
 * Lo llama el cron los lunes y el botón de Inicio. Devuelve null si no hay datos o IA.
 */
export async function generateWeeklyReport(weekStart = lastWeekStart(), userId: string | null = null): Promise<WeeklyReportContent | null> {
  if (!aiConfigured()) return null;
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const weekEnd = addDays(weekStart, 6);
  const base = parseFilters({}, tz);
  const [current, previous] = await Promise.all([totalsUnchecked(base, weekStart, weekEnd), totalsUnchecked(base, addDays(weekStart, -7), addDays(weekStart, -1))]);

  const pieces = await db.execute<{ platform: Platform; type: keyof typeof typeLabel; title: string | null; caption: string | null; views: number | null; perf_score: number | null; hook_type: string | null }>(sql`
    select platform, type, title, caption, views, perf_score, hook_type from content_items
    where (published_at at time zone ${tz})::date between ${weekStart}::date and ${weekEnd}::date
    order by perf_score desc nulls last, views desc nulls last limit 15
  `);
  const followers = await db.execute<{ platform: Platform; gain: number | null }>(sql`
    select sa.platform,
      (select followers from account_snapshots s where s.social_account_id = sa.id and s.captured_on <= ${weekEnd}::date and followers is not null order by captured_on desc limit 1)
      - (select followers from account_snapshots s where s.social_account_id = sa.id and s.captured_on <= ${addDays(weekStart, -1)}::date and followers is not null order by captured_on desc limit 1) as gain
    from social_accounts sa where sa.current
  `);
  const planned = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from calendar_entries where scheduled_date between ${addDays(weekEnd, 1)}::date and ${addDays(weekEnd, 7)}::date
  `);
  if (current.pieces === 0 && followers.rows.every((f) => f.gain == null)) return null;

  const fmt = (v: number | null | undefined) => (v == null ? "sin dato" : Math.round(v).toLocaleString("es-MX"));
  const task = `SEMANA DEL ${formatDate(weekStart)} AL ${formatDate(weekEnd)}

TOTALES (esta semana / semana anterior)
- Piezas publicadas: ${current.pieces} / ${previous.pieces}
- Visualizaciones de esas piezas: ${fmt(current.views)} / ${fmt(previous.views)}
- Tasa de interacción: ${current.engagementRate?.toFixed(1) ?? "sin dato"} % / ${previous.engagementRate?.toFixed(1) ?? "sin dato"} %
- Guardados + compartidos por cada 1,000 vistas: ${current.savesSharesPer1k?.toFixed(1) ?? "sin dato"} / ${previous.savesSharesPer1k?.toFixed(1) ?? "sin dato"}
- Seguidores netos: ${fmt(current.followersNet)} / ${fmt(previous.followersNet)}

SEGUIDORES GANADOS POR RED
${followers.rows.map((f) => `- ${platformLabel[f.platform]}: ${f.gain == null ? "sin dato" : (f.gain >= 0 ? "+" : "") + fmt(f.gain)}`).join("\n")}

PIEZAS DE LA SEMANA (de mejor a peor; ×N = veces su mediana)
${pieces.rows.length ? pieces.rows.map((p) => `- [${platformLabel[p.platform]} ${typeLabel[p.type]}${p.hook_type ? `, gancho ${p.hook_type}` : ""}] ${(p.title || p.caption?.split("\n")[0] || "(sin texto)").slice(0, 140)} · ${fmt(p.views)} vistas${p.perf_score != null ? ` · ×${Number(p.perf_score).toFixed(1)}` : ""}`).join("\n") : "(no publicó nada esta semana)"}

CALENDARIO
Piezas programadas para la semana que viene: ${planned.rows[0]?.n ?? 0}

TAREA
Escribe el resumen de la semana y propone 3 ideas para la semana que viene.`;

  const brand = await getBrand();
  const draft = await generateStructured({
    feature: "inicio.resumen",
    model: "main",
    context: `${WEEKLY_RULES}\n\n${await brandContext(brand)}`,
    task,
    schema: weeklyReportSchema,
    maxTokens: 2500,
    userId,
  });
  const content: WeeklyReportContent = {
    ...draft,
    numbers: { pieces: current.pieces, views: current.views, followersNet: current.followersNet, prevPieces: previous.pieces, prevViews: previous.views, prevFollowersNet: previous.followersNet },
  };
  await db
    .insert(schema.weeklyReports)
    .values({ weekStart, content })
    .onConflictDoUpdate({ target: schema.weeklyReports.weekStart, set: { content, createdAt: new Date() } });
  return content;
}

/** Para el cron: genera el resumen de la semana pasada si todavía no existe. */
export async function ensureWeeklyReport(): Promise<boolean> {
  const tz = env().APP_TIMEZONE;
  // El lunes se espera a las 9:00 (hora de la marca) para que el domingo ya esté sincronizado.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  if (weekday === "Mon" && hour < 9) return false;
  const weekStart = lastWeekStart(tz);
  const [existing] = await getDb().select({ w: schema.weeklyReports.weekStart }).from(schema.weeklyReports).where(eq(schema.weeklyReports.weekStart, weekStart)).limit(1);
  if (existing) return false;
  return (await generateWeeklyReport(weekStart)) != null;
}
