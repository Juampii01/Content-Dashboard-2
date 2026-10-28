/**
 * Etiqueta legible de una versión guardada desde el Estudio: qué partes del plan cambiaron entre lo guardado y lo
 * nuevo («cortes, sonidos y animaciones»). Sin servidor (la usan lib/video/versions.ts y las pruebas).
 */
import type { EditPlan } from "./types";

/** Partes del plan y su nombre para la persona, en el orden en que se nombran. */
// Los valores por defecto cuentan como «sin cambio» (el primer guardado de un plan nuevo completa campos como
// `emoji: false` o `sfx_db: 0` sin que la persona haya tocado nada).
const PARTS: { name: string; pick: (p: EditPlan) => unknown }[] = [
  { name: "cortes", pick: (p) => [p.removals, p.pacing?.long_pause ?? 0.5, p.pacing?.keep ?? [], p.pacing?.keep_all ?? false, p.splits ?? [], p.sequence ?? [], p.moves ?? []] },
  { name: "subtítulos", pick: (p) => [{ ...p.captions, emoji: p.captions?.emoji ?? false }, p.corrections] },
  { name: "b-roll y gráficos", pick: (p) => p.broll },
  { name: "efectos", pick: (p) => [p.effects ?? [], p.transitions ?? []] },
  { name: "animaciones", pick: (p) => p.compositions ?? [] },
  { name: "zooms", pick: (p) => [p.zoom_moments ?? [], p.zooms_enabled ?? null, p.framing] },
  { name: "sonido", pick: (p) => [p.audio?.cues ?? [], p.audio?.sfx ?? null, p.audio?.sfx_db ?? 0, p.audio?.voice_db ?? 0, p.audio?.mix ?? null, p.audio?.studio ?? null] },
  { name: "música", pick: (p) => [p.audio?.music_asset_id ?? null, p.audio?.music_db ?? null, p.audio?.music_gen ?? null, p.audio?.music_fade ?? null] },
  { name: "marcadores", pick: (p) => p.markers ?? [] },
];

/** JSON con las claves ordenadas: el mismo objeto armado en otro orden no cuenta como cambio. */
function stable(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
}

/** Qué partes cambiaron (nombres para la persona). */
export function changedParts(before: EditPlan, after: EditPlan): string[] {
  return PARTS.filter((part) => stable(part.pick(before)) !== stable(part.pick(after))).map((p) => p.name);
}

/** «cortes», «cortes y sonido», «cortes, sonido y música». */
export function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Etiqueta de la versión que guarda el Estudio antes de una tanda de cambios a mano. */
export function studioVersionLabel(before: EditPlan, after: EditPlan): string {
  const parts = changedParts(before, after);
  return parts.length ? `Antes de tus cambios en el Estudio (${joinParts(parts.slice(0, 4))}${parts.length > 4 ? " y más" : ""})` : "Antes de tus cambios en el Estudio";
}
