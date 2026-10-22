/**
 * Reglas de tiempo y de costo del autopiloto semanal. Sin dependencias de servidor: se prueban solas.
 *
 * - El paquete es de la semana que empieza el lunes (en APP_TIMEZONE).
 * - El cron lo arma el lunes desde las 9:00 (como el resumen semanal, así el domingo ya está sincronizado).
 *   Si el cron no corrió el lunes, se pone al día hasta el miércoles; desde el jueves espera al lunes siguiente
 *   (para eso está el botón "Armar mi semana ahora").
 * - Una sola vez por semana: la fila de `weekly_packs` de ese lunes es el candado.
 */
import { addDays, startOfWeek, todayIn, weekdayIndex } from "@/lib/calendar/dates";

export const AUTOPILOT_HOUR = 9;
/** Último día (0 = lunes) en que el cron se pone al día si no armó el paquete el lunes. */
export const CATCH_UP_UNTIL = 2;
export const MAX_PIECES = 7;
export const DEFAULT_PIECES = 3;

/** Tokens estimados por llamada (entrada con el contexto de marca + salida). Son estimaciones, no tarifas. */
export const TOKEN_ESTIMATE = { plan: 9_000, script: 9_000, carousel: 11_000 } as const;
/** Tope de tokens del autopiloto en 7 días: si se pasa, la semana se arma con menos piezas o no se arma. */
export const WEEKLY_TOKEN_BUDGET = 150_000;

export function localNow(timeZone: string, now = new Date()): { today: string; weekday: number; hour: number } {
  const today = todayIn(timeZone, now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return { today, weekday: weekdayIndex(today), hour: Number.isFinite(hour) ? hour : 0 };
}

/** Lunes de la semana que le toca armar al cron ahora, o null si todavía no (o ya pasó la ventana). */
export function cronWeekDue(timeZone: string, now = new Date()): string | null {
  const { today, weekday, hour } = localNow(timeZone, now);
  if (weekday === 0 && hour < AUTOPILOT_HOUR) return null;
  if (weekday > CATCH_UP_UNTIL) return null;
  return startOfWeek(today);
}

/** Semana que arma el botón manual: la actual de lunes a jueves; desde el viernes, la que viene. */
export function manualWeekFor(today: string): string {
  return weekdayIndex(today) <= 3 ? startOfWeek(today) : addDays(startOfWeek(today), 7);
}

/** Días de la semana en que se puede programar: desde mañana (o desde el lunes, si la semana es futura). */
export function allowedDays(weekStart: string, today: string): string[] {
  const from = addDays(today, 1) > weekStart ? addDays(today, 1) : weekStart;
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d >= from);
}

/** Cuántas piezas armar: el ajuste, si no la meta semanal, si no 3. Nunca más que los días disponibles ni que 7. */
export function targetPieces(setting: number | null | undefined, weeklyGoal: number | null | undefined, availableDays: number): number {
  const wanted = setting ?? weeklyGoal ?? DEFAULT_PIECES;
  return Math.max(0, Math.min(MAX_PIECES, availableDays, Math.round(wanted)));
}

/** Tokens estimados de una semana con `pieces` piezas (se asume hasta un tercio de carruseles). */
export function estimateWeekTokens(pieces: number): number {
  if (pieces <= 0) return 0;
  const carousels = Math.ceil(pieces / 3);
  return TOKEN_ESTIMATE.plan + carousels * TOKEN_ESTIMATE.carousel + (pieces - carousels) * TOKEN_ESTIMATE.script;
}

/** Cuántas piezas entran en lo que queda del presupuesto (0 = no alcanza ni para el plan). */
export function piecesWithinBudget(pieces: number, usedLast7Days: number, budget = WEEKLY_TOKEN_BUDGET): number {
  for (let n = pieces; n > 0; n--) if (usedLast7Days + estimateWeekTokens(n) <= budget) return n;
  return 0;
}
