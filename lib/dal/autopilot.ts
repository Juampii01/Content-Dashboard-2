import "server-only";
import { asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/client";
import { getBrand } from "@/lib/ai/brand-context";
import { startOfWeek, todayIn } from "@/lib/calendar/dates";
import { brandCanPlan } from "@/lib/calendar/plan";
import type { CalendarStatus, PlannedFormat } from "@/lib/calendar/labels";
import { autopilotTokensLast7Days, getAutopilotSettings } from "@/lib/autopilot/service";
import { DEFAULT_PIECES, estimateWeekTokens, manualWeekFor, WEEKLY_TOKEN_BUDGET } from "@/lib/autopilot/schedule";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

/** Datos de "Tu semana lista" (autopiloto semanal). Cada función empieza validando la sesión. */
export type WeekItem = {
  id: string;
  title: string;
  hook: string | null;
  pillar: string | null;
  why: string | null;
  format: PlannedFormat;
  platforms: ("INSTAGRAM" | "YOUTUBE" | "TIKTOK")[];
  scheduledDate: string | null;
  genStatus: "pending" | "ready" | "failed";
  genError: string | null;
  decision: "pending" | "approved" | "discarded";
  script: { id: string; title: string; format: string; hooks: string[]; estimatedSeconds: number | null; beats: number } | null;
  carousel: { id: string; title: string; headlines: string[]; slides: number } | null;
  entry: { id: string; status: CalendarStatus; date: string | null } | null;
};

export type WeekPackView = {
  weekStart: string;
  status: "GENERATING" | "READY" | "FAILED";
  stale: boolean;
  errorMessage: string | null;
  trigger: "cron" | "manual";
  estimatedTokens: number | null;
  usedTokens: number | null;
  createdAt: string;
  items: WeekItem[];
};

export type AutopilotView = {
  enabled: boolean;
  piecesPerWeek: number | null;
  weeklyGoal: number | null;
  effectivePieces: number;
  estimatedTokens: number;
  usedLast7Days: number;
  budget: number;
  brandReady: boolean;
  aiReady: boolean;
  today: string;
  /** Semana que armaría el botón "Armar mi semana ahora". */
  manualWeek: string;
  pack: WeekPackView | null;
  canEdit: boolean;
};

const STALE_MS = 15 * 60_000;

async function packView(weekStart: string): Promise<WeekPackView | null> {
  const db = getDb();
  const [pack] = await db.select().from(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart)).limit(1);
  if (!pack) return null;
  const items = await db.select().from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.weekStart, weekStart)).orderBy(asc(schema.weeklyPackItems.scheduledDate), asc(schema.weeklyPackItems.position));
  const scriptIds = items.map((i) => i.scriptId).filter((v): v is string => Boolean(v));
  const carouselIds = items.map((i) => i.carouselId).filter((v): v is string => Boolean(v));
  const entryIds = items.map((i) => i.calendarEntryId).filter((v): v is string => Boolean(v));
  const [scripts, carousels, entries] = await Promise.all([
    scriptIds.length
      ? db.select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format, content: schema.scripts.content, estimatedSeconds: schema.scripts.estimatedSeconds }).from(schema.scripts).where(inArray(schema.scripts.id, scriptIds))
      : [],
    carouselIds.length ? db.select({ id: schema.carousels.id, title: schema.carousels.title, slides: schema.carousels.slides }).from(schema.carousels).where(inArray(schema.carousels.id, carouselIds)) : [],
    entryIds.length ? db.select({ id: schema.calendarEntries.id, status: schema.calendarEntries.status, date: schema.calendarEntries.scheduledDate }).from(schema.calendarEntries).where(inArray(schema.calendarEntries.id, entryIds)) : [],
  ]);
  return {
    weekStart: pack.weekStart,
    status: pack.status,
    stale: pack.status === "GENERATING" && Date.now() - pack.updatedAt.getTime() > STALE_MS,
    errorMessage: pack.errorMessage,
    trigger: pack.trigger,
    estimatedTokens: pack.estimatedTokens,
    usedTokens: pack.usedTokens,
    createdAt: pack.createdAt.toISOString(),
    items: items.map((i) => {
      const s = scripts.find((x) => x.id === i.scriptId);
      const c = carousels.find((x) => x.id === i.carouselId);
      const e = entries.find((x) => x.id === i.calendarEntryId);
      return {
        id: i.id,
        title: i.title,
        hook: i.hook,
        pillar: i.pillar,
        why: i.why,
        format: i.format,
        platforms: i.platforms,
        scheduledDate: i.scheduledDate,
        genStatus: i.genStatus,
        genError: i.genError,
        decision: i.decision,
        script: s ? { id: s.id, title: s.title, format: s.format, hooks: (s.content?.hooks ?? []).slice(0, 3).map((h) => h.text), estimatedSeconds: s.estimatedSeconds, beats: s.content?.beats.length ?? 0 } : null,
        carousel: c ? { id: c.id, title: c.title, headlines: c.slides.map((sl) => sl.headline).slice(0, 10), slides: c.slides.length } : null,
        entry: e ? { id: e.id, status: e.status, date: e.date } : null,
      };
    }),
  };
}

export async function getAutopilotView(): Promise<AutopilotView> {
  const me = await getCurrentUser();
  const db = getDb();
  const today = todayIn(env().APP_TIMEZONE);
  const [settings, brand, used] = await Promise.all([getAutopilotSettings(), getBrand(), autopilotTokensLast7Days()]);
  // La semana más reciente que todavía no terminó (la actual o la próxima).
  const [latest] = await db
    .select({ weekStart: schema.weeklyPacks.weekStart })
    .from(schema.weeklyPacks)
    .where(gte(schema.weeklyPacks.weekStart, startOfWeek(today)))
    .orderBy(desc(schema.weeklyPacks.weekStart))
    .limit(1);
  const weeklyGoal = brand?.goals?.weeklyPieces ?? null;
  const effectivePieces = Math.max(1, Math.min(7, settings.piecesPerWeek ?? weeklyGoal ?? DEFAULT_PIECES));
  return {
    enabled: settings.enabled,
    piecesPerWeek: settings.piecesPerWeek,
    weeklyGoal,
    effectivePieces,
    estimatedTokens: estimateWeekTokens(effectivePieces),
    usedLast7Days: used,
    budget: WEEKLY_TOKEN_BUDGET,
    brandReady: brandCanPlan(brand),
    aiReady: aiConfigured(),
    today,
    manualWeek: manualWeekFor(today),
    pack: latest ? await packView(latest.weekStart) : null,
    canEdit: me.role !== "VIEWER",
  };
}

/** Para un aviso en Inicio: cuántas piezas esperan aprobación esta semana (0 = nada que mostrar). */
export async function pendingWeekItems(): Promise<{ weekStart: string; pending: number } | null> {
  await getCurrentUser();
  const today = todayIn(env().APP_TIMEZONE);
  const [latest] = await getDb()
    .select({ weekStart: schema.weeklyPacks.weekStart, status: schema.weeklyPacks.status })
    .from(schema.weeklyPacks)
    .where(gte(schema.weeklyPacks.weekStart, startOfWeek(today)))
    .orderBy(desc(schema.weeklyPacks.weekStart))
    .limit(1);
  if (!latest || latest.status !== "READY") return null;
  const items = await getDb().select({ decision: schema.weeklyPackItems.decision, genStatus: schema.weeklyPackItems.genStatus }).from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.weekStart, latest.weekStart));
  const pending = items.filter((i) => i.decision === "pending" && i.genStatus === "ready").length;
  return pending ? { weekStart: latest.weekStart, pending } : null;
}
