import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const numberFormat = new Intl.NumberFormat("es-419");
const compactFormat = new Intl.NumberFormat("es-419", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("es-419", { day: "numeric", month: "short", year: "numeric" });

/** 12345 → "12,345" (separador de miles en español latinoamericano). */
export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormat.format(value);
}

/** 1250000 → "1.3 M". Para tarjetas y ejes de gráficos. */
export function formatCompact(value: number | null | undefined): string {
  return value == null ? "—" : compactFormat.format(value);
}

/** Fecha → "12 oct 2026". */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFormat.format(typeof value === "string" ? new Date(value) : value).replace(/\./g, "");
}
