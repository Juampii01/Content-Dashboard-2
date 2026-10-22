/**
 * "Copia este reel": armado del análisis de estructura y textos de la pantalla.
 *
 * Claude lee la transcripción del original dividida en frases con sus tiempos (S1, S2…) y responde qué frases
 * forman el gancho, cada beat y el CTA, de qué tipo es cada parte y por qué funciona. Aquí se arma el análisis que
 * se guarda: los tiempos salen de las frases (medidos, no estimados por la IA), los tramos se ordenan y se
 * corrigen si se pisan, y los textos descriptivos pasan por el control de copia (sin frases del original).
 * Se guarda la estructura, nunca la transcripción. Este archivo no importa nada de servidor.
 */
import { z } from "zod";
import { HOOK_TYPES } from "@/lib/ai/prompts/guiones";
import { formatNumber } from "@/lib/format";
import type { StyleMetrics } from "@/lib/video/style";
import { redactShared } from "./overlap";

export type TimedWord = { text: string; start: number; end: number };
export type Sentence = { index: number; start: number; end: number; text: string; words: number };

/** Palabras que manda el worker (la transcripción viaja una sola vez y no se guarda). */
export const timedWordsSchema = z
  .array(z.object({ text: z.string().max(80), start: z.number().finite().min(0), end: z.number().finite().min(0) }))
  .max(4000);

const SENTENCE_END = /[.?!…]["»”)]*$/;
const MAX_SENTENCE_WORDS = 16;
const SENTENCE_GAP = 0.45;

/** Frases de la transcripción: corta en punto final, en una pausa clara o a las 16 palabras. */
export function sentencesFromWords(words: TimedWord[]): Sentence[] {
  const clean = words.filter((w) => w.text.trim()).sort((a, b) => a.start - b.start);
  const out: Sentence[] = [];
  let current: TimedWord[] = [];
  const close = () => {
    if (!current.length) return;
    out.push({
      index: out.length + 1,
      start: round(current[0]!.start),
      end: round(Math.max(current[0]!.start, current[current.length - 1]!.end)),
      text: current.map((w) => w.text.trim()).join(" "),
      words: current.length,
    });
    current = [];
  };
  clean.forEach((w, i) => {
    current.push(w);
    const next = clean[i + 1];
    if (SENTENCE_END.test(w.text.trim()) || current.length >= MAX_SENTENCE_WORDS || (next && next.start - w.end >= SENTENCE_GAP)) close();
  });
  close();
  return out;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Las frases como las lee Claude: "S3 [4.1–6.8 s] texto". */
export function transcriptLines(sentences: Sentence[], maxChars = 7000): string {
  const lines: string[] = [];
  let used = 0;
  for (const s of sentences) {
    const line = `S${s.index} [${s.start.toFixed(1)}–${s.end.toFixed(1)} s] ${s.text}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Lo medido en la edición del original, en líneas cortas para el prompt. */
export function metricsSummary(m: StyleMetrics): string {
  const lines = [
    `Duración: ${m.duration.toFixed(1)} s, formato ${m.aspect}.`,
    `Cortes: ${m.cuts.count} (${m.cuts.perMinute.toFixed(1)} por minuto, una toma cada ${m.cuts.avgShot.toFixed(1)} s).`,
    `Zooms: ${m.zooms.punchIns} punch-ins y ${m.zooms.smooth} suaves.`,
    m.broll.reliable ? `B-roll: ${Math.round(m.broll.ratio * 100)} % del video.` : "B-roll: no se pudo medir.",
    m.captions.detected ? `Subtítulos: ${m.captions.uppercase ? "en mayúsculas" : "en minúsculas"}, ${m.captions.wordsPerBlock} palabras por bloque.` : "Subtítulos: no tiene.",
  ];
  if (m.speech.detected) {
    if (m.speech.wps != null) lines.push(`Ritmo de habla: ${m.speech.wps.toFixed(1)} palabras por segundo.`);
    if (m.speech.hookSeconds != null) lines.push(`Primera frase: ${m.speech.hookSeconds.toFixed(1)} s.`);
  }
  return lines.join("\n");
}

/** Largo hablado de la versión nueva: el del original (±15 %), dentro de lo razonable para un reel. */
export function targetWords(originalWords: number): { min: number; max: number } {
  const base = clamp(originalWords || 110, 35, 400);
  return { min: Math.max(25, Math.round(base * 0.85)), max: Math.round(base * 1.15) };
}

// ─── Lo que responde Claude (referencias a frases) ────────────────────────

export const CTA_KINDS = ["comentar", "seguir", "guardar", "compartir", "link", "dm", "ninguno"] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

const range = { from: z.number().int().describe("Número de la primera frase (S#)."), to: z.number().int().describe("Número de la última frase (S#), incluida.") };

export const structureSchema = z.object({
  originalTopic: z.string().describe("De qué trata el original, en 3 a 8 palabras propias (sin citarlo)."),
  hook: z.object({
    ...range,
    type: z.enum(HOOK_TYPES),
    mechanism: z.string().describe("Cómo engancha, explicado con tus palabras y sin citar: qué promete, qué tensión abre."),
  }),
  beats: z
    .array(
      z.object({
        ...range,
        purpose: z.string().describe("Qué logra este tramo (ej. 'mostrar el error', 'dar la prueba')."),
        technique: z.string().describe("El recurso que usa (lista, contraste, historia, dato, demostración…), sin citar."),
      }),
    )
    .describe("El desarrollo en 2 a 6 beats, en orden, sin el gancho ni el CTA."),
  cta: z.object({
    from: z.number().int().describe("Primera frase del CTA, o 0 si no hay CTA."),
    to: z.number().int().describe("Última frase del CTA, o 0 si no hay CTA."),
    kind: z.enum(CTA_KINDS),
    description: z.string().describe("Qué le pide al público y cómo, sin citar la frase."),
  }),
  whyItWorks: z.array(z.string()).describe("De 3 a 5 razones concretas de por qué funciona, sin citar el original."),
});
export type StructureAi = z.infer<typeof structureSchema>;

// ─── Lo que se guarda ─────────────────────────────────────────────────────

export type ReelCopyPart = { from: number; to: number; start: number; end: number; seconds: number };
export type ReelCopyAnalysis = {
  version: 1;
  originalTopic: string;
  durationSeconds: number;
  originalWords: number;
  wordsPerSecond: number | null;
  cutsPerMinute: number;
  hook: ReelCopyPart & { type: (typeof HOOK_TYPES)[number]; mechanism: string };
  beats: (ReelCopyPart & { purpose: string; technique: string })[];
  cta: (ReelCopyPart & { kind: CtaKind; description: string }) | null;
  whyItWorks: string[];
  /** Tramos que la IA marcó mal y se corrigieron al armar (solo para soporte). */
  fixes: number;
};

const text = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Arma el análisis a partir de la respuesta de Claude y de las frases medidas:
 * - Los números de frase se acotan a los que existen y cada tramo queda en orden (from ≤ to).
 * - El gancho empieza en la primera frase; los beats van después del gancho, sin pisarse; el CTA va al final.
 * - Los tiempos salen de las frases (inicio de la primera, fin de la última).
 * - Los textos descriptivos pasan por el control de copia: lo que repite el original se tapa.
 */
export function buildAnalysis(ai: StructureAi, sentences: Sentence[], metrics: StyleMetrics, transcript: string): ReelCopyAnalysis {
  if (!sentences.length) throw new Error("sin frases");
  const last = sentences.length;
  let fixes = 0;
  const at = (n: number) => sentences[clamp(n, 1, last) - 1]!;
  const part = (from: number, to: number): ReelCopyPart => {
    const a = at(from);
    const b = at(Math.max(from, to));
    return { from: a.index, to: b.index, start: a.start, end: b.end, seconds: round(Math.max(0, b.end - a.start), 1) };
  };
  const safe = (s: string, max: number) => text(redactShared(s, transcript), max);

  // CTA: al final. Si la IA dice que no hay o lo pone antes del cuerpo, se queda sin CTA.
  let cta: ReelCopyAnalysis["cta"] = null;
  if (ai.cta.kind !== "ninguno" && ai.cta.from > 0) {
    const from = clamp(Math.min(ai.cta.from, ai.cta.to || ai.cta.from), 2, last);
    if (from !== ai.cta.from) fixes++;
    cta = { ...part(from, last), kind: ai.cta.kind, description: safe(ai.cta.description, 300) };
    if (Math.max(ai.cta.to, ai.cta.from) !== last) fixes++;
  }
  const bodyEnd = cta ? cta.from - 1 : last;

  // Gancho: desde la primera frase; nunca se come todo el cuerpo.
  const hookTo = clamp(Math.max(ai.hook.from, ai.hook.to), 1, Math.max(1, Math.min(bodyEnd - 1, 4)));
  if (ai.hook.from !== 1 || hookTo !== ai.hook.to) fixes++;
  const hook = { ...part(1, hookTo), type: ai.hook.type, mechanism: safe(ai.hook.mechanism, 300) };

  // Beats: en orden, sin pisarse, cubriendo del final del gancho al inicio del CTA.
  const beats: ReelCopyAnalysis["beats"] = [];
  let cursor = hook.to + 1;
  const sorted = [...ai.beats].sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  for (const [i, b] of sorted.entries()) {
    if (cursor > bodyEnd) {
      fixes++;
      break;
    }
    const isLast = i === sorted.length - 1;
    const wantedTo = Math.max(b.from, b.to);
    const to = isLast ? bodyEnd : clamp(wantedTo, cursor, bodyEnd);
    if (Math.min(b.from, b.to) !== cursor || to !== wantedTo) fixes++;
    beats.push({ ...part(cursor, to), purpose: safe(b.purpose, 160), technique: safe(b.technique, 160) });
    cursor = to + 1;
  }
  if (!beats.length && cursor <= bodyEnd) {
    fixes++;
    beats.push({ ...part(cursor, bodyEnd), purpose: "Desarrollar la idea", technique: "explicación directa" });
  }

  const originalWords = sentences.reduce((n, s) => n + s.words, 0);
  return {
    version: 1,
    originalTopic: safe(ai.originalTopic, 120),
    durationSeconds: round(metrics.duration, 1),
    originalWords,
    wordsPerSecond: metrics.speech.detected && metrics.speech.wps != null ? round(metrics.speech.wps, 2) : null,
    cutsPerMinute: round(metrics.cuts.perMinute, 1),
    hook,
    beats,
    cta,
    whyItWorks: ai.whyItWorks.map((w) => safe(w, 240)).filter(Boolean).slice(0, 5),
    fixes,
  };
}

/** La estructura como brief para escribir la versión nueva: sin una sola frase del original. */
export function analysisBrief(a: ReelCopyAnalysis): string {
  const lines = [
    `Duración del original: ${a.durationSeconds} s, ${a.originalWords} palabras habladas${a.wordsPerSecond ? ` (${a.wordsPerSecond} por segundo)` : ""}, ${a.cutsPerMinute} cortes por minuto.`,
    `GANCHO (${a.hook.seconds} s, tipo ${a.hook.type}): ${a.hook.mechanism}`,
    ...a.beats.map((b, i) => `BEAT ${i + 1} (${b.seconds} s): ${b.purpose}. Recurso: ${b.technique}.`),
    a.cta ? `CTA (${a.cta.seconds} s, ${a.cta.kind}): ${a.cta.description}` : "CTA: el original no tiene; usa uno coherente con el objetivo.",
    `POR QUÉ FUNCIONA: ${a.whyItWorks.join(" · ")}`,
  ];
  return lines.join("\n");
}

// ─── Textos de la pantalla ────────────────────────────────────────────────

export type ReelCopyStatus = "UPLOADING" | "ANALYZING" | "WRITING" | "READY" | "FAILED";

export const copyStatusLabel: Record<ReelCopyStatus, string> = {
  UPLOADING: "Subida incompleta",
  ANALYZING: "Analizando",
  WRITING: "Escribiendo tu versión",
  READY: "Lista",
  FAILED: "Con error",
};

export const ctaKindLabel: Record<CtaKind, string> = {
  comentar: "Pide comentar",
  seguir: "Pide seguir",
  guardar: "Pide guardar",
  compartir: "Pide compartir",
  link: "Manda a un link",
  dm: "Pide un mensaje directo",
  ninguno: "Sin CTA",
};

export const hookTypeLabel: Record<(typeof HOOK_TYPES)[number], string> = {
  contraste: "Contraste",
  curiosidad: "Curiosidad",
  dolor: "Dolor",
  resultado: "Resultado",
  historia: "Historia",
  pregunta: "Pregunta",
  lista: "Lista",
};

export const secondsLabel = (s: number) => `${formatNumber(s, { digits: 1 })} s`;

/**
 * Grabar con el guion. La grabación con teleprompter se está construyendo aparte: por ahora abre el guion con
 * `?grabar=1` (el parámetro queda listo para cuando exista la pantalla de grabación).
 */
export const recordHref = (scriptId: string) => `/guiones/${scriptId}?grabar=1`;
/** El Editor ya acepta `?estilo=<id>&guion=<id>` en /editor/nuevo. */
export const editWithStyleHref = (styleId: string, scriptId: string | null) => `/editor/nuevo?estilo=${styleId}${scriptId ? `&guion=${scriptId}` : ""}`;
