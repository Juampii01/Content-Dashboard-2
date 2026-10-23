/**
 * Valores por defecto del Editor de video: los usan "Hazlo por mí" (exportar sin pasar por la revisión), los
 * proyectos nuevos (el flujo de subida arranca con ellos y el plan sale con su sonido y su música) y los clips con
 * "Exportar directo".
 *
 * Se guardan en Mi marca: `brand_profile.editor_defaults` (todo) y `brand_profile.subtitle_preset` (solo el estilo de
 * subtítulos, como `{ preset }`), que ya existía y sigue valiendo solo: una instalación que solo tiene
 * `subtitle_preset` ("caja" o { preset: "caja" }) usa ese estilo y lo demás por defecto.
 *
 * Este archivo no importa nada de servidor (lo usan la app, el navegador y las pruebas).
 */
import { z } from "zod";
import { CAPTION_STYLE_KEYS } from "./caption-styles";
import { CAPTION_PRESETS } from "./captions";
import { MUSIC_DB, SFX_LEVEL_LABELS, SFX_LEVELS, type SfxLevel } from "./sfx";
import { STUDIO_LEVEL_LABELS, STUDIO_LEVELS, type StudioLevel } from "./studio-audio";
import type { CaptionPresetKey, VideoFormat } from "./types";
import { FX_FREQUENCY_LABELS } from "./fx/catalog";
import { FX_FACTORY, fxSettingsSchema, readFxSettings, type FxSettings } from "./fx/schema";

/** Estilos que sirven de valor por defecto: "Del estilo" necesita un video de referencia. */
export const DEFAULT_CAPTION_OPTIONS = [...CAPTION_STYLE_KEYS, "clasico", "pop", "ninguno"] as const satisfies readonly CaptionPresetKey[];
export type DefaultCaptionKey = (typeof DEFAULT_CAPTION_OPTIONS)[number];

export const editorDefaultsSchema = z.object({
  captions: z.enum(DEFAULT_CAPTION_OPTIONS),
  /** Emojis sobre las palabras clave (solo en los estilos de la galería). */
  emoji: z.boolean(),
  sfx: z.enum(SFX_LEVELS),
  studio: z.enum(STUDIO_LEVELS),
  /** Pista de Biblioteca → Música (music_tracks.id) o null, y su volumen respecto de la voz. */
  music: z.object({ trackId: z.uuid().nullable(), db: z.number().min(MUSIC_DB.min).max(MUSIC_DB.max) }),
  broll: z.enum(["auto", "off"]),
  format: z.enum(["9:16", "16:9"]),
  /** Efectos de la biblioteca: cuáles puede elegir el director y con qué frecuencia. */
  effects: fxSettingsSchema,
});

export type EditorDefaults = {
  captions: DefaultCaptionKey;
  emoji: boolean;
  sfx: SfxLevel;
  studio: StudioLevel;
  music: { trackId: string | null; db: number };
  broll: "auto" | "off";
  format: VideoFormat;
  effects: FxSettings;
};

/** Lo que sale si la persona nunca tocó nada: lo mismo que ya proponía el editor (Caja, Sutil, Suave, con b-roll). */
export const FACTORY_DEFAULTS: EditorDefaults = {
  captions: "caja",
  emoji: false,
  sfx: "subtle",
  studio: "soft",
  music: { trackId: null, db: MUSIC_DB.default },
  broll: "auto",
  format: "9:16",
  effects: FX_FACTORY,
};

const isCaption = (v: unknown): v is DefaultCaptionKey => typeof v === "string" && (DEFAULT_CAPTION_OPTIONS as readonly string[]).includes(v);

/** Estilo de `subtitle_preset` ("caja" o { preset: "caja" }), si es uno válido. */
export function legacyCaption(raw: unknown): DefaultCaptionKey | null {
  const value = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { preset?: unknown }).preset : null;
  return isCaption(value) ? value : null;
}

/**
 * Lee los valores guardados campo por campo: lo que falta o no es válido queda con el de fábrica (así, sumar un campo
 * nuevo mañana no rompe lo guardado hoy).
 */
export function readEditorDefaults(brand: { editorDefaults?: unknown; subtitlePreset?: unknown } | null | undefined): EditorDefaults {
  const raw = (brand?.editorDefaults && typeof brand.editorDefaults === "object" ? brand.editorDefaults : {}) as Record<string, unknown>;
  const shape = editorDefaultsSchema.shape;
  const pick = <K extends keyof EditorDefaults>(key: K): EditorDefaults[K] => {
    const parsed = shape[key].safeParse(raw[key]);
    return parsed.success ? (parsed.data as EditorDefaults[K]) : FACTORY_DEFAULTS[key];
  };
  return {
    captions: isCaption(raw.captions) ? raw.captions : (legacyCaption(brand?.subtitlePreset) ?? FACTORY_DEFAULTS.captions),
    emoji: pick("emoji"),
    sfx: pick("sfx"),
    studio: pick("studio"),
    music: pick("music"),
    broll: pick("broll"),
    format: pick("format"),
    effects: raw.effects ? readFxSettings(raw.effects) : { ...FX_FACTORY, allowed: [...FX_FACTORY.allowed] },
  };
}

/** Lo que se guarda en la base: `editor_defaults` completo y `subtitle_preset` con el estilo (para lo que ya lo leía). */
export function storedEditorDefaults(defaults: EditorDefaults): { editorDefaults: Record<string, unknown>; subtitlePreset: { preset: DefaultCaptionKey } } {
  return { editorDefaults: { ...defaults, music: { ...defaults.music }, effects: { ...defaults.effects, allowed: [...defaults.effects.allowed] } }, subtitlePreset: { preset: defaults.captions } };
}

/** Frase corta con lo que va a usar "Hazlo por mí" (para mostrar al lado del interruptor). */
export function summarizeDefaults(d: EditorDefaults, musicTitle: string | null): string {
  const parts = [
    d.captions === "ninguno" ? "sin subtítulos" : `subtítulos ${CAPTION_PRESETS[d.captions].label}${d.emoji ? " con emojis" : ""}`,
    d.broll === "auto" ? "b-roll y gráficos" : "sin b-roll",
    `audio de estudio ${STUDIO_LEVEL_LABELS[d.studio].label}`,
    d.sfx === "off" ? "sin efectos" : `efectos ${SFX_LEVEL_LABELS[d.sfx].label}`,
    d.music.trackId && musicTitle ? `música «${musicTitle}»` : "sin música",
    d.effects.frequency === "ninguno" || !d.effects.allowed.length ? "sin efectos de firma" : `efectos de firma: ${FX_FREQUENCY_LABELS[d.effects.frequency].label.toLowerCase()}`,
  ];
  return `Con tus valores por defecto: ${parts.join(", ")}.`;
}
