/**
 * Lo que comparten el editor y el servidor sobre los slides animados (sin dependencias de servidor).
 */
import type { CarouselSlide } from "@/lib/db/schema";

export const MOTIONS = {
  zoom: { label: "Acercamiento", hint: "Se acerca despacio, como un Ken Burns." },
  deriva: { label: "Deriva", hint: "Se mueve suave de un lado al otro." },
  latido: { label: "Latido", hint: "Late suave, como si respirara." },
} as const;
export type Motion = keyof typeof MOTIONS;
export type VideoFormat = "4:5" | "9:16";
export const VIDEO_SECONDS = [4, 6, 8] as const;

/**
 * Huella de lo que se ve en un slide (texto, imagen, plantilla y colores). Si cambia después de animarlo,
 * el video quedó viejo. No es criptográfica: solo compara.
 */
export function slideHash(slide: CarouselSlide, template: string, theme: unknown): string {
  const raw = JSON.stringify([slide.type, slide.kicker, slide.headline, slide.highlight, slide.body, slide.cta, slide.imageUrl ?? null, template, theme ?? null]);
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}
