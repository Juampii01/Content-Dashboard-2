"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { isDay } from "@/lib/calendar/dates";
import { CalendarError } from "@/lib/calendar/service";
import {
  approveItem,
  AutopilotError,
  buildWeeklyPack,
  discardItem,
  editItem,
  manualWeek,
  restoreItem,
  resumePack,
  retryItem,
  saveAutopilotSettings,
} from "@/lib/autopilot/service";
import { getDb, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

/** Acciones de "Tu semana lista". Cada una valida el permiso de edición y los datos antes de escribir. */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof AutopilotError || error instanceof CalendarError) return { ok: false, error: error.message };
  console.error("[autopiloto]", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

const settingsSchema = z.object({ enabled: z.boolean(), piecesPerWeek: z.number().int().min(1).max(7).nullable() });

export async function saveSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige entre 1 y 7 piezas por semana." };
  try {
    await saveAutopilotSettings(parsed.data, user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos guardar el ajuste. Prueba de nuevo.");
  }
}

/** "Armar mi semana ahora": arma el paquete de esta semana (o de la próxima, desde el viernes) sin esperar al lunes. */
export async function buildNowAction(): Promise<ActionResult<{ weekStart: string }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`autopiloto:${user.id}`, 6, 3600))) return { ok: false, error: "Pediste muchas semanas seguidas. Espera unos minutos y vuelve a intentar." };
  try {
    const res = await buildWeeklyPack({
      weekStart: manualWeek(),
      trigger: "manual",
      userId: user.id,
      run: (task) => after(() => task().catch((error: unknown) => console.error("[autopiloto]", error instanceof Error ? error.message : error))),
    });
    if (res.status === "skipped") return { ok: false, error: res.reason ?? "No pudimos armar tu semana." };
    refresh();
    return { ok: true, data: { weekStart: res.weekStart } };
  } catch (error) {
    return fail(error, "No pudimos armar tu semana. Prueba de nuevo.");
  }
}

/** Retoma una semana que falló o se cortó. */
export async function resumePackAction(weekStart: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!isDay(weekStart)) return { ok: false, error: "Semana no válida." };
  if (!(await allowAttempt(`autopiloto:${user.id}`, 6, 3600))) return { ok: false, error: "Pediste muchos reintentos seguidos. Espera unos minutos." };
  const [pack] = await getDb().select({ status: schema.weeklyPacks.status, updatedAt: schema.weeklyPacks.updatedAt }).from(schema.weeklyPacks).where(eq(schema.weeklyPacks.weekStart, weekStart)).limit(1);
  if (!pack) return { ok: false, error: "Esa semana ya no existe." };
  if (pack.status === "READY" || (pack.status === "GENERATING" && Date.now() - pack.updatedAt.getTime() < 15 * 60_000)) return { ok: false, error: "Tu semana ya se está armando." };
  await getDb().update(schema.weeklyPacks).set({ status: "GENERATING", errorMessage: null }).where(and(eq(schema.weeklyPacks.weekStart, weekStart)));
  after(() => resumePack(weekStart, user.id).catch((error: unknown) => console.error("[autopiloto]", error instanceof Error ? error.message : error)));
  refresh();
  return { ok: true };
}

const editSchema = z.object({
  title: z.string().trim().min(2, "Ponle un título a la pieza.").max(160, "El título es demasiado largo (máximo 160 caracteres)."),
  hook: z
    .string()
    .trim()
    .max(600, "El gancho es demasiado largo (máximo 600 caracteres).")
    .transform((v) => v || null),
  scheduledDate: z.string().refine(isDay, "La fecha no es válida.").nullable(),
});

export async function editItemAction(id: string, input: z.input<typeof editSchema>): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  try {
    await editItem(id, parsed.data);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, "No pudimos guardar los cambios. Prueba de nuevo.");
  }
}

async function itemOp(id: string, op: (userId: string) => Promise<unknown>, fallback: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Pieza no válida." };
  try {
    await op(user.id);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error, fallback);
  }
}

export async function approveItemAction(id: string): Promise<ActionResult> {
  return itemOp(id, (userId) => approveItem(id, userId), "No pudimos aprobar la pieza. Prueba de nuevo.");
}

export async function discardItemAction(id: string): Promise<ActionResult> {
  return itemOp(id, () => discardItem(id), "No pudimos descartar la pieza. Prueba de nuevo.");
}

export async function restoreItemAction(id: string): Promise<ActionResult> {
  return itemOp(id, () => restoreItem(id), "No pudimos recuperar la pieza. Prueba de nuevo.");
}

export async function retryItemAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`autopiloto:${user.id}`, 20, 3600))) return { ok: false, error: "Pediste muchos reintentos seguidos. Espera unos minutos." };
  return itemOp(id, (userId) => retryItem(id, userId), "No pudimos escribir la pieza. Prueba de nuevo.");
}

/** Aprueba todas las piezas listas que siguen pendientes de la semana. */
export async function approveAllAction(weekStart: string): Promise<ActionResult<{ approved: number }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!isDay(weekStart)) return { ok: false, error: "Semana no válida." };
  try {
    const items = await getDb()
      .select({ id: schema.weeklyPackItems.id })
      .from(schema.weeklyPackItems)
      .where(and(eq(schema.weeklyPackItems.weekStart, weekStart), eq(schema.weeklyPackItems.decision, "pending"), eq(schema.weeklyPackItems.genStatus, "ready")));
    for (const item of items) await approveItem(item.id, user.id);
    refresh();
    return { ok: true, data: { approved: items.length } };
  } catch (error) {
    return fail(error, "No pudimos aprobar todas. Revisa las que quedaron pendientes.");
  }
}
