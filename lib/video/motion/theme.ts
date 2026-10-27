/**
 * Tema de una escena: los colores y la fuente de la marca. Las capas nunca llevan hex sueltos: nombran un token
 * ("accent", "text", "surface@0.6") y el tema lo resuelve. Así la misma escena sirve para cualquier marca.
 */
import { z } from "zod";
import { contrast, isDark, mix, rgba } from "./color";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Color en formato #rrggbb.");

export const THEME_TOKENS = ["bg", "surface", "text", "muted", "accent", "accent2", "accentText", "positive", "negative", "line"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

export const MOTION_FONTS = ["inter", "montserrat"] as const;
export type MotionFont = (typeof MOTION_FONTS)[number];

export const themeSchema = z.object({
  bg: hex,
  surface: hex,
  text: hex,
  muted: hex,
  accent: hex,
  /** Segundo acento (degradados, series secundarias). Si falta, se deriva del acento. */
  accent2: hex.optional(),
  /** Texto sobre el acento. */
  accentText: hex,
  positive: hex.optional(),
  negative: hex.optional(),
  /** Fuente de títulos y cifras (los textos chicos van siempre en Inter). */
  font: z.enum(MOTION_FONTS).default("inter"),
  /** Fondo del modo pantalla completa: brillo del acento con grilla fina (Medianoche), solo brillo, o liso. */
  backdrop: z.enum(["glow-grid", "glow", "plain"]).default("glow-grid"),
});
export type MotionThemeInput = z.input<typeof themeSchema>;
export type MotionTheme = z.output<typeof themeSchema>;

/** Token de color, con opacidad opcional: "accent", "text@0.6". */
export const colorTokenSchema = z
  .string()
  .regex(new RegExp(`^(${THEME_TOKENS.join("|")})(@(0(\\.\\d+)?|1(\\.0+)?))?$`), "Usa un color del tema (accent, text, muted…), con opacidad opcional: text@0.6.");
export type ColorToken = ThemeToken | `${ThemeToken}@${number}`;

/** Tema completo (con los tokens derivados). */
export type ResolvedTheme = Record<ThemeToken, string> & { font: MotionFont; backdrop: MotionTheme["backdrop"]; dark: boolean };

export function resolveTheme(theme: MotionTheme): ResolvedTheme {
  const dark = isDark(theme.bg);
  const accent2 = theme.accent2 ?? mix(theme.accent, dark ? "#ffffff" : "#000000", 0.35);
  return {
    bg: theme.bg,
    surface: theme.surface,
    text: theme.text,
    muted: theme.muted,
    accent: theme.accent,
    accent2,
    accentText: theme.accentText,
    // Verde y rojo templados hacia el fondo para que no griten sobre la marca.
    positive: theme.positive ?? mix("#2fd38a", theme.bg, dark ? 0.08 : 0.2),
    negative: theme.negative ?? mix("#ff5c6c", theme.bg, dark ? 0.08 : 0.15),
    line: mix(theme.text, theme.bg, 0.82),
    font: theme.font,
    backdrop: theme.backdrop,
    dark,
  };
}

/** Separa "accent@0.4" en token y opacidad. */
export function splitToken(token: string): { name: ThemeToken; alpha: number } {
  const [name, a] = token.split("@");
  const alpha = a == null ? 1 : Math.max(0, Math.min(1, Number(a)));
  return { name: (THEME_TOKENS as readonly string[]).includes(name!) ? (name as ThemeToken) : "text", alpha: Number.isFinite(alpha) ? alpha : 1 };
}

/** Hex del token (sin la opacidad). */
export function tokenHex(theme: ResolvedTheme, token: string): string {
  return theme[splitToken(token).name];
}

/** Color CSS listo para el canvas. */
export function resolveColor(theme: ResolvedTheme, token: string, extraAlpha = 1): string {
  const { name, alpha } = splitToken(token);
  return rgba(theme[name], alpha * extraAlpha);
}

/** Temas de muestra (galería y pruebas). El de la marca sale de Mi marca con `themeFromLook`. */
export const SAMPLE_THEMES: Record<string, { label: string; theme: MotionThemeInput }> = {
  maestria: {
    label: "Medianoche",
    theme: { bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accent: "#2b8cff", accent2: "#8cc6ff", accentText: "#ffffff", font: "inter" },
  },
  papel: {
    label: "Papel y coral",
    theme: { bg: "#f3eee4", surface: "#ffffff", text: "#161412", muted: "#6b665d", accent: "#e2552d", accentText: "#ffffff", font: "montserrat", backdrop: "glow" },
  },
  carbon: {
    label: "Carbón y lima",
    theme: { bg: "#0b0b0c", surface: "#18181b", text: "#f5f5f4", muted: "#a1a1aa", accent: "#c8ff3d", accent2: "#7dd3fc", accentText: "#0b0b0c", font: "montserrat", backdrop: "glow" },
  },
};

/** El color de texto que mejor se lee sobre un fondo (entre el texto del tema y el del acento). */
export function readableOn(theme: ResolvedTheme, bgHex: string): string {
  return contrast(theme.text, bgHex) >= contrast(theme.accentText, bgHex) ? theme.text : theme.accentText;
}
