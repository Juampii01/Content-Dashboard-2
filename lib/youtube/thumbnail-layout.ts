/**
 * Plantilla de las miniaturas de YouTube (1280×720). El fondo lo genera el proveedor de imágenes (sin texto) y la foto
 * del personaje va recortada encima; el texto grande lo dibuja esta plantilla, nunca el modelo. La vista previa y la
 * exportación a JPG usan el mismo nodo (components/miniaturas/thumbnail-canvas.tsx) con estas medidas.
 * Sin dependencias de servidor: se prueba sola.
 */
import { contrast, type BrandLook } from "@/lib/carousels/theme";
import type { ThumbnailLayoutKind } from "./types";

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const THUMB_MIN_WORDS = 2;
export const THUMB_MAX_WORDS = 4;

export const THUMB_FONTS = {
  anton: { label: "Anton (impacto)", family: '"Anton Miniatura", "Oswald Miniatura", sans-serif', weight: 400, width: 0.47, upper: true },
  oswald: { label: "Oswald (condensada)", family: '"Oswald Miniatura", "Inter", sans-serif', weight: 700, width: 0.5, upper: true },
  montserrat: { label: "Montserrat", family: '"Montserrat Miniatura", "Inter", sans-serif', weight: 900, width: 0.76, upper: true },
  inter: { label: "Inter", family: '"Inter", system-ui, sans-serif', weight: 800, width: 0.66, upper: true },
  playfair: { label: "Playfair Display", family: '"Playfair Miniatura", Georgia, serif', weight: 800, width: 0.62, upper: false },
} as const;
export type ThumbFontKey = keyof typeof THUMB_FONTS;

export function isThumbFont(value: unknown): value is ThumbFontKey {
  return typeof value === "string" && value in THUMB_FONTS;
}

/** Fuente de la miniatura a partir de la tipografía de Mi marca (Anton si no hay o no se reconoce). */
export function thumbFontFromBrand(heading: string | null | undefined): ThumbFontKey {
  const n = (heading ?? "").toLowerCase();
  if (n.includes("montserrat")) return "montserrat";
  if (n.includes("oswald") || n.includes("bebas") || n.includes("condensed")) return "oswald";
  if (n.includes("playfair") || n.includes("serif")) return "playfair";
  if (n.includes("inter")) return "inter";
  return "anton";
}

export type ThumbColors = { text: string; accent: string; shade: string };

/** Colores de la miniatura: texto blanco sobre un velo oscuro y el acento de Mi marca (si no se lee, amarillo). */
export function thumbColors(brand: BrandLook["colors"]): ThumbColors {
  const hex = /^#[0-9a-f]{6}$/i;
  const pick = [brand?.accent, brand?.secondary, brand?.primary].find((c) => c && hex.test(c)) ?? "#4da3ff";
  // El acento va sobre un fondo oscurecido: si no contrasta, se usa el amarillo clásico de miniaturas.
  const accent = contrast(pick, "#101010") < 4.5 ? "#ffd400" : pick;
  return { text: "#ffffff", accent, shade: "#050816" };
}

/** Palabras del texto, sin signos sueltos. */
export function thumbWords(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Avisos del texto (se muestran en el editor; no frenan la descarga). */
export function thumbTextIssues(text: string): string[] {
  const n = thumbWords(text).length;
  if (n === 0) return ["Escribe el texto de la miniatura."];
  if (n < THUMB_MIN_WORDS) return ["Con 2 a 4 palabras se entiende mejor de qué trata."];
  if (n > THUMB_MAX_WORDS) return [`Tiene ${n} palabras: en el teléfono se lee mejor con 2 a 4.`];
  return [];
}

const norm = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Índices de las palabras resaltadas (la frase `highlight` dentro del texto; si no aparece, ninguna). */
export function highlightIndexes(words: string[], highlight: string): Set<number> {
  const target = thumbWords(highlight).map(norm).filter(Boolean);
  const out = new Set<number>();
  if (!target.length) return out;
  const keys = words.map(norm);
  for (let i = 0; i + target.length <= keys.length; i++) {
    if (target.every((t, k) => keys[i + k] === t)) {
      for (let k = 0; k < target.length; k++) out.add(i + k);
      return out;
    }
  }
  return out;
}

/** Reparte las palabras en `count` líneas lo más parejas posible (por caracteres). */
export function splitLines(words: string[], count: number): string[][] {
  const n = Math.max(1, Math.min(count, words.length));
  if (n === 1) return [words];
  let best: string[][] = [words];
  let bestScore = Infinity;
  const tryCut = (cuts: number[]) => {
    const lines: string[][] = [];
    let prev = 0;
    for (const c of [...cuts, words.length]) {
      lines.push(words.slice(prev, c));
      prev = c;
    }
    const score = Math.max(...lines.map((l) => l.join(" ").length));
    if (score < bestScore) {
      bestScore = score;
      best = lines;
    }
  };
  for (let a = 1; a < words.length; a++) {
    if (n === 2) tryCut([a]);
    else for (let b = a + 1; b < words.length; b++) tryCut([a, b]);
  }
  return best;
}

export type Box = { x: number; y: number; w: number; h: number };

export type ThumbLayout = {
  lines: { text: string; highlight: boolean }[][];
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: number;
  uppercase: boolean;
  textBox: Box;
  align: "left" | "right" | "center";
  photoBox: Box | null;
  /** Hacia dónde se oscurece el fondo para que el texto se lea. */
  shade: "left" | "right" | "bottom";
};

const MAX_SIZE = [0, 220, 168, 124];
const MIN_SIZE = 64;
const PAD = 64;

/**
 * Medidas de la miniatura. La foto va del lado opuesto al texto, apoyada abajo y un poco más alta que el cuadro
 * (los personajes grandes funcionan mejor en YouTube). Sin foto, el texto usa todo el ancho.
 */
export function thumbnailLayout(input: { text: string; highlight: string; layout: ThumbnailLayoutKind; hasPhoto: boolean; font: ThumbFontKey }): ThumbLayout {
  const font = THUMB_FONTS[input.font];
  const words = thumbWords(input.text).slice(0, 6);
  const shown = font.upper ? words.map((w) => w.toLocaleUpperCase("es")) : words;
  const marked = highlightIndexes(words, input.highlight);
  const withPhoto = input.hasPhoto && input.layout !== "texto-centro";

  const textW = withPhoto ? 700 : THUMB_WIDTH - PAD * 2;
  const textBox: Box =
    input.layout === "texto-derecha" && withPhoto
      ? { x: THUMB_WIDTH - PAD - textW, y: PAD, w: textW, h: THUMB_HEIGHT - PAD * 2 }
      : { x: PAD, y: PAD, w: textW, h: THUMB_HEIGHT - PAD * 2 };
  const photoBox: Box | null = withPhoto
    ? input.layout === "texto-derecha"
      ? { x: -20, y: 24, w: 640, h: THUMB_HEIGHT - 24 }
      : { x: THUMB_WIDTH - 620, y: 24, w: 640, h: THUMB_HEIGHT - 24 }
    : null;

  // Se prueba con 1, 2 y 3 líneas y se queda con la que deja el texto más grande (con empate, menos líneas).
  const lineHeight = 0.96;
  const sizeFor = (split: string[][]) => {
    const longest = Math.max(1, ...split.map((l) => l.join(" ").length));
    const byWidth = textW / (longest * font.width);
    const byHeight = textBox.h / (split.length * lineHeight);
    return Math.floor(Math.max(MIN_SIZE, Math.min(MAX_SIZE[Math.min(3, split.length)]!, byWidth, byHeight)));
  };
  let split = splitLines(shown, 1);
  let fontSize = sizeFor(split);
  for (const count of [2, 3]) {
    if (count > shown.length) break;
    const candidate = splitLines(shown, count);
    const size = sizeFor(candidate);
    if (size > fontSize * 1.08) {
      split = candidate;
      fontSize = size;
    }
  }
  let offset = 0;
  const lines = split.map((line) =>
    line.map((w) => {
      const item = { text: w, highlight: marked.has(offset) };
      offset++;
      return item;
    }),
  );

  return {
    lines,
    fontSize,
    lineHeight,
    fontFamily: font.family,
    fontWeight: font.weight,
    uppercase: font.upper,
    textBox,
    align: input.layout === "texto-centro" || !withPhoto ? (input.layout === "texto-centro" ? "center" : "left") : input.layout === "texto-derecha" ? "right" : "left",
    photoBox,
    shade: input.layout === "texto-centro" ? "bottom" : input.layout === "texto-derecha" && withPhoto ? "right" : "left",
  };
}

/** Prompt del fondo: misma regla que Carruseles (sin texto ni logos), en 16:9, con aire del lado del texto. */
export function backgroundPrompt(input: { scene: string; layout: ThumbnailLayoutKind; hasPhoto: boolean; niche: string | null; colors: BrandLook["colors"] }): string {
  const colors = [input.colors?.primary, input.colors?.accent, input.colors?.secondary].filter(Boolean).join(", ");
  const side =
    input.layout === "texto-centro"
      ? "El texto va centrado encima: deja el centro y la parte de abajo limpios, sin detalles importantes."
      : input.layout === "texto-derecha"
        ? `El texto va a la derecha: deja la mitad derecha limpia y un poco oscura.${input.hasPhoto ? " A la izquierda va la foto de una persona: deja ese lado sin objetos grandes." : ""}`
        : `El texto va a la izquierda: deja la mitad izquierda limpia y un poco oscura.${input.hasPhoto ? " A la derecha va la foto de una persona: deja ese lado sin objetos grandes." : ""}`;
  return [
    "Fondo para una miniatura de YouTube, formato horizontal 16:9.",
    `ESCENA: ${input.scene.trim()}`,
    `ESTILO: fotografía o ilustración de alto contraste, colores saturados y luz dramática, que se lea en tamaño chico${colors ? `; paleta que combine con ${colors}` : ""}${input.niche ? `; nicho: ${input.niche}` : ""}.`,
    side,
    "PROHIBIDO: cualquier texto, letra, número, palabra, cartel, pantalla con letras, logo, marca de agua o firma. Sin personas ni caras (la persona se agrega después). Sin manos deformes.",
    "Una sola idea visual, que se entienda en menos de un segundo.",
  ].join("\n");
}
