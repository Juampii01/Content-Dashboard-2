/**
 * Colores del informe a partir de Mi marca (sin dependencias de servidor: los usan el PDF y la vista previa).
 * La portada usa el color principal si es oscuro; si es claro (o no hay), el azul noche de MaestrIA y el color
 * de la marca como acento. El acento siempre se oscurece hasta leerse bien sobre blanco.
 */
import type { ReportBrand } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const ch = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

export function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  return `#${a.map((v, i) => Math.round(v * (1 - amount) + b[i]! * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function reportColors(brand: Pick<ReportBrand, "primary" | "accent">): { cover: string; accent: string } {
  const primary = brand.primary && HEX.test(brand.primary) ? brand.primary.toLowerCase() : null;
  const darkPrimary = primary && luminance(primary) < 0.18 ? primary : null;
  let accent = (brand.accent && HEX.test(brand.accent) ? brand.accent : null) ?? (primary && primary !== darkPrimary ? primary : null) ?? "#0070f8";
  for (let i = 0; i < 6 && contrast(accent, "#ffffff") < 3.2; i++) accent = mix(accent, "#000000", 0.2);
  return { cover: darkPrimary ?? "#030a22", accent: accent.toLowerCase() };
}
