/**
 * Alinea la transcripción con el guion (si lo hay):
 * - corrige cómo se escribe una palabra en los subtítulos ("ia" → "IA", "clinica" → "clínica"),
 * - marca lo que se dijo fuera del guion (se marca, no se corta).
 * Alineación por programación dinámica sobre palabras normalizadas, con coincidencia aproximada.
 */
import { norm, scriptTokens, similarity } from "./text";
import type { Word } from "./types";

export type ScriptAlignment = {
  corrections: Record<string, string>;
  offScript: number[];
  /** Proporción de palabras de la transcripción que coinciden con el guion. */
  coverage: number;
};

const MAX_CELLS = 6_000_000;

function matches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return similarity(a, b) >= 0.75;
}

/** Forma "visible" para comparar escritura: sin puntuación, pero con tildes y mayúsculas. */
const visible = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "");

export function alignScript(words: Word[], script: string): ScriptAlignment {
  const tokens = scriptTokens(script);
  const empty = { corrections: {}, offScript: [], coverage: 0 };
  if (!tokens.length || !words.length) return empty;
  const n = words.length;
  const m = tokens.length;
  if (n * m > MAX_CELLS) return empty;
  const wn = words.map((w) => norm(w.text));

  // dp[i][j] = mejor alineación de words[i..] con tokens[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const diag = matches(wn[i]!, tokens[j]!.norm) ? dp[i + 1]![j + 1]! + 1 : 0;
      dp[i]![j] = Math.max(diag, dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const corrections: Record<string, string> = {};
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (matches(wn[i]!, tokens[j]!.norm) && dp[i]![j] === dp[i + 1]![j + 1]! + 1) {
      matched.add(i);
      const written = tokens[j]!.text;
      if (visible(written) !== visible(words[i]!.text)) {
        // Se conserva la puntuación de la transcripción y se toma la escritura del guion.
        const trail = words[i]!.text.match(/[.,;:?!…]+$/)?.[0] ?? "";
        corrections[String(words[i]!.id)] = written.replace(/[.,;:?!…]+$/, "") + trail;
      }
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }

  // Fuera del guion: tramos de 3 o más palabras seguidas sin coincidencia.
  const offScript: number[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 3) offScript.push(...run.map((k) => words[k]!.id));
    run = [];
  };
  for (let k = 0; k < n; k++) {
    if (matched.has(k)) flush();
    else run.push(k);
  }
  flush();
  return { corrections, offScript, coverage: matched.size / n };
}
