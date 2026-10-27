/**
 * Etiqueta legible de una versión guardada desde el Estudio: qué partes del plan cambiaron entre lo guardado y lo
 * nuevo («cortes, sonidos y animaciones»). Sin servidor (la usan lib/video/versions.ts y las pruebas).
 */
import type { EditPlan } from "./types";

/** Partes del plan y su nombre para la persona, en el orden en que se nombran. */
const PARTS: { name: string; pick: (p: EditPlan) => unknown }[] = [
  { name: "cortes", pick: (p) => [p.removals, p.pacing, p.splits, p.sequence, p.moves] },
  { name: "subtítulos", pick: (p) => [p.captions, p.corrections] },
  { name: "b-roll y gráficos", pick: (p) => p.broll },
  { name: "efectos", pick: (p) => [p.effects, p.transitions] },
  { name: "animaciones", pick: (p) => p.compositions },
  { name: "zooms", pick: (p) => [p.zoom_moments, p.zooms_enabled, p.framing] },
  { name: "sonido", pick: (p) => [p.audio?.cues, p.audio?.sfx, p.audio?.sfx_db, p.audio?.voice_db, p.audio?.mix, p.audio?.studio] },
  { name: "música", pick: (p) => [p.audio?.music_asset_id, p.audio?.music_db, p.audio?.music_gen, p.audio?.music_fade] },
  { name: "marcadores", pick: (p) => p.markers },
];

/** Qué partes cambiaron (nombres para la persona). */
export function changedParts(before: EditPlan, after: EditPlan): string[] {
  return PARTS.filter((part) => JSON.stringify(part.pick(before) ?? null) !== JSON.stringify(part.pick(after) ?? null)).map((p) => p.name);
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
