/**
 * Puntaje de los momentos de un video largo ("Clips desde un video largo"). Código puro: lo usan la app,
 * el simulador de IA y las pruebas (tests/clips.test.mts).
 *
 * El puntaje es RELATIVO dentro del video: compara sus momentos entre sí. No es una probabilidad de nada.
 * Combina reglas medibles (este archivo) con el criterio de Claude (idea completa, gancho, cierre) y, si la
 * persona ya tiene datos en Métricas, con el ranking de sus tipos de gancho.
 */
import { sentences, type Sentence } from "@/lib/ai/prompts/editor";
import type { HookCategory } from "@/lib/ai/prompts/metricas";
import { endsSentence, norm } from "@/lib/video/text";
import type { Word } from "@/lib/video/types";

export const CLIP_MIN_SECONDS = 30;
export const CLIP_MAX_SECONDS = 90;
/** Largo ideal de un short que se entiende solo. */
export const CLIP_IDEAL: readonly [number, number] = [40, 65];

/** Lo que pesa cada regla en el puntaje de reglas (suman 1). */
export const RULE_WEIGHTS = { hook: 0.25, duration: 0.15, density: 0.15, pauses: 0.15, questions: 0.1, numbers: 0.1, ending: 0.1 } as const;
export type RuleKey = keyof typeof RULE_WEIGHTS;
export type RuleParts = Record<RuleKey, number>;

/** Cuánto pesa cada fuente en el puntaje final (cuando hay IA). */
export const FINAL_WEIGHTS = { rules: 0.45, ai: 0.55 } as const;

export type RuleFeatures = {
  seconds: number;
  words: number;
  wordsPerSecond: number;
  /** Segundos de pausas de más de 0,7 s dentro del tramo. */
  pauseSeconds: number;
  /** Pausas de más de 1,5 s. */
  longPauses: number;
  questions: number;
  numbers: number;
  hookText: string;
  hookSeconds: number;
  hookType: HookCategory;
  /** Arranca con "y", "pero", "entonces"…: suele necesitar lo que se dijo antes. */
  startsWithConnector: boolean;
  /** Termina en un cierre de frase (punto o signo) o en una pausa clara. */
  endsClean: boolean;
};

export type VideoStats = { wordsPerSecond: number; duration: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ─── Texto ─────────────────────────────────────────────────────────────────

const CONNECTORS = new Set(["y", "pero", "entonces", "porque", "osea", "ademas", "tambien", "eso", "asi", "ahi", "bueno", "este", "eh", "em", "mm", "ehm", "o", "ni", "pues", "and", "but", "so", "because"]);
const NUMBER_WORDS = new Set([
  "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "quince", "veinte", "treinta", "cuarenta", "cincuenta",
  "sesenta", "setenta", "ochenta", "noventa", "cien", "ciento", "doscientos", "trescientos", "quinientos", "mil", "millon", "millones", "porciento", "mitad", "doble", "triple",
]);
const STRONG_HOOK = /\b(nadie|error(es)?|secreto|deja de|nunca|la verdad|el problema|la razón|por qué|c[oó]mo (hacer|lograr|conseguir)|si (t[uú] )?(quieres|tienes|eres|est[aá]s)|te voy a (contar|mostrar|explicar)|lo que (nadie|nunca)|aprend[ií]|no es (que|el|la|por)|en realidad|todo el mundo|la mayor[ií]a)\b/i;

/** Minúsculas sin tildes (así `\b` funciona con "empecé", "aprendí"…); conserva signos y dígitos. */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Una palabra es una cifra si tiene dígitos o es un número dicho con letras ("tres", "mil"). */
export function isNumberWord(text: string): boolean {
  return /\d/.test(text) || NUMBER_WORDS.has(norm(text)) || /%/.test(text);
}

/** Tipo de gancho por reglas (las mismas categorías del ranking de Métricas). Claude lo confirma después. */
export function classifyHook(text: string): HookCategory {
  const t = fold(text);
  if (/\b(\d+|dos|tres|cuatro|cinco|seis|siete|diez)\s+(cosas|pasos|errores|formas|maneras|claves|razones|reglas|trucos|tips)\b/.test(t)) return "lista";
  if (/[¿?]/.test(t)) return "pregunta";
  if (/(\d|mil|millones|doble|triple)/.test(t) && /\b(pas[eéó]|gan[eéó]|logr[eéó]|sub[ií]|factur|duplic|tripl|de \S+ a \S+|vend[ií])/.test(t)) return "resultado";
  if (/\b(cuando (yo|ten[ií]a|empec[eé])|hace \S+ años|mi (primer|historia)|me pas[oó]|un d[ií]a)\b/.test(t)) return "historia";
  if (/\b(no es|en realidad|deja de|todos (creen|piensan|dicen)|mito|la verdad es)\b/.test(t)) return "contraste";
  if (/\b(si (t[uú] )?(est[aá]s|tienes|sientes|te)|te (cuesta|frustra)|problema|cansad)\b/.test(t)) return "dolor";
  if (/\b(secreto|nadie|descubr|esto cambi|lo que (nadie|pocos))\b/.test(t)) return "curiosidad";
  return "otro";
}

// ─── Estadísticas del video ───────────────────────────────────────────────

/** Ritmo de habla del video completo (sin las pausas de más de 1,5 s), para comparar cada tramo con su propio video. */
export function videoStats(words: Word[]): VideoStats {
  if (!words.length) return { wordsPerSecond: 2.5, duration: 0 };
  let speaking = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    speaking += Math.max(0.05, w.end - w.start);
    if (next) speaking += Math.min(1.5, Math.max(0, next.start - w.end));
  }
  return { wordsPerSecond: words.length / Math.max(1, speaking), duration: words[words.length - 1]!.end };
}

// ─── Un tramo ──────────────────────────────────────────────────────────────

/** Mide un tramo de palabras [from, to] (índices de `words`, que coinciden con los ids). */
export function analyzeRange(words: Word[], from: number, to: number): RuleFeatures {
  const slice = words.slice(from, to + 1);
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  const seconds = Math.max(0.1, last.end - first.start);
  let pauseSeconds = 0;
  let longPauses = 0;
  let questions = 0;
  let numbers = 0;
  for (let i = 0; i < slice.length; i++) {
    const w = slice[i]!;
    const next = slice[i + 1];
    if (next) {
      const gap = next.start - w.end;
      if (gap > 0.7) pauseSeconds += gap - 0.3;
      if (gap > 1.5) longPauses++;
    }
    if (/\?["'”»)]*$/.test(w.text)) questions++;
    if (isNumberWord(w.text)) numbers++;
  }
  // Gancho: la primera frase (si es muy corta, se suma la siguiente) hasta unos 12 s.
  let hookEnd = 0;
  for (let i = 0; i < slice.length; i++) {
    hookEnd = i;
    const elapsed = slice[i]!.end - first.start;
    const next = slice[i + 1];
    const boundary = endsSentence(slice[i]!.text) || (next ? next.start - slice[i]!.end > 0.4 : true);
    if ((boundary && elapsed >= 3) || elapsed >= 12) break;
  }
  const hookText = slice.slice(0, hookEnd + 1).map((w) => w.text).join(" ");
  const nextWord = words[to + 1];
  return {
    seconds: r2(seconds),
    words: slice.length,
    wordsPerSecond: r2(slice.length / seconds),
    pauseSeconds: r2(pauseSeconds),
    longPauses,
    questions,
    numbers,
    hookText,
    hookSeconds: r2(slice[hookEnd]!.end - first.start),
    hookType: classifyHook(hookText),
    startsWithConnector: CONNECTORS.has(norm(first.text)),
    endsClean: endsSentence(last.text) || !nextWord || nextWord.start - last.end >= 0.6,
  };
}

/** Cada regla de 0 a 1. */
export function ruleParts(f: RuleFeatures, stats: VideoStats): RuleParts {
  const [lo, hi] = CLIP_IDEAL;
  const d = f.seconds;
  const duration =
    d >= lo && d <= hi ? 1 : d >= CLIP_MIN_SECONDS && d < lo ? 0.6 + (0.4 * (d - CLIP_MIN_SECONDS)) / (lo - CLIP_MIN_SECONDS) : d > hi && d <= CLIP_MAX_SECONDS ? 1 - (0.4 * (d - hi)) / (CLIP_MAX_SECONDS - hi) : 0.3;
  const ratio = f.wordsPerSecond / Math.max(0.5, stats.wordsPerSecond);
  let hook = 0.4;
  if (f.hookType === "pregunta") hook += 0.2;
  if (/\d|mil|millones/.test(f.hookText)) hook += 0.15;
  if (STRONG_HOOK.test(fold(f.hookText))) hook += 0.2;
  if (f.hookType !== "otro" && f.hookType !== "pregunta") hook += 0.1;
  if (f.startsWithConnector) hook -= 0.35;
  if (f.hookSeconds > 14) hook -= 0.15;
  return {
    hook: r2(clamp01(hook)),
    duration: r2(clamp01(duration)),
    density: r2(clamp01(0.5 + (ratio - 1) * 1.5)),
    pauses: r2(clamp01(1 - (f.pauseSeconds / d) * 5 - f.longPauses * 0.1)),
    questions: r2(clamp01(f.questions * 0.34)),
    numbers: r2(clamp01(f.numbers * 0.25)),
    ending: f.endsClean ? 1 : 0.4,
  };
}

/** Puntaje de reglas de 0 a 1 (suma ponderada). */
export function ruleScore(parts: RuleParts): number {
  let total = 0;
  for (const key of Object.keys(RULE_WEIGHTS) as RuleKey[]) total += parts[key] * RULE_WEIGHTS[key];
  return Math.round(total * 1000) / 1000;
}

// ─── Ranking de ganchos de la persona ─────────────────────────────────────

export type HookRankingEntry = { type: HookCategory; medianScore: number; count: number };

/**
 * Puntos extra (o en contra) según cómo le rinde a la persona ese tipo de gancho en sus redes ("× su mediana",
 * del ranking de Métricas). Sin datos, 0. Entre -5 y +8 puntos: ayuda a desempatar, no decide solo.
 */
export function rankingBonus(type: HookCategory | null | undefined, ranking: HookRankingEntry[]): number {
  if (!type || type === "otro") return 0;
  const entry = ranking.find((r) => r.type === type && r.count >= 3);
  if (!entry) return 0;
  return Math.round(Math.max(-5, Math.min(8, (entry.medianScore - 1) * 8)) * 10) / 10;
}

export type ScoreDetail = {
  version: 1;
  /** Puntaje de reglas (0 a 100) y cada regla (0 a 1). */
  rules: number;
  parts: RuleParts;
  features: RuleFeatures;
  /** Criterio de Claude (0 a 100); null si se eligió sin IA. */
  ai: number | null;
  /** Puntos por el ranking de ganchos de la persona. */
  bonus: number;
};

/** Puntaje final de 1 a 99. Sin IA, solo reglas (más el ranking). */
export function finalScore(input: { rules: number; ai: number | null; bonus: number }): number {
  const base = input.ai == null ? input.rules * 100 : 100 * (FINAL_WEIGHTS.rules * input.rules + FINAL_WEIGHTS.ai * (Math.max(0, Math.min(100, input.ai)) / 100));
  return Math.round(Math.max(1, Math.min(99, base + input.bonus)));
}

export function scoreRange(words: Word[], from: number, to: number, stats: VideoStats, ai: number | null, ranking: HookRankingEntry[], hookType?: HookCategory | null): { score: number; detail: ScoreDetail } {
  const features = analyzeRange(words, from, to);
  const parts = ruleParts(features, stats);
  const rules = ruleScore(parts);
  const bonus = rankingBonus(hookType ?? features.hookType, ranking);
  return { score: finalScore({ rules, ai, bonus }), detail: { version: 1, rules: Math.round(rules * 100), parts, features, ai, bonus } };
}

// ─── Candidatos ───────────────────────────────────────────────────────────

export type ClipCandidate = {
  id: string;
  from: number;
  to: number;
  start: number;
  end: number;
  rule: number;
  features: RuleFeatures;
  parts: RuleParts;
};

/** Cuántos clips buscar: 5 en un video corto, hasta 10 en uno de más de una hora. */
export function targetClipCount(durationSeconds: number): number {
  return Math.max(5, Math.min(10, 5 + Math.floor(durationSeconds / 60 / 12)));
}

/**
 * Tramos de 30 a 90 s que empiezan y terminan en un límite de frase, con su puntaje de reglas. Se eligen los mejores
 * sin que se pisen (supresión de no máximos), así quedan repartidos por el video. Son los que ve Claude.
 */
export function generateCandidates(words: Word[], options: { limit?: number; min?: number; max?: number } = {}): ClipCandidate[] {
  const min = options.min ?? CLIP_MIN_SECONDS;
  const max = options.max ?? CLIP_MAX_SECONDS;
  const limit = options.limit ?? 24;
  if (words.length < 10) return [];
  const stats = videoStats(words);
  const frases: Sentence[] = sentences(words);
  const all: Omit<ClipCandidate, "id">[] = [];
  for (let i = 0; i < frases.length; i++) {
    const a = frases[i]!;
    for (let j = i; j < frases.length; j++) {
      const b = frases[j]!;
      const seconds = b.end - a.start;
      if (seconds > max) break;
      if (seconds < min) continue;
      const features = analyzeRange(words, a.from, b.to);
      const parts = ruleParts(features, stats);
      all.push({ from: a.from, to: b.to, start: a.start, end: b.end, rule: ruleScore(parts), features, parts });
    }
  }
  all.sort((x, y) => y.rule - x.rule || x.start - y.start);
  const picked: Omit<ClipCandidate, "id">[] = [];
  for (const c of all) {
    if (picked.length >= limit) break;
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  return picked.sort((x, y) => x.start - y.start).map((c, i) => ({ ...c, id: `C${i + 1}` }));
}

// ─── Bordes del clip ──────────────────────────────────────────────────────

/** Segundos del clip con un margen corto antes de la primera palabra y después de la última, sin tocar las vecinas. */
export function clipBounds(words: Word[], from: number, to: number, duration: number): { start: number; end: number } {
  const first = words[from]!;
  const last = words[to]!;
  const prev = words[from - 1];
  const next = words[to + 1];
  const start = Math.max(0, prev ? Math.max(prev.end + 0.02, first.start - 0.15) : first.start - 0.15);
  const end = Math.min(duration || last.end + 0.3, next ? Math.min(next.start - 0.02, last.end + 0.3) : last.end + 0.3);
  return { start: Math.round(Math.min(start, first.start) * 1000) / 1000, end: Math.round(Math.max(end, last.end) * 1000) / 1000 };
}

/** Margen de la vista previa (y del reencuadre) a cada lado: hasta dónde se pueden mover el inicio y el fin. */
export const WINDOW_MARGIN = 20;

export function previewWindow(start: number, end: number, duration: number, margin = WINDOW_MARGIN): { windowStart: number; windowEnd: number } {
  return { windowStart: Math.max(0, Math.floor((start - margin) * 10) / 10), windowEnd: Math.min(duration, Math.ceil((end + margin) * 10) / 10) };
}

/** Límites de un tramo ajustado a mano (por palabra): dentro de la ventana y de 5 s a 3 min. */
export function validRange(words: Word[], from: number, to: number, window: { windowStart: number; windowEnd: number }): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= words.length || from > to) return "Ese tramo no es válido.";
  const a = words[from]!;
  const b = words[to]!;
  if (a.start < window.windowStart - 0.01 || b.end > window.windowEnd + 0.01) return `Puedes mover el inicio y el fin hasta ${WINDOW_MARGIN} segundos fuera del momento elegido.`;
  const seconds = b.end - a.start;
  if (seconds < 5) return "El clip tiene que durar al menos 5 segundos.";
  if (seconds > 180) return "El clip puede durar como mucho 3 minutos.";
  return null;
}
