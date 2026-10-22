/**
 * "Corregir una frase sin regrabar" (revisión del Editor): cálculos puros, sin servidor.
 * Lo usan la app (al crear la corrección y al armar el render) y las pruebas.
 *
 * La frase nueva se dice con la voz clonada del cliente (HeyGen) y reemplaza el audio del original entre la primera y
 * la última palabra marcadas (más un poco del silencio de alrededor). Todo en segundos del video original, así el
 * reemplazo se hace antes de cortar las tomas y respeta cualquier corte que la persona haga después.
 */
import type { Word } from "./types";

/** Máximo de palabras que se pueden marcar (una frase, no un párrafo). */
export const MAX_FIX_WORDS = 40;
/** Máximo de la ventana a reemplazar, en segundos. */
export const MAX_FIX_SECONDS = 15;
/** Cuánto se puede acelerar la voz nueva para que entre en el lugar de la vieja sin que suene rara. */
export const MAX_TEMPO = 1.2;
/** Más de esto de silencio sobrante se avisa: conviene cortarlo en la revisión. */
export const LONG_GAP_SECONDS = 0.8;
/** Margen del tramo que se manda a la sincronía de labios (antes y después de la ventana). */
export const LIPSYNC_PAD = 0.4;

export type FixWindow = { start: number; end: number };

/**
 * Ventana del original que se reemplaza: de la primera palabra a la última, más hasta 0,15 s del silencio anterior y
 * hasta 0,35 s del siguiente (sin pisar las palabras vecinas). Así la frase nueva tiene un poco de aire.
 */
export function fixWindow(words: Word[], from: number, to: number, duration: number): FixWindow | null {
  const a = words[from];
  const b = words[to];
  if (!a || !b || from > to) return null;
  const prevEnd = from > 0 ? (words[from - 1]?.end ?? 0) : 0;
  const nextStart = to + 1 < words.length ? (words[to + 1]?.start ?? duration) : duration;
  const start = Math.max(prevEnd, a.start - Math.min(0.15, Math.max(0, (a.start - prevEnd) / 2)));
  const end = Math.min(nextStart, b.end + Math.min(0.35, Math.max(0, (nextStart - b.end) * 0.6)), duration);
  if (!(end > start)) return null;
  return { start: round3(start), end: round3(end) };
}

export type FitResult =
  | { ok: true; tempo: number; gap: number }
  | { ok: false; reason: "too_long"; neededTempo: number };

/**
 * ¿Entra la voz nueva (`speechSeconds`, sin el silencio del principio y el final) en la ventana?
 * - Si es más larga, se acelera hasta ×1,2 (más que eso suena apurado).
 * - Si es más corta, va al principio de la ventana y el resto queda en silencio con el ambiente de la sala.
 */
export function fitSpeech(speechSeconds: number, window: FixWindow): FitResult {
  const slot = window.end - window.start;
  const tempo = speechSeconds / Math.max(0.05, slot);
  if (tempo > MAX_TEMPO) return { ok: false, reason: "too_long", neededTempo: round3(tempo) };
  return { ok: true, tempo: round3(Math.max(1, tempo)), gap: round3(Math.max(0, slot - speechSeconds)) };
}

/** Texto de las palabras marcadas (con las correcciones de subtítulos que ya tenga). */
export function spokenRange(words: Word[], from: number, to: number, corrections: Record<string, string> = {}): string {
  return words
    .slice(from, to + 1)
    .map((w) => corrections[String(w.id)] ?? w.text)
    .join(" ")
    .trim();
}

/** Palabra invisible para los ids que sobran cuando la frase nueva tiene menos palabras (no ocupa lugar ni se ve). */
export const HIDDEN_WORD = "⁠";

/**
 * Subtítulos de la frase corregida: reparte las palabras nuevas sobre los ids de las viejas (cada id es un tramo de
 * tiempo). Con más palabras nuevas que viejas, un id lleva varias (hasta 60 caracteres, lo que acepta la revisión);
 * con menos, los ids que sobran quedan con una palabra invisible.
 */
export function captionCorrections(from: number, to: number, newText: string): Record<string, string> {
  const ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const next = newText.split(/\s+/).filter(Boolean);
  const out: Record<string, string> = {};
  if (next.length === 0) return out;
  ids.forEach((id, i) => {
    const a = Math.floor((i * next.length) / ids.length);
    const b = Math.floor(((i + 1) * next.length) / ids.length);
    const chunk = next.slice(a, b).join(" ");
    out[String(id)] = (chunk || HIDDEN_WORD).slice(0, 60);
  });
  return out;
}

/** Tramo que se recorta para la sincronía de labios (la ventana con un margen, dentro del video). */
export function lipsyncClip(window: FixWindow, duration: number): FixWindow {
  return { start: round3(Math.max(0, window.start - LIPSYNC_PAD)), end: round3(Math.min(duration, window.end + LIPSYNC_PAD)) };
}

/** Frases que se superponen con otra ya corregida (no se permiten dos correcciones sobre las mismas palabras). */
export function overlaps(a: { fromWord: number; toWord: number }, b: { fromWord: number; toWord: number }): boolean {
  return a.fromWord <= b.toWord && b.fromWord <= a.toWord;
}

/** Inicio y fin de lo hablado según las marcas por palabra de HeyGen (sin el silencio de los bordes). */
export function speechSpan(duration: number, timestamps: { start: number; end: number }[] | null | undefined): { start: number; end: number } {
  if (!timestamps?.length) return { start: 0, end: duration };
  const start = Math.max(0, Math.min(...timestamps.map((t) => t.start)));
  const end = Math.min(duration, Math.max(...timestamps.map((t) => t.end)));
  return end > start ? { start: round3(start), end: round3(end) } : { start: 0, end: duration };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
