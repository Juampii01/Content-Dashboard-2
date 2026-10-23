"use client";

import { useCallback, useMemo, useState } from "react";
import { planDensity, type Density, type RhythmAddition } from "@/lib/video/rhythm";
import { sfxLevel, type SfxLevel } from "@/lib/video/sfx";
import { studioLevel, type StudioLevel } from "@/lib/video/studio-audio";
import type { FxItem } from "@/lib/video/fx/schema";
import { cleanCaptionPlacement, type CaptionPlacement } from "@/lib/video/canvas/captions";
import type { BrollItem, CaptionPresetKey, EditPlan, PlanMove, VideoFormat, ZoomMoment } from "@/lib/video/types";

/**
 * Todo lo que la persona puede cambiar en la revisión, en un solo objeto: así la línea de tiempo, el inspector, la
 * transcripción y el historial (deshacer/rehacer) trabajan sobre el mismo estado. Se guarda con la misma forma de
 * `Review` de siempre (ver `toReview`).
 */
export type StudioState = {
  /** Ids de palabras cortadas, en orden. */
  removed: number[];
  selectedHook: number | null;
  preset: CaptionPresetKey;
  format: VideoFormat;
  offsetX: number;
  corrections: Record<string, string>;
  broll: BrollItem[];
  zoomsOn: boolean;
  emoji: boolean;
  sfx: SfxLevel;
  music: { trackId: string | null; db: number };
  studio: StudioLevel;
  moves: PlanMove[];
  effects: FxItem[];
  density: Density;
  zoomMoments: ZoomMoment[];
  pacing: EditPlan["pacing"];
  emphasis: number[];
  rhythmLog: RhythmAddition[];
  /** Lugar de los subtítulos movidos en el lienzo (todos y, si se pidió, por línea). */
  captionPlace: CaptionPlacement;
  /** Tramos sin subtítulos (palabras): los que quitó la persona y los del director. */
  captionHide: { from_word: number; to_word: number; why: string }[];
  /** Se tocó el ritmo (densidad, zooms del director o resaltados): se guarda el bloque `rhythm` de la revisión. */
  rhythmTouched: boolean;
};

export function initialStudioState(plan: EditPlan, wordCount = Number.MAX_SAFE_INTEGER): StudioState {
  const removed = new Set<number>();
  for (const r of plan.removals) for (let id = r.from_word; id <= r.to_word; id++) removed.add(id);
  return {
    removed: [...removed].sort((a, b) => a - b),
    selectedHook: plan.selected_hook,
    preset: plan.captions.preset,
    format: plan.format,
    offsetX: plan.framing.offset_x,
    corrections: plan.corrections,
    broll: plan.broll ?? [],
    zoomsOn: plan.zooms_enabled !== false,
    emoji: plan.captions.emoji === true,
    // Planes de antes de los efectos de sonido y del audio de estudio: apagados (el video no cambia al volver a renderizar).
    sfx: sfxLevel(plan.audio.sfx),
    music: { trackId: plan.audio.music_asset_id, db: plan.audio.music_db },
    studio: studioLevel(plan.audio.studio),
    moves: plan.moves ?? [],
    effects: plan.effects ?? [],
    density: planDensity(plan),
    zoomMoments: plan.zoom_moments ?? [],
    pacing: plan.pacing,
    emphasis: plan.captions.emphasis_words,
    rhythmLog: plan.rhythm?.added ?? [],
    rhythmTouched: false,
    captionHide: plan.captions.hide ?? [],
    captionPlace: cleanCaptionPlacement({ transform: plan.captions.transform, lines: plan.captions.lines }, wordCount),
  };
}

/** La revisión que se manda al servidor (la misma forma que armaba la revisión anterior). */
export function toReview(s: StudioState, ctx: { plan: EditPlan; hasStyle: boolean; trackIds: string[] }) {
  return {
    removed: s.removed,
    selectedHook: s.selectedHook,
    preset: s.preset,
    offsetX: s.offsetX,
    corrections: s.corrections,
    broll: s.broll,
    ...(ctx.hasStyle ? { zooms: s.zoomsOn } : {}),
    emoji: s.emoji,
    sfx: s.sfx,
    studio: s.studio,
    music: { trackId: s.music.trackId && ctx.trackIds.includes(s.music.trackId) ? s.music.trackId : null, db: Math.max(-30, Math.min(-8, s.music.db)) },
    ...(ctx.plan.moves?.length ? { moves: s.moves } : {}),
    effects: s.effects,
    captionPlace: s.captionPlace,
    captionHide: s.captionHide,
    ...(s.rhythmTouched ? { rhythm: { density: s.density, added: s.rhythmLog, zoomMoments: s.zoomMoments, longPause: s.pacing?.long_pause ?? 0.5, emphasis: s.emphasis } } : {}),
  };
}

type History = { past: StudioState[]; present: StudioState; future: StudioState[]; key: string | null; at: number };

/** Cuántos pasos se pueden deshacer. */
const LIMIT = 200;
/** Cambios seguidos con la misma clave (escribir, mover un control deslizante) cuentan como un solo paso. */
const COALESCE_MS = 1200;

export type StudioUpdate = (fn: (s: StudioState) => StudioState, opts?: { coalesce?: string }) => void;

/** Estado de la revisión con historial: cada cambio es un paso que se puede deshacer y rehacer. */
export function useStudioState(plan: EditPlan, wordCount?: number) {
  const [h, setH] = useState<History>(() => ({ past: [], present: initialStudioState(plan, wordCount), future: [], key: null, at: 0 }));

  const update = useCallback<StudioUpdate>((fn, opts) => {
    setH((prev) => {
      const next = fn(prev.present);
      if (next === prev.present) return prev;
      const now = Date.now();
      const merge = Boolean(opts?.coalesce) && prev.key === opts?.coalesce && now - prev.at < COALESCE_MS;
      return { past: merge ? prev.past : [...prev.past, prev.present].slice(-LIMIT), present: next, future: [], key: opts?.coalesce ?? null, at: now };
    });
  }, []);

  const undo = useCallback(() => {
    setH((prev) => {
      const last = prev.past[prev.past.length - 1];
      if (!last) return prev;
      return { past: prev.past.slice(0, -1), present: last, future: [prev.present, ...prev.future].slice(0, LIMIT), key: null, at: 0 };
    });
  }, []);

  const redo = useCallback(() => {
    setH((prev) => {
      const next = prev.future[0];
      if (!next) return prev;
      return { past: [...prev.past, prev.present].slice(-LIMIT), present: next, future: prev.future.slice(1), key: null, at: 0 };
    });
  }, []);

  const removedSet = useMemo(() => new Set(h.present.removed), [h.present.removed]);

  return { state: h.present, removedSet, update, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

/** Corta o restaura palabras (devuelve el mismo estado si no cambia nada). */
export function withCut(s: StudioState, ids: number[], cut: boolean): StudioState {
  const set = new Set(s.removed);
  let changed = false;
  for (const id of ids) {
    if (cut && !set.has(id)) {
      set.add(id);
      changed = true;
    } else if (!cut && set.has(id)) {
      set.delete(id);
      changed = true;
    }
  }
  return changed ? { ...s, removed: [...set].sort((a, b) => a - b) } : s;
}
