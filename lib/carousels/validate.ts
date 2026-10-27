/**
 * Validaciones de un carrusel, portadas de carrusel-creator-pro (motor/ficha.py) y adaptadas a plantillas
 * con ajuste automático del texto. Son avisos: nunca bloquean guardar ni exportar.
 */
import type { CarouselSlide } from "@/lib/db/schema";

export type CarouselWarning = {
  /** null = aviso del carrusel completo (caption, hashtags). */
  slideId: string | null;
  field: "headline" | "body" | "highlight" | "kicker" | "cta" | "caption" | "hashtags" | "slides" | "character";
  message: string;
};

export const LIMITS = {
  headline: 90,
  body: 220,
  kicker: 40,
  cta: 90,
  caption: 2200,
  hashtags: 5,
  minSlides: 5,
  maxSlides: 10,
  coverWords: [5, 10] as const,
};

/** Quita tildes y pasa a minúsculas para comparar palabras. La ñ se conserva. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "ñ");
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  mil: 1e3,
  m: 1e6,
  mm: 1e6,
  millon: 1e6,
  millones: 1e6,
  b: 1e9,
  billon: 1e12,
  billones: 1e12,
};

/**
 * Lee un número escrito a mano. "1.200" y "1,200" son mil doscientos (tres cifras después del separador);
 * "1.2" y "1,5" son decimales.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (lastSep < 0) return Number(s);
  const tail = s.slice(lastSep + 1);
  const sepCount = (s.match(/[.,]/g) ?? []).length;
  const sameKind = new Set(s.match(/[.,]/g)).size === 1;
  // Tres cifras después del último separador, o el mismo separador repetido: son miles.
  if (tail.length === 3 && (sameKind || sepCount === 1)) return Number(s.replace(/[.,]/g, ""));
  if (sameKind && sepCount > 1) return Number(s.replace(/[.,]/g, ""));
  // El último separador es decimal; los demás, de miles.
  return Number(s.slice(0, lastSep).replace(/[.,]/g, "") + "." + tail);
}

/** Todas las cifras de un texto, normalizadas (1.2K = 10 mil / 10 = 1200 = 1,200…). */
export function extractFigures(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)*)\s*(k|mil|mm|m|millones|millón|millon|billones|billón|billon|b)?(?![\p{L}])/giu;
  for (const match of fold(text).matchAll(re)) {
    const n = parseNumber(match[1]!);
    if (n == null || !Number.isFinite(n)) continue;
    const mult = match[2] ? (MULTIPLIERS[fold(match[2]).replace("ó", "o")] ?? 1) : 1;
    out.push(Math.round(n * mult * 1000) / 1000);
  }
  return out;
}

function slideText(s: CarouselSlide): string {
  return [s.kicker, s.headline, s.body, s.cta].join(" \n ");
}

/** Palabras prohibidas de Mi marca presentes en el texto (sin importar tildes ni mayúsculas). */
export function findBannedWords(text: string, banned: string[]): string[] {
  const folded = fold(text);
  return banned.filter((word) => {
    const w = fold(word.trim());
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(folded);
  });
}

export function validateCarousel(input: {
  slides: CarouselSlide[];
  caption: string;
  hashtags: string[];
  bannedWords: string[];
  /** Texto de origen (tema, texto pegado o guion). Las cifras que no estén aquí se marcan. */
  sourceText: string | null;
  /** Carrusel copiado de otro: el @ del original (no se puede colar) y si hay fotos del personaje en Mi marca. */
  copy?: { handle: string | null } | null;
  /** Fotos del personaje en Mi marca (para avisar si un slide lo pide y no hay ninguna). */
  characterPhotos?: number;
}): CarouselWarning[] {
  const warnings: CarouselWarning[] = [];
  const { slides } = input;
  const sourceFigures = new Set(extractFigures(input.sourceText ?? ""));

  if (slides.length < LIMITS.minSlides || slides.length > LIMITS.maxSlides) {
    warnings.push({ slideId: null, field: "slides", message: `Un carrusel rinde mejor con ${LIMITS.minSlides} a ${LIMITS.maxSlides} slides (tienes ${slides.length}).` });
  }
  if (slides.length > 0 && slides[0]!.type !== "cover") warnings.push({ slideId: slides[0]!.id, field: "slides", message: "El primer slide debería ser la portada." });
  if (slides.length > 1 && slides[slides.length - 1]!.type !== "cta") warnings.push({ slideId: slides[slides.length - 1]!.id, field: "slides", message: "El último slide debería ser el cierre con tu CTA." });

  for (const s of slides) {
    const headline = s.headline.trim();
    if (!headline) warnings.push({ slideId: s.id, field: "headline", message: "Falta el titular." });
    if (headline.length > LIMITS.headline) warnings.push({ slideId: s.id, field: "headline", message: `Titular largo (${headline.length} caracteres): en el teléfono se lee mejor con menos de ${LIMITS.headline}.` });
    if (s.body.trim().length > LIMITS.body) warnings.push({ slideId: s.id, field: "body", message: `Texto largo (${s.body.trim().length} caracteres): intenta quedarte por debajo de ${LIMITS.body}.` });
    if (s.kicker.trim().length > LIMITS.kicker) warnings.push({ slideId: s.id, field: "kicker", message: `La etiqueta superior es larga: máximo ${LIMITS.kicker} caracteres.` });
    if (s.type === "cover" || s.type === "cta") {
      const words = countWords(headline);
      const [min, max] = LIMITS.coverWords;
      if (headline && (words < min || words > max)) {
        warnings.push({ slideId: s.id, field: "headline", message: `${s.type === "cover" ? "La portada" : "El cierre"} funciona mejor con ${min} a ${max} palabras (tiene ${words}).` });
      }
    }
    if (s.type === "cta" && !s.cta.trim()) warnings.push({ slideId: s.id, field: "cta", message: "Al cierre le falta el llamado a la acción (por ejemplo, “Comenta AGENDA”)." });
    if (s.highlight.trim() && !fold(headline).includes(fold(s.highlight.trim()))) {
      warnings.push({ slideId: s.id, field: "highlight", message: "La palabra resaltada no está en el titular: no se va a ver." });
    }
    const banned = findBannedWords(slideText(s), input.bannedWords);
    if (banned.length) warnings.push({ slideId: s.id, field: "headline", message: `Usa palabras prohibidas de tu marca: ${banned.join(", ")}.` });

    const index = slides.indexOf(s);
    const unconfirmed = [...new Set(extractFigures(slideText(s)))].filter((n) => {
      if (sourceFigures.has(n)) return false;
      // Conteos de la propia estructura ("5 errores", "paso 3") no son datos: no se marcan.
      return !(Number.isInteger(n) && n <= Math.max(10, slides.length) && n >= 0 && (n <= slides.length || n === index + 1));
    });
    if (unconfirmed.length) {
      warnings.push({ slideId: s.id, field: "body", message: `Cifras que no están en tu texto de origen: ${unconfirmed.slice(0, 4).join(", ")}. Confírmalas antes de publicar.` });
    }
  }

  // Tu personaje (portado de ficha.py: "el cliente tiene que dar la cara al menos una vez").
  const decided = slides.filter((s) => s.character !== undefined);
  if (input.copy && decided.length && !slides.some((s) => s.character)) {
    warnings.push({ slideId: slides[slides.length - 1]!.id, field: "character", message: "Tu personaje no sale en ningún slide: actívalo al menos en el cierre para que tu marca dé la cara." });
  }
  if (input.characterPhotos === 0 && slides.some((s) => s.character)) {
    warnings.push({ slideId: null, field: "character", message: "Hay slides con tu personaje pero no subiste fotos tuyas: sin fotos no se puede poner tu cara." });
  }
  for (const s of slides) {
    if (s.original?.text && looksCopied(`${s.headline} ${s.body}`, s.original.text)) {
      warnings.push({ slideId: s.id, field: "headline", message: "Se parece mucho al texto del original: reescríbelo con tus palabras." });
    }
  }
  const handle = input.copy?.handle?.replace(/^@/, "").trim();
  if (handle && handle.length >= 3) {
    const re = new RegExp(`@?${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    for (const s of slides) if (re.test(slideText(s))) warnings.push({ slideId: s.id, field: "headline", message: `Aparece la cuenta del original (@${handle}). Quítala.` });
    if (re.test(input.caption)) warnings.push({ slideId: null, field: "caption", message: `El caption nombra la cuenta del original (@${handle}). Quítala.` });
  }

  const caption = input.caption.trim();
  if (caption.length > LIMITS.caption) warnings.push({ slideId: null, field: "caption", message: `El caption tiene ${caption.length} caracteres: Instagram permite ${LIMITS.caption}.` });
  if (!caption) warnings.push({ slideId: null, field: "caption", message: "Falta el caption." });
  const tags = input.hashtags.filter((h) => h.trim());
  if (tags.length !== LIMITS.hashtags) warnings.push({ slideId: null, field: "hashtags", message: `Usa exactamente ${LIMITS.hashtags} hashtags (tienes ${tags.length}).` });
  if (new Set(tags.map((t) => fold(t))).size !== tags.length) warnings.push({ slideId: null, field: "hashtags", message: "Hay hashtags repetidos." });
  const bannedCaption = findBannedWords(caption, input.bannedWords);
  if (bannedCaption.length) warnings.push({ slideId: null, field: "caption", message: `El caption usa palabras prohibidas de tu marca: ${bannedCaption.join(", ")}.` });
  const captionFigures = [...new Set(extractFigures(caption))].filter((n) => !sourceFigures.has(n) && !(Number.isInteger(n) && n <= slides.length));
  if (captionFigures.length) warnings.push({ slideId: null, field: "caption", message: `El caption tiene cifras que no están en tu texto de origen: ${captionFigures.slice(0, 4).join(", ")}.` });

  return warnings;
}

function trigrams(text: string): string[] {
  const words = fold(text).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 2 < words.length; i++) out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/**
 * El texto nuevo repite frases del original: más de la mitad de sus grupos de 3 palabras están en el original.
 * Solo se mide si el texto nuevo tiene al menos 6 palabras (los titulares cortos con nombres propios no cuentan).
 */
export function looksCopied(text: string, original: string): boolean {
  const mine = trigrams(text);
  if (mine.length < 4) return false;
  const theirs = new Set(trigrams(original));
  if (!theirs.size) return false;
  return mine.filter((t) => theirs.has(t)).length / mine.length > 0.5;
}

/** Normaliza un hashtag: sin espacios, con # adelante. */
export function normalizeHashtag(tag: string): string {
  const clean = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return clean ? `#${clean}` : "";
}

export function captionWithHashtags(caption: string, hashtags: string[]): string {
  const tags = hashtags.map(normalizeHashtag).filter(Boolean).join(" ");
  return [caption.trim(), tags].filter(Boolean).join("\n\n");
}
