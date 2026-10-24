/**
 * La revisión del Estudio aplicada al plan (lo que se guarda y lo que se exporta), sin servidor: el servidor arma el
 * render con esto y lib/video/service.ts lo reexporta. `previewMismatch` compara lo que mostraba la vista previa con
 * el timeline que va a renderizar el servidor.
 */
import { cleanCaptionPlacement } from "./canvas/captions";
import { cleanPlace } from "./canvas/transform";
import { cleanFx } from "./fx/schema";
import { cleanTransitions } from "./fx/transitions";
import { musicGenSchema } from "./music-gen/spec";
import { brollItemSchema, rangesFromIds, withDerived } from "./plan";
import { cleanSoundCues, MUSIC_DB, sfxLevel, type SfxLevel } from "./sfx";
import { studioLevel, type StudioLevel } from "./studio-audio";
import { buildTimeline, TIMING, type Timeline } from "./timeline";
import type { BrollItem, CaptionPresetKey, EditPlan, PlanMove, Transcript, VideoFormat, ZoomMoment } from "./types";

export type Review = {
  removed: number[];
  selectedHook: number | null;
  preset: CaptionPresetKey;
  offsetX: number;
  corrections: Record<string, string>;
  /** B-roll tal como quedó en la revisión (cambiado, movido o quitado). */
  broll?: BrollItem[];
  /** Zooms del estilo encendidos o apagados. */
  zooms?: boolean;
  /** Emojis sobre las palabras clave (galería de subtítulos). */
  emoji?: boolean;
  /** Efectos de sonido. */
  sfx?: SfxLevel;
  /** Audio de estudio (ruido y eco fuera). */
  studio?: StudioLevel;
  /** Música de fondo: pista de la biblioteca (o null) y su volumen respecto de la voz. */
  music?: { trackId: string | null; db: number };
  /** Bloques movidos por el director que siguen en pie (la persona puede dejar alguno en su lugar). */
  moves?: PlanMove[];
  /** Efectos de la biblioteca tal como quedaron en la revisión. */
  effects?: unknown[];
  /** Transiciones en los cortes (lib/video/fx/transitions). */
  transitions?: unknown[];
  /** Sonidos de la biblioteca puestos a mano en la pista de Sonido. */
  soundCues?: unknown[];
  /** Música generada elegida (estilo, semilla y tempo), o null para quitarla. Manda sobre `music.trackId`. */
  musicGen?: unknown;
  /**
   * Ritmo elegido en la revisión (lib/video/rhythm.ts): la densidad y lo que el relleno de ritmo dejó en la vista
   * previa (punch-ins, pausa máxima y palabras resaltadas); los gráficos y efectos que agregó van en broll y effects.
   */
  rhythm?: { density: "sobria" | "normal" | "reels"; added: NonNullable<EditPlan["rhythm"]>["added"]; zoomMoments: ZoomMoment[]; longPause: number; emphasis: number[] };
  /**
   * Pausas largas que la persona dejó completas en la revisión (id de la palabra que sigue a cada pausa) o todas
   * (`all`: "Sin recortes automáticos"). Sin el campo, se deja lo que ya tenía el plan.
   */
  pauses?: { keep: number[]; all: boolean };
  /**
   * Lugar y tamaño de los subtítulos desde el lienzo (lib/video/canvas/captions.ts): de todos y, opcional, por línea
   * (id de la primera palabra del bloque). Sin el campo, se deja lo que ya tenía el plan.
   */
  captionPlace?: { transform?: unknown; lines?: unknown };
  /** Tramos sin subtítulos tal como quedaron en la revisión (quitados por la persona o por el director). */
  captionHide?: { from_word: number; to_word: number; why: string }[];
  /**
   * Lo que mostraba la vista previa al exportar: los tramos del original en orden ([cuadro de inicio, cuadro de fin]) y
   * el gancho (rango de palabras). El render se arma en el servidor con el plan guardado; si no da exactamente esto, no
   * se exporta (ver `previewMismatch`).
   */
  preview?: { clips: [number, number][]; hook: { from_word: number; to_word: number } | null };
};

/**
 * ¿El timeline que va a renderizar el servidor es distinto del que se veía en la vista previa? Devuelve qué cambia
 * (para el registro) o null si coinciden. Se compara el gancho por sus palabras (no por su número en la lista, que
 * puede cambiar si el plan guardado cambió) y los tramos cuadro a cuadro.
 */
export function previewMismatch(preview: Review["preview"], plan: Pick<EditPlan, "selected_hook" | "hook_candidates">, timeline: Pick<Timeline, "clips">): string | null {
  if (!preview) return null;
  const hook = plan.selected_hook != null ? plan.hook_candidates[plan.selected_hook] : undefined;
  const want = preview.hook;
  if (Boolean(hook) !== Boolean(want) || (hook && want && (hook.from_word !== want.from_word || hook.to_word !== want.to_word))) {
    return `gancho: vista previa ${want ? `${want.from_word}-${want.to_word}` : "ninguno"}, render ${hook ? `${hook.from_word}-${hook.to_word}` : "ninguno"}`;
  }
  const got = timeline.clips.map((c) => [c.startFrame, c.endFrame] as [number, number]);
  const at = got.findIndex((c, i) => !preview.clips[i] || preview.clips[i]![0] !== c[0] || preview.clips[i]![1] !== c[1]);
  if (at >= 0 || got.length !== preview.clips.length) {
    const i = at >= 0 ? at : Math.min(got.length, preview.clips.length);
    return `tramos: ${preview.clips.length} en la vista previa y ${got.length} en el render; el ${i + 1}.º es ${JSON.stringify(preview.clips[i] ?? null)} contra ${JSON.stringify(got[i] ?? null)}`;
  }
  return null;
}

export function applyReview(plan: EditPlan, review: Review, words: Transcript["words"], duration: number, format: VideoFormat): EditPlan {
  const valid = review.removed.filter((id) => Number.isInteger(id) && id >= 0 && id < words.length);
  const corrections: Record<string, string> = {};
  for (const [id, text] of Object.entries(review.corrections)) {
    const n = Number(id);
    const clean = text.trim().slice(0, 60);
    if (Number.isInteger(n) && n >= 0 && n < words.length && clean) corrections[String(n)] = clean;
  }
  const next: EditPlan = {
    ...plan,
    format,
    removals: rangesFromIds(valid, [...plan.removals, ...plan.proposed_removals]),
    selected_hook: review.selectedHook != null && plan.hook_candidates[review.selectedHook] ? review.selectedHook : null,
    captions: { ...plan.captions, preset: review.preset, ...(review.emoji != null ? { emoji: review.emoji } : {}) },
    audio: {
      ...plan.audio,
      ...(review.sfx ? { sfx: sfxLevel(review.sfx) } : {}),
      ...(review.studio ? { studio: studioLevel(review.studio) } : {}),
      ...(review.music
        ? { music_asset_id: review.music.trackId, music_db: Math.round(Math.max(MUSIC_DB.min, Math.min(MUSIC_DB.max, review.music.db))) }
        : {}),
    },
    framing: { mode: review.offsetX === 0 ? "center" : "manual", offset_x: Math.max(-1, Math.min(1, review.offsetX)) },
    corrections,
    ...(review.broll ? { broll: cleanBroll(review.broll, words.length) } : {}),
    ...(review.zooms != null && plan.style_id ? { zooms_enabled: review.zooms } : {}),
  };
  if (review.captionHide) {
    // Subtítulos quitados: tramos válidos, sin repetir y unidos si se pisan.
    const spans = review.captionHide
      .map((h) => ({ from_word: Math.min(h.from_word, h.to_word), to_word: Math.max(h.from_word, h.to_word), why: h.why.slice(0, 300) }))
      .filter((h) => h.from_word >= 0 && h.to_word < words.length)
      .sort((a, b) => a.from_word - b.from_word);
    const merged: typeof spans = [];
    for (const h of spans) {
      const last = merged[merged.length - 1];
      if (last && h.from_word <= last.to_word + 1) last.to_word = Math.max(last.to_word, h.to_word);
      else merged.push({ ...h });
    }
    const { hide: _h, ...rest } = next.captions;
    void _h;
    next.captions = merged.length ? { ...rest, hide: merged.slice(0, 60) } : rest;
  }
  if (review.captionPlace) {
    // Lienzo: lugar de los subtítulos, limpio (sin rotación, ids válidos, dentro de los límites).
    const place = cleanCaptionPlacement(review.captionPlace, words.length);
    const { transform: _t, lines: _l, ...rest } = next.captions;
    void _t;
    void _l;
    next.captions = { ...rest, ...place };
  }
  if (review.effects) {
    const fx = cleanFx(review.effects, words.length, next.broll.filter((b) => b.choice));
    if (fx.length) next.effects = fx;
    else delete next.effects;
  }
  if (review.transitions) {
    // Solo en cortes que existen con lo que quedó (el corte depende de lo cortado y del gancho).
    const tr = cleanTransitions(review.transitions, buildTimeline(words, next, duration));
    if (tr.length) next.transitions = tr;
    else delete next.transitions;
  }
  if (review.soundCues) {
    const cues = cleanSoundCues(review.soundCues, words.length);
    const { cues: _c, ...audio } = next.audio;
    void _c;
    next.audio = cues.length ? { ...audio, cues } : audio;
  }
  if (review.musicGen !== undefined) {
    const gen = review.musicGen === null ? null : musicGenSchema.safeParse(review.musicGen);
    next.audio = { ...next.audio, music_gen: gen && gen.success ? gen.data : null };
    if (next.audio.music_gen) next.audio.music_asset_id = null;
  }
  if (review.rhythm) {
    // Densidad elegida en la revisión: los punch-ins, la pausa máxima y los resaltados que ya se veían en la vista previa.
    const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < words.length;
    const zooms = review.rhythm.zoomMoments.filter((z) => valid(z.from_word) && valid(z.to_word) && z.from_word <= z.to_word).slice(0, 60).map((z) => ({ from_word: z.from_word, to_word: z.to_word, scale: Math.max(1, Math.min(1.4, z.scale)), why: String(z.why ?? "").slice(0, 300) }));
    if (zooms.length) next.zoom_moments = zooms;
    else delete next.zoom_moments;
    next.pacing = { ...next.pacing, long_pause: Math.max(0.2, Math.min(1.2, review.rhythm.longPause)) };
    next.captions = { ...next.captions, emphasis_words: [...new Set(review.rhythm.emphasis.filter(valid))].slice(0, 40) };
    next.rhythm = { density: review.rhythm.density, added: review.rhythm.added.filter((a) => valid(a.from_word) && valid(a.to_word)).slice(-120).map((a) => ({ ...a, why: a.why.slice(0, 300) })) };
  }
  if (review.pauses) {
    // Pausas completas: ids válidos, sin repetir (van con la tolerancia que quedó, la del plan o la del ritmo).
    const keep = [...new Set(review.pauses.keep.filter((id) => Number.isInteger(id) && id > 0 && id < words.length))].sort((a, b) => a - b).slice(0, 5000);
    const { keep: _k, keep_all: _a, ...pacing } = next.pacing ?? { long_pause: TIMING.longPause };
    void _k;
    void _a;
    next.pacing = { ...pacing, ...(keep.length ? { keep } : {}), ...(review.pauses.all ? { keep_all: true } : {}) };
  }
  if (review.moves) {
    // Solo se pueden quitar bloques movidos (no inventar nuevos desde el navegador).
    const kept = (plan.moves ?? []).filter((m) => review.moves!.some((r) => r.from_word === m.from_word && r.to_word === m.to_word && r.after_word === m.after_word));
    if (kept.length) next.moves = kept;
    else delete next.moves;
  }
  return withDerived(next, words, duration);
}

/** B-roll que manda el navegador: forma válida, ids dentro de la transcripción, sin superponerse. */
function cleanBroll(items: BrollItem[], wordCount: number): BrollItem[] {
  const out: BrollItem[] = [];
  for (const raw of [...items].sort((a, b) => a.from_word - b.from_word).slice(0, 20)) {
    const parsed = brollItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const b = parsed.data as BrollItem;
    if (b.from_word > b.to_word || b.to_word >= wordCount) continue;
    if (out.some((o) => b.from_word <= o.to_word && o.from_word <= b.to_word)) continue;
    out.push(cleanBrollPlace(b));
  }
  return out;
}

/** El lugar y la animación del lienzo solo valen para gráficos, dentro de sus límites y si cambian algo. */
function cleanBrollPlace(b: BrollItem): BrollItem {
  if (!b.edit || (!b.edit.transform && !b.edit.anim)) return b;
  const { transform: _t, anim: _a, ...rest } = b.edit;
  void _t;
  void _a;
  const place = b.choice?.source === "graphic" ? cleanPlace(b.edit) : undefined;
  return { ...b, edit: { ...rest, ...(place?.transform ? { transform: place.transform } : {}), ...(place?.anim ? { anim: place.anim } : {}) } };
}
