/**
 * Compilación: de la escena (esquema v2) a nodos en píxeles listos para dibujar. Resuelve el tema, ubica la caja del
 * contenido según formato y modo (zona segura de Reels), arma los componentes (que miden texto con el mismo contexto
 * que dibuja), aplica los comportamientos y comprime la entrada si el tramo es corto.
 */
import { applyBehavior } from "./animate";
import { COMPONENTS } from "./components";
import { card, col, counter, ellipse, fit, group as groupNode, icon, iconTile, path as pathNode, rect, textNode, type Format, type Kit, type Mode, type Position } from "./kit";
import { lastKeyTime, retime, walk, type Box, type Node, type Prop } from "./nodes";
import { sceneSchema, type ComponentLayer, type Layer, type MotionScene, type MotionSceneInput, type PrimitiveLayer } from "./schema";
import type { Measurer } from "./text";
import { smoothThrough } from "./path";
import { resolveColor, resolveTheme, type MotionFont, type ResolvedTheme } from "./theme";

export type CompiledScene = {
  width: number;
  height: number;
  duration: number;
  format: Format;
  mode: Mode;
  position: Position;
  theme: ResolvedTheme;
  unit: number;
  region: Box;
  safe: Box;
  /** Velo del modo "overlay" (posición 0–1, opacidad). */
  veil: [number, number][];
  exit: { start: number; dur: number };
  /** Factor con el que se comprimió la entrada (1 = sin comprimir). */
  timeScale: number;
  drift: boolean;
  nodes: Node[];
  /** Problemas que aparecieron al armar (componente con props inválidas, etc.). */
  notes: string[];
};

export type FontFamilies = Partial<Record<MotionFont, string>> & { body?: string };

export type CompileOptions = {
  width: number;
  height: number;
  measure: Measurer;
  /** Familias CSS de cada fuente del tema (por defecto "Inter" y "Montserrat"). */
  fonts?: FontFamilies;
};

export const DEFAULT_FAMILIES: Record<MotionFont, string> & { body: string } = { inter: "Inter", montserrat: "Montserrat", body: "Inter" };

// ─── Cajas por formato ────────────────────────────────────────────────────

const frac = (W: number, H: number, x0: number, y0: number, x1: number, y1: number): Box => ({ x: W * x0, y: H * y0, w: W * (x1 - x0), h: H * (y1 - y0) });

/**
 * Zona segura: en 9:16 lejos de los bordes, del encabezado y de la interfaz de Reels de abajo (descripción y
 * botones); en 16:9, el margen de títulos de siempre.
 */
export function safeZone(W: number, H: number): Box {
  return H > W ? frac(W, H, 0.065, 0.065, 0.935, 0.84) : frac(W, H, 0.05, 0.06, 0.95, 0.93);
}

/** Botones de la derecha de Reels (me gusta, comentar, compartir): ahí no va texto. */
export function reelsButtons(W: number, H: number): Box | null {
  return H > W ? frac(W, H, 0.87, 0.5, 1, 0.92) : null;
}

/** Caja del contenido. Pantalla completa: centrada un poco arriba; sobre el video: franja de arriba o la de abajo. */
export function contentRegion(W: number, H: number, mode: Mode, position: Position): Box {
  const vertical = H > W;
  if (mode === "full") return vertical ? frac(W, H, 0.085, 0.12, 0.915, 0.76) : frac(W, H, 0.1, 0.12, 0.9, 0.88);
  if (vertical) return position === "top" ? frac(W, H, 0.075, 0.07, 0.925, 0.355) : frac(W, H, 0.075, 0.56, 0.925, 0.825);
  return position === "top" ? frac(W, H, 0.12, 0.07, 0.88, 0.46) : frac(W, H, 0.12, 0.55, 0.88, 0.92);
}

export function veilStops(W: number, H: number, position: Position): [number, number][] {
  const vertical = H > W;
  if (position === "top")
    return vertical
      ? [[0, 0.9], [0.24, 0.8], [0.44, 0.36], [0.58, 0]]
      : [[0, 0.88], [0.32, 0.72], [0.52, 0.3], [0.68, 0]];
  return vertical
    ? [[0.4, 0], [0.52, 0.42], [0.64, 0.82], [1, 0.92]]
    : [[0.42, 0], [0.56, 0.36], [0.7, 0.8], [1, 0.9]];
}

// ─── Primitivas ───────────────────────────────────────────────────────────

function place(l: { x: number; y: number; anchor: "center" | "top-left" }, w: number, h: number, W: number, H: number): Box {
  const px = l.x * W;
  const py = l.y * H;
  return l.anchor === "top-left" ? { x: px, y: py, w, h } : { x: px - w / 2, y: py - h / 2, w, h };
}

function primitive(l: PrimitiveLayer, k: Kit): Node {
  const { W, H, u } = k;
  const c = (token: string) => resolveColor(k.theme, token);
  let n: Node;
  switch (l.type) {
    case "rect": {
      const b = place(l, l.w * W, l.h * H, W, H);
      const r = l.shape === "pill" ? Math.min(b.w, b.h) / 2 : l.radius * u;
      n = l.card
        ? card(k, b, { r })
        : rect({ ...b, r, ...(l.fill ? { fill: c(l.fill) } : {}), ...(l.stroke ? { stroke: { color: c(l.stroke), width: l.strokeWidth * u } } : {}), ...(l.grow ? { grow: l.grow } : {}) });
      break;
    }
    case "ellipse": {
      const w = l.w * W;
      const h = l.h != null ? l.h * H : w;
      const b = place(l, w, h, W, H);
      n = ellipse({ cx: b.x + w / 2, cy: b.y + h / 2, rx: w / 2, ry: h / 2, ...(l.fill ? { fill: c(l.fill) } : {}), ...(l.stroke ? { stroke: { color: c(l.stroke), width: l.strokeWidth * u, cap: "round" } } : {}), ...(l.arc ? { arc: l.arc } : {}) });
      break;
    }
    case "line": {
      const pts = l.points.map(([x, y]) => [x * W, y * H] as const);
      let d = `M${pts[0]![0]} ${pts[0]![1]}`;
      if (l.smooth && pts.length > 2) d += smoothThrough(pts.map(([x, y]) => [x, y]));
      else if (pts.length === 2 && l.bend) {
        const [[x1, y1], [x2, y2]] = pts as unknown as [[number, number], [number, number]];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        d += `Q${(x1 + x2) / 2 + (-(y2 - y1) / len) * len * l.bend} ${(y1 + y2) / 2 + ((x2 - x1) / len) * len * l.bend} ${x2} ${y2}`;
      } else for (const [x, y] of pts.slice(1)) d += `L${x} ${y}`;
      const color = c(l.color);
      n = pathNode(d, { stroke: { color, width: l.width * u, cap: "round", ...(l.dash ? { dash: l.dash.map((v) => v * u) } : {}) }, ...(l.head === "end" ? { head: { size: l.width * u * 3.2, color } } : {}), drawMode: "sequence" });
      break;
    }
    case "path": {
      const p = pathNode(l.d, { ...(l.fill ? { fill: c(l.fill) } : {}), ...(l.stroke ? { stroke: { color: c(l.stroke), width: l.strokeWidth * u, cap: "round", join: "round" } } : {}) });
      const s = l.scale * u;
      p.tf = { x: l.x * W, y: l.y * H, s };
      p.box = { x: l.x * W + p.box.x * s, y: l.y * H + p.box.y * s, w: p.box.w * s, h: p.box.h * s };
      n = p;
      break;
    }
    case "icon": {
      const size = l.size * u;
      const cx = l.x * W + (l.anchor === "top-left" ? size / 2 : 0);
      const cy = l.y * H + (l.anchor === "top-left" ? size / 2 : 0);
      n = l.tile !== "none" ? iconTile(k, l.name, cx, cy, size, { variant: l.tile }) : icon(k, l.name, cx, cy, size, { color: c(l.color), weight: l.weight });
      break;
    }
    case "text": {
      const w = l.w * W;
      const family = l.font === "display" ? k.families.display : k.families.body;
      const f = fit(k, l.text, { family, weight: l.weight, tracking: l.tracking ?? (l.font === "display" ? -0.02 : 0), uppercase: l.uppercase }, { max: l.size * u, min: (l.minSize ?? l.size * 0.55) * u, maxW: w, maxLines: l.maxLines, ...(l.h != null ? { maxH: l.h * H } : {}), leading: l.leading });
      const b = place(l, w, f.height, W, H);
      n = textNode(k, f, b.x, b.y, w, {
        color: c(l.color),
        align: l.align,
        on: k.ground,
        ...(l.emphasis ? { emphasis: { words: l.emphasis.words, style: l.emphasis.style, color: c(l.emphasis.color), ...(l.emphasis.style === "marker" ? { textColor: k.theme.accentText } : {}) } } : {}),
      });
      break;
    }
    case "counter": {
      const size = l.size * u;
      const top = l.y * H - (l.anchor === "center" ? size / 2 : 0);
      n = counter(k, l.value, { x: l.x * W, top, size, font: { family: k.families.display, weight: l.weight, tracking: -0.04 }, align: l.align, color: c(l.color), affixColor: c(l.affixColor), on: k.ground, ...(l.from != null ? { from: l.from } : {}) });
      break;
    }
    case "image": {
      const b = place(l, l.w * W, l.h * H, W, H);
      n = { kind: "image", src: l.src, ...b, r: l.radius * u, fit: l.fit, tracks: {}, box: b, role: "decor" };
      break;
    }
    case "group": {
      const children = l.children.map((ch) => primitive(ch, k));
      n = groupNode(children, l.clip ? { clip: { x: l.clip.x * W, y: l.clip.y * H, w: l.clip.w * W, h: l.clip.h * H, r: l.clip.radius * u } } : {});
      // Cascada entre hijos (each) para los comportamientos del grupo.
      for (const b of l.animate) {
        if (b.each != null) {
          children.forEach((ch, i) => applyBehavior(ch, b, u, b.at + i * b.each!));
        } else applyBehavior(n, b, u);
      }
      if (l.tracks) for (const [prop, keys] of Object.entries(l.tracks)) if (keys) n.tracks[prop as Prop] = [...keys].sort((a, b) => a.t - b.t);
      if (l.opacity != null) n.alpha = l.opacity;
      return n;
    }
  }
  for (const b of l.animate) applyBehavior(n, b, u);
  if (l.tracks) for (const [prop, keys] of Object.entries(l.tracks)) if (keys) n.tracks[prop as Prop] = [...keys].sort((a, b) => a.t - b.t);
  if (l.opacity != null) n.alpha = l.opacity;
  if (l.rotation) n.tracks.rotation = [{ t: 0, v: l.rotation }, ...(n.tracks.rotation ?? [])];
  return n;
}

function buildComponent(l: ComponentLayer, k: Kit, notes: string[]): Node[] {
  const def = COMPONENTS[l.component];
  const parsed = def.props.safeParse(l.props);
  if (!parsed.success) {
    notes.push(`El componente "${def.label}" tiene datos que no sirven: ${parsed.error.issues[0]?.message ?? "revisa los textos"}.`);
    return [];
  }
  const kk: Kit = l.region ? { ...k, region: { x: l.region.x * k.W, y: l.region.y * k.H, w: l.region.w * k.W, h: l.region.h * k.H } } : k;
  const nodes = (def.build as (p: unknown, k: Kit) => Node[])(parsed.data, kk);
  if (l.at) retime(nodes, 1, l.at);
  if (l.id) nodes.forEach((n, i) => (n.id ??= `${l.id}.${i}`));
  return nodes;
}

/** El kit de diseño para un lienzo (lo usan los componentes, el validador y la galería). */
export function makeKit(scene: Pick<MotionScene, "mode" | "position" | "theme" | "duration">, opts: CompileOptions): Kit {
  const { width: W, height: H } = opts;
  const theme = resolveTheme(scene.theme);
  const families = { ...DEFAULT_FAMILIES, ...opts.fonts };
  const u = Math.min(W, H) / 1080;
  const vertical = H > W;
  return {
    W,
    H,
    u,
    s: u * (scene.mode === "overlay" ? 0.86 : vertical ? 1.15 : 1.05),
    vertical,
    format: vertical ? "9:16" : "16:9",
    mode: scene.mode,
    position: scene.position,
    theme,
    region: contentRegion(W, H, scene.mode, scene.position),
    safe: safeZone(W, H),
    duration: scene.duration,
    measure: opts.measure,
    families: { display: families[theme.font], body: families.body },
    ground: theme.bg,
  };
}

/** Compila una escena ya validada. */
export function compileScene(scene: MotionScene, opts: CompileOptions): CompiledScene {
  const k = makeKit(scene, opts);
  const notes: string[] = [];
  const nodes: Node[] = [];
  for (const l of scene.layers as Layer[]) {
    if (l.type === "component") nodes.push(...buildComponent(l, k, notes));
    else nodes.push(primitive(l, k));
  }
  const exitDur = scene.exit === "none" ? 0 : Math.min(0.45, Math.max(0.22, scene.duration * 0.12));
  // Si la entrada no entra antes de la salida (con un respiro para leer), se comprime.
  const hold = Math.min(0.6, scene.duration * 0.2);
  const available = scene.duration - exitDur - hold;
  const last = lastKeyTime(nodes);
  const timeScale = last > 0 && last > available ? Math.max(0.35, available / last) : 1;
  if (timeScale < 1) retime(nodes, timeScale);
  return {
    width: k.W,
    height: k.H,
    duration: scene.duration,
    format: k.format,
    mode: scene.mode,
    position: scene.position,
    theme: k.theme,
    unit: k.u,
    region: k.region,
    safe: k.safe,
    veil: veilStops(k.W, k.H, scene.position),
    exit: { start: scene.duration - exitDur, dur: exitDur },
    timeScale,
    drift: true,
    nodes,
    notes,
  };
}

/** Valida (Zod) y compila. Lanza si la escena no cumple el esquema. */
export function compile(input: MotionSceneInput, opts: CompileOptions): CompiledScene {
  return compileScene(sceneSchema.parse(input), opts);
}

/** Cuenta los nodos (para depurar y para las pruebas). */
export function countNodes(nodes: Node[]): number {
  let n = 0;
  walk(nodes, () => n++);
  return n;
}

export { col };
