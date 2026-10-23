/**
 * Estudio de edición: cuentas de la línea de tiempo editable sobre el video final (sin React ni servidor).
 *
 * Los bloques del plan (b-roll, efectos, zooms) se guardan como rangos de palabras (`from_word`/`to_word`): cuando la
 * persona arrastra un bloque en segundos, aquí se resuelve a palabras ("imán" a los bordes de palabra), se respetan los
 * límites de cada cosa y se arman las marcas de corte. Así lo que se ve en la línea de tiempo es lo que guarda el plan.
 */
import { formatDuration } from "@/lib/format";
import { outputRange, type Timeline } from "./timeline";
import { FPS, type TimedWord } from "./types";

export type WordSpan = { from: number; to: number };
/** Un rango de palabras resuelto con sus bordes en el video final. */
export type SnappedSpan = WordSpan & { start: number; end: number };

/** Primer índice cuya palabra termina después de `t` (búsqueda binaria; las palabras van en orden de salida). */
function firstEndingAfter(words: TimedWord[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = words.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.end > t) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/** Índice de la palabra cuyo inicio queda más cerca de `t`. */
export function nearestStart(words: TimedWord[], t: number): number {
  if (!words.length) return -1;
  let best = 0;
  let dist = Infinity;
  const i = Math.max(0, firstEndingAfter(words, t) - 1);
  for (let k = Math.max(0, i - 2); k <= Math.min(words.length - 1, i + 3); k++) {
    const d = Math.abs(words[k]!.start - t);
    if (d < dist) {
      dist = d;
      best = k;
    }
  }
  return best;
}

/** Índice de la palabra cuyo final queda más cerca de `t`. */
export function nearestEnd(words: TimedWord[], t: number): number {
  if (!words.length) return -1;
  let best = 0;
  let dist = Infinity;
  const i = Math.max(0, firstEndingAfter(words, t) - 1);
  for (let k = Math.max(0, i - 2); k <= Math.min(words.length - 1, i + 3); k++) {
    const d = Math.abs(words[k]!.end - t);
    if (d < dist) {
      dist = d;
      best = k;
    }
  }
  return best;
}

/** Palabra que suena (o la próxima) en el segundo `t` del video final. */
export function wordAt(timeline: Pick<Timeline, "words">, t: number): TimedWord | null {
  const i = firstEndingAfter(timeline.words, t);
  return timeline.words[i] ?? timeline.words[timeline.words.length - 1] ?? null;
}

/**
 * Resuelve un tramo en segundos del video final a un rango de palabras: el inicio va al comienzo de palabra más cercano
 * y el final al final de palabra más cercano (mínimo una palabra). Si el tramo cruza un lugar donde el video cambia de
 * orden (el gancho que pasó al principio o un bloque movido), se acorta hasta donde sigue en orden.
 */
export function snapToWords(timeline: Pick<Timeline, "words">, t0: number, t1: number): SnappedSpan | null {
  const words = timeline.words;
  if (!words.length) return null;
  const i = nearestStart(words, Math.min(t0, t1));
  let j = Math.max(i, nearestEnd(words, Math.max(t0, t1)));
  // Solo hacia adelante en el orden del original.
  for (let k = i + 1; k <= j; k++) {
    if (words[k]!.id < words[k - 1]!.id) {
      j = k - 1;
      break;
    }
  }
  // El rango de ids tiene que verse en un solo tramo que empiece en la palabra elegida.
  for (; j >= i; j--) {
    const from = words[i]!.id;
    const to = words[j]!.id;
    const range = outputRange(timeline, from, to);
    if (range && Math.abs(range.start - words[i]!.start) < 0.01) return { from, to, start: range.start, end: range.end };
  }
  return null;
}

/**
 * Un tramo de unas `seconds` alrededor del cabezal (para agregar algo "aquí"): arranca en la palabra que suena y sigue
 * hasta llegar a la duración, cerrando en un final de frase si hay uno cerca.
 */
export function spanAround(timeline: Pick<Timeline, "words">, t: number, seconds: number): SnappedSpan | null {
  const words = timeline.words;
  if (!words.length) return null;
  const i = Math.min(words.length - 1, firstEndingAfter(words, t));
  let j = i;
  while (j + 1 < words.length && words[j + 1]!.id > words[j]!.id && words[j + 1]!.start - words[i]!.start < seconds) {
    j++;
    if (words[j]!.stop && words[j]!.end - words[i]!.start >= seconds * 0.6) break;
  }
  return snapToWords(timeline, words[i]!.start, words[j]!.end);
}

/** ¿Se pisan dos rangos de palabras? */
export const overlaps = (a: WordSpan, b: { from_word: number; to_word: number }) => a.from <= b.to_word && b.from_word <= a.to;

/** Una marca de corte en la línea de tiempo: dónde cae en el video final y qué palabras se sacaron ahí (si hay). */
export type CutMark = { at: number; removed: WordSpan | null; kind: "corte" | "pausa" | "gancho" | "orden" };

/** Marcas de corte entre tramos: palabras cortadas, pausas recortadas o el salto del gancho a su lugar. */
export function cutMarks(timeline: Pick<Timeline, "clips">, removed: Set<number>): CutMark[] {
  const out: CutMark[] = [];
  let acc = 0;
  timeline.clips.forEach((c, i) => {
    const prev = timeline.clips[i - 1];
    if (prev) {
      const at = Math.round(acc * 1000) / 1000;
      if (prev.role === "hook" && c.role === "body") out.push({ at, removed: null, kind: "gancho" });
      else if (c.firstWord > prev.lastWord + 1) {
        let from = -1;
        let to = -1;
        for (let id = prev.lastWord + 1; id < c.firstWord; id++) {
          if (!removed.has(id)) continue;
          if (from < 0) from = id;
          to = id;
        }
        out.push({ at, removed: from >= 0 ? { from, to } : null, kind: from >= 0 ? "corte" : "orden" });
      } else if (c.firstWord <= prev.lastWord) out.push({ at, removed: null, kind: "orden" });
      else out.push({ at, removed: null, kind: "pausa" });
    }
    acc += (c.endFrame - c.startFrame) / FPS;
  });
  return out;
}

/** Comienzo de cada tramo en el video final. */
export function clipOffsets(timeline: Pick<Timeline, "clips">): number[] {
  let acc = 0;
  return timeline.clips.map((c) => {
    const s = acc;
    acc += (c.endFrame - c.startFrame) / FPS;
    return s;
  });
}

/**
 * Límites para arrastrar un bloque: no sale del video, no pasa por encima de los bloques vecinos (`obstacles`) y respeta
 * la duración mínima y máxima. `mode` dice qué se arrastra: el bloque entero o uno de sus bordes.
 */
export function clampDrag(input: {
  mode: "move" | "start" | "end";
  start: number;
  end: number;
  delta: number;
  duration: number;
  obstacles: { start: number; end: number }[];
  min?: number;
  max?: number;
}): { start: number; end: number } {
  const { mode, start, end, delta, duration } = input;
  const min = Math.max(0.1, input.min ?? 0.2);
  const max = input.max ?? Infinity;
  // Vecinos: lo que termina antes del bloque y lo que empieza después.
  const left = Math.max(0, ...input.obstacles.filter((o) => o.end <= start + 0.001).map((o) => o.end));
  const right = Math.min(duration, ...input.obstacles.filter((o) => o.start >= end - 0.001).map((o) => o.start));
  if (mode === "move") {
    const len = end - start;
    const s = Math.max(left, Math.min(right - len, start + delta));
    return { start: s, end: s + len };
  }
  if (mode === "start") {
    const s = Math.max(left, end - max, Math.min(end - min, start + delta));
    return { start: s, end };
  }
  const e = Math.min(right, start + max, Math.max(start + min, end + delta));
  return { start, end: e };
}

/** "0:12,4" para la línea de tiempo (minutos, segundos y décimas). */
export function timeLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  const tenths = Math.floor((s * 10) % 10);
  return `${formatDuration(Math.floor(s))},${tenths}`;
}

/** Duración corta en segundos con coma ("2,4 s"). */
export const secondsLabel = (s: number) => `${Math.max(0, s).toFixed(1).replace(".", ",")} s`;

/** Divide un rango de palabras en la palabra `at` (queda en el segundo tramo). null si no se puede partir ahí. */
export function splitSpan(span: WordSpan, at: number): [WordSpan, WordSpan] | null {
  if (at <= span.from || at > span.to) return null;
  return [
    { from: span.from, to: at - 1 },
    { from: at, to: span.to },
  ];
}

/**
 * Un tramo libre en el cabezal para agregar algo: el de `spanAround`, acortado para que termine antes del próximo bloque
 * que no se puede pisar. null si el cabezal cae encima de otro bloque o si no queda la duración mínima.
 */
export function fitSpan(timeline: Pick<Timeline, "words">, t: number, seconds: number, min: number, blocked: { from_word: number; to_word: number }[]): SnappedSpan | null {
  const span = spanAround(timeline, t, seconds);
  if (!span) return null;
  const hit = blocked.filter((b) => overlaps(span, b));
  if (!hit.length) return span;
  if (hit.some((b) => b.from_word <= span.from)) return null;
  const first = Math.min(...hit.map((b) => b.from_word));
  const inside = timeline.words.filter((w) => w.id >= span.from && w.id < first && w.start >= span.start - 0.001);
  const last = inside[inside.length - 1];
  if (!last) return null;
  const short = snapToWords(timeline, span.start, last.end);
  return short && short.end - short.start >= min ? short : null;
}
