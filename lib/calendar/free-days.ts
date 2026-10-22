/**
 * Elección de días libres del Calendario: lo usan "Sacarle todo el jugo" (agregar todo en los próximos días libres)
 * y el autopiloto semanal (repartir la semana). Sin dependencias de servidor: se prueba sola.
 *
 * Un día "libre" es uno sin piezas programadas. Si no alcanzan los días libres, se usan los menos ocupados
 * (primero los más cercanos), así nunca se apila todo en un mismo día.
 */
import { addDays, diffDays } from "./dates";

/** Piezas ya programadas por día ("YYYY-MM-DD" → cantidad). */
export type BusyDays = Record<string, number>;

function daysBetween(from: string, to: string): string[] {
  const n = diffDays(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/**
 * Los próximos `count` días libres desde `from` (incluido) hasta `until` (incluido; por defecto 4 semanas).
 * Devuelve las fechas en orden. Si no hay suficientes libres, completa con los días menos ocupados de la ventana.
 */
export function pickFreeDays(input: { from: string; count: number; busy: BusyDays; until?: string }): string[] {
  const window = daysBetween(input.from, input.until ?? addDays(input.from, 27));
  const count = Math.max(0, Math.min(input.count, window.length));
  const free = window.filter((d) => !(input.busy[d] ?? 0));
  const picked = free.slice(0, count);
  if (picked.length < count) {
    const taken = new Set(picked);
    const rest = window
      .filter((d) => !taken.has(d))
      .sort((a, b) => (input.busy[a] ?? 0) - (input.busy[b] ?? 0) || (a < b ? -1 : 1));
    picked.push(...rest.slice(0, count - picked.length));
  }
  return picked.sort();
}

/**
 * Asigna un día a cada pieza dentro de los días permitidos (`allowed`, en orden): respeta el día propuesto si está
 * permitido, libre y sin usar; si no, toma el primer día libre; si no queda ninguno libre, el menos ocupado.
 * Una pieza por día como máximo: si hay más piezas que días, las que sobran quedan sin fecha (null).
 */
export function assignDays(preferred: (string | null)[], allowed: string[], busy: BusyDays): (string | null)[] {
  const allowedSet = new Set(allowed);
  const used = new Set<string>();
  const out: (string | null)[] = preferred.map(() => null);
  // Primero los que piden un día libre y permitido (el orden de la IA manda).
  preferred.forEach((day, i) => {
    if (day && allowedSet.has(day) && !used.has(day) && !(busy[day] ?? 0)) {
      out[i] = day;
      used.add(day);
    }
  });
  preferred.forEach((day, i) => {
    if (out[i]) return;
    const candidates = allowed.filter((d) => !used.has(d));
    if (!candidates.length) return;
    const free = candidates.filter((d) => !(busy[d] ?? 0));
    // Si su día pedido está permitido pero ocupado, preferimos el libre más cercano a ese día.
    const target = day && allowedSet.has(day) ? day : null;
    const pool = free.length ? free : [...candidates].sort((a, b) => (busy[a] ?? 0) - (busy[b] ?? 0));
    const minBusy = busy[pool[0]!] ?? 0;
    const best = free.length ? pool : pool.filter((d) => (busy[d] ?? 0) === minBusy);
    const choice = target ? [...best].sort((a, b) => Math.abs(diffDays(target, a)) - Math.abs(diffDays(target, b)) || (a < b ? -1 : 1))[0]! : best[0]!;
    out[i] = choice;
    used.add(choice);
  });
  return out;
}
