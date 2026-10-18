/**
 * Candidatos a cortar, calculados sin IA a partir de la transcripción por palabra.
 *
 * - Toma repetida: la misma secuencia de 3 o más palabras vuelve a aparecer dentro de 30 s.
 *   Se descarta la primera toma (desde su inicio hasta justo antes de que empieza la siguiente).
 * - Arranque en falso: 1 a 3 palabras, una pausa y el reinicio con las mismas palabras.
 * - Muletillas aisladas: "eh", "em", "mmm"… siempre; "este", "bueno", "pues", "o sea" solo entre pausas.
 * - Silencios largos: pausas de 1 s o más (informativo: el timeline ya las acorta solo).
 *
 * Son candidatos con un nivel de confianza: Claude decide cuáles se cortan y la persona tiene la última palabra.
 */
import { norm } from "./text";
import type { RemovalReason, Word } from "./types";

export type CandidateKind = Extract<RemovalReason, "retake" | "false_start" | "filler" | "silence">;

export type Candidate = {
  id: string;
  kind: CandidateKind;
  from_word: number;
  to_word: number;
  start: number;
  end: number;
  confidence: number;
  note: string;
};

const RETAKE_WINDOW_SEC = 30;
const MAX_NGRAM = 8;
const MIN_NGRAM = 3;
const PAUSE = 0.25;
const LONG_SILENCE = 1.0;

/** Muletillas puras: no tienen otro significado. */
const PURE_FILLERS = new Set(["eh", "ehh", "eeh", "ehm", "em", "emm", "mm", "mmm", "mhm", "um", "uh", "uhm", "hmm", "ah", "ahh"]);
/** Palabras que a veces son muletilla y a veces no: solo cuentan aisladas entre pausas. */
const SOFT_FILLERS = new Set(["este", "bueno", "pues", "osea", "digamos", "tipo"]);
/** Palabras que no alcanzan para decir que una frase se repitió ("de la que", "y en el"). */
const STOPWORDS = new Set([
  "a", "al", "de", "del", "el", "la", "lo", "los", "las", "un", "una", "unos", "unas", "y", "o", "u", "e", "que", "en", "es", "se", "su", "sus",
  "no", "si", "me", "te", "le", "les", "mi", "tu", "por", "para", "con", "como", "mas", "pero", "ya", "muy", "eso", "esto", "esta", "este",
]);
/** Palabras que suelen aparecer cuando alguien se corrige antes de repetir la toma. */
const CORRECTION_MARKERS = new Set(["perdon", "perdona", "espera", "corta", "otravez", "denuevo", "repito", "mal"]);

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function gapBefore(words: Word[], i: number): number {
  return i <= 0 ? Infinity : words[i]!.start - words[i - 1]!.end;
}
function gapAfter(words: Word[], i: number): number {
  return i >= words.length - 1 ? Infinity : words[i + 1]!.start - words[i]!.end;
}

function sameSeq(n: string[], a: number, b: number, len: number): boolean {
  for (let k = 0; k < len; k++) if (!n[a + k] || n[a + k] !== n[b + k]) return false;
  return true;
}

/** Cuántas veces aparece una secuencia en el guion (para reforzar una toma repetida). */
function countInScript(scriptNorm: string[], seq: string[]): number {
  let count = 0;
  for (let i = 0; i + seq.length <= scriptNorm.length; i++) {
    let ok = true;
    for (let k = 0; k < seq.length; k++) if (scriptNorm[i + k] !== seq[k]) { ok = false; break; }
    if (ok) count++;
  }
  return count;
}

function detectRetakes(words: Word[], n: string[], scriptNorm: string[] | null): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  let i = 0;
  while (i < words.length) {
    let found: { len: number; j: number } | null = null;
    for (let len = Math.min(MAX_NGRAM, words.length - i); len >= MIN_NGRAM && !found; len--) {
      const seq = n.slice(i, i + len);
      if (seq.some((t) => !t) || seq.every((t) => STOPWORDS.has(t))) continue;
      for (let j = i + len; j + len <= words.length && words[j]!.start - words[i]!.start <= RETAKE_WINDOW_SEC; j++) {
        if (sameSeq(n, i, j, len)) {
          found = { len, j };
          break;
        }
      }
    }
    if (!found) {
      i++;
      continue;
    }
    const { len, j } = found;
    const spanWords = j - i;
    const spanSec = words[j]!.start - words[i]!.start;
    const between = n.slice(i + len, j);
    let confidence = 0.45 + Math.min(0.24, 0.08 * (len - MIN_NGRAM));
    // Casi toda toma repetida tiene una pausa antes de volver a empezar; sin pausa suele ser una repetición a propósito.
    confidence += gapBefore(words, j) >= 0.35 ? 0.2 : -0.1;
    if (spanWords <= len + 6) confidence += 0.1;
    if (spanSec > 15) confidence -= 0.2;
    if (between.some((t) => CORRECTION_MARKERS.has(t)) || between.join("").includes("otravez")) confidence += 0.1;
    if (scriptNorm && countInScript(scriptNorm, n.slice(i, i + len)) === 1) confidence += 0.15;
    out.push({
      kind: "retake",
      from_word: i,
      to_word: j - 1,
      start: words[i]!.start,
      end: words[j - 1]!.end,
      confidence: round2(clamp(confidence, 0.3, 0.97)),
      note: `Repite «${words.slice(i, i + len).map((w) => w.text).join(" ")}» ${round2(spanSec)} s después; queda la última toma.`,
    });
    i = j; // la toma nueva puede volver a repetirse: gana la última completa
  }
  return out;
}

function detectFalseStarts(words: Word[], n: string[]): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  const push = (i: number, k: number, confidence: number) =>
    out.push({
      kind: "false_start",
      from_word: i,
      to_word: k,
      start: words[i]!.start,
      end: words[k]!.end,
      confidence,
      note: `Arranque en falso: «${words.slice(i, k + 1).map((w) => w.text).join(" ")}» y vuelve a empezar.`,
    });
  for (let k = 0; k < words.length - 1; k++) {
    if (gapAfter(words, k) < PAUSE) continue;
    let found = false;
    // 1) El fragmento (1 a 3 palabras, después de una pausa) se repite igual: "Esto es… Esto es lo que…".
    for (let runLen = 3; runLen >= 1 && !found; runLen--) {
      const i = k - runLen + 1;
      if (i < 0 || k + runLen >= words.length) continue;
      if (!sameSeq(n, i, k + 1, runLen)) continue;
      if (i > 0 && gapBefore(words, i) < 0.2) continue;
      if (runLen === 1 && STOPWORDS.has(n[i]!) && gapAfter(words, k) < 0.4) continue;
      push(i, k, 0.85);
      found = true;
    }
    // 2) La última palabra quedó cortada y es el comienzo de la siguiente: "con… contarte".
    if (!found && n[k]!.length >= 3 && n[k + 1]!.length > n[k]!.length && n[k + 1]!.startsWith(n[k]!)) {
      push(k, k, 0.8);
    }
  }
  return out;
}

function detectFillers(words: Word[], n: string[]): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const token = n[i]!;
    const isolated = gapBefore(words, i) >= 0.2 && gapAfter(words, i) >= 0.2;
    if (w.filler || PURE_FILLERS.has(token)) {
      out.push({ kind: "filler", from_word: i, to_word: i, start: w.start, end: w.end, confidence: w.filler ? 0.95 : 0.9, note: `Muletilla «${w.text}».` });
    } else if (token === "o" && n[i + 1] === "sea" && gapBefore(words, i) >= 0.2 && gapAfter(words, i + 1) >= 0.2) {
      out.push({ kind: "filler", from_word: i, to_word: i + 1, start: w.start, end: words[i + 1]!.end, confidence: 0.65, note: "Muletilla «o sea» entre pausas." });
      i++;
    } else if (SOFT_FILLERS.has(token) && isolated) {
      out.push({ kind: "filler", from_word: i, to_word: i, start: w.start, end: w.end, confidence: 0.6, note: `«${w.text}» suelto entre pausas.` });
    }
  }
  return out;
}

function detectSilences(words: Word[]): Omit<Candidate, "id">[] {
  const out: Omit<Candidate, "id">[] = [];
  for (let k = 0; k < words.length - 1; k++) {
    const gap = words[k + 1]!.start - words[k]!.end;
    if (gap >= LONG_SILENCE) {
      out.push({
        kind: "silence",
        from_word: k,
        to_word: k + 1,
        start: words[k]!.end,
        end: words[k + 1]!.start,
        confidence: 0.99,
        note: `Pausa de ${round2(gap)} s (se acorta sola).`,
      });
    }
  }
  return out;
}

const overlaps = (a: { from_word: number; to_word: number }, b: { from_word: number; to_word: number }) =>
  a.from_word <= b.to_word && b.from_word <= a.to_word;

/** Detecta los candidatos. `script` es opcional: si está, refuerza las tomas repetidas que el guion dice una sola vez. */
export function detectCandidates(words: Word[], options: { script?: string | null } = {}): Candidate[] {
  if (words.length === 0) return [];
  const n = words.map((w) => norm(w.text));
  const scriptNorm = options.script ? options.script.split(/\s+/).map(norm).filter(Boolean) : null;

  const retakes = detectRetakes(words, n, scriptNorm);
  const falseStarts = detectFalseStarts(words, n).filter((c) => !retakes.some((r) => overlaps(r, c)));
  const fillers = detectFillers(words, n).filter((c) => ![...retakes, ...falseStarts].some((r) => overlaps(r, c)));
  const silences = detectSilences(words);

  return [...retakes, ...falseStarts, ...fillers, ...silences]
    .sort((a, b) => a.from_word - b.from_word || a.to_word - b.to_word)
    .map((c, index) => ({ ...c, id: `C${index + 1}` }));
}

/** Candidatos que se cortarían sin IA (cuando Claude no está disponible): solo los muy seguros. */
export function confidentRemovals(candidates: Candidate[], threshold = 0.75) {
  return candidates.filter((c) => c.kind !== "silence" && c.confidence >= threshold);
}
