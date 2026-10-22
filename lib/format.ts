/**
 * Formato de números, porcentajes, duraciones y fechas para toda la interfaz.
 *
 * Usamos la configuración regional de Latinoamérica ("es-419", la que se lee en México, Colombia,
 * Centroamérica y entre latinos en Estados Unidos), con agrupación siempre activa:
 *   12345     → "12,345"      (coma de miles, punto decimal)
 *   12400     → "12.4 mil"    (forma compacta para tarjetas y ejes)
 *   12.5 (%)  → "12.5 %"
 *   fecha     → "12 oct 2026"
 * Todo pasa por Intl: nada de concatenar separadores a mano.
 */

const LOCALE = "es-419";
const EMPTY = "—";

const numberFormat = new Intl.NumberFormat(LOCALE, { useGrouping: "always", maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });

type Num = number | null | undefined;
type DateInput = Date | string | number | null | undefined;

function isNum(value: Num): value is number {
  return value != null && Number.isFinite(value);
}

/** 12345 → "12,345"; 0.5 → "0.5". `null` → "—". */
export function formatNumber(value: Num, options?: { digits?: number }): string {
  if (!isNum(value)) return EMPTY;
  if (options?.digits != null) {
    return new Intl.NumberFormat(LOCALE, {
      useGrouping: "always",
      minimumFractionDigits: options.digits,
      maximumFractionDigits: options.digits,
    }).format(value);
  }
  return numberFormat.format(value);
}

/**
 * Forma compacta: 999 → "999", 12400 → "12.4 mil", 1250000 → "1.3 M", 2.1e9 → "2.1 mil M".
 * Para tarjetas de métricas y ejes de gráficos. Se arma a mano porque el compacto de Intl en
 * es-419 usa "k", que suena a inglés.
 */
export function formatCompact(value: Num): string {
  if (!isNum(value)) return EMPTY;
  const abs = Math.abs(value);
  const one = (n: number) => formatNumber(Math.round(n * 10) / 10);
  if (abs >= 1e9) return `${one(value / 1e9)} mil M`;
  if (abs >= 1e6) return `${one(value / 1e6)} M`;
  if (abs >= 1e4) return `${one(value / 1e3)} mil`;
  return formatNumber(Math.round(value));
}

/**
 * Recibe puntos porcentuales (12.5 = 12.5 %), no una proporción.
 * `signed` agrega el signo: "+12.5 %", "-3.2 %"; el cero queda sin signo.
 */
export function formatPercent(value: Num, options?: { digits?: number; signed?: boolean }): string {
  if (!isNum(value)) return EMPTY;
  const digits = options?.digits ?? 1;
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: digits,
    signDisplay: options?.signed ? "exceptZero" : "auto",
  }).format(value / 100);
}

/** Multiplicador para piezas que rinden por encima de lo normal: 3.2 → "×3.2". */
export function formatMultiplier(value: Num): string {
  if (!isNum(value)) return EMPTY;
  return `×${formatNumber(value, { digits: value >= 10 ? 0 : 1 })}`;
}

/**
 * Duración en segundos.
 * Menos de una hora → reloj "m:ss" (45 → "0:45", 754 → "12:34").
 * Una hora o más → "1 h 5 min" (la hora en punto queda "2 h").
 */
export function formatDuration(seconds: Num): string {
  if (!isNum(seconds) || seconds < 0) return EMPTY;
  const total = Math.round(seconds);
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (m === 60) return `${h + 1} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Bytes legibles: 1536 → "1.5 KB", 2147483648 → "2 GB". */
export function formatBytes(bytes: Num): string {
  if (!isNum(bytes) || bytes < 0) return EMPTY;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(value, unit === 0 ? undefined : { digits: value >= 100 || Number.isInteger(value) ? 0 : 1 })} ${units[unit]}`;
}

/**
 * Convierte la entrada en Date. Una fecha sin hora ("2026-10-12") se interpreta en hora local:
 * `new Date("2026-10-12")` la tomaría como medianoche UTC y en América mostraría el día anterior.
 */
export function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 oct 2026". Con `withYear: false` → "12 oct" (para ejes y rangos del mismo año). */
export function formatDate(value: DateInput, options?: { withYear?: boolean }): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return (options?.withYear === false ? shortDateFormat : dateFormat).format(date).replace(/\./g, "");
}

/** Rango de fechas: "6 – 12 oct 2026", "28 sept – 12 oct 2026" o "28 dic 2025 – 3 ene 2026". */
export function formatDateRange(from: DateInput, to: DateInput): string {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return EMPTY;
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(a)} – ${formatDate(b)}`;
  if (a.getMonth() === b.getMonth()) {
    if (a.getDate() === b.getDate()) return formatDate(b);
    return `${a.getDate()} – ${formatDate(b)}`;
  }
  return `${formatDate(a, { withYear: false })} – ${formatDate(b)}`;
}

/**
 * Tiempo relativo: "ahora", "hace 5 min", "hace 3 h", "ayer", "hace 4 días".
 * Desde 7 días atrás muestra la fecha ("12 oct 2026"), que se lee mejor que "hace 5 sem".
 * `now` es configurable para poder calcularlo en el servidor o en pruebas sin depender del reloj.
 */
export function formatRelative(value: DateInput, now: Date | number = Date.now()): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const diffSec = Math.round((date.getTime() - (typeof now === "number" ? now : now.getTime())) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "ahora";
  if (abs < 3600) return relativeFormat.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return relativeFormat.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86400) return relativeFormat.format(Math.round(diffSec / 86400), "day");
  return formatDate(date);
}

/** Variación porcentual entre dos periodos. `null` si no hay base para comparar. */
export function percentChange(current: Num, previous: Num): number | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Date → "2026-10-12" (valor de un <input type="date">), en hora local. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Marca de tiempo de un video: 75 → "1:15", 3725 → "1:02:05". */
export function formatTimecode(seconds: Num): string {
  if (!isNum(seconds) || seconds < 0) return EMPTY;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
