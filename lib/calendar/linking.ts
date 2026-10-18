import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { markPublished } from "./status";

/**
 * Vínculo entre lo planeado (calendar_targets) y lo publicado (content_items).
 *
 * Después de cada sync, por cada pieza reciente se buscan destinos de la misma red cuya entrada está
 * READY o PUBLISHED y programada a ±3 días de la fecha real de publicación (en APP_TIMEZONE).
 *
 *   puntaje = 0,6 × similitud de texto + 0,4 × cercanía de fecha
 *
 * - Similitud: `similarity()` de pg_trgm entre el texto de la pieza (título y primera línea del caption)
 *   y el de la entrada (título y gancho). Se toma la mejor combinación: el caption completo trae hashtags
 *   y CTA que bajan la similitud aunque la pieza sea la misma.
 * - Cercanía: 1 el mismo día, 0,75 a un día, 0,5 a dos, 0,25 a tres.
 *
 * ≥ 0,75 se vincula solo (destino LINKED, entrada y guion PUBLISHED). Entre 0,5 y 0,75 queda como
 * sugerencia ("¿Es esta?"). Con similitud menor a 0,2 nunca se sugiere: dos piezas del mismo día con
 * textos distintos no son la misma, aunque la fecha sume.
 * Nunca se sugiere una pieza ya vinculada ni una que el usuario descartó (`rejectedItemIds`).
 * Cada pieza va a un solo destino y cada destino a una sola pieza: se asignan de mayor a menor puntaje.
 */
export const AUTO_LINK_SCORE = 0.75;
export const SUGGEST_SCORE = 0.5;
export const MIN_SIMILARITY = 0.2;
export const DATE_WINDOW_DAYS = 3;

export function dateCloseness(gapDays: number): number {
  const gap = Math.abs(gapDays);
  if (gap > DATE_WINDOW_DAYS) return 0;
  return 1 - gap / (DATE_WINDOW_DAYS + 1);
}

export function linkScore(similarity: number, gapDays: number): number {
  return Math.round((0.6 * similarity + 0.4 * dateCloseness(gapDays)) * 1000) / 1000;
}

type Pair = { targetId: string; entryId: string; itemId: string; similarity: number; gap: number; score: number };

/** Pares destino–pieza con su puntaje. `targetIds` limita a ciertos destinos; `itemId` a una pieza. */
async function scorePairs(opts: { days: number; targetIds?: string[]; itemId?: string; window?: number }): Promise<Pair[]> {
  const tz = env().APP_TIMEZONE;
  const window = opts.window ?? DATE_WINDOW_DAYS;
  const targetFilter = opts.targetIds?.length ? sql`and t.id in (${sql.join(opts.targetIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const itemFilter = opts.itemId ? sql`and ci.id = ${opts.itemId}::uuid` : sql`and ci.published_at > now() - make_interval(days => ${opts.days})`;
  const result = await getDb().execute<{ target_id: string; entry_id: string; item_id: string; gap: number; sim: number }>(sql`
    with items as (
      select ci.id, ci.platform, (ci.published_at at time zone ${tz})::date as day,
        coalesce(ci.title, '') as title,
        coalesce(split_part(ci.caption, E'\n', 1), '') as first_line
      from content_items ci
      where ci.available ${itemFilter}
        and not exists (select 1 from calendar_targets lt where lt.content_item_id = ci.id and lt.link_status = 'LINKED')
    ),
    targets as (
      select t.id, t.platform, t.rejected_item_ids, e.id as entry_id, e.scheduled_date,
        e.title as e_title, coalesce(e.hook, '') as e_hook
      from calendar_targets t
      join calendar_entries e on e.id = t.entry_id
      where t.link_status <> 'LINKED' and e.status in ('READY', 'PUBLISHED') and e.scheduled_date is not null ${targetFilter}
    )
    select t.id as target_id, t.entry_id, i.id as item_id, abs(i.day - t.scheduled_date) as gap,
      greatest(
        similarity(t.e_title, i.title),
        similarity(t.e_title, i.first_line),
        similarity(t.e_title || ' ' || t.e_hook, i.title || ' ' || i.first_line),
        case when t.e_hook <> '' then greatest(similarity(t.e_hook, i.title), similarity(t.e_hook, i.first_line)) else 0 end
      ) as sim
    from targets t
    join items i on i.platform = t.platform
      and abs(i.day - t.scheduled_date) <= ${window}
      and not (i.id = any(t.rejected_item_ids))
  `);
  return result.rows.map((r) => {
    const similarity = Number(r.sim);
    const gap = Number(r.gap);
    return { targetId: r.target_id, entryId: r.entry_id, itemId: r.item_id, similarity, gap, score: linkScore(similarity, gap) };
  });
}

/** Asigna cada destino a lo sumo a una pieza y viceversa, de mayor a menor puntaje. */
export function assignPairs<P extends { targetId: string; itemId: string; score: number; similarity: number }>(pairs: P[]): P[] {
  const eligible = pairs.filter((p) => p.score >= SUGGEST_SCORE && p.similarity >= MIN_SIMILARITY).sort((a, b) => b.score - a.score);
  const usedTargets = new Set<string>();
  const usedItems = new Set<string>();
  const chosen: P[] = [];
  for (const p of eligible) {
    if (usedTargets.has(p.targetId) || usedItems.has(p.itemId)) continue;
    usedTargets.add(p.targetId);
    usedItems.add(p.itemId);
    chosen.push(p);
  }
  return chosen;
}

export type LinkSummary = { linked: number; suggested: number };

/**
 * Busca vínculos para las piezas recientes. Lo llama el sync al terminar bien (lib/social/sync/runner.ts).
 * `suggestOnly` no vincula solo (se usa después de que el usuario descarta una sugerencia).
 */
export async function autoLinkRecent(opts: { days?: number; targetIds?: string[]; suggestOnly?: boolean } = {}): Promise<LinkSummary> {
  const db = getDb();
  const pairs = await scorePairs({ days: opts.days ?? 21, targetIds: opts.targetIds });
  const chosen = assignPairs(pairs);

  // Estado actual de los destinos involucrados (para no reescribir lo que no cambia).
  const targetIds = [...new Set(pairs.map((p) => p.targetId))];
  const current = targetIds.length
    ? await db
        .select({ id: schema.calendarTargets.id, linkStatus: schema.calendarTargets.linkStatus, contentItemId: schema.calendarTargets.contentItemId, linkScore: schema.calendarTargets.linkScore })
        .from(schema.calendarTargets)
        .where(inArray(schema.calendarTargets.id, targetIds))
    : [];
  const byId = new Map(current.map((c) => [c.id, c]));

  let linked = 0;
  let suggested = 0;
  const publishedEntries: string[] = [];
  const assignedItems = new Set<string>();
  const assignedTargets = new Set<string>();

  for (const p of chosen) {
    const auto = !opts.suggestOnly && p.score >= AUTO_LINK_SCORE;
    assignedItems.add(p.itemId);
    assignedTargets.add(p.targetId);
    const now = byId.get(p.targetId);
    if (auto) {
      await db
        .update(schema.calendarTargets)
        .set({ linkStatus: "LINKED", contentItemId: p.itemId, linkScore: p.score, linkedAt: new Date() })
        .where(eq(schema.calendarTargets.id, p.targetId));
      publishedEntries.push(p.entryId);
      linked++;
    } else {
      if (now?.linkStatus === "SUGGESTED" && now.contentItemId === p.itemId && now.linkScore === p.score) continue;
      await db
        .update(schema.calendarTargets)
        .set({ linkStatus: "SUGGESTED", contentItemId: p.itemId, linkScore: p.score, linkedAt: null })
        .where(eq(schema.calendarTargets.id, p.targetId));
      suggested++;
    }
  }

  // Sugerencias viejas que apuntan a una pieza que ahora está vinculada o asignada a otro destino: se limpian.
  await db.execute(sql`
    update calendar_targets t set link_status = 'NONE', content_item_id = null, link_score = null
    where t.link_status = 'SUGGESTED'
      and t.content_item_id in (select content_item_id from calendar_targets where link_status = 'LINKED' and content_item_id is not null)
  `);
  const stale = [...assignedItems];
  if (stale.length) {
    const keep = [...assignedTargets];
    await db
      .update(schema.calendarTargets)
      .set({ linkStatus: "NONE", contentItemId: null, linkScore: null })
      .where(
        and(
          eq(schema.calendarTargets.linkStatus, "SUGGESTED"),
          inArray(schema.calendarTargets.contentItemId, stale),
          sql`${schema.calendarTargets.id} not in (${sql.join(keep.map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
      );
  }

  await markPublished([...new Set(publishedEntries)]);
  return { linked, suggested };
}

/** Piezas publicadas que se pueden vincular a mano con un destino: misma red, cerca de la fecha, sin vincular. */
export async function candidatesForTarget(targetId: string, limit = 12) {
  const tz = env().APP_TIMEZONE;
  const result = await getDb().execute<{
    id: string;
    title: string | null;
    caption: string | null;
    thumbnail: string | null;
    published_at: Date;
    day: string;
    views: number | null;
    perf_score: number | null;
    type: string;
    gap: number | null;
    sim: number;
  }>(sql`
    with target as (
      select t.id, t.platform, t.rejected_item_ids, e.scheduled_date, e.title as e_title, coalesce(e.hook, '') as e_hook
      from calendar_targets t join calendar_entries e on e.id = t.entry_id where t.id = ${targetId}::uuid
    )
    select ci.id, ci.title, ci.caption, coalesce(ci.thumbnail_url, ci.thumbnail_source_url) as thumbnail, ci.published_at,
      to_char((ci.published_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, ci.views, ci.perf_score, ci.type,
      abs((ci.published_at at time zone ${tz})::date - target.scheduled_date) as gap,
      greatest(similarity(target.e_title, coalesce(ci.title, '')), similarity(target.e_title, coalesce(split_part(ci.caption, E'\n', 1), '')),
        case when target.e_hook <> '' then similarity(target.e_hook, coalesce(ci.title, '') || ' ' || coalesce(split_part(ci.caption, E'\n', 1), '')) else 0 end) as sim
    from content_items ci, target
    where ci.platform = target.platform and ci.available
      and not exists (select 1 from calendar_targets lt where lt.content_item_id = ci.id and lt.link_status = 'LINKED')
      and (
        (target.scheduled_date is not null and abs((ci.published_at at time zone ${tz})::date - target.scheduled_date) <= 10)
        or (target.scheduled_date is null and ci.published_at > now() - interval '30 days')
      )
    order by ci.published_at desc
    limit 80
  `);
  return result.rows.map((r) => ({
    id: r.id,
    text: (r.title || r.caption?.split("\n")[0] || "Sin texto").slice(0, 160),
    thumbnail: r.thumbnail,
    day: r.day,
    views: r.views == null ? null : Number(r.views),
    perfScore: r.perf_score == null ? null : Number(r.perf_score),
    type: r.type,
    score: r.gap == null ? null : linkScore(Number(r.sim), Number(r.gap)),
  }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.day < b.day ? 1 : -1))
    .slice(0, limit);
}

/** El usuario confirma "¿Es esta?". */
export async function acceptSuggestion(targetId: string): Promise<void> {
  const db = getDb();
  const [target] = await db.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, targetId)).limit(1);
  if (!target || target.linkStatus !== "SUGGESTED" || !target.contentItemId) throw new LinkError("Esa sugerencia ya no está disponible.");
  await linkTarget(targetId, target.contentItemId, target.linkScore);
}

/** El usuario dice "No es esta": se descarta para siempre y se busca otra candidata (solo como sugerencia). */
export async function rejectSuggestion(targetId: string): Promise<void> {
  const db = getDb();
  const [target] = await db.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, targetId)).limit(1);
  if (!target || target.linkStatus !== "SUGGESTED" || !target.contentItemId) throw new LinkError("Esa sugerencia ya no está disponible.");
  await db
    .update(schema.calendarTargets)
    .set({
      linkStatus: "NONE",
      contentItemId: null,
      linkScore: null,
      rejectedItemIds: sql`array_append(${schema.calendarTargets.rejectedItemIds}, ${target.contentItemId}::uuid)`,
    })
    .where(eq(schema.calendarTargets.id, targetId));
  await autoLinkRecent({ targetIds: [targetId], suggestOnly: true, days: 60 });
}

export class LinkError extends Error {}

/** Vincula a mano (o confirma) un destino con una pieza publicada. */
export async function linkTarget(targetId: string, itemId: string, score: number | null = null): Promise<void> {
  const db = getDb();
  const [target] = await db
    .select({ id: schema.calendarTargets.id, platform: schema.calendarTargets.platform, entryId: schema.calendarTargets.entryId })
    .from(schema.calendarTargets)
    .where(eq(schema.calendarTargets.id, targetId))
    .limit(1);
  if (!target) throw new LinkError("No encontramos esa pieza del calendario.");
  const [item] = await db.select({ id: schema.contentItems.id, platform: schema.contentItems.platform }).from(schema.contentItems).where(eq(schema.contentItems.id, itemId)).limit(1);
  if (!item) throw new LinkError("No encontramos esa publicación.");
  if (item.platform !== target.platform) throw new LinkError("La publicación es de otra red.");
  const [taken] = await db
    .select({ id: schema.calendarTargets.id })
    .from(schema.calendarTargets)
    .where(and(eq(schema.calendarTargets.contentItemId, itemId), eq(schema.calendarTargets.linkStatus, "LINKED")))
    .limit(1);
  if (taken && taken.id !== targetId) throw new LinkError("Esa publicación ya está vinculada con otra pieza del calendario.");

  await db
    .update(schema.calendarTargets)
    .set({ linkStatus: "LINKED", contentItemId: itemId, linkScore: score, linkedAt: new Date() })
    .where(eq(schema.calendarTargets.id, targetId));
  // Si esa pieza estaba sugerida en otro destino, se limpia.
  await db
    .update(schema.calendarTargets)
    .set({ linkStatus: "NONE", contentItemId: null, linkScore: null })
    .where(and(eq(schema.calendarTargets.contentItemId, itemId), eq(schema.calendarTargets.linkStatus, "SUGGESTED")));
  await markPublished([target.entryId]);
}

/** Desvincula. La pieza queda descartada para ese destino: el próximo sync no la vuelve a unir. */
export async function unlinkTarget(targetId: string): Promise<void> {
  const db = getDb();
  const [target] = await db.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, targetId)).limit(1);
  if (!target) throw new LinkError("No encontramos esa pieza del calendario.");
  await db
    .update(schema.calendarTargets)
    .set({
      linkStatus: "NONE",
      contentItemId: null,
      linkScore: null,
      linkedAt: null,
      ...(target.contentItemId ? { rejectedItemIds: sql`array_append(${schema.calendarTargets.rejectedItemIds}, ${target.contentItemId}::uuid)` } : {}),
    })
    .where(eq(schema.calendarTargets.id, targetId));
}
