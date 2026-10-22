import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { mix, reportColors } from "../colors";
import type { ReportBrand } from "../types";

/**
 * Fuentes y colores del PDF. Las fuentes son WOFF autoalojadas en lib/reports/fonts (de Fontsource, licencia
 * SIL OFL 1.1): Inter para todo el texto, JetBrains Mono para eyebrows y cifras técnicas, y la fuente de títulos
 * de Mi marca si es una de las que ya usamos en los carruseles.
 */
const FONT_DIR = path.join(process.cwd(), "lib/reports/fonts");
const file = (name: string) => path.join(FONT_DIR, `${name}.woff`);

/** Fuentes de títulos disponibles para la marca (nombre en Mi marca → familia registrada). */
const HEADING_FONTS: { match: RegExp; family: string; file: string; weight: number }[] = [
  { match: /montserrat/i, family: "Montserrat", file: "montserrat-latin-800-normal", weight: 800 },
  { match: /playfair|serif(?!.*instrument)/i, family: "Playfair Display", file: "playfair-display-latin-700-normal", weight: 700 },
  { match: /instrument/i, family: "Instrument Serif", file: "instrument-serif-latin-400-normal", weight: 400 },
  { match: /oswald|bebas|condensed/i, family: "Oswald", file: "oswald-latin-600-normal", weight: 600 },
  { match: /anton/i, family: "Anton", file: "anton-latin-400-normal", weight: 400 },
];

let registered = false;
export function registerFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Inter",
    fonts: [400, 500, 600, 700, 800].map((w) => ({ src: file(`inter-latin-${w}-normal`), fontWeight: w })),
  });
  Font.register({
    family: "JetBrains Mono",
    fonts: [
      { src: file("jetbrains-mono-latin-400-normal"), fontWeight: 400 },
      { src: file("jetbrains-mono-latin-600-normal"), fontWeight: 600 },
    ],
  });
  for (const f of HEADING_FONTS) Font.register({ family: f.family, fonts: [{ src: file(f.file), fontWeight: f.weight }] });
  // Sin cortes de palabra con guion: en español los cortes automáticos en inglés quedan mal.
  Font.registerHyphenationCallback((word) => [word]);
}

export type PdfTheme = {
  /** Fondo de la portada y bloques destacados. */
  cover: string;
  coverText: string;
  coverMuted: string;
  /** Acento sobre papel blanco (con contraste suficiente). */
  accent: string;
  accentSoft: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  soft: string;
  positive: string;
  negative: string;
  heading: { family: string; weight: number };
  platform: Record<"INSTAGRAM" | "YOUTUBE" | "TIKTOK", string>;
};

/** Colores del PDF: los de la marca (ver lib/reports/colors.ts) sobre papel blanco. */
export function pdfTheme(brand: ReportBrand): PdfTheme {
  const { cover, accent } = reportColors(brand);
  const heading = HEADING_FONTS.find((f) => brand.headingFont && f.match.test(brand.headingFont));
  return {
    cover,
    coverText: "#ffffff",
    coverMuted: mix(cover, "#ffffff", 0.66),
    accent,
    accentSoft: mix(accent, "#ffffff", 0.88),
    ink: "#0b1324",
    muted: "#55637a",
    faint: "#8a96a8",
    line: "#e2e7ef",
    soft: "#f5f7fa",
    positive: "#0f8a5f",
    negative: "#c2410c",
    heading: heading ? { family: heading.family, weight: heading.weight } : { family: "Inter", weight: 800 },
    platform: { INSTAGRAM: "#c94cd8", YOUTUBE: "#ee4b2b", TIKTOK: "#0fa59c" },
  };
}
