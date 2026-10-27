import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { CalendarStatus } from "./labels";

/**
 * Estados sincronizados entre el Calendario y Guiones.
 *
 * Los estados solo avanzan: un cambio en un lado sube el otro hasta su "piso", nunca lo baja.
 * Así, si alguien vuelve un guion a borrador, no se pierde que la pieza ya estaba en producción.
 *
 *   Guion                    →  Calendario (al menos)
 *   IDEA                        IDEA
 *   DRAFT  (borrador)           SCRIPTING (en guion)
 *   READY  (listo para grabar)  PRODUCTION
 *   RECORDED (grabado)          PRODUCTION (falta editar y publicar)
 *   PUBLISHED                   PUBLISHED
 *   ARCHIVED                    (no cambia nada)
 *
 *   Calendario               →  Guion (al menos)
 *   IDEA                        (no cambia nada)
 *   SCRIPTING                   DRAFT
 *   PRODUCTION                  READY
 *   READY  (listo para publicar) RECORDED
 *   PUBLISHED                   PUBLISHED
 *
 * Un guion ARCHIVADO no se toca desde el Calendario.
 */
export type ScriptStatus = "IDEA" | "DRAFT" | "READY" | "RECORDED" | "PUBLISHED" | "ARCHIVED";

const calendarOrder: CalendarStatus[] = ["IDEA", "SCRIPTING", "PRODUCTION", "READY", "PUBLISHED"];
const scriptOrder: ScriptStatus[] = ["IDEA", "DRAFT", "READY", "RECORDED", "PUBLISHED"];

const scriptToCalendar: Record<ScriptStatus, CalendarStatus | null> = {
  IDEA: "IDEA",
  DRAFT: "SCRIPTING",
  READY: "PRODUCTION",
  RECORDED: "PRODUCTION",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: null,
};

const calendarToScript: Record<CalendarStatus, ScriptStatus | null> = {
  IDEA: null,
  SCRIPTING: "DRAFT",
  PRODUCTION: "READY",
  READY: "RECORDED",
  PUBLISHED: "PUBLISHED",
};

/** Estado que debería tener la entrada del calendario después de que el guion pasó a `script`. */
export function calendarStatusFromScript(current: CalendarStatus, script: ScriptStatus): CalendarStatus {
  const floor = scriptToCalendar[script];
  if (!floor) return current;
  return calendarOrder.indexOf(floor) > calendarOrder.indexOf(current) ? floor : current;
}

/** Estado que debería tener el guion después de que la entrada del calendario pasó a `entry`. */
export function scriptStatusFromCalendar(current: ScriptStatus, entry: CalendarStatus): ScriptStatus {
  if (current === "ARCHIVED") return current;
  const floor = calendarToScript[entry];
  if (!floor) return current;
  return scriptOrder.indexOf(floor) > scriptOrder.indexOf(current) ? floor : current;
}

/** Estado inicial de una entrada nueva vinculada a un guion. */
export function initialStatusForScript(script: ScriptStatus): CalendarStatus {
  return calendarStatusFromScript("IDEA", script);
}

/** Sube el guion vinculado según el estado nuevo de la entrada. Devuelve el estado final del guion (o null si no hay guion). */
export async function syncScriptFromEntry(scriptId: string | null, entryStatus: CalendarStatus): Promise<ScriptStatus | null> {
  if (!scriptId) return null;
  const db = getDb();
  const [script] = await db.select({ status: schema.scripts.status }).from(schema.scripts).where(eq(schema.scripts.id, scriptId)).limit(1);
  if (!script) return null;
  const next = scriptStatusFromCalendar(script.status, entryStatus);
  if (next !== script.status) await db.update(schema.scripts).set({ status: next }).where(eq(schema.scripts.id, scriptId));
  return next;
}

/**
 * Sube las entradas del calendario vinculadas a un guion cuando cambia su estado.
 * Lo llama Guiones al cambiar el estado (components/guiones/actions.ts). Devuelve cuántas entradas cambiaron.
 */
export async function syncEntriesFromScript(scriptId: string, scriptStatus: ScriptStatus): Promise<number> {
  const db = getDb();
  const entries = await db
    .select({ id: schema.calendarEntries.id, status: schema.calendarEntries.status })
    .from(schema.calendarEntries)
    .where(eq(schema.calendarEntries.scriptId, scriptId));
  let changed = 0;
  for (const entry of entries) {
    const next = calendarStatusFromScript(entry.status, scriptStatus);
    if (next === entry.status) continue;
    await db.update(schema.calendarEntries).set({ status: next }).where(eq(schema.calendarEntries.id, entry.id));
    changed++;
  }
  return changed;
}

/** Marca como publicadas las entradas indicadas y sus guiones (cuando se vinculan con la pieza real). */
export async function markPublished(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const db = getDb();
  const rows = await db
    .update(schema.calendarEntries)
    .set({ status: "PUBLISHED" })
    .where(and(inArray(schema.calendarEntries.id, entryIds)))
    .returning({ scriptId: schema.calendarEntries.scriptId });
  for (const scriptId of new Set(rows.map((r) => r.scriptId).filter((s): s is string => Boolean(s)))) {
    await syncScriptFromEntry(scriptId, "PUBLISHED");
  }
}
