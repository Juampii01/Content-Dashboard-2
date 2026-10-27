/**
 * Variaciones de la descripción de Instagram (5, una por tipo de gancho) y sus comprobaciones, portadas de
 * carrusel-creator-pro (motor/ficha.py: fallos_descripcion y comprobar_variaciones). Son avisos: no bloquean.
 */
import type { CaptionVariant } from "@/lib/db/schema";
import { extractFigures, fold, LIMITS, normalizeHashtag } from "./validate";

export const HOOK_LABEL: Record<CaptionVariant["hook"], string> = {
  dato: "Con un dato",
  pregunta: "Con una pregunta",
  problema: "Con el problema",
  promesa: "Con una promesa",
  curiosidad: "Con curiosidad",
};

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map((x) => normalizeHashtag(fold(x).replace(/[^#\p{L}\p{N}_]/gu, "")))) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, LIMITS.hashtags);
}

/** Avisos de cada variación (índice → mensajes) y del conjunto. `source` es el texto del carrusel y del origen. */
export function variantWarnings(variants: CaptionVariant[], source: string, slidesCount: number): { byIndex: string[][]; all: string[] } {
  const figures = new Set(extractFigures(source));
  const byIndex = variants.map((v) => {
    const out: string[] = [];
    const tags = v.hashtags.filter(Boolean);
    if (tags.length !== LIMITS.hashtags) out.push(`Tiene ${tags.length} hashtags y tienen que ser ${LIMITS.hashtags}.`);
    const text = `${v.caption.trim()}\n\n${tags.join(" ")}`;
    if (text.length > LIMITS.caption) out.push(`Tiene ${text.length} caracteres: Instagram admite ${LIMITS.caption}.`);
    const extra = [...new Set(extractFigures(v.caption))].filter((n) => !figures.has(n) && !(Number.isInteger(n) && n <= slidesCount));
    if (extra.length) out.push(`Cifras que no están en el carrusel: ${extra.slice(0, 4).join(", ")}.`);
    return out;
  });
  const all: string[] = [];
  if (variants.length && variants.length !== 5) all.push(`Hay ${variants.length} variaciones y tienen que ser 5.`);
  const firsts = variants.map((v) => fold(v.caption.trim().split("\n")[0] ?? ""));
  const tagSets = variants.map((v) => [...v.hashtags].map((t) => fold(t)).sort().join(" "));
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (firsts[i] && firsts[i] === firsts[j]) all.push(`Las variaciones ${i + 1} y ${j + 1} empiezan igual.`);
      if (tagSets[i] && tagSets[i] === tagSets[j]) all.push(`Las variaciones ${i + 1} y ${j + 1} llevan los mismos hashtags.`);
    }
  }
  return { byIndex, all };
}

/** Texto del archivo variaciones.txt del ZIP. */
export function variantsText(variants: CaptionVariant[]): string {
  return variants.map((v, i) => `=== VARIACIÓN ${i + 1} · ${HOOK_LABEL[v.hook]} ===\n\n${v.caption.trim()}\n\n${v.hashtags.join(" ")}`).join("\n\n\n");
}
