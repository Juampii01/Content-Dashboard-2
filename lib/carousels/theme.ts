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
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export function isTemplate(value: unknown): value is TemplateKey {
  return typeof value === "string" && value in TEMPLATES;
}

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
} as const;
export type FontKey = keyof typeof FONTS;

export type Palette = { bg: string; surface: string; text: string; muted: string; accent: string; accentText: string };

/** Paletas listas. "marca" se arma con los colores de Mi marca (con respaldo en los tokens MaestrIA). */
export const PALETTES: Record<string, { label: string } & Palette> = {
  medianoche: { label: "Medianoche", bg: "#030a22", surface: "#07163f", text: "#ffffff", muted: "#a7b9d4", accent: "#4da3ff", accentText: "#030a22" },
  papel: { label: "Papel", bg: "#f3eee4", surface: "#ffffff", text: "#141414", muted: "#5c5850", accent: "#e2552d", accentText: "#ffffff" },
  carbon: { label: "Carbón", bg: "#0d0d0d", surface: "#1a1a1a", text: "#f5f5f5", muted: "#9a9a9a", accent: "#c8ff3d", accentText: "#0d0d0d" },
  blanco: { label: "Blanco", bg: "#ffffff", surface: "#f2f4f7", text: "#0f1419", muted: "#536471", accent: "#0070f8", accentText: "#ffffff" },
  bosque: { label: "Bosque", bg: "#0f2a22", surface: "#163a2f", text: "#f1efe6", muted: "#a9bdb2", accent: "#f2c14e", accentText: "#0f2a22" },
};
export const PALETTE_KEYS = ["marca", ...Object.keys(PALETTES)] as const;

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

/** Paleta a partir de los colores de Mi marca. Si faltan o no se leen bien, usa los tokens MaestrIA. */
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
  if (n.includes("playfair") || n.includes("serif")) return "playfair";
  if (n.includes("inter")) return "inter";
  return null;
}

export function resolveTheme(theme: Record<string, string> | null | undefined, brand: BrandLook): ResolvedTheme {
  const paletteKey = theme?.palette && (theme.palette === "marca" || theme.palette in PALETTES) ? theme.palette : "marca";
  const palette: Palette = paletteKey === "marca" ? brandPalette(brand.colors) : PALETTES[paletteKey]!;
  const accent = theme?.accent && HEX.test(theme.accent) ? theme.accent : palette.accent;
  const font: FontKey = theme?.font && theme.font in FONTS ? (theme.font as FontKey) : (fontFromName(brand.fonts?.heading) ?? "inter");
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
