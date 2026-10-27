/**
 * Mezcla del video: tres pistas de audio (voz, música y efectos de sonido) con su volumen, silenciar y solo, y los
 * fundidos de la música y de cada sonido puesto a mano. Lo mismo arma la vista previa del Estudio (Web Audio) y el
 * render del worker (worker/video/render.py, `mix_audio`): los números que salen de aquí son los que suenan en los dos.
 *
 * Todo es opcional en el plan: sin `audio.voice_db`, la voz va a 0 dB; sin `audio.mix`, nada silenciado; sin
 * `audio.music_fade`, los fundidos de siempre (0,8 s de entrada y 1,5 s de salida). Los planes de antes suenan igual.
 *
 * Este archivo no importa nada de servidor (lo usan la app, la vista previa y las pruebas).
 */
import { z } from "zod";

export const MIX_TRACKS = ["voice", "music", "sfx"] as const;
export type MixTrack = (typeof MIX_TRACKS)[number];

export const MIX_TRACK_LABELS: Record<MixTrack, string> = { voice: "Voz", music: "Música", sfx: "Efectos de sonido" };

/** Volumen de la voz (dB). Hasta 0: la voz sale normalizada a -14 LUFS y no se sube (la vista previa no puede pasar de 1). */
export const VOICE_DB = { min: -30, max: 0, default: 0 } as const;

/** Fundidos de la música (s). Los de siempre: 0,8 s al entrar y 1,5 s al salir. */
export const MUSIC_FADE = { in: 0.8, out: 1.5, max: 10 } as const;

/** Fundidos y recorte de un sonido (s). */
export const CUE_FADE_MAX = 5;

export const mixSchema = z.object({
  mute: z.array(z.enum(MIX_TRACKS)).max(3),
  solo: z.array(z.enum(MIX_TRACKS)).max(3),
});
export type AudioMix = z.infer<typeof mixSchema>;

export const musicFadeSchema = z.object({ in: z.number().min(0).max(MUSIC_FADE.max), out: z.number().min(0).max(MUSIC_FADE.max) });
export type MusicFade = z.infer<typeof musicFadeSchema>;

export const NO_MIX: AudioMix = { mute: [], solo: [] };

/** Mezcla limpia (sin repetir, solo pistas conocidas); null si no cambia nada (no se guarda el campo). */
export function cleanMix(raw: unknown): AudioMix | null {
  const p = mixSchema.safeParse(raw);
  if (!p.success) return null;
  const mute = MIX_TRACKS.filter((t) => p.data.mute.includes(t));
  const solo = MIX_TRACKS.filter((t) => p.data.solo.includes(t));
  return mute.length || solo.length ? { mute: [...mute], solo: [...solo] } : null;
}

/** ¿Se escucha la pista? Silenciada no; con alguna en solo, solo las que están en solo (como en cualquier mezclador). */
export function audible(mix: AudioMix | null | undefined, track: MixTrack): boolean {
  const m = mix ?? NO_MIX;
  if (m.mute.includes(track)) return false;
  return m.solo.length === 0 || m.solo.includes(track);
}

export function voiceDb(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : VOICE_DB.default;
  return Math.round(Math.max(VOICE_DB.min, Math.min(VOICE_DB.max, n)) * 10) / 10;
}

export function musicFade(value: unknown): MusicFade {
  const p = musicFadeSchema.safeParse(value);
  return p.success ? { in: round2(p.data.in), out: round2(p.data.out) } : { in: MUSIC_FADE.in, out: MUSIC_FADE.out };
}

/**
 * Fundidos de la música en un video de `duration` s: si no entran los dos, se achican en proporción (nunca se pisan).
 */
export function fitMusicFade(fade: MusicFade, duration: number): MusicFade {
  const total = fade.in + fade.out;
  if (duration <= 0) return { in: 0, out: 0 };
  if (total <= duration) return fade;
  const k = duration / total;
  return { in: round2(fade.in * k), out: round2(fade.out * k) };
}

/** Lo que la mezcla le pasa al render (`audio.mix` de la entrada del worker). */
export type RenderMix = {
  /** Volumen de la voz (dB) o null si no se escucha (silenciada o fuera del solo). */
  voiceDb: number | null;
  /** ¿Va la música? */
  music: boolean;
  /** ¿Van los efectos de sonido? */
  sfx: boolean;
  musicFade: MusicFade;
};

export function renderMix(audio: { voice_db?: number; mix?: AudioMix | null; music_fade?: MusicFade }): RenderMix {
  return {
    voiceDb: audible(audio.mix, "voice") ? voiceDb(audio.voice_db) : null,
    music: audible(audio.mix, "music"),
    sfx: audible(audio.mix, "sfx"),
    musicFade: musicFade(audio.music_fade),
  };
}

/** Ganancia lineal de un valor en dB. */
export const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * Ganancia (lineal, 0 a 1) de un fundido en el segundo `t` de un tramo que suena de `start` a `end`: rampa lineal de
 * entrada y de salida, como el `afade` de ffmpeg con su curva por defecto (tri). La usan la vista previa y las pruebas.
 */
export function fadeGainAt(t: number, start: number, end: number, fadeIn: number, fadeOut: number): number {
  if (t < start || t > end) return 0;
  let g = 1;
  if (fadeIn > 0 && t < start + fadeIn) g = Math.min(g, (t - start) / fadeIn);
  if (fadeOut > 0 && t > end - fadeOut) g = Math.min(g, (end - t) / fadeOut);
  return Math.max(0, Math.min(1, g));
}

/**
 * Ducking de la música bajo la voz, como el `sidechaincompress` del render: mientras hablas la música baja
 * `MUSIC_DUCK_DB`; entra en 20 ms y vuelve en 450 ms. Las pausas más cortas que la salida no la dejan volver del todo
 * (se unen). En la vista previa se programa con estas ventanas; en el render lo hace ffmpeg con la voz.
 */
export const MUSIC_DUCK_DB = -9;
export const DUCK_ATTACK = 0.02;
export const DUCK_RELEASE = 0.45;

export function duckWindows(speech: { start: number; end: number }[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const w of [...speech].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && w.start - last.end < DUCK_RELEASE) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
