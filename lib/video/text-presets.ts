/**
 * Textos y títulos a mano (Estudio → Biblioteca → Textos): un texto con estilo es un b-roll "graphic" cuya escena v2
 * (lib/video/motion) va sobre el video, sin velo. Así se ve igual en la vista previa y en el render del worker, se
 * mueve en el lienzo como cualquier gráfico y entra en la línea de tiempo con sus capas.
 *
 * - `TextSpec` es lo que eligió la persona (texto, estilo, color, tamaño y lugar). Se guarda en el b-roll
 *   (`BrollOption.text`) para poder volver a armar la escena cuando cambia algo.
 * - `textScene` arma la escena: la fuente y los colores de la marca (`GraphicLook`), y un color propio si lo eligió.
 *   Los colores que no son del tema van en `scene.colors` (el render vuelve a poner el tema de la marca, no esos).
 *
 * En `colors`, los tokens del tema se usan así: `text` = el texto suelto, `accent` = el color destacado (marcador,
 * etiqueta, botón), `accentText` = la tinta sobre el destacado, `surface` = la caja y `muted` = la tinta sobre la caja.
 * `bg` es un oscuro de referencia: sobre el video no hay fondo (sin velo), pero el validador mide el contraste contra él.
 *
 * Sin servidor ni navegador: lo usan el Estudio, el inspector y las pruebas.
 */
import { z } from "zod";
import { contrast, mix } from "./motion/color";
import { approxMeasure } from "./motion/validate";
import { sceneSchema, type MotionScene, type MotionSceneInput } from "./motion/schema";
import type { ThemeColors } from "./motion/theme";
import { motionTheme } from "./motion-graphics";
import { graphicId, type GraphicLook, type GraphicSpec } from "./graphics";
import type { BrollOption, VideoFormat } from "./types";

export const TEXT_PRESET_KEYS = ["title", "titleBox", "subtitle", "pill", "number", "quote", "marker", "strike", "cta", "lowerThird", "typewriter", "neon"] as const;
export type TextPresetKey = (typeof TEXT_PRESET_KEYS)[number];
export const isTextPreset = (v: unknown): v is TextPresetKey => typeof v === "string" && (TEXT_PRESET_KEYS as readonly string[]).includes(v);

/** Qué cambia el color que elige la persona: el texto, el destacado (marcador, etiqueta, botón) o la caja. */
type ColorRole = "text" | "accent" | "box";

export const TEXT_PRESETS: Record<TextPresetKey, { label: string; hint: string; sample: string; sub?: string; role: ColorRole; position: TextPosition; subLabel?: string; emphasis?: boolean }> = {
  title: { label: "Título grande", hint: "En mayúsculas, se acerca al entrar.", sample: "Esto cambia todo", role: "text", position: "center" },
  titleBox: { label: "Título con fondo", hint: "Sobre una caja que se descubre de lado.", sample: "Paso número uno", role: "box", position: "top" },
  subtitle: { label: "Subtítulo inferior", hint: "Una línea abajo, sobre una franja oscura.", sample: "Lo que nadie te cuenta", role: "text", position: "bottom" },
  pill: { label: "Etiqueta", hint: "Corta, en una píldora con tu color.", sample: "Nuevo", role: "accent", position: "top" },
  number: { label: "Número gigante", hint: "La cifra cuenta hasta su valor.", sample: "100", sub: "cambia este número por el tuyo", role: "accent", position: "center", subLabel: "Detalle debajo" },
  quote: { label: "Cita", hint: "Una frase entre comillas, palabra por palabra.", sample: "Hecho es mejor que perfecto", sub: "Tu nombre", role: "text", position: "center", subLabel: "Autor", emphasis: true },
  marker: { label: "Resaltado", hint: "Un marcador barre las palabras clave.", sample: "La clave es la constancia", role: "accent", position: "center", emphasis: true },
  strike: { label: "Tachado", hint: "Una línea tacha lo que no va.", sample: "Publicar sin plan", role: "accent", position: "center", emphasis: true },
  cta: { label: "Llamado a la acción", hint: "Un botón que late para que te escriban.", sample: "Escríbeme «GUÍA»", role: "accent", position: "bottom" },
  lowerThird: { label: "Nombre y cargo", hint: "Tu nombre y a qué te dedicas, de lado.", sample: "Ana Gómez", sub: "Coach de ventas", role: "accent", position: "bottom", subLabel: "Cargo" },
  typewriter: { label: "Máquina de escribir", hint: "Las letras aparecen de a una.", sample: "Te lo explico en 30 segundos", role: "text", position: "center" },
  neon: { label: "Neón", hint: "Brilla con tu color y titila al entrar.", sample: "Abierto", role: "accent", position: "center" },
};

export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export const TEXT_POSITION_LABELS: Record<TextPosition, string> = { top: "Arriba", center: "Centro", bottom: "Abajo" };

export const TEXT_SIZES = ["s", "m", "l"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { s: "Chico", m: "Mediano", l: "Grande" };
const SIZE_SCALE: Record<TextSize, number> = { s: 0.8, m: 1, l: 1.25 };

/** Colores fijos que se pueden elegir además de los de la marca. */
export const TEXT_COLOR_SWATCHES = ["auto", "brand", "white", "black"] as const;
export const TEXT_COLOR_LABELS: Record<(typeof TEXT_COLOR_SWATCHES)[number], string> = { auto: "El del estilo", brand: "Color de tu marca", white: "Blanco", black: "Negro" };

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const TEXT_MAX = 120;

export const textSpecSchema = z.object({
  preset: z.enum(TEXT_PRESET_KEYS),
  text: z.string().trim().min(1).max(TEXT_MAX),
  /** Segunda línea: el cargo (nombre y cargo), el autor (cita) o el detalle (número). */
  sub: z.string().trim().max(40).optional(),
  /** Palabras que se resaltan o se tachan (sin el campo: las del final, o todo si es corto). */
  emphasis: z.string().trim().max(80).optional(),
  color: z.union([z.enum(TEXT_COLOR_SWATCHES), hex]).default("auto"),
  size: z.enum(TEXT_SIZES).default("m"),
  /** Sin el campo, el lugar del estilo. */
  position: z.enum(TEXT_POSITIONS).optional(),
});
export type TextSpec = z.output<typeof textSpecSchema>;
export type TextSpecInput = z.input<typeof textSpecSchema>;

/** Lo que dura un texto nuevo en la línea de tiempo. */
export const TEXT_SECONDS = 2.5;

// ─── Colores ──────────────────────────────────────────────────────────────

const WHITE = "#ffffff";
const INK = "#111111";
/** Oscuro de referencia del video (para el contraste y los colores derivados). */
const VIDEO_DARK = "#101114";

const readable = (bg: string) => (contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK);
/** Tinta sobre el destacado: blanca si se lee (los textos del destacado son grandes y gruesos, piden 3:1). */
const inkOnAccent = (bg: string) => (contrast(WHITE, bg) >= 3.2 ? WHITE : readable(bg));

/** El color que pidió la persona (o el del estilo) en hex. */
function pick(color: TextSpec["color"], look: GraphicLook, fallback: string): string {
  if (color === "auto") return fallback;
  if (color === "brand") return look.theme.accent;
  if (color === "white") return WHITE;
  if (color === "black") return INK;
  return color.toLowerCase();
}

/** Acento de la marca que se lee sobre el video oscuro (si es muy oscuro, se aclara). */
function brandOnVideo(look: GraphicLook): string {
  const a = look.theme.accent;
  return contrast(a, VIDEO_DARK) >= 3 ? a : mix(a, WHITE, 0.45);
}

function colorsFor(spec: TextSpec, look: GraphicLook): ThemeColors {
  const role = TEXT_PRESETS[spec.preset].role;
  const brand = brandOnVideo(look);
  // Lo de siempre: texto blanco sobre el video y el acento de la marca; la caja del título, blanca.
  let text = WHITE;
  let accent = look.theme.accent;
  let surface = WHITE;
  // La cifra y el neón brillan con el color de la marca (aclarado si sobre el video oscuro no se ve).
  if (spec.preset === "number") accent = pick(spec.color, look, brand);
  else if (spec.preset === "neon") accent = pick(spec.color, look, mix(brand, WHITE, 0.25));
  else if (role === "text") text = pick(spec.color, look, WHITE);
  else if (role === "accent") accent = pick(spec.color, look, look.theme.accent);
  else surface = pick(spec.color, look, WHITE);
  if (spec.preset === "subtitle") surface = "#000000";
  return { bg: VIDEO_DARK, text, accent, accentText: inkOnAccent(accent), surface, muted: readable(surface) };
}

// ─── Lugar ────────────────────────────────────────────────────────────────

/** Centro vertical (fracción del alto) de cada lugar. */
function yOf(pos: TextPosition, vertical: boolean): number {
  if (pos === "top") return vertical ? 0.2 : 0.2;
  if (pos === "bottom") return vertical ? 0.71 : 0.78;
  return 0.48;
}

/** Caja horizontal: en 9:16 abajo se corre a la izquierda (a la derecha están los botones de Reels). */
function xw(pos: TextPosition, vertical: boolean, w: number): { x: number; w: number } {
  if (vertical && pos === "bottom") return { x: 0.47, w: Math.min(w, 0.74) };
  return { x: 0.5, w };
}

/** Palabras resaltadas por defecto: todo si son hasta 3; si no, las 2 del final. */
export function defaultEmphasis(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out = words.length <= 3 ? words.join(" ") : words.slice(-2).join(" ");
  return out.slice(0, 80);
}

/** Una cifra que puede contar (tiene número y entra en el contador). */
const countable = (text: string) => /\d/.test(text) && text.trim().length <= 14;

// ─── Escena ───────────────────────────────────────────────────────────────

type Layers = MotionSceneInput["layers"];

function layersFor(spec: TextSpec, vertical: boolean): { layers: Layers; exit: NonNullable<MotionSceneInput["exit"]> } {
  const k = SIZE_SCALE[spec.size];
  const pos = spec.position ?? TEXT_PRESETS[spec.preset].position;
  const y = yOf(pos, vertical);
  const text = spec.text;
  const sub = spec.sub?.trim() ?? "";
  const words = (spec.emphasis?.trim() || defaultEmphasis(text)).slice(0, 80);
  switch (spec.preset) {
    case "title": {
      const b = xw(pos, vertical, 0.86);
      return {
        layers: [{ type: "text", text, ...b, y, size: 124 * k, minSize: 56, font: "display", weight: 900, uppercase: true, leading: 1.02, maxLines: 3, color: "text", shadow: "soft", animate: [{ type: "zoomIn", at: 0, dur: 0.6, from: 1.18 }] }],
        exit: "zoom",
      };
    }
    case "titleBox": {
      const b = xw(pos, vertical, 0.84);
      return {
        layers: [{ type: "text", text, ...b, y, size: 80 * k, minSize: 40, font: "display", weight: 800, maxLines: 3, color: "muted", box: { fill: "surface", radius: 22, padX: 38, padY: 22 }, animate: [{ type: "wipe", at: 0, dur: 0.5, dir: "right" }] }],
        exit: "sink",
      };
    }
    case "subtitle": {
      const b = xw(pos, vertical, 0.84);
      return {
        layers: [{ type: "text", text, ...b, y, size: 58 * k, minSize: 34, font: "body", weight: 600, leading: 1.2, maxLines: 2, color: "text", box: { fill: "surface@0.62", radius: 14, padX: 28, padY: 14 }, animate: [{ type: "fadeUp", at: 0, dur: 0.45, dist: 22 }] }],
        exit: "fade",
      };
    }
    case "pill": {
      const b = xw(pos, vertical, 0.7);
      return {
        layers: [{ type: "text", text, ...b, y, size: 52 * k, minSize: 28, font: "display", weight: 800, uppercase: true, tracking: 0.08, maxLines: 1, color: "accentText", box: { fill: "accent", shape: "pill", padX: 36, padY: 14 }, animate: [{ type: "pop", at: 0, dur: 0.55, from: 0.6, bounce: 0.4 }] }],
        exit: "fade",
      };
    }
    case "number": {
      const b = xw(pos, vertical, 0.86);
      // La cifra no se achica sola: su tamaño sale de lo que mide (con margen para la fuente real) y del ancho.
      const W = vertical ? 1080 : 1920;
      const H = vertical ? 1920 : 1080;
      const counts = countable(text);
      const per100 = approxMeasure(text.trim(), "900 100px Inter", -4) / 100;
      // Una palabra en lugar de cifra: una línea que se achica sola (el texto sí se ajusta a su caja).
      const big = counts ? Math.max(90, Math.min((vertical ? 300 : 260) * k, (b.w * W * 0.82) / Math.max(0.1, per100))) : (vertical ? 230 : 200) * k;
      // Con detalle, el bloque (cifra + detalle) queda centrado en su lugar y dentro de la zona segura.
      const subGap = (big * 0.62 + 46 * k) / H;
      const bottomLimit = vertical ? 0.8 : 0.86;
      let cy = sub ? y - subGap / 2 : y;
      if (sub && cy + subGap > bottomLimit) cy = bottomLimit - subGap;
      cy = Math.max(cy, 0.08 + (big * 0.55) / H);
      const main: Layers[number] = counts
        ? { type: "counter", value: text.trim(), x: b.x, y: cy, size: big, color: "accent", affixColor: "accent", shadow: "soft", animate: [{ type: "pop", at: 0, dur: 0.6, from: 0.7, bounce: 0.3 }, { type: "countUp", at: 0.05, dur: 1.1 }] }
        : { type: "text", text, ...b, y: cy, size: big, minSize: 60, font: "display", weight: 900, maxLines: 1, leading: 1, color: "accent", shadow: "soft", animate: [{ type: "pop", at: 0, dur: 0.6, from: 0.7, bounce: 0.3 }] };
      const layers: Layers = [main];
      if (sub) layers.push({ type: "text", text: sub, ...b, y: cy + subGap, size: 52 * k, minSize: 30, font: "body", weight: 600, maxLines: 1, color: "text", shadow: "soft", animate: [{ type: "fadeUp", at: 0.45, dur: 0.5, dist: 20 }] });
      return { layers, exit: "zoom" };
    }
    case "quote": {
      const b = xw(pos, vertical, 0.86);
      const h = vertical ? 0.34 : 0.56;
      const top = Math.max(0.07, Math.min(0.84 - h, y - h / 2));
      return {
        layers: [
          {
            type: "component",
            component: "quote",
            props: { text, highlight: spec.emphasis?.trim() ?? "", author: sub },
            region: { x: b.x - b.w / 2, y: top, w: b.w, h },
            scale: Math.max(0.5, Math.min(1.6, k)),
          },
        ],
        exit: "fade",
      };
    }
    case "marker": {
      const b = xw(pos, vertical, 0.84);
      return {
        layers: [{ type: "text", text, ...b, y, size: 92 * k, minSize: 44, font: "display", weight: 800, maxLines: 3, color: "text", shadow: "soft", emphasis: { words, style: "marker", color: "accent" }, animate: [{ type: "fadeUp", at: 0, dur: 0.5, dist: 30 }, { type: "highlight", at: 0.45, dur: 0.5 }] }],
        exit: "auto",
      };
    }
    case "strike": {
      const b = xw(pos, vertical, 0.84);
      return {
        layers: [{ type: "text", text, ...b, y, size: 92 * k, minSize: 44, font: "display", weight: 800, maxLines: 3, color: "text", shadow: "soft", emphasis: { words, style: "strike", color: "accent" }, animate: [{ type: "fadeIn", at: 0, dur: 0.35 }, { type: "strike", at: 0.45, dur: 0.45 }] }],
        exit: "sink",
      };
    }
    case "cta": {
      const b = xw(pos, vertical, 0.74);
      return {
        layers: [{ type: "text", text, ...b, y, size: 58 * k, minSize: 32, font: "display", weight: 800, maxLines: 2, color: "accentText", box: { fill: "accent", shape: "pill", padX: 44, padY: 22 }, shadow: "soft", animate: [{ type: "pop", at: 0, dur: 0.6, from: 0.5, bounce: 0.45 }, { type: "pulse", at: 0.8, period: 1.1, amount: 0.04, count: 3 }] }],
        exit: "fade",
      };
    }
    case "lowerThird": {
      // Arriba a la izquierda del bloque: el nombre en una caja del color, el cargo debajo en una franja oscura.
      const H = vertical ? 1920 : 1080;
      const x = vertical ? 0.075 : 0.06;
      const w = vertical ? 0.72 : 0.5;
      const nameSize = 66 * k;
      const nameH = nameSize * 1.12 + 2 * 14;
      const subSize = 40 * k;
      const total = nameH + (sub ? 10 + subSize * 1.2 + 2 * 10 : 0);
      const top = y - total / 2 / H;
      const layers: Layers = [
        { type: "text", text, x, y: top, anchor: "top-left", w, size: nameSize, minSize: 34, font: "display", weight: 800, align: "left", maxLines: 1, color: "accentText", box: { fill: "accent", radius: 10, padX: 22, padY: 14 }, animate: [{ type: "slide", at: 0, dur: 0.55, dir: "right", dist: 70 }] },
      ];
      if (sub) layers.push({ type: "text", text: sub, x, y: top + (nameH + 10) / H, anchor: "top-left", w, size: subSize, minSize: 24, font: "body", weight: 600, align: "left", maxLines: 1, color: "muted", box: { fill: "surface", radius: 8, padX: 18, padY: 10 }, animate: [{ type: "slide", at: 0.15, dur: 0.5, dir: "right", dist: 50 }] });
      return { layers, exit: "fade" };
    }
    case "typewriter": {
      const b = xw(pos, vertical, 0.84);
      return {
        layers: [{ type: "text", text, ...b, y, size: 76 * k, minSize: 38, font: "display", weight: 700, maxLines: 3, color: "text", shadow: "soft", animate: [{ type: "typewriter", at: 0.05 }] }],
        exit: "fade",
      };
    }
    case "neon": {
      const b = xw(pos, vertical, 0.84);
      // Titila al prenderse (opacidad a mano) y queda con su brillo.
      return {
        layers: [
          {
            type: "text",
            text,
            ...b,
            y,
            size: 116 * k,
            minSize: 52,
            font: "display",
            weight: 800,
            uppercase: true,
            tracking: 0.04,
            maxLines: 2,
            color: "accent",
            shadow: "glow",
            animate: [{ type: "zoomIn", at: 0, dur: 0.5, from: 1.06 }],
            tracks: { opacity: [{ t: 0, v: 0 }, { t: 0.07, v: 1 }, { t: 0.13, v: 0.15 }, { t: 0.2, v: 0.9 }, { t: 0.27, v: 0.3 }, { t: 0.42, v: 1 }] },
          },
        ],
        exit: "fade",
      };
    }
  }
}

/** Escena v2 de un texto a mano (sobre el video, sin velo, con la marca y el color elegido). */
export function textScene(input: TextSpecInput, look: GraphicLook, opts: { format: VideoFormat; duration?: number }): MotionScene {
  const spec = textSpecSchema.parse(input);
  const vertical = opts.format === "9:16";
  const pos = spec.position ?? TEXT_PRESETS[spec.preset].position;
  const { layers, exit } = layersFor(spec, vertical);
  return sceneSchema.parse({
    v: 2,
    duration: Math.max(0.6, Math.min(30, opts.duration ?? TEXT_SECONDS)),
    format: opts.format,
    mode: "overlay",
    // Abajo: los subtítulos se ocultan mientras se ve (van en la misma franja).
    position: pos === "bottom" ? "bottom" : "top",
    theme: { ...motionTheme(look), backdrop: "plain" },
    exit,
    veil: "none",
    colors: colorsFor(spec, look),
    layers,
  } satisfies MotionSceneInput);
}

/** Título corto para la línea de tiempo y las listas. */
export const textTitle = (spec: TextSpec) => `${TEXT_PRESETS[spec.preset].label} · ${spec.text}`.slice(0, 200);

/** El b-roll de un texto: un gráfico con su escena y lo que eligió la persona (para volver a armarla). */
export function textOption(input: TextSpecInput, look: GraphicLook, opts: { format: VideoFormat; duration?: number }): BrollOption {
  const spec = textSpecSchema.parse(input);
  const graphic = textScene(spec, look, opts);
  return { source: "graphic", id: graphicId(graphic as unknown as GraphicSpec), duration: 0, width: 0, height: 0, graphic, title: textTitle(spec), text: spec };
}

/** El mismo texto con cambios (texto, estilo, color, tamaño o lugar): vuelve a armar la escena y conserva el lugar del lienzo. */
export function updateTextOption(option: BrollOption, patch: Partial<TextSpecInput>, look: GraphicLook, format: VideoFormat): BrollOption | null {
  if (!option.text) return null;
  const parsed = textSpecSchema.safeParse({ ...option.text, ...patch });
  if (!parsed.success) return null;
  return textOption(parsed.data, look, { format });
}

/** Es un texto a mano (un gráfico con su `text`). */
export const isTextOption = (o: BrollOption | null | undefined): o is BrollOption & { text: TextSpec } => Boolean(o && o.source === "graphic" && o.text);
