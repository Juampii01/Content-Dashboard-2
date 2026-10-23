/**
 * Textos del director para personas: la IA a veces escribe con los ids internos que ve en su contexto ("zoom de 235 a
 * 254", "el b-roll de B4", "F12", "ritmo fast", "cover_story"). Aquí se traducen a frases citadas y tiempos del video
 * final antes de mostrarlos. No cambia el sentido: solo reemplaza referencias que la persona no puede entender.
 * Sin servidor ni React.
 */
import { formatDuration } from "@/lib/format";
import { sentences } from "@/lib/ai/prompts/editor";
import { FX_INFO, FX_KINDS } from "./fx/catalog";
import type { TimedWord, Word } from "./types";

export type HumanContext = {
  words: Word[];
  corrections?: Record<string, string>;
  /** Palabras del video final (para decir en qué segundo cae una frase). */
  timed?: TimedWord[];
  /** B-roll en el orden del plan (el director los llama B1, B2…). */
  broll?: { from_word: number; to_word: number; choice?: { source: string } | null }[];
  /** Tramos visuales del mapa del director (S1, S2…), en segundos del original. */
  shots?: { start: number; end: number }[];
};

const REASONS: Record<string, string> = {
  retake: "toma repetida",
  false_start: "arranque en falso",
  filler: "muletilla",
  off_topic: "fuera de tema",
  bad_take: "toma mala",
};
const PACE: Record<string, string> = { fast: "rápido", calm: "tranquilo", normal: "normal", slow: "tranquilo" };

/** Cita corta de un rango de palabras, con el segundo del video final si se ve. */
export function quoteRange(ctx: HumanContext, from: number, to: number, max = 42): string {
  const { words } = ctx;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(words.length - 1, Math.max(from, to));
  if (!words.length || a > words.length - 1) return "ese tramo";
  const text = words
    .slice(a, b + 1)
    .map((w) => ctx.corrections?.[String(w.id)] ?? w.text)
    .join(" ")
    .replace(/[.,;:]+$/, "");
  const short = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  const at = ctx.timed?.find((w) => w.id >= a && w.id <= b);
  return `«${short}»${at ? ` (${formatDuration(at.start)})` : ""}`;
}

const valid = (ctx: HumanContext, a: number, b: number) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b < ctx.words.length && b - a <= 400;

/** Palabras que anuncian un rango de palabras ("zoom de 12 a 20", "palabras 3–9"). */
const THING = "(?:zooms?|cortes?|b-roll|gr[áa]ficos?|efectos?|tramos?|bloques?|subt[íi]tulos?|palabras?|frases?|ids?|words?|punch-ins?|resaltados?)";

export function humanize(text: string | null | undefined, ctx: HumanContext): string {
  if (!text) return "";
  let out = text;
  // [235–254] o [235-254]
  out = out.replace(/\[(\d+)\s*[–-]\s*(\d+)\]/g, (m, a: string, b: string) => (valid(ctx, +a, +b) ? quoteRange(ctx, +a, +b) : m));
  // "zoom de 235 a 254", "palabras 235–254", "b-roll en 12-20"
  out = out.replace(new RegExp(`(${THING})(\\s+(?:de|del|en|sobre|entre|las|los)){0,2}\\s+(\\d+)\\s*(?:a|al|y|–|-|hasta)\\s*(?:la\\s+)?(\\d+)\\b(?!\\s*(?:s\\b|seg|%|minutos?|veces))`, "gi"), (m, thing: string, _p: string, a: string, b: string) =>
    valid(ctx, +a, +b) ? `${thing} en ${quoteRange(ctx, +a, +b)}` : m,
  );
  // "la palabra 98" / "palabra 98"
  out = out.replace(/(?:la\s+)?palabra\s+(\d+)\b/gi, (m, a: string) => (valid(ctx, +a, +a) ? quoteRange(ctx, +a, +a) : m));
  // "el b-roll de B4", "B4"
  out = out.replace(/(?:(?:el|al|del)\s+)?(?:b-roll|gr[áa]fico)\s+(?:de\s+|del\s+)?B(\d+)\b/gi, (m, n: string) => {
    const b = ctx.broll?.[Number(n) - 1];
    return b ? `${b.choice?.source === "graphic" ? "el gráfico" : "el b-roll"} de ${quoteRange(ctx, b.from_word, b.to_word)}` : m;
  });
  out = out.replace(/\bB(\d+)\b/g, (m, n: string) => {
    const b = ctx.broll?.[Number(n) - 1];
    return b ? `${b.choice?.source === "graphic" ? "el gráfico" : "el b-roll"} de ${quoteRange(ctx, b.from_word, b.to_word)}` : m;
  });
  // Frases (F12) y tramos visuales (S3, T4).
  if (/\bF\d+\b/.test(out)) {
    const list = sentences(ctx.words);
    out = out.replace(/\b(?:la\s+)?(?:frase\s+)?F(\d+)\b/g, (m, n: string) => {
      const f = list[Number(n) - 1];
      return f ? `la frase ${quoteRange(ctx, f.from, f.to)}` : m;
    });
  }
  out = out.replace(/\bS(\d+)\b/g, (m, n: string) => {
    const s = ctx.shots?.[Number(n) - 1];
    return s ? `la parte de ${formatDuration(s.start)} a ${formatDuration(s.end)} del original` : m;
  });
  out = out.replace(/\b(?:el\s+)?tramo\s+T\d+\b/g, "ese tramo").replace(/\bT\d+\b/g, "ese tramo");
  // Cuadros de las hojas de contacto (#12, #12–#18).
  out = out.replace(/\s*\(?(?:cuadros?\s+)?#\d+(?:\s*[–-]\s*#?\d+)?\)?/g, "");
  // Segundos crudos "12.3–15.8 s" → "0:12 a 0:16".
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*s\b/g, (_m, a: string, b: string) => `${formatDuration(Number(a.replace(",", ".")))} a ${formatDuration(Number(b.replace(",", ".")))}`);
  // Palabras internas en inglés: ritmo, motivos de corte y efectos.
  out = out.replace(/\b(ritmo|pace)\s+(fast|calm|normal|slow)\b/gi, (_m, _r: string, p: string) => `ritmo ${PACE[p.toLowerCase()] ?? p}`);
  out = out.replace(/\b(retake|false_start|filler|off_topic|bad_take)\b/g, (m) => REASONS[m] ?? m);
  for (const kind of FX_KINDS) out = out.replace(new RegExp(`\\b${kind}\\b`, "g"), `«${FX_INFO[kind].label}»`);
  // Etiquetas internas del ritmo.
  out = out.replace(/^(?:Ritmo|Tuyo):\s*/, "");
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return out.charAt(0).toLocaleUpperCase("es") + out.slice(1);
}
