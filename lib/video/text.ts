/** Utilidades de texto para comparar palabras habladas sin importar mayúsculas, tildes ni puntuación. */

/** "¿Cómo," → "como". */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Quita la puntuación de los bordes que no se muestra en subtítulos (comas, puntos), conserva ¿? ¡!. */
export function captionText(text: string): string {
  return text.replace(/^[\s"'“”«»(\[]+|[\s"'“”«»)\].,;:…]+$/g, "").trim();
}

/** true si la palabra cierra una frase (para cortar bloques de subtítulos y armar frases). */
export function endsSentence(text: string): boolean {
  return /[.?!…]["'”»)]*$/.test(text.trim());
}

/** Distancia de edición, para comparar con el guion. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Parecido entre 0 y 1. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Palabras del guion en orden, con su forma escrita (sin puntuación de borde). */
export function scriptTokens(script: string): { text: string; norm: string }[] {
  return script
    .split(/\s+/)
    .map((t) => ({ text: captionText(t), norm: norm(t) }))
    .filter((t) => t.norm.length > 0);
}
