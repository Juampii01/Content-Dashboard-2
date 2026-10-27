/**
 * Orden de las partes del video que elige la persona a mano («Mover antes» / «Mover después» en el Estudio). Es una
 * lista de tramos de palabras del original, en el orden en que salen, que cubre todas las palabras una sola vez. La IA
 * nunca lo cambia. Sin orden propio (null), el video sale como se grabó.
 */
export type SeqRange = { from_word: number; to_word: number };

/** El orden guardado si es válido (cubre 0..n-1 sin huecos ni repetidos), o null. */
export function validSequence(wordCount: number, seq: SeqRange[] | null | undefined): [number, number][] | null {
  if (!seq?.length || wordCount <= 0) return null;
  const seen = new Uint8Array(wordCount);
  let total = 0;
  for (const r of seq) {
    if (!Number.isInteger(r.from_word) || !Number.isInteger(r.to_word) || r.from_word < 0 || r.to_word >= wordCount || r.from_word > r.to_word) return null;
    for (let id = r.from_word; id <= r.to_word; id++) {
      if (seen[id]) return null;
      seen[id] = 1;
      total++;
    }
  }
  return total === wordCount ? seq.map((r) => [r.from_word, r.to_word]) : null;
}

/** Une los tramos que siguen seguidos en el original; si queda el video entero en orden, devuelve null. */
export function normalizeSequence(wordCount: number, seq: [number, number][]): SeqRange[] | null {
  const out: [number, number][] = [];
  for (const r of seq) {
    const last = out.at(-1);
    if (last && last[1] + 1 === r[0]) last[1] = r[1];
    else out.push([r[0], r[1]]);
  }
  if (out.length === 1 && out[0]![0] === 0 && out[0]![1] === wordCount - 1) return null;
  return out.map(([from_word, to_word]) => ({ from_word, to_word }));
}

/** Corta los tramos en los puntos dados (cada punto es la primera palabra de una parte nueva). */
function splitAt(seq: [number, number][], points: Set<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of seq) {
    let start = a;
    for (let id = a + 1; id <= b; id++) {
      if (points.has(id)) {
        out.push([start, id - 1]);
        start = id;
      }
    }
    out.push([start, b]);
  }
  return out;
}

export type MoveResult = { ok: true; sequence: SeqRange[] | null } | { ok: false; error: string };

/**
 * Mueve una parte (el tramo de palabras elegido) un lugar antes o después: pasa del otro lado de la parte vecina que
 * todavía suena (las partes cortadas enteras se saltean). `splits` son los puntos donde la persona dividió el video.
 */
export function movePart(input: { wordCount: number; sequence: SeqRange[] | null; splits: number[]; removed: Set<number>; part: { from: number; to: number }; dir: -1 | 1 }): MoveResult {
  const n = input.wordCount;
  const { from, to } = input.part;
  if (n <= 0 || from < 0 || to >= n || from > to) return { ok: false, error: "Elige una parte del video." };
  const base = validSequence(n, input.sequence) ?? [[0, n - 1] as [number, number]];
  const units = splitAt(base, new Set([...input.splits, from, to + 1]));
  // La parte elegida: los tramos seguidos (en el orden actual) que van de `from` a `to`.
  const i = units.findIndex(([a]) => a === from);
  if (i < 0) return { ok: false, error: "No encontramos esa parte. Elígela otra vez en la pista Video." };
  let j = i;
  while (j < units.length && units[j]![1] < to) j++;
  if (j >= units.length || units[j]![1] !== to) return { ok: false, error: "Esa parte quedó repartida en lugares distintos: elige una parte a la vez." };
  const sounds = (u: [number, number]) => {
    for (let id = u[0]; id <= u[1]; id++) if (!input.removed.has(id)) return true;
    return false;
  };
  const block = units.slice(i, j + 1);
  const rest = [...units.slice(0, i), ...units.slice(j + 1)];
  let at: number;
  if (input.dir < 0) {
    let k = i - 1;
    while (k >= 0 && !sounds(rest[k]!)) k--;
    if (k < 0) return { ok: false, error: "Ya es la primera parte del video." };
    at = k;
  } else {
    let k = i;
    while (k < rest.length && !sounds(rest[k]!)) k++;
    if (k >= rest.length) return { ok: false, error: "Ya es la última parte del video." };
    at = k + 1;
  }
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return { ok: true, sequence: normalizeSequence(n, next) };
}
