import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AiError, aiConfigured } from "@/lib/ai/client";
import { getBrand } from "@/lib/ai/brand-context";
import { addDays, dayLong, todayIn } from "@/lib/calendar/dates";
import { assignDays } from "@/lib/calendar/free-days";
import { defaultPlatformsFor, type CalendarPlatform, type PlannedFormat } from "@/lib/calendar/labels";
import { brandCanPlan, buildWeekPlan, PlanError, type PlanIdea } from "@/lib/calendar/plan";
import { createEntry, entriesForSource, sourcePrefill } from "@/lib/calendar/service";
import { createCarousel } from "@/lib/carousels/service";
import { isTemplate, type TemplateKey } from "@/lib/carousels/theme";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/lib/notifications";
import { allowAttempt } from "@/lib/rate-limit";
import { busyDays } from "@/lib/calendar/busy";
import { createScript } from "@/lib/scripts/service";
import { autopilotExtra } from "@/lib/ai/prompts/autopiloto";
import { allowedDays, cronWeekDue, estimateWeekTokens, manualWeekFor, piecesWithinBudget, targetPieces, WEEKLY_TOKEN_BUDGET } from "./schedule";

/**
 * Autopiloto semanal: cada lunes deja listo un paquete para aprobar con el plan de la semana (el plan semanal con
 * IA del Calendario), los guiones escritos y los borradores de carrusel. Nada entra al calendario hasta que la
 * persona aprueba cada pieza. Consumo: todo se registra en ai_usage como "autopiloto.*" y tiene un tope semanal.
 */
export class AutopilotError extends Error {}

/** Si un paquete sigue "generando" después de esto, se cortó: el cron o el botón lo retoman. */
const STALE_MS = 15 * 60_000;
const CONCURRENCY = 3;

export type AutopilotSettings = { enabled: boolean; piecesPerWeek: number | null };

export async function getAutopilotSettings(): Promise<AutopilotSettings> {
  const [row] = await getDb().select().from(schema.autopilotSettings).limit(1);
  return { enabled: row?.enabled ?? false, piecesPerWeek: row?.piecesPerWeek ?? null };
}

export async function saveAutopilotSettings(input: AutopilotSettings, userId: string): Promise<void> {
  await getDb()
    .insert(schema.autopilotSettings)
    .values({ id: "autopilot", enabled: input.enabled, piecesPerWeek: input.piecesPerWeek, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.autopilotSettings.id, set: { enabled: input.enabled, piecesPerWeek: input.piecesPerWeek, updatedBy: userId } });
}

/** Tokens del autopiloto registrados en los últimos 7 días. */
export async function autopilotTokensLast7Days(): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select coalesce(sum(input_tokens + output_tokens), 0)::int as n from ai_usage
    where feature like 'autopiloto.%' and created_at > now() - interval '7 days'
  `);
  return Number(rows.rows[0]?.n ?? 0);
}

/** Ideas de los informes (mensual y semanal) que todavía pueden servir: el plan las tiene en cuenta si encajan. */
async function reportIdeas(): Promise<{ title: string; hook: string }[]> {
  const db = getDb();
  const [monthly, weekly] = await Promise.all([
    db.execute<{ ideas: { title: string; hook: string }[] | null }>(sql`select data->'summary'->'ideas' as ideas from monthly_reports order by month desc limit 1`),
    db.execute<{ ideas: { title: string; hook: string }[] | null }>(sql`select content->'nextWeek' as ideas from weekly_reports order by week_start desc limit 1`),
  ]);
  return [...(monthly.rows[0]?.ideas ?? []), ...(weekly.rows[0]?.ideas ?? [])].filter((i) => i?.title).slice(0, 8);
}

async function preferredTemplate(): Promise<TemplateKey> {
  const rows = await getDb().select({ template: schema.carousels.template }).from(schema.carousels).where(eq(schema.carousels.demo, false)).orderBy(sql`${schema.carousels.updatedAt} desc`).limit(10);
  return (rows.map((r) => r.template).find(isTemplate) as TemplateKey | undefined) ?? "editorial";
}

const scriptFormatFor: Partial<Record<PlannedFormat, "REEL" | "SHORT" | "STORY">> = { REEL: "REEL", SHORT: "SHORT", STORY: "STORY", VIDEO: "SHORT", POST: "REEL", CLONE_VIDEO: "REEL" };

type PackItem = typeof schema.weeklyPackItems.$inferSelect;

/** Escribe el guion o el carrusel de una pieza del paquete. Nunca tira error: guarda el suyo en la pieza. */
async function generateItem(item: PackItem, userId: string | null): Promise<void> {
  const db = getDb();
  try {
    if (item.format === "CAROUSEL") {
      const carouselId = await createCarousel({
        origin: "tema",
        topic: [item.title, item.hook].filter(Boolean).join(". "),
        pastedText: null,
        scriptId: null,
        objective: "guardar",
        slides: 7,
        keyword: null,
        template: await preferredTemplate(),
        userId,
        feature: "autopiloto.carrusel",
      });
      await db.update(schema.weeklyPackItems).set({ carouselId, genStatus: "ready", genError: null }).where(eq(schema.weeklyPackItems.id, item.id));
    } else {
      const scriptId = await createScript({
        idea: [item.title, item.hook ? `Gancho propuesto: ${item.hook}` : null, item.why ? `Por qué esta semana: ${item.why}` : null].filter(Boolean).join("\n"),
        format: scriptFormatFor[item.format] ?? "REEL",
        objective: "seguidores",
        pillar: item.pillar,
        offer: null,
        reference: null,
        referenceLabel: null,
        sourceContentItemId: null,
        sourceUrl: null,
        userId,
        feature: "autopiloto.guion",
      });
      await db.update(schema.weeklyPackItems).set({ scriptId, genStatus: "ready", genError: null }).where(eq(schema.weeklyPackItems.id, item.id));
    }
  } catch (error) {
    const message = error instanceof AiError ? error.userMessage : "No pudimos escribir esta pieza. Reintenta desde aquí.";
    if (error instanceof AiError) console.error("[autopiloto] ia", error.detail);
    else console.error("[autopiloto]", error instanceof Error ? error.message : error);
    await db.update(schema.weeklyPackItems).set({ genStatus: "failed", genError: message }).where(eq(schema.weeklyPackItems.id, item.id));
  }
}

async function runPool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
  }));
}

/** Avisa al equipo (dueños y editores) con la campana y por correo. Una sola vez por semana. */
async function notifyReady(weekStart: string, pieces: number): Promise<void> {
  const db = getDb();
  const [claimed] = await db
    .update(schema.weeklyPacks)
    .set({ notifiedAt: new Date() })
    .where(and(eq(schema.weeklyPacks.weekStart, weekStart), sql`${schema.weeklyPacks.notifiedAt} is null`))
    .returning({ weekStart: schema.weeklyPacks.weekStart });
  if (!claimed) return;
  const members = await db.execute<{ user_id: string }>(sql`select user_id from team_members where active and role in ('OWNER', 'EDITOR')`);
  for (const m of members.rows) {
    await notify({
      key: `autopiloto:${weekStart}:${m.user_id}`,
      userId: m.user_id,
      tone: "success",
      title: "Tu semana está lista para aprobar",
      body: `Preparamos ${pieces === 1 ? "1 pieza" : `${pieces} piezas`} con sus guiones y carruseles. Apruébalas, edítalas o descártalas: lo aprobado queda en tu calendario.`,
      href: "/calendario/semana",
      email: true,
      footnote: "El autopiloto arma tu semana cada lunes. Puedes apagarlo o cambiar cuántas piezas prepara en Calendario → Tu semana lista.",
    });
  }
}

/** Escribe las piezas pendientes y cierra el paquete (READY, o FAILED si no salió ninguna). */
async function finishPack(weekStart: string, userId: string | null, startedAt: Date): Promise<void> {
  const db = getDb();
  const items = await db.select().from(schema.weeklyPackItems).where(and(eq(schema.weeklyPackItems.weekStart, weekStart), eq(schema.weeklyPackItems.genStatus, "pending"))).orderBy(asc(schema.weeklyPackItems.position));
  await runPool(items, (item) => generateItem(item, userId));
  const all = await db.select({ genStatus: schema.weeklyPackItems.genStatus }).from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.weekStart, weekStart));
  const ready = all.filter((i) => i.genStatus === "ready").length;
  const used = await db.execute<{ n: number }>(sql`
    select coalesce(sum(input_tokens + output_tokens), 0)::int as n from ai_usage where feature like 'autopiloto.%' and created_at >= ${startedAt.toISOString()}::timestamptz
  `);
  await db
    .update(schema.weeklyPacks)
    .set({
      status: ready ? "READY" : "FAILED",
      errorMessage: ready ? null : "No pudimos escribir ninguna pieza. Vuelve a intentarlo en unos minutos.",
      usedTokens: Number(used.rows[0]?.n ?? 0),
    })
    .where(eq(schema.weeklyPacks.weekStart, weekStart));
  if (ready) await notifyReady(weekStart, ready);
}

export type BuildResult = { status: "created" | "exists" | "skipped"; reason?: string; weekStart: string };

/**
 * Arma el paquete de la semana. La fila de weekly_packs es el candado: si ya existe (generando o listo), no hace
 * nada. Devuelve enseguida con la fila creada si `background` es una función (para la acción, que sigue en `after`).
 */
export async function buildWeeklyPack(input: { weekStart: string; trigger: "cron" | "manual"; userId: string | null; today?: string; run?: (task: () => Promise<void>) => void }): Promise<BuildResult> {
  const db = getDb();
  const tz = env().APP_TIMEZONE;
  const today = input.today ?? todayIn(tz);
  if (!aiConfigured()) return { status: "skipped", reason: "Falta configurar la IA en esta instalación.", weekStart: input.weekStart };
  const brand = await getBrand();
  if (!brandCanPlan(brand)) return { status: "skipped", reason: "Primero completa Mi marca: con tu nicho y tus pilares el plan sale a tu medida.", weekStart: input.weekStart };

  const days = allowedDays(input.weekStart, today);
  const settings = await getAutopilotSettings();
  const wanted = targetPieces(settings.piecesPerWeek, brand?.goals?.weeklyPieces ?? null, days.length);
  if (wanted === 0) return { status: "skipped", reason: "Ya no quedan días libres esta semana.", weekStart: input.weekStart };
  const used = await autopilotTokensLast7Days();
  const pieces = piecesWithinBudget(wanted, used);
  if (pieces === 0) return { status: "skipped", reason: "El autopiloto llegó a su tope de consumo de esta semana. Vuelve a intentarlo en unos días.", weekStart: input.weekStart };

  const [claimed] = await db
    .insert(schema.weeklyPacks)
    .values({ weekStart: input.weekStart, status: "GENERATING", trigger: input.trigger, estimatedTokens: estimateWeekTokens(pieces), createdBy: input.userId })
    .onConflictDoNothing()
    .returning({ weekStart: schema.weeklyPacks.weekStart, createdAt: schema.weeklyPacks.createdAt });
  if (!claimed) return { status: "exists", weekStart: input.weekStart };

  const task = async () => {
    try {
      await planPack(input.weekStart, pieces, days, input.userId);
      await finishPack(input.weekStart, input.userId, claimed.createdAt);
    } catch (error) {
      const message = error instanceof AiError ? error.userMessage : error instanceof PlanError ? error.message : "No pudimos armar el plan de la semana. Vuelve a intentarlo.";
      console.error("[autopiloto] plan", error instanceof AiError ? error.detail : error instanceof Error ? error.message : error);
      await db.update(schema.weeklyPacks).set({ status: "FAILED", errorMessage: message }).where(eq(schema.weeklyPacks.weekStart, input.weekStart));
    }
  };
  if (input.run) input.run(task);
  else await task();
  return { status: "created", weekStart: input.weekStart };
}

/** Pide el plan con IA y guarda sus piezas (sin escribir todavía guiones ni carruseles). */
async function planPack(weekStart: string, pieces: number, days: string[], userId: string | null): Promise<void> {
  const db = getDb();
  const ideas = await reportIdeas();
  const plan = await buildWeekPlan(userId, {
    weekStart,
    count: pieces,
    allowedDays: days,
    feature: "autopiloto.plan",
    extra: autopilotExtra({ count: pieces, days: days.map(dayLong), reportIdeas: ideas }),
  });
  const busy = await busyDays(weekStart, addDays(weekStart, 6));
  const dates = assignDays(plan.ideas.map((i) => i.date), days, busy);
  const rows = plan.ideas.slice(0, pieces).map((idea: PlanIdea, i) => {
    // Formatos caros o sin flujo propio se escriben como guion corto (ver scriptFormatFor).
    const format: PlannedFormat = idea.format === "VIDEO" ? "SHORT" : idea.format;
    const platforms: CalendarPlatform[] = format === idea.format ? idea.platforms : defaultPlatformsFor[format];
    return {
      weekStart,
      position: i,
      title: idea.title,
      hook: idea.hook || null,
      pillar: idea.pillar,
      why: idea.why || null,
      format,
      platforms,
      scheduledDate: dates[i] ?? null,
    };
  });
  if (!rows.length) throw new PlanError("La IA no propuso piezas esta vez. Vuelve a intentarlo.");
  await db.insert(schema.weeklyPackItems).values(rows);
}

/** Para el cron horario: arma el paquete del lunes (una vez por semana) o retoma uno que se cortó. */
export async function ensureWeeklyPack(now = new Date()): Promise<BuildResult | null> {
  const settings = await getAutopilotSettings();
  if (!settings.enabled) return null;
  const tz = env().APP_TIMEZONE;
  const db = getDb();

  // Un paquete que se cortó a mitad de camino (por ejemplo, se acabó el tiempo de la función) se retoma.
  const [stuck] = await db
    .select({ weekStart: schema.weeklyPacks.weekStart, createdBy: schema.weeklyPacks.createdBy, createdAt: schema.weeklyPacks.createdAt })
    .from(schema.weeklyPacks)
    .where(and(eq(schema.weeklyPacks.status, "GENERATING"), sql`${schema.weeklyPacks.updatedAt} < now() - make_interval(secs => ${STALE_MS / 1000})`))
    .limit(1);
  if (stuck) {
    await resumePack(stuck.weekStart);
    return { status: "created", weekStart: stuck.weekStart };
  }

  const weekStart = cronWeekDue(tz, now);
  if (!weekStart) return null;
  const [existing] = await db.select({ w: schema.weeklyPacks.weekStart }).from(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart)).limit(1);
  if (existing) return { status: "exists", weekStart };
  // Si algo falla (IA, marca incompleta), se reintenta como mucho 3 veces por semana, no cada hora.
  if (!(await allowAttempt(`autopiloto-cron:${weekStart}`, 3, 7 * 86_400))) return null;
  return buildWeeklyPack({ weekStart, trigger: "cron", userId: null, today: todayIn(tz, now) });
}

/** Retoma un paquete cortado: si no tiene piezas, rehace el plan; si tiene, escribe las que faltan. */
export async function resumePack(weekStart: string, userId: string | null = null): Promise<void> {
  const db = getDb();
  await db.update(schema.weeklyPacks).set({ status: "GENERATING", errorMessage: null }).where(eq(schema.weeklyPacks.weekStart, weekStart));
  const [pack] = await db.select().from(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart)).limit(1);
  if (!pack) return;
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.weekStart, weekStart));
  try {
    if (n === 0) {
      const tz = env().APP_TIMEZONE;
      const days = allowedDays(weekStart, todayIn(tz));
      const settings = await getAutopilotSettings();
      const brand = await getBrand();
      const pieces = piecesWithinBudget(targetPieces(settings.piecesPerWeek, brand?.goals?.weeklyPieces ?? null, days.length), await autopilotTokensLast7Days());
      if (!pieces) throw new PlanError("No quedan días o se llegó al tope de consumo de esta semana.");
      await planPack(weekStart, pieces, days, userId ?? pack.createdBy);
    }
    await finishPack(weekStart, userId ?? pack.createdBy, new Date());
  } catch (error) {
    const message = error instanceof AiError ? error.userMessage : error instanceof PlanError ? error.message : "No pudimos armar el plan de la semana. Vuelve a intentarlo.";
    await db.update(schema.weeklyPacks).set({ status: "FAILED", errorMessage: message }).where(eq(schema.weeklyPacks.weekStart, weekStart));
  }
}

/** Semana que arma el botón "Armar mi semana ahora". */
export function manualWeek(): string {
  return manualWeekFor(todayIn(env().APP_TIMEZONE));
}

/** Descarta un paquete fallido para volver a armarlo (las piezas ya escritas quedan en Guiones y Carruseles). */
export async function discardFailedPack(weekStart: string): Promise<void> {
  const db = getDb();
  const [pack] = await db.select({ status: schema.weeklyPacks.status, updatedAt: schema.weeklyPacks.updatedAt }).from(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart)).limit(1);
  if (!pack) return;
  const stale = pack.status === "GENERATING" && Date.now() - pack.updatedAt.getTime() > STALE_MS;
  if (pack.status !== "FAILED" && !stale) throw new AutopilotError(pack.status === "GENERATING" ? "Tu semana todavía se está armando." : "Esa semana ya está lista.");
  await db.delete(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart));
}

// ─── Decisiones sobre cada pieza ───────────────────────────────────────────

async function loadItem(id: string): Promise<PackItem> {
  const [item] = await getDb().select().from(schema.weeklyPackItems).where(eq(schema.weeklyPackItems.id, id)).limit(1);
  if (!item) throw new AutopilotError("Esa pieza ya no está en tu semana.");
  return item;
}

export type ItemEdit = { title: string; hook: string | null; scheduledDate: string | null };

export async function editItem(id: string, edit: ItemEdit): Promise<void> {
  const item = await loadItem(id);
  if (item.decision === "discarded") throw new AutopilotError("Esa pieza está descartada. Recupérala para editarla.");
  await getDb().update(schema.weeklyPackItems).set({ title: edit.title, hook: edit.hook, scheduledDate: edit.scheduledDate }).where(eq(schema.weeklyPackItems.id, id));
  // Si ya estaba aprobada, el calendario se actualiza igual.
  if (item.calendarEntryId) {
    await getDb().update(schema.calendarEntries).set({ title: edit.title, hook: edit.hook, scheduledDate: edit.scheduledDate }).where(eq(schema.calendarEntries.id, item.calendarEntryId));
  }
}

/** Aprueba la pieza: queda en el calendario en su día, vinculada a su guion o carrusel y con su estado. */
export async function approveItem(id: string, userId: string): Promise<{ entryId: string; date: string | null }> {
  const item = await loadItem(id);
  if (item.genStatus !== "ready") throw new AutopilotError(item.genStatus === "pending" ? "Esa pieza todavía se está escribiendo." : "Esa pieza no se pudo escribir. Reintenta antes de aprobarla.");
  const kind = item.carouselId ? ("carrusel" as const) : ("guion" as const);
  const sourceId = (item.carouselId ?? item.scriptId)!;
  if (item.calendarEntryId) return { entryId: item.calendarEntryId, date: item.scheduledDate };
  const existing = await entriesForSource(kind, sourceId);
  let entryId = existing[0]?.id;
  if (!entryId) {
    const prefill = await sourcePrefill(kind, sourceId);
    if (!prefill) throw new AutopilotError(kind === "carrusel" ? "El carrusel de esta pieza ya no existe." : "El guion de esta pieza ya no existe.");
    entryId = await createEntry(
      {
        title: item.title.slice(0, 160),
        notes: item.why ? `Por qué esta semana: ${item.why}` : null,
        hook: item.hook ?? prefill.hook,
        pillar: item.pillar ?? prefill.pillar,
        format: item.format,
        status: prefill.status,
        platforms: item.platforms.length ? item.platforms : prefill.platforms,
        scheduledDate: item.scheduledDate,
        scheduledTime: null,
        scriptId: prefill.scriptId,
        carouselId: prefill.carouselId,
        source: "autopiloto",
      },
      userId,
    );
  }
  await getDb().update(schema.weeklyPackItems).set({ decision: "approved", calendarEntryId: entryId }).where(eq(schema.weeklyPackItems.id, id));
  return { entryId, date: item.scheduledDate };
}

/**
 * Descarta la pieza: su guion o carrusel se archiva (no se borra: se puede recuperar en Guiones o Carruseles) y,
 * si ya estaba aprobada, sale del calendario.
 */
export async function discardItem(id: string): Promise<void> {
  const item = await loadItem(id);
  const db = getDb();
  if (item.calendarEntryId) await db.delete(schema.calendarEntries).where(eq(schema.calendarEntries.id, item.calendarEntryId));
  if (item.scriptId) await db.update(schema.scripts).set({ status: "ARCHIVED" }).where(and(eq(schema.scripts.id, item.scriptId), inArray(schema.scripts.status, ["IDEA", "DRAFT"])));
  if (item.carouselId) await db.update(schema.carousels).set({ status: "ARCHIVED" }).where(and(eq(schema.carousels.id, item.carouselId), eq(schema.carousels.status, "DRAFT")));
  await db.update(schema.weeklyPackItems).set({ decision: "discarded", calendarEntryId: null }).where(eq(schema.weeklyPackItems.id, id));
}

/** Recupera una pieza descartada: vuelve a pendiente y su guion o carrusel sale del archivo. */
export async function restoreItem(id: string): Promise<void> {
  const item = await loadItem(id);
  const db = getDb();
  if (item.scriptId) await db.update(schema.scripts).set({ status: "DRAFT" }).where(and(eq(schema.scripts.id, item.scriptId), eq(schema.scripts.status, "ARCHIVED")));
  if (item.carouselId) await db.update(schema.carousels).set({ status: "DRAFT" }).where(and(eq(schema.carousels.id, item.carouselId), eq(schema.carousels.status, "ARCHIVED")));
  await db.update(schema.weeklyPackItems).set({ decision: "pending" }).where(eq(schema.weeklyPackItems.id, id));
}

/** Vuelve a escribir una pieza que falló. */
export async function retryItem(id: string, userId: string): Promise<void> {
  const item = await loadItem(id);
  if (item.genStatus !== "failed") throw new AutopilotError("Esa pieza no falló.");
  await getDb().update(schema.weeklyPackItems).set({ genStatus: "pending", genError: null }).where(eq(schema.weeklyPackItems.id, id));
  await generateItem({ ...item, genStatus: "pending" }, userId);
}

export { WEEKLY_TOKEN_BUDGET };
