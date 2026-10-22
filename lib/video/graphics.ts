/**
 * B-roll "a medida": gráficos animados con la marca del cliente (número que cuenta, lista, frase fuerte,
 * palabra clave, comparación y flujo de 3 pasos). Este archivo no importa nada de servidor: lo usan la app,
 * la vista previa del navegador (components/editor/graphic-canvas.tsx), el plan de b-roll y las pruebas.
 *
 * Un gráfico se guarda como `spec` (plantilla + textos + colores de marca + modo) dentro del plan del proyecto.
 * El worker lo dibuja cuadro a cuadro con Pillow (worker/video/graphics.py) con el mismo diseño que la vista previa
 * (lib/video/graphic-scene.ts). Los gráficos son propios: no llevan créditos.
 */
import { z } from "zod";
import { brandPalette, type BrandLook } from "@/lib/carousels/theme";
import type { BrollOption } from "./types";

export const GRAPHIC_TEMPLATES = {
  number: { label: "Número", hint: "Una cifra grande que cuenta (x2, +40 %, 10K)." },
  list: { label: "Lista", hint: "De 2 a 4 puntos que entran uno por uno." },
  quote: { label: "Frase fuerte", hint: "Tu frase palabra por palabra, con una palabra resaltada." },
  keyword: { label: "Palabra clave", hint: "Una idea en grande, con resaltado o subrayado." },
  compare: { label: "Comparación", hint: "Antes y después, o mito y realidad." },
  flow: { label: "Flujo", hint: "Tres pasos: A → B → C." },
} as const;
export type GraphicTemplate = keyof typeof GRAPHIC_TEMPLATES;
export const GRAPHIC_TEMPLATE_KEYS = Object.keys(GRAPHIC_TEMPLATES) as GraphicTemplate[];

export const GRAPHIC_MODES = {
  full: { label: "Pantalla completa", hint: "Fondo de tu marca; tu voz sigue debajo." },
  overlay: { label: "Sobre tu video", hint: "Un velo y el gráfico arriba o abajo, sin taparte la cara." },
} as const;
export type GraphicMode = keyof typeof GRAPHIC_MODES;

/** Límites de cada texto (los usan el esquema, el editor y la IA). */
export const GRAPHIC_LIMITS = {
  value: 10,
  label: 48,
  title: 44,
  item: 40,
  quote: 100,
  highlight: 40,
  keyword: 28,
  side: 56,
  sideLabel: 16,
  step: 24,
} as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const graphicThemeSchema = z.object({ bg: hex, surface: hex, text: hex, muted: hex, accent: hex, accentText: hex });
export type GraphicTheme = z.infer<typeof graphicThemeSchema>;
export type GraphicFont = "inter" | "montserrat";

const L = GRAPHIC_LIMITS;
const line = (max: number) => z.string().trim().max(max);
const filled = (max: number) => z.string().trim().min(1).max(max);
const base = {
  v: z.literal(1),
  mode: z.enum(["full", "overlay"]),
  /** Solo en "overlay": el gráfico va en el tercio superior o en el inferior (donde van los subtítulos, que se ocultan mientras se ve). */
  position: z.enum(["top", "bottom"]),
  theme: graphicThemeSchema,
  font: z.enum(["inter", "montserrat"]),
};

export const graphicSpecSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("number"), value: filled(L.value).regex(/\d/, "La cifra tiene que tener un número."), label: line(L.label), ...base }),
  z.object({ template: z.literal("list"), title: line(L.title), items: z.array(filled(L.item)).min(2).max(4), ...base }),
  z.object({ template: z.literal("quote"), text: filled(L.quote), highlight: line(L.highlight), ...base }),
  z.object({ template: z.literal("keyword"), text: filled(L.keyword), label: line(L.label), emphasis: z.enum(["highlight", "underline"]), ...base }),
  z.object({
    template: z.literal("compare"),
    left: z.object({ label: filled(L.sideLabel), text: filled(L.side) }),
    right: z.object({ label: filled(L.sideLabel), text: filled(L.side) }),
    ...base,
  }),
  z.object({ template: z.literal("flow"), title: line(L.title), steps: z.array(filled(L.step)).length(3), ...base }),
]);
export type GraphicSpec = z.infer<typeof graphicSpecSchema>;
export type GraphicSpecOf<T extends GraphicTemplate> = Extract<GraphicSpec, { template: T }>;

/** Lo visual que sale de Mi marca: paleta (la misma regla que los carruseles) y fuente de títulos. */
export type GraphicLook = { theme: GraphicTheme; font: GraphicFont };

export function brandGraphicLook(brand: BrandLook | null | undefined): GraphicLook {
  const p = brandPalette(brand?.colors ?? null);
  const heading = brand?.fonts?.heading?.toLowerCase() ?? "";
  return {
    theme: { bg: p.bg, surface: p.surface, text: p.text, muted: p.muted, accent: p.accent, accentText: p.accentText },
    font: heading.includes("montserrat") ? "montserrat" : "inter",
  };
}

/** Hash corto y estable (FNV-1a) del spec: identifica el gráfico (y su caché en el worker). */
export function graphicId(spec: GraphicSpec): string {
  const text = stableJson(spec);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `g${h1.toString(36)}${h2.toString(36)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Una alternativa de b-roll que es un gráfico (no tiene archivo: lo dibuja el worker). */
export function graphicOption(spec: GraphicSpec): BrollOption {
  return { source: "graphic", id: graphicId(spec), duration: 0, width: 0, height: 0, graphic: spec, title: graphicTitle(spec) };
}

/** Texto corto para listas y etiquetas ("Número · x2"). */
export function graphicTitle(spec: GraphicSpec): string {
  const main =
    spec.template === "number"
      ? spec.value
      : spec.template === "list"
        ? spec.title || spec.items[0]!
        : spec.template === "quote" || spec.template === "keyword"
          ? spec.text
          : spec.template === "compare"
            ? `${spec.left.label} / ${spec.right.label}`
            : spec.steps.join(" → ");
  return `${GRAPHIC_TEMPLATES[spec.template].label} · ${main}`.slice(0, 200);
}

/** Todos los textos visibles del gráfico (para revisar cifras y palabras prohibidas). */
export function graphicTexts(spec: GraphicSpec): string[] {
  switch (spec.template) {
    case "number":
      return [spec.value, spec.label];
    case "list":
      return [spec.title, ...spec.items];
    case "quote":
      return [spec.text, spec.highlight];
    case "keyword":
      return [spec.text, spec.label];
    case "compare":
      return [spec.left.label, spec.left.text, spec.right.label, spec.right.text];
    case "flow":
      return [spec.title, ...spec.steps];
  }
}

// ─── Plantilla por defecto (gráfico nuevo a mano) ─────────────────────────

/** Gráfico inicial para un tramo elegido a mano: si dice una cifra, "Número"; si no, la frase misma. */
export function defaultGraphic(spokenText: string, look: GraphicLook, template?: GraphicTemplate): GraphicSpec {
  const common = { v: 1 as const, theme: look.theme, font: look.font, position: "top" as const };
  const words = spokenText.replace(/\s+/g, " ").trim();
  const nums = spokenNumbers(words);
  const pick = template ?? (nums.length ? "number" : "quote");
  const short = (text: string, max: number) => {
    if (text.length <= max) return text;
    const cut = text.slice(0, max + 1);
    return (cut.lastIndexOf(" ") > max * 0.5 ? cut.slice(0, cut.lastIndexOf(" ")) : text.slice(0, max)).replace(/[,;:.\s]+$/, "");
  };
  const clean = words.replace(/[.…]+$/, "");
  const longest = [...clean.split(" ")].sort((a, b) => b.replace(/[^\p{L}]/gu, "").length - a.replace(/[^\p{L}]/gu, "").length)[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  switch (pick) {
    case "number":
      return { ...common, template: "number", mode: "full", value: nums[0] != null ? formatSpoken(nums[0]) : "x2", label: short(clean, L.label) };
    case "list":
      return { ...common, template: "list", mode: "full", title: "", items: ["Primer punto", "Segundo punto", "Tercer punto"] };
    case "keyword":
      return { ...common, template: "keyword", mode: "overlay", text: short(capitalize(longest || "Idea"), L.keyword), label: "", emphasis: "highlight" };
    case "compare":
      return { ...common, template: "compare", mode: "full", left: { label: "Antes", text: "Lo que hacías" }, right: { label: "Después", text: "Lo que funciona" } };
    case "flow":
      return { ...common, template: "flow", mode: "full", title: "", steps: ["Paso 1", "Paso 2", "Resultado"] };
    case "quote":
    default:
      return { ...common, template: "quote", mode: "overlay", text: short(capitalize(clean) || "Tu frase", L.quote), highlight: "" };
  }
}

/** Cambia de plantilla conservando lo que se pueda (los colores, el modo y un texto principal). */
export function switchTemplate(spec: GraphicSpec, template: GraphicTemplate, spokenText: string): GraphicSpec {
  if (spec.template === template) return spec;
  const next = defaultGraphic(spokenText || graphicTexts(spec).filter(Boolean).join(" "), { theme: spec.theme, font: spec.font }, template);
  return { ...next, mode: spec.mode, position: spec.position };
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// ─── Cifras: nunca se inventan ────────────────────────────────────────────

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  // Inglés (marcas que publican en inglés).
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const MULTIPLIERS: Record<string, number> = { mil: 1000, thousand: 1000, millon: 1e6, millones: 1e6, million: 1e6, millions: 1e6 };
/** Palabras que equivalen a una cifra en un gráfico ("el doble" → x2, "la mitad" → 50 %). */
const IMPLIED: Record<string, number[]> = { doble: [2], duplic: [2], tripl: [3], mitad: [50, 2], double: [2], half: [50, 2] };

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Lee un número escrito con cifras ("1.500", "2,5", "10K", "40%"). */
function parseDigits(token: string): number | null {
  const m = token.match(/(\d+(?:[.,]\d+)*)\s*([km]\b)?/i);
  if (!m) return null;
  let raw = m[1]!;
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, "");
  else raw = raw.replace(",", ".");
  let n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") n *= 1000;
  if (suffix === "m") n *= 1e6;
  return n;
}

/** Cifras que se dicen en un texto, con números o con palabras ("tres de cada diez", "diez mil", "el doble"). */
export function spokenNumbers(text: string): number[] {
  const out: number[] = [];
  const tokens = fold(text).split(/[^a-z0-9.,%]+/).filter(Boolean);
  let acc: number | null = null;
  let group = 0;
  const flush = () => {
    if (acc != null || group) out.push((acc ?? 0) + group);
    acc = null;
    group = 0;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.replace(/[.,]+$/, "");
    if (/\d/.test(t)) {
      flush();
      const n = parseDigits(t);
      const next = tokens[i + 1];
      if (n != null) {
        // "10 mil", "2 millones"
        const mult = next ? MULTIPLIERS[next] : undefined;
        if (mult) {
          out.push(n * mult);
          i++;
        } else out.push(n);
      }
      continue;
    }
    if (t in UNITS) {
      const v = UNITS[t]!;
      if (t === "hundred") group = (group || 1) * 100;
      else group += v;
      continue;
    }
    if (t in MULTIPLIERS) {
      const m = MULTIPLIERS[t]!;
      acc = (acc ?? 0) + (group || 1) * m;
      group = 0;
      continue;
    }
    if ((t === "y" || t === "and") && (group || acc != null)) continue;
    flush();
    for (const [stem, values] of Object.entries(IMPLIED)) if (t.startsWith(stem)) out.push(...values);
  }
  flush();
  // "por ciento" / "%" no cambian la cifra.
  return [...new Set(out)];
}

/** Cifras que aparecen escritas en los textos de un gráfico. */
export function writtenNumbers(spec: GraphicSpec): number[] {
  return numbersInTexts(graphicTexts(spec));
}

/** Cifras escritas con números en una lista de textos ("+40%", "10K", "1.500"). */
export function numbersInTexts(texts: string[]): number[] {
  const out: number[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(/\d+(?:[.,]\d+)*\s*[km]?\b/gi)) {
      const n = parseDigits(m[0]);
      if (n != null) out.push(n);
    }
  }
  return out;
}

/** Dos cifras son la misma (con una tolerancia mínima por redondeo). */
export const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.001);

/**
 * Las cifras del gráfico tienen que salir de lo que dice la persona en ese momento: cada número escrito tiene
 * que estar en lo dicho (con cifras o con palabras). Los números 1 a 4 sueltos en listas y flujos ("Paso 1")
 * no cuentan como cifra.
 */
export function numbersSupported(spec: GraphicSpec, spoken: string): boolean {
  return unsupportedNumbers(spec, spoken).length === 0;
}

/** Las cifras escritas en el gráfico que no se dicen en el tramo (sin repetir). */
export function unsupportedNumbers(spec: GraphicSpec, spoken: string): number[] {
  const said = spokenNumbers(spoken);
  const missing = writtenNumbers(spec).filter((n) => !(n >= 1 && n <= 4 && Number.isInteger(n) && spec.template !== "number") && !said.some((s) => sameNumber(s, n)));
  return [...new Set(missing)];
}

/** Cifra dicha → texto corto para el gráfico (10000 → "10K"). */
function formatSpoken(n: number): string {
  if (n >= 1e6 && n % 1e5 === 0) return `${trimZeros(n / 1e6)}M`;
  if (n >= 10000 && n % 100 === 0) return `${trimZeros(n / 1000)}K`;
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}
const trimZeros = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

// ─── Desde la respuesta de la IA ──────────────────────────────────────────

/** Lo que escribe Claude para un gráfico (campos planos; los que no aplican van vacíos). */
export type GraphicAi = {
  template: GraphicTemplate;
  mode: GraphicMode;
  position: "top" | "bottom";
  headline: string;
  label: string;
  highlight: string;
  items: string[];
  item_labels: string[];
};

const cut = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();

/** Arma y valida el spec a partir de lo que respondió la IA. null si no sirve (se usa stock en su lugar). */
export function graphicFromAi(raw: GraphicAi, look: GraphicLook): GraphicSpec | null {
  const common = { v: 1 as const, mode: raw.mode === "overlay" ? ("overlay" as const) : ("full" as const), position: raw.position === "bottom" ? ("bottom" as const) : ("top" as const), theme: look.theme, font: look.font };
  const items = (raw.items ?? []).map((s) => cut(s, 80)).filter(Boolean);
  let candidate: unknown;
  switch (raw.template) {
    case "number":
      candidate = { ...common, template: "number", value: cut(raw.headline, L.value).replace(/\s+/g, ""), label: cut(raw.label, L.label) };
      break;
    case "list":
      candidate = { ...common, template: "list", title: cut(raw.label || "", L.title), items: items.slice(0, 4).map((s) => cut(s, L.item)) };
      break;
    case "quote":
      candidate = { ...common, template: "quote", text: cut(raw.headline, L.quote), highlight: cut(raw.highlight, L.highlight) };
      break;
    case "keyword":
      candidate = { ...common, template: "keyword", text: cut(raw.headline, L.keyword), label: cut(raw.label, L.label), emphasis: "highlight" };
      break;
    case "compare": {
      const labels = (raw.item_labels ?? []).map((s) => cut(s, L.sideLabel));
      candidate = { ...common, template: "compare", left: { label: labels[0] || "Antes", text: cut(items[0], L.side) }, right: { label: labels[1] || "Después", text: cut(items[1], L.side) } };
      break;
    }
    case "flow":
      candidate = { ...common, template: "flow", title: cut(raw.label, L.title), steps: items.slice(0, 3).map((s) => cut(s, L.step)) };
      break;
    default:
      return null;
  }
  const parsed = graphicSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ─── Animación (compartida con el worker) ─────────────────────────────────

export const GRAPHIC_FPS = 30;
/** Un gráfico dura lo que dura su tramo; fuera de este rango se ve apurado o estirado. */
export const GRAPHIC_MIN_SECONDS = 1.5;
export const GRAPHIC_MAX_SECONDS = 5;
