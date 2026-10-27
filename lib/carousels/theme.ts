/**
 * Plantillas, paletas y fuentes de los carruseles. Sin dependencias de servidor: lo usan la vista previa,
 * la exportación en el navegador y las acciones.
 */
import type { CarouselSlide } from "@/lib/db/schema";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

export const TEMPLATES = {
  editorial: { label: "Editorial", hint: "Tipografía grande, como una revista." },
  tweet: { label: "Tweet", hint: "Tu foto, tu nombre y el texto, estilo post." },
  lista: { label: "Lista y datos", hint: "Números grandes para pasos y cifras." },
  cita: { label: "Cita", hint: "Una frase protagonista, con comillas." },
  impacto: { label: "Portada impacto", hint: "Titular enorme que frena el scroll." },
  foto: { label: "Foto + texto", hint: "Imagen arriba (2/3) y el texto abajo." },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export function isTemplate(value: unknown): value is TemplateKey {
  return typeof value === "string" && value in TEMPLATES;
}

/**
 * Plantilla de un carrusel o de un slide: una de fábrica (`editorial`, `foto`…) o una propia creada desde una
 * referencia (`custom:<uuid>`, ver lib/carousels/template-spec.ts).
 */
export type TemplateRef = TemplateKey | `custom:${string}`;
const CUSTOM_RE = /^custom:[0-9a-f-]{36}$/i;

export function isCustomRef(value: unknown): value is `custom:${string}` {
  return typeof value === "string" && CUSTOM_RE.test(value);
}

export function isTemplateRef(value: unknown): value is TemplateRef {
  return isTemplate(value) || isCustomRef(value);
}

export function customRef(id: string): `custom:${string}` {
  return `custom:${id}`;
}

export function customIdOf(ref: string | null | undefined): string | null {
  return ref && CUSTOM_RE.test(ref) ? ref.slice(7) : null;
}

/** Plantillas de fábrica que muestran la imagen del slide (las demás son solo texto). */
export const PHOTO_TEMPLATES: TemplateKey[] = ["foto", "tweet"];

export const SLIDE_TYPES = {
  cover: "Portada",
  item: "Ítem",
  step: "Paso",
  data: "Dato",
  quote: "Cita",
  cta: "Cierre (CTA)",
} as const satisfies Record<CarouselSlide["type"], string>;
export type SlideType = keyof typeof SLIDE_TYPES;

/** Fuentes disponibles: todas autoalojadas (ver components/carruseles/slides.css). */
export const FONTS = {
  inter: { label: "Inter", family: '"Inter", system-ui, sans-serif', heavy: 800 },
  montserrat: { label: "Montserrat", family: '"Montserrat Carrusel", "Inter", sans-serif', heavy: 900 },
  playfair: { label: "Playfair Display", family: '"Playfair Carrusel", Georgia, serif', heavy: 800 },
  instrument: { label: "Instrument Serif", family: '"Instrument Carrusel", Georgia, serif', heavy: 400 },
  oswald: { label: "Oswald (condensada)", family: '"Oswald Carrusel", "Inter", sans-serif', heavy: 700 },
  anton: { label: "Anton (impacto)", family: '"Anton Carrusel", "Oswald Carrusel", sans-serif', heavy: 400 },
  caveat: { label: "Caveat (manuscrita)", family: '"Caveat Carrusel", cursive', heavy: 700 },
  mono: { label: "JetBrains Mono", family: '"JetBrains Mono", ui-monospace, monospace', heavy: 800 },
} as const;
export type FontKey = keyof typeof FONTS;

export type Palette = { bg: string; surface: string; text: string; muted: string; accent: string; accentText: string };

/** Paletas listas. "marca" se arma con los colores de Mi marca (con respaldo en los tokens de la paleta Medianoche). */
export const PALETTES: Record<string, { label: string } & Palette> = {
  medianoche: { label: "Medianoche", bg: "#030a22", surface: "#07163f", text: "#ffffff", muted: "#a7b9d4", accent: "#4da3ff", accentText: "#030a22" },
  papel: { label: "Papel", bg: "#f3eee4", surface: "#ffffff", text: "#141414", muted: "#5c5850", accent: "#e2552d", accentText: "#ffffff" },
  carbon: { label: "Carbón", bg: "#0d0d0d", surface: "#1a1a1a", text: "#f5f5f5", muted: "#9a9a9a", accent: "#c8ff3d", accentText: "#0d0d0d" },
  blanco: { label: "Blanco", bg: "#ffffff", surface: "#f2f4f7", text: "#0f1419", muted: "#536471", accent: "#0070f8", accentText: "#ffffff" },
  bosque: { label: "Bosque", bg: "#0f2a22", surface: "#163a2f", text: "#f1efe6", muted: "#a9bdb2", accent: "#f2c14e", accentText: "#0f2a22" },
};
/** "referencia" = los colores del carrusel copiado (solo con una plantilla propia). */
export const PALETTE_KEYS = ["marca", "referencia", ...Object.keys(PALETTES)] as const;

export type BrandLook = { colors: { primary?: string; secondary?: string; accent?: string } | null; fonts: { heading?: string; body?: string } | null };

/** Tema resuelto de un carrusel: paleta + fuente. Lo que se guarda en `carousels.theme` son solo las elecciones. */
export type ResolvedTheme = Palette & { palette: string; font: FontKey; fontFamily: string; heavy: number };

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

function mix(hex: string, other: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(other.slice(1), 16);
  const ch = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - amount) + ((b >> s) & 255) * amount));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Paleta a partir de los colores de Mi marca. Si faltan o no se leen bien, usa los tokens de la paleta Medianoche. */
export function brandPalette(colors: BrandLook["colors"]): Palette {
  const base = PALETTES.medianoche!;
  const primary = colors?.primary && HEX.test(colors.primary) ? colors.primary : null;
  const accentRaw = [colors?.accent, colors?.secondary, colors?.primary].find((c) => c && HEX.test(c)) ?? null;
  if (!primary && !accentRaw) return base;
  // El fondo es el color principal si es oscuro; si es claro, fondo claro con texto oscuro.
  const bg = primary ?? base.bg;
  const dark = luminance(bg) < 0.25;
  const text = dark ? "#ffffff" : "#111111";
  let accent = accentRaw && accentRaw.toLowerCase() !== bg.toLowerCase() ? accentRaw : dark ? base.accent : "#0070f8";
  if (contrast(accent, bg) < 2.2) accent = dark ? mix(accent, "#ffffff", 0.45) : mix(accent, "#000000", 0.45);
  return {
    bg,
    surface: dark ? mix(bg, "#ffffff", 0.07) : mix(bg, "#000000", 0.05),
    text,
    muted: dark ? mix(bg, "#ffffff", 0.68) : mix(bg, "#000000", 0.62),
    accent,
    accentText: contrast("#ffffff", accent) >= 3 ? "#ffffff" : "#111111",
  };
}

function fontFromName(name: string | undefined): FontKey | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("montserrat")) return "montserrat";
  if (n.includes("instrument")) return "instrument";
  if (n.includes("oswald") || n.includes("bebas") || n.includes("condensed")) return "oswald";
  if (n.includes("anton")) return "anton";
  if (n.includes("caveat") || n.includes("script")) return "caveat";
  if (n.includes("mono")) return "mono";
  if (n.includes("playfair") || n.includes("serif")) return "playfair";
  if (n.includes("inter")) return "inter";
  return null;
}

/**
 * Tema resuelto. Con una plantilla propia (`reference`), la paleta "referencia" usa sus colores y, si no se eligió
 * otra fuente, se usa la de la referencia.
 */
export function resolveTheme(theme: Record<string, string> | null | undefined, brand: BrandLook, reference?: { palette: Palette; font: FontKey } | null): ResolvedTheme {
  const valid = theme?.palette && (theme.palette === "marca" || (theme.palette === "referencia" && reference) || theme.palette in PALETTES);
  const paletteKey = valid ? theme!.palette! : "marca";
  const palette: Palette = paletteKey === "marca" ? brandPalette(brand.colors) : paletteKey === "referencia" ? reference!.palette : PALETTES[paletteKey]!;
  const accent = theme?.accent && HEX.test(theme.accent) ? theme.accent : palette.accent;
  const font: FontKey = theme?.font && theme.font in FONTS ? (theme.font as FontKey) : (reference?.font ?? fontFromName(brand.fonts?.heading) ?? "inter");
  return {
    ...palette,
    accent,
    accentText: accent === palette.accent ? palette.accentText : contrast("#ffffff", accent) >= 3 ? "#ffffff" : "#111111",
    palette: paletteKey,
    font,
    fontFamily: FONTS[font].family,
    heavy: FONTS[font].heavy,
  };
}

/** Identidad que va en cada slide (handle discreto, nombre y avatar de la plantilla Tweet). */
export type SlideIdentity = { name: string; handle: string; avatarUrl: string | null };

export function initials(name: string): string {
  const parts = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

export function newSlideId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function blankSlide(type: SlideType = "item"): CarouselSlide {
  return { id: newSlideId(), type, kicker: "", headline: type === "cta" ? "¿Quieres que te ayude con esto?" : "Nuevo slide", highlight: "", body: "", cta: "", template: null };
}
