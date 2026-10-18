import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isoDay, SyncContext } from "../http";
import { instagramAccountDays, instagramMediaPage, instagramNormalize, instagramProfile, pastDays } from "../instagram/client";
import { tiktokProfile, tiktokVideosPage } from "../tiktok/client";
import { getValidToken } from "../tokens";
import { SocialApiError, type AccountDay, type AccountProfile, type Platform } from "../types";
import { youtubeAccountDays, youtubeChannel, youtubeNormalize, youtubeRetention, youtubeUploadsPage } from "../youtube/client";
import { copyThumbnails, fixCheckpoints, markUnseenUnavailable, recomputePerfScores, saveAccountData, saveItems } from "./store";

/**
 * Sincronización de una cuenta.
 *
 * Tipos:
 * - BACKFILL: todo el histórico, con estadísticas. Se puede cortar y retomar (cursor en sync_runs).
 * - RECENT: piezas de las últimas 72 h (cada 3 h, son las que más cambian).
 * - DAILY / MANUAL: piezas de los últimos 30 días + totales de la cuenta + seguidores.
 * - WEEKLY: listado completo para detectar piezas borradas; estadísticas solo de los últimos 90 días.
 *
 * Una sola sincronización por cuenta a la vez: el registro en sync_runs funciona como candado con vencimiento.
 */
export type SyncKind = "BACKFILL" | "RECENT" | "DAILY" | "WEEKLY" | "MANUAL";

export type SyncOutcome = {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "SKIPPED";
  itemsUpserted: number;
  apiCalls: number;
  message?: string;
};

type Cursor = { page?: string | number | null; listingStartedAt?: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function windowFor(kind: SyncKind): { publishedAfter: Date | null; insightsAfter: Date | null } {
  const now = Date.now();
  if (kind === "RECENT") return { publishedAfter: new Date(now - 72 * HOUR), insightsAfter: null };
  if (kind === "DAILY" || kind === "MANUAL") return { publishedAfter: new Date(now - 30 * DAY), insightsAfter: null };
  if (kind === "WEEKLY") return { publishedAfter: null, insightsAfter: new Date(now - 90 * DAY) };
  return { publishedAfter: null, insightsAfter: null };
}

async function acquire(accountId: string, platform: Platform, kind: SyncKind, deadline: number) {
  return getDb().transaction(async (tx) => {
    await tx.select({ id: schema.socialAccounts.id }).from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId)).for("update");
    const [running] = await tx
      .select({ id: schema.syncRuns.id })
      .from(schema.syncRuns)
      .where(and(eq(schema.syncRuns.socialAccountId, accountId), eq(schema.syncRuns.status, "RUNNING"), gt(schema.syncRuns.leaseUntil, new Date())))
      .limit(1);
    if (running) return null;

    // Un backfill cortado (por tiempo o por un error) se retoma desde su último cursor guardado.
    let cursor: Cursor | null = null;
    if (kind === "BACKFILL") {
      const [previous] = await tx
        .select({ cursor: schema.syncRuns.cursor, status: schema.syncRuns.status })
        .from(schema.syncRuns)
        .where(and(eq(schema.syncRuns.socialAccountId, accountId), eq(schema.syncRuns.kind, "BACKFILL")))
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1);
      if ((previous?.status === "PARTIAL" || previous?.status === "FAILED") && previous.cursor) cursor = previous.cursor as Cursor;
    }

    const [run] = await tx
      .insert(schema.syncRuns)
      .values({ socialAccountId: accountId, platform, kind, status: "RUNNING", cursor, leaseUntil: new Date(deadline + 60_000) })
      .returning({ id: schema.syncRuns.id });
    return { runId: run!.id, cursor };
  });
}

/** Recorre las páginas del listado de la red y guarda cada una. Devuelve el cursor si se cortó por tiempo. */
async function syncItems(
  ctx: SyncContext,
  account: { id: string; platform: Platform; meta: Record<string, unknown> | null },
  token: string,
  kind: SyncKind,
  cursor: Cursor | null,
  onPage: (cursor: Cursor, upserted: number) => Promise<void>,
): Promise<{ complete: boolean; upserted: number; listingStartedAt: Date }> {
  const { publishedAfter, insightsAfter } = windowFor(kind);
  const listingStartedAt = cursor?.listingStartedAt ? new Date(cursor.listingStartedAt) : new Date();
  let page: string | number | null = cursor?.page ?? null;
  let upserted = 0;

  while (true) {
    let reachedOlder = false;
    let next: string | number | null = null;

    if (account.platform === "INSTAGRAM") {
      const res = await instagramMediaPage(ctx, token, (page as string | null) ?? null);
      const inWindow = res.items.filter((m) => !publishedAfter || new Date(m.timestamp) >= publishedAfter);
      reachedOlder = inWindow.length < res.items.length;
      // En el semanal, las piezas viejas solo se listan (para saber que siguen ahí) sin pedir estadísticas.
      const withInsights = insightsAfter ? inWindow.filter((m) => new Date(m.timestamp) >= insightsAfter) : inWindow;
      const withoutInsights = insightsAfter ? inWindow.filter((m) => new Date(m.timestamp) < insightsAfter) : [];
      const items = await instagramNormalize(ctx, token, withInsights);
      upserted += await saveItems(account.id, "INSTAGRAM", items);
      if (withoutInsights.length > 0) await touchSeen("INSTAGRAM", withoutInsights.map((m) => m.id), listingStartedAt);
      next = res.next;
    } else if (account.platform === "YOUTUBE") {
      const playlistId = account.meta?.uploadsPlaylistId as string | undefined;
      if (!playlistId) throw new SocialApiError("YOUTUBE", "BAD_ACCOUNT", "No encontramos la lista de videos del canal. Vuelve a conectar YouTube.", "sin uploadsPlaylistId");
      const res = await youtubeUploadsPage(ctx, token, playlistId, (page as string | null) ?? null);
      const inWindow = res.ids.filter((v) => !publishedAfter || v.publishedAt >= publishedAfter);
      reachedOlder = inWindow.length < res.ids.length;
      const withInsights = insightsAfter ? inWindow.filter((v) => v.publishedAt >= insightsAfter) : inWindow;
      const withoutInsights = insightsAfter ? inWindow.filter((v) => v.publishedAt < insightsAfter) : [];
      const items = await youtubeNormalize(ctx, token, withInsights.map((v) => v.id), (account.meta?.channelPublishedAt as string | null) ?? null);
      upserted += await saveItems(account.id, "YOUTUBE", items);
      if (withoutInsights.length > 0) await touchSeen("YOUTUBE", withoutInsights.map((v) => v.id), listingStartedAt);
      next = res.next;
    } else {
      const res = await tiktokVideosPage(ctx, token, (page as number | null) ?? null);
      const inWindow = res.items.filter((v) => !publishedAfter || v.publishedAt >= publishedAfter);
      reachedOlder = inWindow.length < res.items.length;
      upserted += await saveItems(account.id, "TIKTOK", inWindow);
      next = res.next;
    }

    if (!next || reachedOlder) return { complete: true, upserted, listingStartedAt };
    page = next;
    await onPage({ page, listingStartedAt: listingStartedAt.toISOString() }, upserted);
    if (ctx.outOfTime()) return { complete: false, upserted, listingStartedAt };
  }
}

/** Marca como vistas piezas que siguen en la red pero no se actualizaron en esta pasada. */
async function touchSeen(platform: Platform, externalIds: string[], at: Date) {
  await getDb()
    .update(schema.contentItems)
    .set({ lastSeenAt: at, available: true, unavailableSince: null })
    .where(and(eq(schema.contentItems.platform, platform), inArray(schema.contentItems.externalId, externalIds)));
}

async function syncAccountLevel(ctx: SyncContext, account: { id: string; platform: Platform }, token: string, firstTime: boolean) {
  let profile: AccountProfile | null = null;
  let days: AccountDay[] = [];

  if (account.platform === "INSTAGRAM") {
    profile = await instagramProfile(ctx, token);
    days = await instagramAccountDays(ctx, token, pastDays(firstTime ? 28 : 3));
  } else if (account.platform === "YOUTUBE") {
    profile = (await youtubeChannel(ctx, token)).profile;
    const all = pastDays(firstTime ? 28 : 5);
    try {
      days = await youtubeAccountDays(ctx, token, all);
    } catch (error) {
      if (!(error instanceof SocialApiError) || error.kind !== "NOT_SUPPORTED") throw error;
    }
  } else {
    profile = await tiktokProfile(ctx, token);
  }
  await saveAccountData(account.id, profile, days);
}

/** Curvas de retención de YouTube: a los 7 días y a los 30 (hasta 10 videos por pasada). */
async function syncRetention(ctx: SyncContext, accountId: string, token: string) {
  const db = getDb();
  const candidates = await db.execute<{ id: string; external_id: string; published_at: Date }>(sql`
    select ci.id, ci.external_id, ci.published_at
    from content_items ci
    left join retention_curves rc on rc.content_item_id = ci.id
    where ci.social_account_id = ${accountId} and ci.available
      and ci.published_at < now() - interval '7 days' and ci.published_at > now() - interval '120 days'
      and (rc.content_item_id is null
           or (ci.published_at < now() - interval '30 days' and rc.captured_at < ci.published_at + interval '30 days'))
    order by ci.published_at desc
    limit 10
  `);
  for (const row of candidates.rows) {
    if (ctx.outOfTime()) return;
    try {
      const points = await youtubeRetention(ctx, token, row.external_id, new Date(row.published_at));
      if (points.length === 0) continue;
      await db
        .insert(schema.retentionCurves)
        .values({ contentItemId: row.id, points, capturedAt: new Date() })
        .onConflictDoUpdate({ target: schema.retentionCurves.contentItemId, set: { points, capturedAt: new Date() } });
    } catch (error) {
      if (!(error instanceof SocialApiError) || error.kind !== "NOT_SUPPORTED") throw error;
    }
  }
}

const statusForError: Partial<Record<SocialApiError["kind"], "EXPIRED" | "REVOKED" | "MISSING_SCOPES" | "ERROR">> = {
  AUTH_EXPIRED: "EXPIRED",
  AUTH_REVOKED: "REVOKED",
  MISSING_SCOPES: "MISSING_SCOPES",
  BAD_ACCOUNT: "ERROR",
};

export async function syncAccount(accountId: string, kind: SyncKind, budgetMs = 240_000): Promise<SyncOutcome> {
  const db = getDb();
  const [account] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId)).limit(1);
  if (!account || !account.current || account.status === "DISCONNECTED") return { status: "SKIPPED", itemsUpserted: 0, apiCalls: 0 };
  // Las cuentas de demostración (pnpm demo cargar) no tienen tokens reales: nunca se sincronizan.
  if ((account.meta as { demo?: boolean } | null)?.demo) return { status: "SKIPPED", itemsUpserted: 0, apiCalls: 0, message: "Es una cuenta de demostración." };

  const ctx = new SyncContext(account.platform, Date.now() + budgetMs);
  const lock = await acquire(accountId, account.platform, kind, ctx.deadline);
  if (!lock) return { status: "SKIPPED", itemsUpserted: 0, apiCalls: 0, message: "Ya hay una sincronización en curso." };

  const finish = (values: Partial<typeof schema.syncRuns.$inferInsert>) =>
    db
      .update(schema.syncRuns)
      .set({ ...values, apiCalls: ctx.apiCalls, finishedAt: new Date(), leaseUntil: null })
      .where(eq(schema.syncRuns.id, lock.runId));

  try {
    const { token } = await getValidToken(accountId);
    const firstAccountSync = !account.backfillCompletedAt;

    const items = await syncItems(ctx, { id: account.id, platform: account.platform, meta: account.meta }, token, kind, lock.cursor, async (cursor, upserted) => {
      await db.update(schema.syncRuns).set({ cursor, itemsUpserted: upserted, apiCalls: ctx.apiCalls }).where(eq(schema.syncRuns.id, lock.runId));
    });

    const fullListing = kind === "BACKFILL" || kind === "WEEKLY";
    if (items.complete && fullListing) await markUnseenUnavailable(account.id, items.listingStartedAt);

    if (kind !== "RECENT" && !ctx.outOfTime(30_000)) await syncAccountLevel(ctx, account, token, firstAccountSync && kind === "BACKFILL");
    if (account.platform === "YOUTUBE" && (kind === "DAILY" || kind === "BACKFILL") && !ctx.outOfTime(30_000)) await syncRetention(ctx, account.id, token);

    await fixCheckpoints(account.id);
    await recomputePerfScores();
    await copyThumbnails(ctx, account.id);

    await db
      .update(schema.socialAccounts)
      .set({
        lastSyncedAt: new Date(),
        status: "ACTIVE",
        statusMessage: null,
        ...(kind === "BACKFILL" && items.complete ? { backfillCompletedAt: new Date() } : {}),
      })
      .where(eq(schema.socialAccounts.id, account.id));

    const status = items.complete ? "SUCCEEDED" : "PARTIAL";
    await finish({
      status,
      itemsUpserted: items.upserted,
      // Si se cortó, queda el último cursor guardado por página para retomar desde ahí.
      cursor: items.complete ? null : await currentCursor(lock.runId),
    });
    return { status, itemsUpserted: items.upserted, apiCalls: ctx.apiCalls };
  } catch (error) {
    const social = error instanceof SocialApiError ? error : null;
    const message = social?.userMessage ?? "No pudimos sincronizar. Lo intentamos de nuevo en la próxima pasada.";
    console.error(`[sync] ${account.platform} ${kind}:`, social?.detail ?? (error instanceof Error ? error.message : error));

    const newStatus = social ? statusForError[social.kind] : undefined;
    if (newStatus) {
      await db.update(schema.socialAccounts).set({ status: newStatus, statusMessage: message }).where(eq(schema.socialAccounts.id, account.id));
    }
    // Un límite de uso deja el backfill a medias (se retoma); cualquier otro error lo marca como fallido.
    const status = social?.kind === "RATE_LIMITED" ? "PARTIAL" : "FAILED";
    await finish({ status, errorCode: social?.kind ?? "UNKNOWN", errorMessage: message });
    return { status, itemsUpserted: 0, apiCalls: ctx.apiCalls, message };
  }
}

async function currentCursor(runId: string): Promise<Cursor> {
  const [row] = await getDb().select({ cursor: schema.syncRuns.cursor }).from(schema.syncRuns).where(eq(schema.syncRuns.id, runId)).limit(1);
  return (row?.cursor as Cursor | null) ?? {};
}

/** Qué sincronizaciones le tocan a una cuenta ahora (para el cron). */
export async function dueKinds(account: { id: string; backfillCompletedAt: Date | null }): Promise<SyncKind[]> {
  if (!account.backfillCompletedAt) return ["BACKFILL"];
  const runs = await getDb()
    .select({ kind: schema.syncRuns.kind, startedAt: schema.syncRuns.startedAt })
    .from(schema.syncRuns)
    .where(and(eq(schema.syncRuns.socialAccountId, account.id), inArray(schema.syncRuns.status, ["SUCCEEDED", "PARTIAL"]), gt(schema.syncRuns.startedAt, new Date(Date.now() - 8 * DAY))))
    .orderBy(desc(schema.syncRuns.startedAt));

  const last = (kinds: string[]) => runs.find((r) => kinds.includes(r.kind))?.startedAt.getTime() ?? 0;
  const now = Date.now();
  const today = isoDay(new Date());
  const due: SyncKind[] = [];

  if (isoDay(new Date(last(["DAILY"]) || 0)) !== today) due.push("DAILY");
  else if (now - last(["RECENT", "DAILY", "MANUAL", "BACKFILL", "WEEKLY"]) > 3 * HOUR - 5 * 60_000) due.push("RECENT");
  if (new Date().getUTCDay() === 0 && now - last(["WEEKLY"]) > 6 * DAY) due.push("WEEKLY");
  return due;
}
