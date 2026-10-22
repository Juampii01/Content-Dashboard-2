/**
 * Puntaje antes de publicar: compara un gancho y un guion con el historial real de la persona.
 *
 * Funciones puras (sin base ni sesión): sirven en el servidor, en el navegador y en las pruebas.
 * No es una "probabilidad de viralizar": cada número sale de comparar con sus propias piezas,
 * y si hay pocos datos se dice. El puntaje (0 a 100) usa una sola escala para todo:
 *   ×1 tu mediana = 50 · ×2 = 100 · ×0.5 = 0 (escala logarítmica, recortada).
 */

export type HookKind = "contraste" | "curiosidad" | "dolor" | "resultado" | "historia" | "pregunta" | "lista" | "otro";
export type ScoreFormat = "REEL" | "SHORT" | "YT_LONG" | "STORY";

/** Una pieza publicada, reducida a lo que el puntaje necesita. */
export type HistoryPiece = {
  id: string;
  platform: "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
  type: "REEL" | "CAROUSEL" | "IMAGE" | "VIDEO" | "SHORT";
  /** Tipo de gancho clasificado (null = sin clasificar). */
  hookType: HookKind | null;
  /** Primera frase útil (título o primera línea del caption). */
  text: string;
  durationSec: number | null;
  /** Veces su mediana (misma red y tipo). */
  perf: number;
  views: number | null;
};

export const hookKindLabel: Record<HookKind, string> = {
  contraste: "Contraste",
  curiosidad: "Curiosidad",
  dolor: "Dolor",
  resultado: "Resultado",
  historia: "Historia",
  pregunta: "Pregunta",
  lista: "Lista",
  otro: "Sin gancho claro",
};

/** Menos de esto no se calcula puntaje: se dice que faltan datos. */
export const MIN_PIECES = 8;
/** Desde aquí el puntaje se considera con datos suficientes. */
export const SOLID_PIECES = 25;
/** Mínimo de piezas para opinar sobre un tipo de gancho o un rango de duración. */
export const MIN_GROUP = 3;
/** Palabras por segundo al hablar (igual que lib/scripts/stats.ts). */
export const WORDS_PER_SECOND = 2.5;

/** Qué piezas del historial se comparan con cada formato de guion. */
export function poolFor(format: ScoreFormat): { platform: HistoryPiece["platform"]; type: HistoryPiece["type"] }[] {
  if (format === "YT_LONG") return [{ platform: "YOUTUBE", type: "VIDEO" }];
  return [
    { platform: "INSTAGRAM", type: "REEL" },
    { platform: "TIKTOK", type: "VIDEO" },
    { platform: "YOUTUBE", type: "SHORT" },
  ];
}

export function filterPool(history: HistoryPiece[], format: ScoreFormat): HistoryPiece[] {
  const pool = poolFor(format);
  return history.filter((p) => Number.isFinite(p.perf) && p.perf > 0 && pool.some((k) => k.platform === p.platform && k.type === p.type));
}

// ─── Utilidades ───────────────────────────────────────────────────────────

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Cuantil con interpolación lineal (q entre 0 y 1). */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** ×1 → 50, ×2 → 100, ×0.5 → 0. */
export function ratioToScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(50 + 50 * Math.log2(ratio))));
}

const STOPWORDS = new Set(
  "a al algo ante antes asi aun como con cual cuando de del desde donde el ella ellos en entre era eres es esa ese eso esta este esto estas estos fue ha hace hay la las le les lo los mas me mi mis muy nada ni no nos o otra otro para pero poco por porque que quien se sea si sin sobre solo son su sus tan te ti tu tus un una uno unos unas y ya yo the and you your to of in is".split(" "),
);

/** Minúsculas, sin tildes ni signos. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Palabras con contenido (sin conectores), con una raíz simple: se cortan plurales, la vocal final y terminaciones comunes. */
export function contentWords(text: string): Set<string> {
  const words = normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => w.replace(/(mente|ciones|cion|es|s)$/u, "").replace(/[aeo]$/u, "").slice(0, 7))
    .filter((w) => w.length >= 3);
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Rasgos de forma de una frase: si pregunta, si lleva una cifra, si le habla a "tú", y su largo. */
export function hookFeatures(text: string): { question: boolean; number: boolean; secondPerson: boolean; words: number } {
  const n = normalize(text);
  return {
    question: /[?¿]/.test(text),
    number: /\d/.test(text) || /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(n),
    secondPerson: /\b(tu|tus|te|ti|contigo|tienes|haces|quieres|puedes|estas|eres|sabes|necesitas)\b/.test(n),
    words: wordCount(text),
  };
}

/**
 * Qué tanto se parece un gancho a la primera frase de una pieza (0 a 1):
 * 50 % mismo tipo de gancho, 30 % palabras en común, 20 % misma forma (pregunta, cifra, "tú", largo).
 */
export function hookSimilarity(hook: { text: string; type: HookKind | null }, piece: Pick<HistoryPiece, "text" | "hookType">): number {
  const sameType = hook.type && hook.type !== "otro" && piece.hookType === hook.type ? 1 : 0;
  const words = jaccard(contentWords(hook.text), contentWords(piece.text));
  const a = hookFeatures(hook.text);
  const b = hookFeatures(piece.text);
  const shape = ((a.question === b.question ? 1 : 0) + (a.number === b.number ? 1 : 0) + (a.secondPerson === b.secondPerson ? 1 : 0) + (Math.abs(a.words - b.words) <= 4 ? 1 : 0)) / 4;
  return Math.round((0.5 * sameType + 0.3 * Math.min(1, words * 2) + 0.2 * shape) * 100) / 100;
}

// ─── Tipos de gancho ──────────────────────────────────────────────────────

export type HookTypeStat = { type: HookKind; label: string; count: number; median: number };

/** Mediana de "× tu mediana" por tipo de gancho (solo tipos con al menos MIN_GROUP piezas), de mejor a peor. */
export function hookTypeStats(pool: HistoryPiece[]): HookTypeStat[] {
  const groups = new Map<HookKind, number[]>();
  for (const p of pool) {
    if (!p.hookType || p.hookType === "otro") continue;
    groups.set(p.hookType, [...(groups.get(p.hookType) ?? []), p.perf]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length >= MIN_GROUP)
    .map(([type, v]) => ({ type, label: hookKindLabel[type], count: v.length, median: median(v)! }))
    .sort((a, b) => b.median - a.median);
}

// ─── Duración ─────────────────────────────────────────────────────────────

export type DurationBucket = { from: number; to: number | null; label: string; count: number; median: number | null };

const SHORT_EDGES = [0, 15, 30, 45, 60, 90];
const LONG_EDGES = [0, 240, 480, 720, 1200];

function bucketLabel(from: number, to: number | null, long: boolean): string {
  const f = (s: number) => (long ? `${Math.round(s / 60)} min` : `${s} s`);
  if (to == null) return `más de ${f(from)}`;
  if (from === 0) return `menos de ${f(to)}`;
  return long ? `${Math.round(from / 60)} a ${Math.round(to / 60)} min` : `${from} a ${to} s`;
}

/** Rendimiento por rango de duración (mediana de "× tu mediana" de las piezas de cada rango). */
export function durationBuckets(pool: HistoryPiece[], format: ScoreFormat): DurationBucket[] {
  const long = format === "YT_LONG";
  const edges = long ? LONG_EDGES : SHORT_EDGES;
  return edges.map((from, i) => {
    const to = edges[i + 1] ?? null;
    const perf = pool.filter((p) => p.durationSec != null && p.durationSec >= from && (to == null || p.durationSec < to)).map((p) => p.perf);
    return { from, to, label: bucketLabel(from, to, long), count: perf.length, median: perf.length >= MIN_GROUP ? median(perf) : null };
  });
}

export function bucketOf(buckets: DurationBucket[], seconds: number): DurationBucket {
  return buckets.find((b) => seconds >= b.from && (b.to == null || seconds < b.to)) ?? buckets[buckets.length - 1]!;
}

// ─── Puntaje ──────────────────────────────────────────────────────────────

export type ScoreInput = {
  hook: string;
  /** Tipo del gancho (lo asigna la IA al escribirlo o al volver a clasificarlo). */
  hookType: HookKind | null;
  /** Duración estimada del guion hablado, en segundos. */
  estimatedSeconds: number;
  format: ScoreFormat;
};

export type Confidence = "sin-datos" | "pocos" | "suficientes";

export type ScoreResult = {
  confidence: Confidence;
  /** Piezas del historial contra las que se compara. */
  poolSize: number;
  /** Piezas de ese grupo con el gancho clasificado. */
  classified: number;
  /** Tipos de gancho con al menos MIN_GROUP piezas, de mejor a peor. */
  hookTypes: HookTypeStat[];
  /** Piezas por tipo de gancho (también los que no llegan al mínimo). */
  hookTypeCounts: Partial<Record<HookKind, number>>;
  hook: {
    score: number | null;
    type: HookKind | null;
    typeLabel: string;
    /** Rendimiento de su tipo de gancho (null = no hay MIN_GROUP piezas de ese tipo). */
    typeStat: HookTypeStat | null;
    /** Puesto de su tipo entre los tipos con datos (1 = el mejor). */
    typeRank: number | null;
    bestType: HookTypeStat | null;
    /** Las piezas de sus mejores que más se le parecen. */
    similar: { piece: HistoryPiece; similarity: number }[];
    /** Cuántas de esas se parecen de verdad (similitud ≥ 0.5). */
    closeMatches: number;
    words: number;
    /** Largo típico de la primera frase de sus mejores piezas. */
    bestWords: number | null;
  };
  script: {
    score: number | null;
    estimatedSeconds: number;
    bucket: DurationBucket | null;
    bestBucket: DurationBucket | null;
    /** Rango de duración (entre el cuartil 1 y 3) de sus mejores piezas. */
    bestRange: { from: number; to: number } | null;
    buckets: DurationBucket[];
  };
  verdict: "arriba" | "parecido" | "abajo" | null;
  suggestions: string[];
};

/** Las mejores piezas del grupo: el 20 % de arriba por "× tu mediana" (mínimo 3, máximo 15). */
export function topPieces(pool: HistoryPiece[]): HistoryPiece[] {
  const sorted = [...pool].sort((a, b) => b.perf - a.perf);
  const n = Math.max(MIN_GROUP, Math.min(15, Math.round(sorted.length * 0.2)));
  return sorted.slice(0, n);
}

const fmtX = (v: number) => `×${(Math.round(v * 10) / 10).toFixed(1)}`;
const fmtSeconds = (s: number, long: boolean) => (long ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

export function computeScore(history: HistoryPiece[], input: ScoreInput): ScoreResult {
  const pool = filterPool(history, input.format);
  const long = input.format === "YT_LONG";
  const confidence: Confidence = pool.length < MIN_PIECES ? "sin-datos" : pool.length < SOLID_PIECES ? "pocos" : "suficientes";
  const type = input.hookType;
  const words = wordCount(input.hook);
  const buckets = durationBuckets(pool, input.format);
  const hookTypeCounts: Partial<Record<HookKind, number>> = {};
  for (const p of pool) if (p.hookType) hookTypeCounts[p.hookType] = (hookTypeCounts[p.hookType] ?? 0) + 1;
  const empty: ScoreResult = {
    confidence,
    poolSize: pool.length,
    classified: pool.filter((p) => p.hookType).length,
    hookTypes: [],
    hookTypeCounts,
    hook: { score: null, type, typeLabel: type ? hookKindLabel[type] : "Sin clasificar", typeStat: null, typeRank: null, bestType: null, similar: [], closeMatches: 0, words, bestWords: null },
    script: { score: null, estimatedSeconds: input.estimatedSeconds, bucket: null, bestBucket: null, bestRange: null, buckets },
    verdict: null,
    suggestions: [],
  };
  if (confidence === "sin-datos") return empty;

  // Gancho: rendimiento de su tipo y parecido con sus mejores piezas.
  const stats = hookTypeStats(pool);
  const typeStat = type ? (stats.find((s) => s.type === type) ?? null) : null;
  const typeRank = typeStat ? stats.indexOf(typeStat) + 1 : null;
  const bestType = stats[0] ?? null;
  const top = topPieces(pool);
  const similar = top
    .map((piece) => ({ piece, similarity: hookSimilarity({ text: input.hook, type }, piece) }))
    .sort((a, b) => b.similarity - a.similarity || b.piece.perf - a.piece.perf)
    .slice(0, 3);
  const closeMatches = similar.filter((s) => s.similarity >= 0.5).length;
  const bestWords = median(top.map((p) => wordCount(p.text)).filter((n) => n > 0));

  const typeScore = typeStat ? ratioToScore(typeStat.median) : null;
  // Parecido promedio con sus 3 mejores más cercanas, llevado a la misma escala (0.5 de parecido ≈ su mejor rendimiento).
  const topMedian = median(top.map((p) => p.perf)) ?? 1;
  const simAvg = similar.length ? similar.reduce((a, s) => a + s.similarity, 0) / similar.length : 0;
  const simScore = similar.length ? ratioToScore(1 + (topMedian - 1) * Math.min(1, simAvg / 0.5)) : null;
  const hookScore = typeScore != null && simScore != null ? Math.round(0.6 * typeScore + 0.4 * simScore) : (typeScore ?? simScore);

  // Guion: duración estimada contra la duración de lo que mejor le rinde.
  const withDuration = pool.filter((p) => p.durationSec != null);
  const bucket = withDuration.length >= MIN_PIECES ? bucketOf(buckets, input.estimatedSeconds) : null;
  const ranked = buckets.filter((b) => b.median != null).sort((a, b) => b.median! - a.median!);
  const bestBucket = withDuration.length >= MIN_PIECES ? (ranked[0] ?? null) : null;
  const topDur = topPieces(withDuration)
    .map((p) => p.durationSec!)
    .filter((d) => d > 0);
  const q1 = quantile(topDur, 0.25);
  const q3 = quantile(topDur, 0.75);
  const bestRange = topDur.length >= MIN_GROUP && q1 != null && q3 != null ? { from: Math.round(q1), to: Math.round(q3) } : null;
  const durationScore = bucket?.median != null ? ratioToScore(bucket.median) : null;
  const parts = [hookScore, durationScore].filter((v): v is number => v != null);
  const scriptScore = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  const overall = scriptScore ?? hookScore;
  const verdict = overall == null ? null : overall >= 62 ? "arriba" : overall >= 42 ? "parecido" : "abajo";

  // Sugerencias concretas (máximo 2), de la que más mueve la aguja a la que menos.
  const suggestions: string[] = [];
  if (!type || type === "otro") {
    suggestions.push(
      bestType
        ? `No se nota un tipo de gancho claro. Tus ganchos de ${bestType.label.toLowerCase()} rinden ${fmtX(bestType.median)} tu mediana: abre con uno así.`
        : "No se nota un tipo de gancho claro: abre con un contraste, un resultado concreto o una pregunta directa.",
    );
  } else if (bestType && bestType.type !== type && (typeStat == null || bestType.median >= typeStat.median * 1.25)) {
    const example = top.find((p) => p.hookType === bestType.type);
    suggestions.push(
      `${typeStat ? `Tus ganchos de ${typeStat.label.toLowerCase()} rinden ${fmtX(typeStat.median)}` : `Todavía tienes pocos ganchos de ${hookKindLabel[type].toLowerCase()} medidos`}; los de ${bestType.label.toLowerCase()} rinden ${fmtX(bestType.median)}. Prueba reescribirlo como ${bestType.label.toLowerCase()}${example ? `, como en «${example.text.slice(0, 90)}»` : ""}.`,
    );
  }
  if (bucket && bestBucket && bucket !== bestBucket && bestBucket.median != null && (bucket.median == null || bestBucket.median >= bucket.median * 1.2)) {
    const target = bestBucket.to != null && input.estimatedSeconds >= bestBucket.to ? bestBucket.to - (long ? 30 : 3) : null;
    const cutWords = target != null ? Math.max(5, Math.round((input.estimatedSeconds - target) * WORDS_PER_SECOND)) : null;
    suggestions.push(
      `Tu guion dura ≈${fmtSeconds(input.estimatedSeconds, long)}. Tus piezas de ${bestBucket.label} rinden ${fmtX(bestBucket.median)}${bucket.median != null ? ` y las de ${bucket.label}, ${fmtX(bucket.median)}` : ""}.${cutWords ? ` Recorta unas ${cutWords} palabras.` : " Puedes desarrollarlo un poco más."}`,
    );
  }
  if (bestWords != null && words > Math.max(14, bestWords * 1.5)) {
    suggestions.push(`Tu gancho tiene ${words} palabras y la primera frase de tus mejores piezas, unas ${Math.round(bestWords)}. Recórtalo para que se diga en 3 segundos.`);
  }

  return {
    confidence,
    poolSize: pool.length,
    classified: empty.classified,
    hookTypes: stats,
    hookTypeCounts,
    hook: { score: hookScore, type, typeLabel: type ? hookKindLabel[type] : "Sin clasificar", typeStat, typeRank, bestType, similar, closeMatches, words, bestWords },
    script: { score: scriptScore, estimatedSeconds: input.estimatedSeconds, bucket, bestBucket, bestRange, buckets },
    verdict,
    suggestions: suggestions.slice(0, 2),
  };
}

/** Frase corta para el veredicto. */
export const verdictLabel: Record<NonNullable<ScoreResult["verdict"]>, string> = {
  arriba: "En línea con lo que mejor te funciona",
  parecido: "Parecido a tu promedio",
  abajo: "Por debajo de lo que te suele funcionar",
};

/** Resumen en texto plano para que la IA lo explique (no le pasa nada que no esté calculado). */
export function scoreFacts(result: ScoreResult, hook: string): string {
  const lines = [
    `Gancho: «${hook}»`,
    `Tipo de gancho: ${result.hook.typeLabel}`,
    `Piezas comparadas: ${result.poolSize} (${result.confidence === "pocos" ? "pocos datos" : "datos suficientes"})`,
    result.hook.score != null ? `Puntaje del gancho: ${result.hook.score}/100` : "Puntaje del gancho: sin datos",
    result.hook.typeStat ? `Ganchos de ese tipo: ${fmtX(result.hook.typeStat.median)} su mediana en ${result.hook.typeStat.count} piezas (puesto ${result.hook.typeRank})` : "Ganchos de ese tipo: menos de 3 piezas medidas",
    result.hook.bestType ? `Su mejor tipo de gancho: ${result.hook.bestType.label} (${fmtX(result.hook.bestType.median)}, ${result.hook.bestType.count} piezas)` : "",
    result.hook.similar.length ? `Mejores piezas más parecidas: ${result.hook.similar.map((s) => `«${s.piece.text.slice(0, 80)}» (${fmtX(s.piece.perf)}, parecido ${Math.round(s.similarity * 100)} %)`).join("; ")}` : "",
    `Duración estimada del guion: ${Math.round(result.script.estimatedSeconds)} s`,
    result.script.bestRange ? `Duración de sus mejores piezas: ${result.script.bestRange.from} a ${result.script.bestRange.to} s` : "",
    result.script.bucket?.median != null ? `Piezas de ${result.script.bucket.label}: ${fmtX(result.script.bucket.median)} (${result.script.bucket.count} piezas)` : "",
    result.script.bestBucket?.median != null ? `Mejor rango de duración: ${result.script.bestBucket.label} (${fmtX(result.script.bestBucket.median)})` : "",
    result.script.score != null ? `Puntaje del guion: ${result.script.score}/100` : "",
    result.suggestions.length ? `Sugerencias calculadas: ${result.suggestions.join(" | ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
