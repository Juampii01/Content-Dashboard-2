/**
 * De la respuesta de Claude a una escena v2 lista para guardar, con validación, reintento y arreglos automáticos.
 *
 * Flujo (lo usan el plan automático del b-roll y "Pide tu gráfico"):
 * 1. `sceneFromAi`: la respuesta (esquema plano de lib/ai/prompts/motion.ts) → escena v2 con el tema de Mi marca.
 *    Valores fuera de rango se acotan, íconos y colores ya vienen saneados por el esquema.
 * 2. `checkScene` (motion-graphics.ts): motor (desbordes, choques, zona segura, contraste), cifras, una idea, palabras
 *    prohibidas.
 * 3. Si hay errores, un reintento a Claude con los problemas explicados (`retry`, hasta `retries` veces).
 * 4. Si sigue mal: `autoFix` (recorta textos a su límite, achica, pasa a pantalla completa) y, si tampoco, un
 *    componente más simple (`fallbackScene`: palabra clave o frase, sin cifras dudosas).
 *
 * No importa nada de servidor: el reintento se inyecta (`retry`), así se prueba sin red (tests/motion-ai.test.mts).
 */
import type { MotionLayerAi, MotionPrimitiveAi, MotionSceneAi } from "@/lib/ai/prompts/motion";
import { COMPONENTS, COMPONENT_NAMES, type ComponentName } from "./motion/components";
import { contentRegion } from "./motion/compile";
import { isIconName } from "./motion/icons";
import { sceneSchema, type ComponentLayer, type Layer, type MotionScene, type MotionSceneInput } from "./motion/schema";
import { BEHAVIORS } from "./motion/animate";
import { THEME_TOKENS } from "./motion/theme";
import type { GraphicLook } from "./graphics";
import { checkScene, graphicSeconds, motionTheme, unsupportedSceneNumbers, type CheckOptions, type SceneCheck } from "./motion-graphics";
import type { VideoFormat } from "./types";

export type SceneContext = { look: GraphicLook; format: VideoFormat; duration: number };

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(lo, Math.min(hi, v));
};
const token = (t: unknown, fallback = "text") => (typeof t === "string" && (THEME_TOKENS as readonly string[]).includes(t) ? t : fallback);
const size = (format: VideoFormat) => (format === "9:16" ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 });

// ─── Respuesta de la IA → escena ──────────────────────────────────────────

type BehaviorIn = { type: string; at: number; dur: number; dir: string };
type BehaviorOut = { type: (typeof BEHAVIORS)[number]; at: number; dur?: number; dir?: "left" | "right" | "up" | "down" };
function behaviors(list: BehaviorIn[] | undefined, fallback: { type: string; at: number }): BehaviorOut[] {
  const out = (list ?? [])
    .filter((b) => (BEHAVIORS as readonly string[]).includes(b.type))
    .slice(0, 6)
    .map((b) => ({
      type: b.type as (typeof BEHAVIORS)[number],
      at: clamp(b.at, 0, 20, 0),
      ...(b.dur > 0 ? { dur: clamp(b.dur, 0.05, 6, 0.6) } : {}),
      ...(["left", "right", "up", "down"].includes(b.dir) ? { dir: b.dir as "left" | "right" | "up" | "down" } : {}),
    }));
  return out.length ? out : [{ type: fallback.type as (typeof BEHAVIORS)[number], at: fallback.at }];
}

/** Caja del componente en pantalla completa cuando se pide arriba o abajo (fracciones del lienzo). */
function placeRegion(place: string, format: VideoFormat): ComponentLayer["region"] {
  if (place !== "top" && place !== "bottom") return undefined;
  const { W, H } = size(format);
  const r = contentRegion(W, H, "full", "top");
  const x = r.x / W;
  const w = r.w / W;
  const y0 = r.y / H;
  const h = r.h / H;
  return place === "top" ? { x, y: y0, w, h: h * 0.56 } : { x, y: y0 + h * 0.44, w, h: h * 0.56 };
}

/** Props del componente tal como las escribió la IA, sin los opcionales vacíos que el componente no acepta. */
function cleanProps(component: ComponentName, raw: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = { ...raw };
  if (component === "statCard" && !isIconName(p.icon)) delete p.icon;
  if ((component === "list" || component === "steps") && Array.isArray(p.icons)) {
    p.icons = (p.icons as unknown[]).filter(isIconName);
    const count = ((component === "list" ? p.items : p.steps) as unknown[] | undefined)?.length ?? 0;
    if (component === "list" && p.marker === "icon" && (p.icons as unknown[]).length < count) p.marker = "number";
    if (component === "steps" && (p.icons as unknown[]).length && (p.icons as unknown[]).length < count) p.icons = [];
  }
  if (component === "dmNotification") {
    p.stack = clamp(p.stack, 0, 2, 1);
    if (!p.app) p.app = "Mensajes";
    if (!p.time) p.time = "ahora";
  }
  if (component === "barChart") p.highlight = clamp(p.highlight, -1, 5, -1);
  if (component === "progress") p.value = clamp(p.value, 0, 100, 0);
  return p;
}

function primitiveFromAi(l: MotionPrimitiveAi, i: number): MotionSceneInput["layers"][number] | null {
  const x = clamp(l.kind === "line" ? 0.5 : l.x, 0, 1, 0.5);
  const y = clamp(l.kind === "line" ? 0.5 : l.y, 0, 1, 0.5);
  const at = Math.min(2, i * 0.3);
  switch (l.kind) {
    case "text": {
      const t = l.text.trim();
      if (!t) return null;
      const style = l.emphasis_style;
      const words = l.emphasis_words.trim();
      return {
        type: "text",
        text: t.slice(0, 240),
        x,
        y,
        w: clamp(l.w, 0.1, 1, 0.84),
        size: clamp(l.size, 20, 400, 72),
        font: l.font === "body" ? "body" : "display",
        weight: Math.round(clamp(l.weight, 400, 900, 800) / 100) * 100,
        color: token(l.color),
        align: l.align,
        uppercase: Boolean(l.uppercase),
        ...(style !== "none" && words && t.toLowerCase().includes(words.toLowerCase()) ? { emphasis: { words: words.slice(0, 80), style, color: "accent" } } : {}),
        animate: behaviors(l.animate, { type: "fadeUp", at }),
      };
    }
    case "icon":
      if (!isIconName(l.name)) return null;
      return { type: "icon", name: l.name, x, y, size: clamp(l.size, 40, 600, 180), color: token(l.color, "accent"), tile: l.tile, animate: behaviors(l.animate, { type: "pop", at }) };
    case "counter":
      if (!/\d/.test(l.value)) return null;
      return { type: "counter", value: l.value.trim().slice(0, 14), x, y, size: clamp(l.size, 60, 600, 220), color: token(l.color), animate: behaviors(l.animate, { type: "countUp", at }) };
    case "line": {
      const pts = (l.points ?? []).slice(0, 24).map((p) => [clamp(p.x, 0, 1, 0.5), clamp(p.y, 0, 1, 0.5)] as [number, number]);
      if (pts.length < 2) return null;
      return { type: "line", points: pts, bend: clamp(l.bend, -1, 1, 0), color: token(l.color, "accent"), width: clamp(l.width, 1, 40, 8), head: l.head === "end" ? "end" : "none", animate: behaviors(l.animate, { type: "draw", at }) };
    }
    case "shape": {
      const fill = l.fill === "none" ? undefined : token(l.fill, "surface");
      const stroke = l.stroke === "none" ? undefined : token(l.stroke, "line");
      const common = { x, y, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}), animate: behaviors(l.animate, { type: "fadeIn", at }) };
      if (l.shape === "circle") return { type: "ellipse", w: clamp(l.w, 0.02, 1, 0.3), ...common };
      return { type: "rect", w: clamp(l.w, 0.02, 1, 0.5), h: clamp(l.h, 0.01, 1, 0.1), shape: l.shape === "pill" ? "pill" : "rect", card: Boolean(l.card), radius: l.card ? 32 : 0, ...common };
    }
  }
}

function layerFromAi(l: MotionLayerAi, i: number, ctx: SceneContext, mode: "full" | "overlay"): MotionSceneInput["layers"][number] | null {
  if (!l || typeof l !== "object") return null;
  if (l.kind === "component") {
    if (!COMPONENT_NAMES.includes(l.component)) return null;
    const region = mode === "full" ? placeRegion(l.place, ctx.format) : undefined;
    return { type: "component", component: l.component, props: cleanProps(l.component, (l.props ?? {}) as Record<string, unknown>), at: clamp(l.at, 0, 3, 0), scale: clamp(l.scale || 1, 0.6, 1.5, 1), ...(region ? { region } : {}) };
  }
  return primitiveFromAi(l, i);
}

/** Escena v2 a partir de la respuesta de la IA, con el tema de la marca. null si no queda nada que dibujar. */
export function sceneFromAi(ai: MotionSceneAi, ctx: SceneContext): MotionScene | null {
  const mode = ai.mode === "overlay" ? "overlay" : "full";
  const layers = (ai.layers ?? []).map((l, i) => layerFromAi(l, i, ctx, mode)).filter((l): l is NonNullable<typeof l> => Boolean(l)).slice(0, 12);
  if (!layers.length) return null;
  const parsed = sceneSchema.safeParse({ v: 2, duration: graphicSeconds(ctx.duration), format: ctx.format, mode, position: ai.position === "bottom" ? "bottom" : "top", theme: motionTheme(ctx.look), layers });
  return parsed.success ? parsed.data : null;
}

// ─── Escena → forma de la IA (para pedir un ajuste o un reintento) ───────

const behaviorOut = (list: { type: string; at: number; dur?: number; dir?: string }[]) => list.map((b) => ({ type: b.type, at: b.at, dur: b.dur ?? 0, dir: b.dir && b.dir !== "center" ? b.dir : "none" }));

/** La escena en la misma forma que responde la IA (así Claude ve el gráfico actual tal como lo escribiría). */
export function sceneToAi(scene: MotionScene, title = ""): MotionSceneAi {
  const { W, H } = size(scene.format);
  const layers: MotionLayerAi[] = [];
  for (const l of scene.layers as Layer[]) {
    switch (l.type) {
      case "component": {
        const cy = l.region ? l.region.y + l.region.h / 2 : 0.5;
        layers.push({ kind: "component", component: l.component, at: l.at, scale: l.scale ?? 1, place: !l.region ? "auto" : cy < 0.4 ? "top" : cy > 0.5 ? "bottom" : "auto", props: l.props as Record<string, unknown> });
        break;
      }
      case "text":
        layers.push({ kind: "text", text: l.text, x: l.x, y: l.y, w: l.w, size: l.size, weight: l.weight, font: l.font, color: l.color.split("@")[0]!, align: l.align, uppercase: l.uppercase, emphasis_words: l.emphasis?.words ?? "", emphasis_style: l.emphasis?.style ?? "none", animate: behaviorOut(l.animate) });
        break;
      case "icon":
        layers.push({ kind: "icon", name: l.name, x: l.x, y: l.y, size: l.size, color: l.color.split("@")[0]!, tile: l.tile, animate: behaviorOut(l.animate) });
        break;
      case "counter":
        layers.push({ kind: "counter", value: l.value, x: l.x, y: l.y, size: l.size, color: l.color.split("@")[0]!, animate: behaviorOut(l.animate) });
        break;
      case "line":
        layers.push({ kind: "line", points: l.points.map(([x, y]) => ({ x, y })), bend: l.bend, color: l.color.split("@")[0]!, width: l.width, head: l.head, animate: behaviorOut(l.animate) });
        break;
      case "rect":
        layers.push({ kind: "shape", shape: l.shape === "pill" ? "pill" : "rect", x: l.x, y: l.y, w: l.w, h: l.h, fill: l.fill?.split("@")[0] ?? "none", stroke: l.stroke?.split("@")[0] ?? "none", card: l.card, animate: behaviorOut(l.animate) });
        break;
      case "ellipse":
        layers.push({ kind: "shape", shape: "circle", x: l.x, y: l.y, w: l.w, h: (l.h ?? (l.w * W) / H) || l.w, fill: l.fill?.split("@")[0] ?? "none", stroke: l.stroke?.split("@")[0] ?? "none", card: false, animate: behaviorOut(l.animate) });
        break;
      default:
        break;
    }
  }
  // A un lado (16:9) es una elección de la persona: la IA trabaja con arriba/abajo y el lado se conserva al volver.
  return { title, mode: scene.mode, position: scene.position === "bottom" ? "bottom" : "top", layers };
}

// ─── Arreglos automáticos ─────────────────────────────────────────────────

/** Acorta un texto a `max` caracteres sin cortar palabras (y sin puntuación colgando). */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.5 ? cut.slice(0, at) : t.slice(0, max)).replace(/[,;:.\s—–-]+$/, "");
}

type ZIssue = { code: string; path: (string | number)[]; maximum?: number; minimum?: number; origin?: string };

/** Corrige las props que se pasan de los límites del componente: recorta textos y listas, acota números. */
export function fitProps(component: ComponentName, props: Record<string, unknown>): Record<string, unknown> {
  const def = COMPONENTS[component];
  let p = structuredClone(props);
  for (let round = 0; round < 6; round++) {
    const parsed = def.props.safeParse(p);
    if (parsed.success) return p;
    let changed = false;
    for (const i of parsed.error.issues as unknown as ZIssue[]) {
      if (i.code !== "too_big" || i.maximum == null) continue;
      const keys = i.path;
      let obj = p as Record<string | number, unknown>;
      for (const k of keys.slice(0, -1)) obj = (obj?.[k] ?? {}) as Record<string | number, unknown>;
      const last = keys[keys.length - 1]!;
      const v = keys.length ? obj[last] : p;
      if (typeof v === "string") obj[last] = shorten(v, Number(i.maximum));
      else if (Array.isArray(v)) obj[last] = v.slice(0, Number(i.maximum));
      else if (typeof v === "number") obj[last] = Number(i.maximum);
      else continue;
      changed = true;
    }
    if (!changed) break;
    p = { ...p };
  }
  return p;
}

function mapScene(scene: MotionScene, fn: (l: Layer) => Layer): MotionScene | null {
  const parsed = sceneSchema.safeParse({ ...scene, layers: (scene.layers as Layer[]).map(fn) });
  return parsed.success ? parsed.data : null;
}

const shrink = (factor: number) => (l: Layer): Layer => {
  switch (l.type) {
    case "component":
      return { ...l, scale: Math.max(0.5, (l.scale ?? 1) * factor) };
    case "text":
      return { ...l, size: l.size * factor, ...(l.minSize ? { minSize: l.minSize * factor } : {}) };
    case "icon":
    case "counter":
      return { ...l, size: l.size * factor };
    default:
      return l;
  }
};

/**
 * Arreglos sin IA, de menor a mayor cambio: recortar textos al límite de su componente, achicar, y pasar de "sobre
 * el video" a pantalla completa (más lugar). Devuelve la primera versión sin errores, o null.
 */
export function autoFix(scene: MotionScene, opts: CheckOptions): MotionScene | null {
  const steps: ((s: MotionScene) => MotionScene | null)[] = [
    (s) => mapScene(s, (l) => (l.type === "component" ? { ...l, props: fitProps(l.component, l.props) } : l)),
    (s) => mapScene(s, shrink(0.88)),
    (s) => mapScene(s, shrink(0.86)),
    (s) => (s.mode === "overlay" ? sceneSchema.safeParse({ ...s, mode: "full" }).data ?? null : null),
  ];
  let current: MotionScene | null = scene;
  for (const step of steps) {
    const next: MotionScene | null = current ? step(current) : null;
    if (!next) continue;
    current = next;
    if (checkScene(current, opts).ok) return current;
  }
  return null;
}

/**
 * Un gráfico más simple que se pueda leer siempre: la palabra clave (o la frase corta) del título o de lo que se dice,
 * sin cifras que no se dicen. Es el último recurso antes de quedarse sin gráfico.
 */
export function fallbackScene(input: { texts: string[]; spoken: string; opts: CheckOptions } & SceneContext): MotionScene | null {
  const strip = (t: string) =>
    t
      .replace(/[«»"“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const candidates: MotionSceneInput[] = [];
  const theme = motionTheme(input.look);
  const base = { v: 2 as const, duration: graphicSeconds(input.duration), format: input.format, position: "top" as const, theme };
  const words = (t: string) => t.split(" ").filter(Boolean);
  for (const raw of [...input.texts, input.spoken].map(strip).filter(Boolean)) {
    if (words(raw).length <= 3) candidates.push({ ...base, mode: "overlay", layers: [{ type: "component", component: "keyword", props: { text: shorten(raw, 28), label: "", emphasis: "marker" } }] });
    else candidates.push({ ...base, mode: "overlay", layers: [{ type: "component", component: "quote", props: { text: shorten(words(raw).slice(0, 12).join(" "), 110).replace(/[.…]+$/, ""), highlight: "", author: "" } }] });
  }
  for (const c of candidates) {
    const parsed = sceneSchema.safeParse(c);
    if (!parsed.success) continue;
    if (unsupportedSceneNumbers(parsed.data, input.opts.allowed).length) continue;
    if (checkScene(parsed.data, input.opts).ok) return parsed.data;
    const fixed = autoFix(parsed.data, input.opts);
    if (fixed) return fixed;
  }
  return null;
}

// ─── Validación con reintento ─────────────────────────────────────────────

export type MotionJob = SceneContext & {
  ai: MotionSceneAi | null;
  /** Lo que se dice en el tramo. */
  spoken: string;
  /** Lo que escribió la persona (en un pedido): sus cifras también valen. */
  request?: string;
  bannedWords?: string[];
};

export type MotionOutcome = {
  scene: MotionScene | null;
  /** Cómo quedó: bien de entrada, después del reintento, arreglado sin IA o simplificado. */
  how: "ok" | "retry" | "auto" | "fallback" | "none";
  /** Problemas que tenía la última versión de la IA (para el registro y para avisar). */
  problems: string[];
  warnings: string[];
  title: string;
};

export type RetryFn = (items: { job: MotionJob; scene: MotionSceneAi; problems: string[] }[]) => Promise<(MotionSceneAi | null)[]>;

const optsOf = (job: MotionJob): CheckOptions => ({ allowed: [job.spoken, job.request ?? ""].join(" "), ...(job.bannedWords ? { bannedWords: job.bannedWords } : {}) });

function evaluate(job: MotionJob, ai: MotionSceneAi | null): { scene: MotionScene | null; check: SceneCheck | null; problems: string[] } {
  if (!ai) return { scene: null, check: null, problems: ["No llegó ninguna escena."] };
  const scene = sceneFromAi(ai, job);
  if (!scene) return { scene: null, check: null, problems: ["La escena no tiene capas que se puedan dibujar: usa un componente del catálogo con sus props."] };
  const check = checkScene(scene, optsOf(job));
  return { scene, check, problems: check.errors };
}

/**
 * Arma las escenas de varios gráficos a la vez (el plan del b-roll manda todos juntos) con hasta `retries`
 * reintentos para los que tienen problemas (todos en una sola llamada), y después arreglos automáticos.
 */
export async function resolveScenes(jobs: MotionJob[], opts: { retries: number; retry: RetryFn | null; fallback?: boolean }): Promise<MotionOutcome[]> {
  const current = jobs.map((job) => ({ ai: job.ai, ...evaluate(job, job.ai) }));
  const how: MotionOutcome["how"][] = current.map((c) => (c.scene && c.check?.ok ? "ok" : "none"));
  for (let round = 0; round < opts.retries && opts.retry; round++) {
    const failing = current.map((c, i) => ({ c, i })).filter(({ c, i }) => how[i] === "none" && c.ai);
    if (!failing.length) break;
    let fixed: (MotionSceneAi | null)[] = [];
    try {
      fixed = await opts.retry(failing.map(({ c, i }) => ({ job: jobs[i]!, scene: c.ai!, problems: c.problems })));
    } catch {
      break;
    }
    failing.forEach(({ i }, k) => {
      const ai = fixed[k];
      if (!ai) return;
      const next = evaluate(jobs[i]!, ai);
      current[i] = { ai, ...next };
      if (next.scene && next.check?.ok) how[i] = "retry";
    });
  }
  return jobs.map((job, i) => {
    const c = current[i]!;
    const title = (c.ai?.title ?? "").trim().slice(0, 80);
    if (how[i] !== "none") return { scene: c.scene, how: how[i]!, problems: [], warnings: c.check?.warnings ?? [], title };
    const o = optsOf(job);
    const auto = c.scene ? autoFix(c.scene, o) : null;
    if (auto) return { scene: auto, how: "auto", problems: c.problems, warnings: checkScene(auto, o).warnings, title };
    if (opts.fallback === false) return { scene: null, how: "none", problems: c.problems, warnings: [], title };
    const texts = c.scene ? (c.scene.layers as Layer[]).flatMap((l) => (l.type === "component" ? [String((l.props as { text?: unknown; title?: unknown }).text ?? (l.props as { title?: unknown }).title ?? "")] : l.type === "text" ? [l.text] : [])) : [];
    const simple = fallbackScene({ texts: [title, ...texts].filter(Boolean), spoken: job.spoken, opts: o, look: job.look, format: job.format, duration: job.duration });
    return simple ? { scene: simple, how: "fallback", problems: c.problems, warnings: [], title } : { scene: null, how: "none", problems: c.problems, warnings: [], title };
  });
}

