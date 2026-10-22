/**
 * Largo de los títulos de YouTube. YouTube acepta hasta 100 caracteres, pero en el teléfono y en las sugerencias
 * se ven ~60: lo que pase de ahí se corta con "…". Se cuentan caracteres visibles (grafemas), así un emoji o una
 * letra con tilde cuentan como uno. Sin dependencias de servidor.
 */
import { TITLE_ANGLES, type TitleAngle, type TitleGroup } from "./types";

export const TITLE_VISIBLE_MAX = 60;
export const TITLE_HARD_MAX = 100;

let segmenter: Intl.Segmenter | null = null;

export function visibleLength(text: string): number {
  segmenter ??= new Intl.Segmenter("es", { granularity: "grapheme" });
  return Array.from(segmenter.segment(text)).length;
}

/** Limpia un título: sin comillas alrededor, sin espacios dobles ni punto final. */
export function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .replace(/(?<![.…])\.$/, "")
    .trim();
}

export type TitleCheck = { chars: number; fits: boolean; overBy: number; tooLong: boolean; preview: string };

/** Medida de un título: si entra en lo visible, cuánto se pasa y cómo se ve cortado. */
export function checkTitle(text: string): TitleCheck {
  const clean = cleanTitle(text);
  const chars = visibleLength(clean);
  const overBy = Math.max(0, chars - TITLE_VISIBLE_MAX);
  let preview = clean;
  if (overBy) {
    segmenter ??= new Intl.Segmenter("es", { granularity: "grapheme" });
    const parts = [...segmenter.segment(clean)].map((s) => s.segment);
    preview = `${parts.slice(0, TITLE_VISIBLE_MAX - 1).join("").trimEnd()}…`;
  }
  return { chars, fits: overBy === 0, overBy, tooLong: chars > TITLE_HARD_MAX, preview };
}

export const ANGLE_LABELS: Record<TitleAngle, string> = {
  curiosidad: "Curiosidad",
  resultado: "Resultado",
  contraste: "Contraste",
  pregunta: "Pregunta",
  lista: "Lista",
  historia: "Historia",
  error: "Error a evitar",
};

export function isAngle(value: string): value is TitleAngle {
  return (TITLE_ANGLES as readonly string[]).includes(value);
}

/**
 * Ordena y limpia lo que propone la IA: títulos limpios, sin repetidos (sin mayúsculas ni tildes), sin los que pasan
 * de 100 caracteres, ángulos agrupados y con un tope de opciones.
 */
export function normalizeTitleGroups(groups: { angle: string; options: { text: string; why: string }[] }[], max = 10, makeId: () => string = () => Math.random().toString(36).slice(2, 10)): TitleGroup[] {
  const seen = new Set<string>();
  const byAngle = new Map<TitleAngle, TitleGroup>();
  let total = 0;
  for (const g of groups) {
    const angle: TitleAngle = isAngle(g.angle) ? g.angle : "curiosidad";
    for (const o of g.options) {
      const text = cleanTitle(o.text);
      const key = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!text || seen.has(key) || checkTitle(text).tooLong || total >= max) continue;
      seen.add(key);
      total++;
      const group = byAngle.get(angle) ?? { angle, options: [] };
      group.options.push({ id: makeId(), text, why: o.why.trim() });
      byAngle.set(angle, group);
    }
  }
  return [...byAngle.values()];
}

export function countFitting(groups: TitleGroup[]): { total: number; fitting: number; long: string[] } {
  const all = groups.flatMap((g) => g.options);
  const long = all.filter((o) => !checkTitle(o.text).fits).map((o) => o.text);
  return { total: all.length, fitting: all.length - long.length, long };
}
