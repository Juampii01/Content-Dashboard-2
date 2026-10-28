"use client";

import type { Grade } from "@/lib/video/grade";
import type { SeqRange } from "@/lib/video/sequence";
import { useCallback, useMemo, useState } from "react";
import { planDensity, type Density, type RhythmAddition } from "@/lib/video/rhythm";
import { sfxLevel, type SfxLevel } from "@/lib/video/sfx";
import { studioLevel, type StudioLevel } from "@/lib/video/studio-audio";
import type { FxItem } from "@/lib/video/fx/schema";
import type { Composition } from "@/lib/video/compos/schema";
import type { TransitionItem } from "@/lib/video/fx/transitions";
import type { MusicGenSpec } from "@/lib/video/music-gen/spec";
import type { SoundCue } from "@/lib/video/sfx";
import { musicFade, NO_MIX, voiceDb, type AudioMix, type MusicFade } from "@/lib/video/audio-mix";
import type { Marker } from "@/lib/video/markers";
import { cleanCaptionPlacement, type CaptionPlacement } from "@/lib/video/canvas/captions";
import { rangesFromIds } from "@/lib/video/plan";
import { TIMING } from "@/lib/video/timeline";
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
  /** Volumen de todos los efectos de sonido (dB). */
  sfxDb: number;
  music: { trackId: string | null; db: number };
  studio: StudioLevel;
  moves: PlanMove[];
  /** Orden de las partes elegido a mano (null = como se grabó). */
  sequence: SeqRange[] | null;
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
  /** Transiciones en los cortes. */
  transitions: TransitionItem[];
  /** Sonidos de la biblioteca puestos a mano (pista de Sonido). */
  soundCues: SoundCue[];
  /** Música generada elegida (manda sobre la pista subida). */
  musicGen: MusicGenSpec | null;
  /** Animaciones a medida (composiciones que escribe Claude). */
  compositions: Composition[];
  /**
   * Pausas largas que se dejan completas (no se recortan): `keep` son las palabras que siguen a cada pausa; `all`,
   * "Sin recortes automáticos" (ninguna pausa se recorta).
   */
  pauses: { keep: number[]; all: boolean };
  /** Divisiones del video («Dividir» o la tecla C): id de la palabra con la que empieza cada parte. */
  splits: number[];
  /** Mezcla: volumen de la voz (dB), pistas silenciadas o en solo y fundidos de la música (lib/video/audio-mix.ts). */
  voiceDb: number;
  mix: AudioMix;
  musicFade: MusicFade;
  /** Marcadores con nota (tecla M). */
  markers: Marker[];
  /** Color del video principal (null = sin cambios de color). */
  grade: Grade | null;
};

export function initialStudioState(plan: EditPlan, wordCount = Number.MAX_SAFE_INTEGER): StudioState {
  const removed = new Set<number>();
  for (const r of plan.removals) for (let id = r.from_word; id <= r.to_word; id++) removed.add(id);
  return {
    removed: [...removed].sort((a, b) => a - b),
    // Ya no hay gancho: el video siempre empieza como se grabó (un gancho elegido en planes de antes se quita al guardar).
    selectedHook: null,
    preset: plan.captions.preset,
    format: plan.format,
    offsetX: plan.framing.offset_x,
    corrections: plan.corrections,
    broll: plan.broll ?? [],
    zoomsOn: plan.zooms_enabled !== false,
    emoji: plan.captions.emoji === true,
    // Planes de antes de los efectos de sonido y del audio de estudio: apagados (el video no cambia al volver a renderizar).
    sfx: sfxLevel(plan.audio.sfx),
    sfxDb: plan.audio.sfx_db ?? 0,
    music: { trackId: plan.audio.music_asset_id, db: plan.audio.music_db },
    studio: studioLevel(plan.audio.studio),
    moves: plan.moves ?? [],
    sequence: plan.sequence?.length ? plan.sequence : null,
    effects: plan.effects ?? [],
    density: planDensity(plan),
    zoomMoments: plan.zoom_moments ?? [],
    pacing: plan.pacing,
    emphasis: plan.captions.emphasis_words,
    rhythmLog: plan.rhythm?.added ?? [],
    rhythmTouched: false,
    captionHide: plan.captions.hide ?? [],
    captionPlace: cleanCaptionPlacement({ transform: plan.captions.transform, lines: plan.captions.lines }, wordCount),
    transitions: plan.transitions ?? [],
    soundCues: plan.audio.cues ?? [],
    musicGen: plan.audio.music_gen ?? null,
    pauses: { keep: [...(plan.pacing?.keep ?? [])].sort((a, b) => a - b), all: plan.pacing?.keep_all === true },
    compositions: plan.compositions ?? [],
    splits: plan.splits ?? [],
    voiceDb: voiceDb(plan.audio.voice_db),
    mix: plan.audio.mix ?? NO_MIX,
    musicFade: musicFade(plan.audio.music_fade),
    markers: plan.markers ?? [],
    grade: plan.grade ?? null,
  };
}

/** El silencio que usa el timeline: la tolerancia del ritmo más las pausas que se dejan completas. */
export function studioPacing(s: Pick<StudioState, "pacing" | "pauses">): NonNullable<EditPlan["pacing"]> | undefined {
  if (!s.pauses.all && !s.pauses.keep.length) return s.pacing;
  return { long_pause: s.pacing?.long_pause ?? TIMING.longPause, ...(s.pauses.keep.length ? { keep: s.pauses.keep } : {}), ...(s.pauses.all ? { keep_all: true } : {}) };
}

/**
 * Lo que arma el timeline de la vista previa (lo mismo que el servidor aplica con `applyReview`): las palabras
 * cortadas, el gancho, las pausas y los bloques movidos.
 */
export function studioTimelineInput(plan: EditPlan, s: Pick<StudioState, "removed" | "selectedHook" | "corrections" | "preset" | "emphasis" | "pacing" | "pauses" | "moves"> & Partial<Pick<StudioState, "sequence">>) {
  return {
    removals: rangesFromIds(s.removed, plan.removals),
    hook_candidates: plan.hook_candidates,
    selected_hook: s.selectedHook,
    corrections: s.corrections,
    captions: { preset: s.preset, emphasis_words: s.emphasis },
    pacing: studioPacing(s),
    moves: s.moves,
    ...(s.sequence ? { sequence: s.sequence } : {}),
  };
}

/**
 * Deja una pausa completa (`keep`) o vuelve a recortarla. `longOnes`: todas las pausas largas (para volver a recortar
 * una cuando está puesto "Sin recortes automáticos": las demás siguen completas).
 */
export function withPause(s: StudioState, word: number, keep: boolean, longOnes: number[] = []): StudioState {
  if (s.pauses.all) {
    if (keep) return s;
    return { ...s, pauses: { keep: [...new Set([...s.pauses.keep, ...longOnes])].filter((id) => id !== word).sort((a, b) => a - b), all: false } };
  }
  const set = new Set(s.pauses.keep);
  if (keep === set.has(word)) return s;
  if (keep) set.add(word);
  else set.delete(word);
  return { ...s, pauses: { keep: [...set].sort((a, b) => a - b), all: false } };
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
    sfxDb: s.sfxDb,
    studio: s.studio,
    music: { trackId: !s.musicGen && s.music.trackId && ctx.trackIds.includes(s.music.trackId) ? s.music.trackId : null, db: Math.max(-30, Math.min(-8, s.music.db)) },
    musicGen: s.musicGen,
    transitions: s.transitions,
    soundCues: s.soundCues,
    ...(ctx.plan.moves?.length ? { moves: s.moves } : {}),
    sequence: s.sequence ?? [],
    effects: s.effects,
    compositions: s.compositions,
    captionPlace: s.captionPlace,
    captionHide: s.captionHide,
    pauses: s.pauses,
    splits: s.splits,
    voiceDb: s.voiceDb,
    mix: s.mix,
    musicFade: s.musicFade,
    markers: s.markers,
    grade: s.grade,
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
