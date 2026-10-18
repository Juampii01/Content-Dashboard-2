import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// El formato de números y fechas vive en lib/format.ts; se reexporta para no romper importaciones viejas.
export { formatCompact, formatDate, formatNumber } from "./format";
