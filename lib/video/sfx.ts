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
import type { OutputBroll } from "./effects";
import type { Timeline } from "./timeline";
import { FPS } from "./types";

export const SFX_LEVELS = ["off", "subtle", "strong"] as const;
export type SfxLevel = (typeof SFX_LEVELS)[number];
export type SfxName = "whoosh" | "pop" | "riser";

export const SFX_LEVEL_LABELS: Record<SfxLevel, { label: string; description: string }> = {
  off: { label: "Sin efectos", description: "Solo tu voz (y la música, si eliges una)." },
  subtle: { label: "Sutil", description: "Un whoosh suave cuando entra un b-roll o un gráfico." },
  strong: { label: "Marcado", description: "Whoosh más presente, un pop en cada emoji y un riser antes de que termine el gancho." },
};

/** Duración de cada archivo y en qué segundo está su punto fuerte (lo que tiene que caer justo en el corte). */
export const SFX_FILES: Record<SfxName, { duration: number; hit: number }> = {
  whoosh: { duration: 0.55, hit: 0.33 },
  pop: { duration: 0.12, hit: 0 },
  riser: { duration: 1.0, hit: 1.0 },
};

/** Ganancia (dB) de cada sonido según el nivel; null = no suena en ese nivel. */
const GAINS: Record<Exclude<SfxLevel, "off">, Record<SfxName, number | null>> = {
  subtle: { whoosh: -16, pop: null, riser: null },
  strong: { whoosh: -10, pop: -15, riser: -13 },
};

/** Entre dos efectos, al menos esto (un b-roll que entra justo después de otro no suena dos veces). */
const MIN_GAP = 0.35;
const MAX_CUES = 60;

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
}): SfxCue[] {
  if (input.level === "off" || input.duration <= 0) return [];
  const gains = GAINS[input.level];
  const wanted: { name: SfxName; hitAt: number }[] = [];
  for (const b of input.broll) wanted.push({ name: "whoosh", hitAt: b.start });
  if (input.hookEnd != null && input.hookEnd > SFX_FILES.riser.duration * 0.6) wanted.push({ name: "riser", hitAt: input.hookEnd });
  for (const t of input.emojiTimes ?? []) wanted.push({ name: "pop", hitAt: t });

  const cues: SfxCue[] = [];
  // Primero los más importantes (whoosh y riser) y en orden de tiempo; los pop solo si no chocan con nada.
  const priority: Record<SfxName, number> = { riser: 0, whoosh: 1, pop: 2 };
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
  return cues.sort((a, b) => a.at - b.at);
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
