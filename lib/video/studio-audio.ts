/**
 * "Audio de estudio": que una toma con el teléfono en una habitación con eco y ruido suene limpia. Lo hace el worker
 * (worker/video/studio.py: DeepFilterNet3 para el ruido, supresión de la cola de eco y del zumbido de la red, y
 * después ecualización de voz, de-esser y compresión).
 *
 * Los planes nuevos arrancan en "Suave". Los de antes no traen el campo y quedan "Apagado": si se vuelven a
 * renderizar, el audio suena como antes.
 *
 * Este archivo no importa nada de servidor (lo usan la app, la revisión y las pruebas).
 */

export const STUDIO_LEVELS = ["off", "soft", "strong"] as const;
export type StudioLevel = (typeof STUDIO_LEVELS)[number];

export const STUDIO_DEFAULT: StudioLevel = "soft";

export const STUDIO_LEVEL_LABELS: Record<StudioLevel, { label: string; description: string }> = {
  off: { label: "Apagado", description: "Tu voz con el procesado básico: volumen parejo y un poco menos de ruido." },
  soft: { label: "Suave", description: "Quita el ruido y parte del eco sin que suene procesado. Recomendado." },
  strong: { label: "Fuerte", description: "Para habitaciones con mucho eco o ruido: limpia al máximo, aunque la voz puede sonar más seca." },
};

/** Nivel guardado en el plan; sin el campo (planes de antes), apagado. */
export function studioLevel(value: unknown): StudioLevel {
  return (STUDIO_LEVELS as readonly unknown[]).includes(value) ? (value as StudioLevel) : "off";
}

/** Muestra de 10 s que arma el worker al analizar el video (en `media.audioPreview`). */
export type AudioPreviewMedia = {
  version: number;
  /** Segundo del video original donde empieza la muestra. */
  start: number;
  duration: number;
  keys: Partial<Record<"original" | "soft" | "strong", string>>;
};

/** La misma muestra, con URLs firmadas para el navegador. */
export type AudioPreview = {
  start: number;
  duration: number;
  urls: { original: string | null; soft: string | null; strong: string | null };
};
