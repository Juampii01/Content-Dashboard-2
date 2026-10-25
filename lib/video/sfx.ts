/**
 * Efectos de sonido del video final: un "whoosh" cuando entra un b-roll o un gráfico, un "pop" cuando aparece un
 * emoji de los subtítulos y un "riser" que sube hasta el corte entre el gancho y el resto (estos dos, solo en
 * "Marcado"). Los sonidos se generan con worker/scripts/make_sfx.py (procedurales: sin licencias de terceros) y
 * están en worker/assets/sfx (render) y public/sfx (vista previa).
 *
 * Los tres archivos están normalizados igual (su ventana de 100 ms más fuerte a -12 dBFS RMS), así las ganancias
 * de aquí significan lo mismo para todos. La voz sale a -14 LUFS (≈ -17 dBFS RMS al hablar): con "Sutil" el
 * whoosh queda unos 11 dB por debajo de la voz y con "Marcado", unos 5 dB. La voz siempre manda.
 *
 * Este archivo no importa nada de servidor (lo usan la app, la vista previa y las pruebas).
 */
import { z } from "zod";
import type { OutputBroll } from "./effects";
import { SFX_LIBRARY, SFX_NAMES, type SfxName } from "./sfx-library";
import { outputRange, type Timeline } from "./timeline";
import { FPS } from "./types";

export type { SfxName } from "./sfx-library";

export const SFX_LEVELS = ["off", "subtle", "strong"] as const;
export type SfxLevel = (typeof SFX_LEVELS)[number];

export const SFX_LEVEL_LABELS: Record<SfxLevel, { label: string; description: string }> = {
  off: { label: "Sin efectos", description: "Solo tu voz (y la música, si eliges una)." },
  subtle: { label: "Sutil", description: "Un whoosh suave cuando entra un b-roll o un gráfico (y, con ritmo Editor de reels, un toque suave en cada cosa que entra)." },
  strong: { label: "Marcado", description: "Whoosh más presente, un pop en cada emoji y un riser antes de que termine el gancho." },
};

/** Duración de cada archivo y en qué segundo está su punto fuerte (lo que tiene que caer justo en el corte). */
export const SFX_FILES: Record<SfxName, { duration: number; hit: number }> = Object.fromEntries(SFX_NAMES.map((n) => [n, { duration: SFX_LIBRARY[n].duration, hit: SFX_LIBRARY[n].hit }])) as Record<SfxName, { duration: number; hit: number }>;

type AutoName = "whoosh" | "pop" | "riser";
/** Ganancia (dB) de cada sonido automático según el nivel; null = no suena en ese nivel. */
const GAINS: Record<Exclude<SfxLevel, "off">, Record<AutoName, number | null>> = {
  subtle: { whoosh: -16, pop: null, riser: null },
  strong: { whoosh: -10, pop: -15, riser: -13 },
};

// ─── Sonidos que pone la persona (pista de Sonido del Estudio) ─────────────

export const SOUND_GAIN = { min: -30, max: 0, default: -14 } as const;
export const MAX_SOUND_CUES = 40;

/** Un sonido de la biblioteca anclado a una palabra (sobrevive a los cortes): su punto fuerte cae en `offset` s desde ella. */
export const soundCueSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.enum(SFX_NAMES as [SfxName, ...SfxName[]]),
  at_word: z.number().int().min(0),
  offset: z.number().min(-2).max(2).default(0),
  gain: z.number().min(SOUND_GAIN.min).max(SOUND_GAIN.max).default(SOUND_GAIN.default),
  source: z.enum(["director", "user"]).optional(),
});
export type SoundCue = z.infer<typeof soundCueSchema>;
export const soundCueListSchema = z.array(soundCueSchema).max(MAX_SOUND_CUES);

/** Sonidos válidos que manda el navegador (forma, palabra existente, sin repetir id). */
export function cleanSoundCues(raw: unknown[], wordCount: number): SoundCue[] {
  const out: SoundCue[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const p = soundCueSchema.safeParse(r);
    if (!p.success || p.data.at_word >= wordCount || ids.has(p.data.id)) continue;
    ids.add(p.data.id);
    out.push({ ...p.data, offset: Math.round(p.data.offset * 1000) / 1000, gain: Math.round(p.data.gain * 10) / 10 });
    if (out.length >= MAX_SOUND_CUES) break;
  }
  return out;
}

/** Dónde suena cada sonido puesto a mano en el video final (su punto fuerte), o null si su palabra se cortó. */
export function soundCueTimes(timeline: Pick<Timeline, "words">, cues: SoundCue[]): { cue: SoundCue; hitAt: number }[] {
  const out: { cue: SoundCue; hitAt: number }[] = [];
  for (const cue of cues) {
    const r = outputRange(timeline as Timeline, cue.at_word, cue.at_word);
    if (!r) continue;
    out.push({ cue, hitAt: Math.max(0, r.start + cue.offset) });
  }
  return out;
}

let cueCounter = 0;
export const newSoundCueId = () => `s${Date.now().toString(36)}${(cueCounter++).toString(36)}`;

/** Entre dos efectos, al menos esto (un b-roll que entra justo después de otro no suena dos veces). */
const MIN_GAP = 0.35;
const MAX_CUES = 60;
/** Entre dos sonidos de animaciones o transiciones, como mínimo (s). */
const AUTO_GAP = 0.3;
/** Techo de los sonidos que traen las animaciones y transiciones (dB del archivo; la voz queda arriba). */
const AUTO_MAX_DB = -16;
/** Cuánto bajan los efectos mientras la persona habla (dB). */
const UNDER_VOICE_DB = 4;
/** «Volumen de los efectos» (dB sobre todos): de casi nada a un poco más fuerte. */
export const SFX_VOLUME = { min: -18, max: 6, default: 0 } as const;

export type SfxCue = { name: SfxName; /** Inicio del archivo en el video final (s). */ at: number; gain: number };

/** Fin del gancho en el video final (s), si el video arranca con un gancho y sigue con el resto. */
export function hookEnd(timeline: Pick<Timeline, "clips">): number | null {
  let t = 0;
  let i = 0;
  while (i < timeline.clips.length && timeline.clips[i]!.role === "hook") {
    t += (timeline.clips[i]!.endFrame - timeline.clips[i]!.startFrame) / FPS;
    i++;
  }
  return i > 0 && i < timeline.clips.length ? t : null;
}

export function sfxLevel(value: unknown): SfxLevel {
  return (SFX_LEVELS as readonly unknown[]).includes(value) ? (value as SfxLevel) : "off";
}

/**
 * Efectos del video: momentos y ganancias. `emojiTimes`: instantes en que aparece un emoji de los subtítulos.
 * Nada empieza antes de 0 ni pasa del final del video.
 */
export function sfxCues(input: {
  level: SfxLevel;
  duration: number;
  broll: Pick<OutputBroll, "start" | "end">[];
  hookEnd?: number | null;
  emojiTimes?: number[];
  /** Entradas sincronizadas con la voz: cada ítem de un gráfico, cada efecto y cada punch-in (pop en su palabra). */
  entries?: number[];
  /** Punch-ins (whoosh corto). */
  punches?: number[];
  /** Ritmo "Editor de reels": las entradas suenan también en "Sutil". */
  dense?: boolean;
  /**
   * Sonidos elegidos: los que puso la persona en la pista de Sonido y los de las transiciones. Suenan siempre (también
   * con "Sin efectos", que apaga solo los automáticos) y van primero.
   */
  manual?: { name: SfxName; hitAt: number; gain: number }[];
  /**
   * Sonidos que trae lo que se agregó (animaciones, transiciones): suenan siempre como los elegidos, pero con un techo
   * de volumen y sin amontonarse (uno cada AUTO_GAP s como mucho).
   */
  extras?: { name: SfxName; hitAt: number; gain: number }[];
  /** Volumen de todos los efectos (dB, «Volumen de los efectos» en Audio y música). */
  volumeDb?: number;
  /** Tramos en que habla la persona (segundos del video final): ahí los efectos bajan un poco para no taparla. */
  speech?: { start: number; end: number }[];
}): SfxCue[] {
  if (input.duration <= 0) return [];
  const master = Math.max(SFX_VOLUME.min, Math.min(SFX_VOLUME.max, input.volumeDb ?? 0));
  const speaking = (t: number) => (input.speech ?? []).some((w) => t >= w.start - 0.05 && t <= w.end + 0.05);
  // Mezcla: el volumen general, y debajo de la voz mientras hablas (igual en la vista previa y en el render).
  const level = (c: SfxCue): SfxCue => {
    const hit = c.at + SFX_FILES[c.name].hit;
    const gain = c.gain + master - (speaking(hit) ? UNDER_VOICE_DB : 0);
    return { ...c, gain: Math.round(Math.max(-40, Math.min(0, gain)) * 10) / 10 };
  };
  const manual: SfxCue[] = [];
  for (const m of (input.manual ?? []).slice(0, MAX_SOUND_CUES + 24)) {
    const file = SFX_FILES[m.name];
    if (!file) continue;
    const at = Math.round(Math.max(0, m.hitAt - file.hit) * 1000) / 1000;
    if (at >= input.duration - 0.02) continue;
    if (manual.some((c) => c.name === m.name && Math.abs(c.at - at) < 0.05)) continue;
    manual.push({ name: m.name, at, gain: Math.max(SOUND_GAIN.min, Math.min(SOUND_GAIN.max, m.gain)) });
  }
  // Los de las animaciones y transiciones: con techo y sin golpes pegados (antes sonaban 4 o 5 seguidos a todo volumen).
  for (const m of [...(input.extras ?? [])].sort((a, b) => a.hitAt - b.hitAt).slice(0, MAX_CUES)) {
    const file = SFX_FILES[m.name];
    if (!file) continue;
    const at = Math.round(Math.max(0, m.hitAt - file.hit) * 1000) / 1000;
    if (at >= input.duration - 0.02) continue;
    if (manual.some((c) => Math.abs(c.at + SFX_FILES[c.name].hit - m.hitAt) < AUTO_GAP)) continue;
    manual.push({ name: m.name, at, gain: Math.max(SOUND_GAIN.min, Math.min(AUTO_MAX_DB, m.gain)) });
  }
  if (input.level === "off") return manual.map(level).sort((a, b) => a.at - b.at);
  const gains = GAINS[input.level];
  const wanted: { name: AutoName; hitAt: number }[] = [];
  for (const b of input.broll) wanted.push({ name: "whoosh", hitAt: b.start });
  if (input.hookEnd != null && input.hookEnd > SFX_FILES.riser.duration * 0.6) wanted.push({ name: "riser", hitAt: input.hookEnd });
  for (const t of input.emojiTimes ?? []) wanted.push({ name: "pop", hitAt: t });
  const entryGain = input.level === "strong" ? -14 : input.dense ? -20 : null;
  const extra: { name: AutoName; hitAt: number; gain: number }[] = [];
  if (entryGain != null) {
    for (const t of input.entries ?? []) extra.push({ name: "pop", hitAt: t, gain: entryGain });
    for (const t of input.punches ?? []) extra.push({ name: "whoosh", hitAt: t, gain: entryGain - 4 });
  }

  const cues: SfxCue[] = [...manual];
  // Primero los más importantes (whoosh y riser) y en orden de tiempo; los pop solo si no chocan con nada.
  const priority: Record<AutoName, number> = { riser: 0, whoosh: 1, pop: 2 };
  for (const w of wanted.sort((a, b) => priority[a.name] - priority[b.name] || a.hitAt - b.hitAt)) {
    const gain = gains[w.name];
    if (gain == null) continue;
    const file = SFX_FILES[w.name];
    const at = Math.round(Math.max(0, w.hitAt - file.hit) * 1000) / 1000;
    if (at + Math.min(file.duration, 0.2) > input.duration) continue;
    const hit = at + file.hit;
    if (cues.some((c) => Math.abs(c.at + SFX_FILES[c.name].hit - hit) < MIN_GAP)) continue;
    cues.push({ name: w.name, at, gain });
    if (cues.length >= MAX_CUES) break;
  }
  // Las entradas sincronizadas, en la palabra exacta, mientras no choquen con otro sonido.
  for (const w of extra.sort((a, b) => a.hitAt - b.hitAt)) {
    if (cues.length >= MAX_CUES) break;
    const file = SFX_FILES[w.name];
    const at = Math.round(Math.max(0, w.hitAt - file.hit) * 1000) / 1000;
    if (at + Math.min(file.duration, 0.2) > input.duration) continue;
    const hit = at + file.hit;
    if (cues.some((c) => Math.abs(c.at + SFX_FILES[c.name].hit - hit) < MIN_GAP)) continue;
    cues.push({ name: w.name, at, gain: w.gain });
  }
  return cues.map(level).sort((a, b) => a.at - b.at);
}

// ─── Música ─────────────────────────────────────────────────────────────────

/** Volumen de la música respecto de la voz (dB). Debajo de la voz, con ducking: baja más cuando hablas. */
export const MUSIC_DB = { min: -30, max: -8, default: -16 } as const;

export function musicLabel(db: number): string {
  if (db <= -24) return "Muy baja";
  if (db <= -19) return "Baja";
  if (db <= -13) return "Media";
  return "Alta";
}
