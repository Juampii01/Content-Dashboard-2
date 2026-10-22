/**
 * Gráficos del b-roll con el motor de motion graphics (escenas v2), junto a los gráficos v1 de los planes ya
 * guardados (6 plantillas, lib/video/graphics.ts). Este archivo no importa nada de servidor: lo usan la app, la
 * revisión en el navegador, el plan de b-roll y las pruebas.
 *
 * - Un gráfico del plan es un spec v1 o una escena v2 (`BrollGraphic`). Los dos se ven y se renderizan con el motor.
 * - El tema de una escena sale siempre de Mi marca (`motionTheme`); Claude solo nombra tokens ("accent", "text").
 * - `checkScene` junta todo lo que hace que un gráfico no sirva: lo que revisa el motor (desbordes, choques, zona
 *   segura, contraste), cifras que no se dicen, más de una idea y palabras prohibidas de la marca.
 */
import { z } from "zod";
import { COMPONENTS, type ComponentName } from "./motion/components";
import { sceneSchema, type ComponentLayer, type Layer, type MotionScene, type PrimitiveLayer } from "./motion/schema";
import type { MotionThemeInput } from "./motion/theme";
import type { Measurer } from "./motion/text";
import { validateScene, type SceneIssue } from "./motion/validate";
import {
  GRAPHIC_MODES,
  GRAPHIC_TEMPLATES,
  graphicId,
  graphicSpecSchema,
  graphicTexts,
  numbersInTexts,
  sameNumber,
  spokenNumbers,
  unsupportedNumbers,
  type GraphicLook,
  type GraphicSpec,
} from "./graphics";
import type { BrollOption, VideoFormat } from "./types";

export type BrollGraphic = GraphicSpec | MotionScene;

/** Un gráfico guardado en el plan: spec v1 (planes viejos) o escena v2. */
export const brollGraphicSchema = z.union([graphicSpecSchema, sceneSchema]);

export const isMotionScene = (g: unknown): g is MotionScene => Boolean(g) && typeof g === "object" && (g as { v?: unknown }).v === 2;

/** Tema de la escena a partir de Mi marca (la misma paleta que los carruseles y los gráficos v1). */
export function motionTheme(look: GraphicLook): MotionThemeInput {
  return { ...look.theme, font: look.font, backdrop: "glow-grid" };
}

/** La misma escena con los colores y la fuente de la marca (se aplica en el servidor antes de guardar y renderizar). */
export function withBrandTheme(scene: MotionScene, look: GraphicLook): MotionScene {
  return sceneSchema.parse({ ...scene, theme: motionTheme(look) });
}

// ─── Textos y etiquetas ───────────────────────────────────────────────────

function componentTexts(l: ComponentLayer): string[] {
  const def = COMPONENTS[l.component];
  const parsed = def.props.safeParse(l.props);
  if (parsed.success) return (def.texts as (p: unknown) => string[])(parsed.data).filter(Boolean);
  // Con props inválidas, igual se revisan los textos que haya (cifras y palabras prohibidas).
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(l.props);
  return out.filter(Boolean);
}

function primitiveTexts(l: PrimitiveLayer): string[] {
  if (l.type === "text") return [l.text];
  if (l.type === "counter") return [l.value];
  if (l.type === "group") return l.children.flatMap(primitiveTexts);
  return [];
}

/** Todos los textos visibles de una escena. */
export function sceneTexts(scene: MotionScene): string[] {
  return (scene.layers as Layer[]).flatMap((l) => (l.type === "component" ? componentTexts(l) : primitiveTexts(l)));
}

export function brollGraphicTexts(g: BrollGraphic): string[] {
  return isMotionScene(g) ? sceneTexts(g) : graphicTexts(g).filter(Boolean);
}

const mainComponent = (scene: MotionScene) => (scene.layers as Layer[]).find((l): l is ComponentLayer => l.type === "component") ?? null;

/** Qué tipo de gráfico es ("Embudo", "Número", "Texto animado"). */
export function graphicKindLabel(g: BrollGraphic): string {
  if (!isMotionScene(g)) return GRAPHIC_TEMPLATES[g.template].label;
  const main = mainComponent(g);
  if (main) return COMPONENTS[main.component].label;
  return (g.layers as Layer[]).some((l) => l.type === "counter") ? "Cifra animada" : "Texto animado";
}

export function graphicModeLabel(g: BrollGraphic): string {
  return g.mode === "full" ? GRAPHIC_MODES.full.label.toLowerCase() : "sobre tu video";
}

/** Texto corto para listas y etiquetas ("Embudo · Seguidores"). */
export function brollGraphicTitle(g: BrollGraphic): string {
  const main = brollGraphicTexts(g).find((t) => t.trim()) ?? "";
  return `${graphicKindLabel(g)}${main ? ` · ${main}` : ""}`.slice(0, 200);
}

/** Una alternativa de b-roll que es un gráfico (no tiene archivo: lo dibuja el worker). */
export function brollGraphicOption(g: BrollGraphic): BrollOption {
  return { source: "graphic", id: graphicId(g as GraphicSpec), duration: 0, width: 0, height: 0, graphic: g, title: brollGraphicTitle(g) };
}

// ─── Cifras: nunca se inventan ────────────────────────────────────────────

/** Componentes cuyo dato principal es una cifra: ahí hasta un 2 suelto es una cifra que se revisa. */
const FIGURE_COMPONENTS = new Set<ComponentName>(["statCard", "beforeAfter", "progress", "barChart", "lineChart", "funnel"]);

function hasFigures(scene: MotionScene): boolean {
  const visit = (l: Layer): boolean => (l.type === "component" ? FIGURE_COMPONENTS.has(l.component) : l.type === "counter" || (l.type === "group" && l.children.some(visit)));
  return (scene.layers as Layer[]).some(visit);
}

/**
 * Cifras escritas en la escena que no están en `allowed` (lo que se dice en el tramo y, en un pedido, lo que
 * escribe la persona). Los números 1 a 4 sueltos ("Paso 1") no cuentan si la escena no es de cifras.
 */
export function unsupportedSceneNumbers(scene: MotionScene, allowed: string): number[] {
  const said = spokenNumbers(allowed);
  const figures = hasFigures(scene);
  const missing = numbersInTexts(sceneTexts(scene)).filter((n) => !(!figures && n >= 1 && n <= 4 && Number.isInteger(n)) && !said.some((s) => sameNumber(s, n)));
  return [...new Set(missing)];
}

export function unsupportedGraphicNumbers(g: BrollGraphic, spoken: string): number[] {
  return isMotionScene(g) ? unsupportedSceneNumbers(g, spoken) : unsupportedNumbers(g, spoken);
}

// ─── Revisión completa ────────────────────────────────────────────────────

const FIELD_NAMES: Record<string, string> = {
  title: "el título",
  items: "los puntos",
  steps: "los pasos",
  levels: "los niveles",
  bars: "las barras",
  points: "los puntos de la línea",
  value: "la cifra",
  label: "el rótulo",
  text: "el texto",
  highlight: "lo resaltado",
  author: "el autor",
  eyebrow: "el rótulo de arriba",
  name: "el nombre",
  message: "el mensaje",
  caption: "el detalle",
  from: "la cifra de antes",
  to: "la cifra de después",
  fromLabel: "el rótulo de antes",
  toLabel: "el rótulo de después",
  startLabel: "el rótulo del inicio",
  endLabel: "el rótulo del final",
  left: "el lado izquierdo",
  right: "el lado derecho",
  icon: "el ícono",
  icons: "los íconos",
};

function pathName(path: PropertyKey[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (typeof p === "number") {
      parts.push(`n.º ${p + 1}`);
      continue;
    }
    const key = String(p);
    parts.push(FIELD_NAMES[key] ?? `«${key}»`);
  }
  return parts.join(" ").replace(/^(los|las) (\S+) n\.º/, "$2 n.º") || "un dato";
}

type ZIssue = { code: string; path: PropertyKey[]; maximum?: number | bigint; minimum?: number | bigint; origin?: string; message: string };

/** Problemas de las props de un componente, en español y con el límite (para que Claude los corrija). */
export function componentPropProblems(l: ComponentLayer): string[] {
  const def = COMPONENTS[l.component];
  const parsed = def.props.safeParse(l.props);
  if (parsed.success) return [];
  return (parsed.error.issues as ZIssue[]).slice(0, 6).map((i) => {
    const where = `En «${def.label}», ${pathName(i.path)}`;
    if (i.code === "too_big") return i.origin === "array" ? `${where} tiene demasiados elementos (máximo ${i.maximum}).` : i.origin === "string" ? `${where} es demasiado largo (máximo ${i.maximum} caracteres).` : `${where} es demasiado grande (máximo ${i.maximum}).`;
    if (i.code === "too_small") return i.origin === "array" ? `${where} necesita al menos ${i.minimum} elementos.` : i.origin === "string" ? `${where} está vacío.` : `${where} es demasiado chico (mínimo ${i.minimum}).`;
    if (i.code === "invalid_format") return `${where} tiene que llevar un número.`;
    if (i.code === "invalid_value") return `${where} no es una opción válida.`;
    return `${where} no sirve: ${i.message}`;
  });
}

export type SceneCheck = { ok: boolean; errors: string[]; warnings: string[]; issues: SceneIssue[] };

export type CheckOptions = {
  /** Lo que se dice en el tramo (y lo que escribió la persona en su pedido): de ahí salen las cifras permitidas. */
  allowed: string;
  bannedWords?: string[];
  /** Medición real del navegador (en el servidor se aproxima). */
  measure?: Measurer;
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Revisa una escena: lo que mira el motor, las cifras, una sola idea y las palabras prohibidas. */
export function checkScene(scene: MotionScene, opts: CheckOptions): SceneCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const layers = scene.layers as Layer[];
  const components = layers.filter((l): l is ComponentLayer => l.type === "component");
  for (const c of components) errors.push(...componentPropProblems(c));
  const result = validateScene(scene, opts.measure ? { measure: opts.measure } : {});
  // Los problemas de props ya están explicados arriba con más detalle.
  const issues = result.issues.filter((i) => i.code !== "component");
  for (const i of issues) (i.severity === "error" ? errors : warnings).push(i.message);
  if (components.length > 1) errors.push("Una sola idea por gráfico: usa un solo componente (y como mucho un texto o un ícono de apoyo).");
  if (layers.length > 8) errors.push("El gráfico tiene demasiados elementos: déjalo en 1 componente o hasta 6 primitivas.");
  const missing = unsupportedSceneNumbers(scene, opts.allowed);
  if (missing.length) {
    const list = missing.map((n) => String(n).replace(".", ",")).join(", ");
    errors.push(`${missing.length === 1 ? "La cifra" : "Las cifras"} ${list} no ${missing.length === 1 ? "aparece" : "aparecen"} en lo que dice la persona en este tramo: quítala o usa un componente sin cifras.`);
  }
  const banned = (opts.bannedWords ?? []).map((w) => w.trim()).filter(Boolean);
  if (banned.length) {
    const all = ` ${fold(sceneTexts(scene).join(" ")).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    for (const w of banned) if (all.includes(` ${fold(w)} `)) errors.push(`«${w}» está en las palabras prohibidas de la marca: usa otra.`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], issues };
}

// ─── Edición manual de los textos (revisión) ──────────────────────────────

export type SceneField = { id: string; group: string; label: string; kind: "text" | "number"; value: string | number; long: boolean };

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  items: "Punto",
  steps: "Paso",
  levels: "Nivel",
  bars: "Barra",
  value: "Cifra",
  label: "Rótulo",
  text: "Texto",
  highlight: "Palabras resaltadas",
  author: "Autor",
  eyebrow: "Rótulo de arriba",
  name: "Quién escribe",
  message: "Mensaje",
  caption: "Detalle",
  from: "Cifra de antes",
  to: "Cifra de después",
  fromLabel: "Rótulo de antes",
  toLabel: "Rótulo de después",
  startLabel: "Rótulo del inicio",
  endLabel: "Rótulo del final",
  prefix: "Antes de la cifra",
  suffix: "Después de la cifra",
  left: "Izquierda",
  right: "Derecha",
};
/** Props que no son textos para editar a mano (opciones, íconos, la forma de una curva). */
const SKIP = new Set(["marker", "icons", "icon", "emphasis", "style", "typing", "stack", "highlight_index", "points", "app", "time"]);
const LONG = new Set(["text", "message", "label", "caption"]);

/** Los textos (y cifras) de la escena que la persona puede cambiar a mano, en el orden en que se ven. */
export function sceneFields(scene: MotionScene): SceneField[] {
  const out: SceneField[] = [];
  (scene.layers as Layer[]).forEach((l, li) => {
    if (l.type === "component") {
      const group = COMPONENTS[l.component].label;
      const walk = (v: unknown, path: (string | number)[], label: string) => {
        const key = path[path.length - 1];
        if (typeof key === "string" && SKIP.has(key)) return;
        if (key === "highlight" && typeof v === "number") return;
        if (typeof v === "string") out.push({ id: `${li}:${path.join(".")}`, group, label, kind: "text", value: v, long: typeof key === "string" && LONG.has(key) && v.length > 28 });
        else if (typeof v === "number" && (l.component === "barChart" || l.component === "progress")) out.push({ id: `${li}:${path.join(".")}`, group, label, kind: "number", value: v, long: false });
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], `${label} ${i + 1}`));
        else if (v && typeof v === "object")
          Object.entries(v).forEach(([k, x]) => {
            const sub = FIELD_LABELS[k] ?? k;
            walk(x, [...path, k], path.length ? `${label} · ${sub.toLowerCase()}` : sub);
          });
      };
      walk(l.props, [], "");
    } else if (l.type === "text") out.push({ id: `${li}:text`, group: "Texto", label: `Texto ${li + 1}`, kind: "text", value: l.text, long: l.text.length > 28 });
    else if (l.type === "counter") out.push({ id: `${li}:value`, group: "Cifra", label: "Cifra", kind: "text", value: l.value, long: false });
  });
  // "Barra 1 · rótulo" en lugar de "Barras 1 · rótulo": el rótulo del arreglo va en singular (FIELD_LABELS).
  return out.map((f) => ({ ...f, label: f.label.replace(/^ · /, "") }));
}

/** La escena con un texto cambiado (sin validar: la vista previa y `checkScene` dicen si sirve). */
export function setSceneField(scene: MotionScene, id: string, value: string | number): MotionScene {
  const [li, path] = [Number(id.split(":")[0]), id.split(":")[1] ?? ""];
  const next = structuredClone(scene) as MotionScene;
  const layer = (next.layers as Layer[])[li];
  if (!layer) return scene;
  if (layer.type === "text" && path === "text") layer.text = String(value);
  else if (layer.type === "counter" && path === "value") layer.value = String(value);
  else if (layer.type === "component") {
    const keys = path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
    let obj = layer.props as Record<string | number, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string | number, unknown>;
    if (obj && typeof obj === "object") obj[keys[keys.length - 1]!] = value;
  }
  return next;
}

/** Duración con la que se ve un gráfico (la del tramo, entre 1,5 y 6 s). */
export const graphicSeconds = (span: number) => Math.max(1.5, Math.min(6, Number.isFinite(span) && span > 0 ? span : 3));

/** Formato y duración de la escena según el tramo (el render usa siempre los del tramo). */
export function sceneForSpan(scene: MotionScene, format: VideoFormat, span: number): MotionScene {
  return { ...scene, format, duration: graphicSeconds(span) };
}
