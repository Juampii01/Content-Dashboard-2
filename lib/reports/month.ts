/**
 * Cálculos puros del informe mensual (sin base ni servidor): meses, comparaciones, ritmo por semana
 * y cuándo toca el envío automático. Los prueba tests/report.test.mts.
 */
import type { Pair, ReportWeek } from "./types";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value) && value >= "2005-01";
}

/** "2026-10" → "Octubre 2026". Con `lower`, "octubre 2026" (dentro de una frase). */
export function monthLabel(month: string, options?: { lower?: boolean; withYear?: boolean }): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[(m ?? 1) - 1] ?? "";
  const text = options?.withYear === false ? name : `${name} ${y}`;
  return options?.lower ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Primer y último día del mes (YYYY-MM-DD). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Rango con datos de un mes visto desde `today`: el mes completo si ya cerró; si está en curso, hasta hoy.
 * null si el mes todavía no empezó.
 */
export function reportRange(month: string, today: string): { from: string; to: string; monthEnd: string; partial: boolean } | null {
  const { from, to } = monthRange(month);
  if (from > today) return null;
  const partial = to >= today;
  return { from, to: partial ? today : to, monthEnd: to, partial };
}

/** Lista de días entre dos fechas, inclusive. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function shift(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de un día. */
export function mondayOf(day: string): string {
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return shift(day, -dow);
}

/**
 * Ritmo por semana (lunes a domingo) dentro del mes. Las semanas que el mes corta al principio o al final
 * se marcan `partial` y su meta se prorratea por los días que caen en el mes (redondeando hacia arriba).
 */
export function weeklyRhythm(piecesByDay: Record<string, number>, from: string, to: string, weeklyTarget: number): ReportWeek[] {
  const weeks: ReportWeek[] = [];
  for (let start = mondayOf(from); start <= to; start = shift(start, 7)) {
    const weekEnd = shift(start, 6);
    const a = start < from ? from : start;
    const b = weekEnd > to ? to : weekEnd;
    const days = daysOf(a, b);
    const pieces = days.reduce((sum, d) => sum + (piecesByDay[d] ?? 0), 0);
    const partial = days.length < 7;
    const target = partial ? Math.ceil((weeklyTarget * days.length) / 7) : weeklyTarget;
    weeks.push({ weekStart: a, weekEnd: b, pieces, target, hit: pieces >= target, partial });
  }
  return weeks;
}

/** Variación porcentual; null si no hay base. */
export function change(pair: Pair): number | null {
  if (pair.current == null || pair.previous == null || pair.previous === 0) return null;
  return ((pair.current - pair.previous) / Math.abs(pair.previous)) * 100;
}

/** Suma de una serie; null si no hay ningún dato. */
export function sumSeries(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** Suma de números que pueden faltar: null solo si faltan todos. */
export function sumKnown(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/**
 * Rellena hacia adelante: cada día toma el último valor conocido (seguidores). Los días anteriores
 * al primer dato quedan en null.
 */
export function carryForward(values: (number | null)[]): (number | null)[] {
  let last: number | null = null;
  return values.map((v) => {
    if (v != null) last = v;
    return last;
  });
}

/**
 * ¿Toca el informe automático? El día 1 desde las 9:00 (hora de la marca) se genera y se envía el del mes anterior.
 * Si el cron falla, se reintenta hasta el día 3; después ya no se envía (para no mandar un informe viejo).
 */
export function dueReportMonth(now: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "numeric", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const day = get("day");
  const hour = get("hour");
  if (day > 3 || (day === 1 && hour < 9)) return null;
  return addMonths(`${get("year")}-${String(get("month")).padStart(2, "0")}`, -1);
}

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

/** Normaliza y valida destinatarios: minúsculas, sin repetidos. Devuelve los válidos y los que no lo son. */
export function parseRecipients(values: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of values) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) invalid.push(raw.trim());
    else if (!valid.includes(email)) valid.push(email);
  }
  return { valid, invalid };
}

export const MAX_RECIPIENTS = 10;

/** Nombre del archivo: "informe-octubre-2026-marca.pdf". */
export function reportFileName(month: string, brandName: string | null): string {
  const slug = (brandName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `informe-${monthLabel(month, { lower: true }).replace(" ", "-")}${slug ? `-${slug}` : ""}.pdf`;
}
