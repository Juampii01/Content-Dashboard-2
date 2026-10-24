/**
 * Efectos de apertura (sobre la persona, en el gancho) y su rotación entre videos: así no se abre siempre con el
 * mismo efecto. Sin servidor.
 */
import type { FxKind } from "./catalog";

/** Efectos que sirven para abrir (sobre la persona). Se rotan: primero los que la marca no usó hace poco. */
export const OPENERS: FxKind[] = ["glass_type", "word_slam", "digital_zoom", "snap_zoom", "title_card", "cover_story", "letter_build", "text_behind", "neon_text"];

/**
 * Orden de los efectos de apertura para este video: los que la marca usó hace poco van al final (más usado, más atrás)
 * y, entre los demás, el orden cambia de video en video (semilla de las palabras) para no abrir siempre igual.
 */
export function openerOrder(words: { text: string }[], recent: FxKind[] = []): FxKind[] {
  let seed = 2166136261;
  for (const w of words.slice(0, 40)) for (let i = 0; i < w.text.length; i++) seed = Math.imul(seed ^ w.text.charCodeAt(i), 16777619) >>> 0;
  const rank = (k: FxKind) => {
    const i = recent.indexOf(k);
    return i < 0 ? 0 : 100 - i;
  };
  const jitter = (k: FxKind) => (Math.imul(seed ^ OPENERS.indexOf(k), 2654435761) >>> 0) / 4294967296;
  return [...OPENERS].sort((a, b) => rank(a) - rank(b) || jitter(a) - jitter(b));
}

