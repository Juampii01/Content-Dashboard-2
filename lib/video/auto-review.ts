/**
 * "Hazlo por mí": la revisión que haría la persona si aceptara la propuesta del plan tal cual (cortes, gancho, b-roll,
 * subtítulos y sonido). Sin nada de servidor: lo usan lib/video/auto-export.ts y las pruebas.
 */
import type { Review } from "./service";
import type { CaptionPresetKey, EditPlan } from "./types";

/** La revisión que haría la persona si aceptara la propuesta tal cual. */
export function reviewFromPlan(plan: EditPlan, opts: { keepHook: boolean }): Review {
  const removed: number[] = [];
  for (const r of plan.removals) for (let w = r.from_word; w <= r.to_word; w++) removed.push(w);
  return {
    removed,
    // Un clip ya empieza en su gancho (lo eligió el análisis del video largo): no se mueve otra frase al inicio.
    selectedHook: opts.keepHook ? plan.selected_hook : null,
    preset: plan.captions.preset as CaptionPresetKey,
    offsetX: plan.framing.offset_x,
    corrections: plan.corrections ?? {},
    broll: plan.broll,
    ...(plan.zooms_enabled != null ? { zooms: plan.zooms_enabled } : {}),
    ...(plan.captions.emoji != null ? { emoji: plan.captions.emoji } : {}),
    ...(plan.audio.sfx ? { sfx: plan.audio.sfx } : {}),
    ...(plan.audio.studio ? { studio: plan.audio.studio } : {}),
    music: { trackId: plan.audio.music_asset_id, db: plan.audio.music_db },
  };
}

