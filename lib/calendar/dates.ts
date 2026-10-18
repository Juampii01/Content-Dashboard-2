/**
 * Fechas del Calendario. Todo trabaja con días locales "YYYY-MM-DD" (en APP_TIMEZONE) y horas "HH:MM":
 * nunca con Date en UTC, así un día no se corre al cambiar de zona horaria.
 * Sin dependencias de servidor: se usa en el cliente y en el servidor.
 */
export type CalendarView = "mes" | "semana";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** "Hoy" en una zona horaria IANA, como YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const utc = (day: string) => new Date(`${day}T12:00:00Z`);

export function addDays(day: string, delta: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** 0 = lunes … 6 = domingo. */
export function weekdayIndex(day: string): number {
  return (utc(day).getUTCDay() + 6) % 7;
}

/** Lunes de la semana del día. */
export function startOfWeek(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

export function addMonths(day: string, delta: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return d.toISOString().slice(0, 10);
}

/** Días visibles de una vista: la semana (7 días) o la grilla del mes (semanas completas de lunes a domingo). */
export function visibleRange(view: CalendarView, anchor: string): { from: string; to: string; days: string[] } {
  if (view === "semana") {
    const from = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to: days[6]!, days };
  }
  const first = startOfMonth(anchor);
  const from = startOfWeek(first);
  const last = addDays(addMonths(first, 1), -1);
  const to = addDays(startOfWeek(last), 6);
  const days = Array.from({ length: diffDays(from, to) + 1 }, (_, i) => addDays(from, i));
  return { from, to, days };
}

/** Fecha a la que llevan los botones anterior / siguiente. */
export function shiftAnchor(view: CalendarView, anchor: string, step: -1 | 1): string {
  return view === "semana" ? addDays(startOfWeek(anchor), 7 * step) : addMonths(startOfMonth(anchor), step);
}

const LOCALE = "es-419";
const clean = (s: string) => s.replace(/\./g, "");

/** "octubre de 2026" → "Octubre 2026". */
export function monthTitle(day: string): string {
  const s = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(day)).replace(" de ", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "lun", "mar"… */
export function weekdayShort(day: string): string {
  return clean(new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" }).format(utc(day)));
}

/** "lunes 12 oct". */
export function dayLong(day: string): string {
  const s = clean(new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(utc(day)));
  return s.replace(",", "");
}

/** "12 oct" o "12 oct 2026". */
export function dayShort(day: string, withYear = false): string {
  return clean(new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(utc(day)));
}

/** "6 – 12 oct 2026" o "28 sept – 4 oct 2026". */
export function rangeTitle(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))} – ${dayShort(to, true)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dayShort(from)} – ${dayShort(to, true)}`;
  return `${dayShort(from, true)} – ${dayShort(to, true)}`;
}

/** Ordena piezas de un día: primero las que no tienen hora, después por hora y por posición. */
export function compareInDay(a: { scheduledTime: string | null; position: number }, b: { scheduledTime: string | null; position: number }): number {
  if (a.scheduledTime !== b.scheduledTime) {
    if (!a.scheduledTime) return -1;
    if (!b.scheduledTime) return 1;
    return a.scheduledTime < b.scheduledTime ? -1 : 1;
  }
  return a.position - b.position;
}
