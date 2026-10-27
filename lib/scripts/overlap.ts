/**
 * Control de copia para "Copia este reel": detecta frases que un texto nuevo comparte palabra por palabra con
 * la transcripción del original. La regla es simple y estricta: ninguna secuencia de más de 6 palabras seguidas
 * (7 o más) puede repetirse. Se compara sin tildes, sin mayúsculas y sin signos, para que cambiar una coma no
 * alcance para "esquivarla". No importa nada de servidor: lo usan la app y las pruebas.
 */
export const MAX_SHARED_WORDS = 6;

/** Palabras normalizadas: minúsculas, sin tildes ni signos (la ñ queda como n: no cambia el resultado). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Tramos de `candidate` que aparecen tal cual en `source` con más de `max` palabras seguidas.
 * Devuelve cada tramo máximo una sola vez (como texto normalizado), del más largo al más corto.
 */
export function sharedRuns(candidate: string, source: string, max = MAX_SHARED_WORDS): string[] {
  const n = max + 1;
  const a = tokens(candidate);
  const b = tokens(source);
  if (a.length < n || b.length < n) return [];
  const grams = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(" "));
  const runs: string[] = [];
  let i = 0;
  while (i + n <= a.length) {
    if (!grams.has(a.slice(i, i + n).join(" "))) {
      i++;
      continue;
    }
    // Extiende el tramo mientras cada ventana siga apareciendo en el original.
    let end = i + n;
    while (end < a.length && grams.has(a.slice(end - n + 1, end + 1).join(" "))) end++;
    runs.push(a.slice(i, end).join(" "));
    i = end;
  }
  return [...new Set(runs)].sort((x, y) => y.length - x.length);
}

/** Frases compartidas en varios textos (cada campo por separado: no se pegan campos entre sí). */
export function sharedRunsIn(texts: string[], source: string, max = MAX_SHARED_WORDS): string[] {
  return [...new Set(texts.flatMap((t) => sharedRuns(t, source, max)))];
}

/**
 * Tapa con "…" las frases de `text` que repiten el original (para textos descriptivos del análisis, nunca
 * para el guion: el guion se vuelve a escribir). Trabaja sobre las palabras originales de `text`.
 */
export function redactShared(text: string, source: string, max = MAX_SHARED_WORDS): string {
  const n = max + 1;
  const words = text.split(/(\s+)/);
  const plain = words.map((w) => (/^\s+$/.test(w) ? null : tokens(w).join(" ")));
  const idx = plain.flatMap((p, i) => (p ? [i] : []));
  const seq = idx.map((i) => plain[i]!);
  const b = tokens(source);
  if (seq.length < n || b.length < n) return text;
  const grams = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(" "));
  const hide = new Set<number>();
  for (let i = 0; i + n <= seq.length; i++) {
    if (grams.has(seq.slice(i, i + n).join(" "))) for (let k = i; k < i + n; k++) hide.add(k);
  }
  if (!hide.size) return text;
  const out: string[] = [];
  let hiding = false;
  idx.forEach((wordIndex, k) => {
    if (hide.has(k)) {
      if (!hiding) out.push("…");
      hiding = true;
    } else {
      out.push(words[wordIndex]!);
      hiding = false;
    }
  });
  return out.join(" ");
}
