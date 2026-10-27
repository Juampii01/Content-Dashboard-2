import "server-only";
import { and, gte, isNotNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { BusyDays } from "./free-days";

/** Piezas programadas por día entre `from` y `to` (incluidos), para elegir días libres (lib/calendar/free-days.ts). */
export async function busyDays(from: string, to: string): Promise<BusyDays> {
  const rows = await getDb()
    .select({ day: schema.calendarEntries.scheduledDate, n: sql<number>`count(*)::int` })
    .from(schema.calendarEntries)
    .where(and(isNotNull(schema.calendarEntries.scheduledDate), gte(schema.calendarEntries.scheduledDate, from), lte(schema.calendarEntries.scheduledDate, to)))
    .groupBy(schema.calendarEntries.scheduledDate);
  return Object.fromEntries(rows.map((r) => [r.day!, r.n]));
}
