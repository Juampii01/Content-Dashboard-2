/**
 * Kit de diseño de los componentes: medidas del lienzo, zona del contenido, tema, tipografía y constructores de
 * nodos con el estilo de la casa (tarjetas con borde fino y luz arriba, eyebrows en mayúsculas, íconos en tiles).
 * Todo lo visual de los componentes sale de aquí: si cambia el estilo, cambia en todos.
 */
import { contrast, mix, rgba } from "./color";
import { iconPaths, type IconName } from "./icons";
import { parsePath } from "./path";
import { parseCount } from "./count";
import { fitLine, fitText, matchWords, normWord, placeLines, placeWords, type Fit, type FitOptions, type FontSpec, type Measurer, type PlacedWord } from "./text";
import { resolveColor, tokenHex, type ResolvedTheme } from "./theme";
import type { Box, CountFormat, CounterNode, EllipseNode, Fill, GroupNode, Node, PathNode, RectNode, Role, Shadow, Stroke, TextMark, TextNode } from "./nodes";

export type Format = "9:16" | "16:9";
export type Mode = "full" | "overlay";
/** Sobre el video: franja de arriba o de abajo; en 16:9 también a la izquierda o a la derecha (la persona al otro lado). */
export type Position = "top" | "bottom" | "left" | "right";

export type Kit = {
  W: number;
  H: number;
  /** 1 unidad = 1 px en un lienzo de 1080 de lado corto. */
  u: number;
  /** Escala de diseño: `u` por la densidad del modo (sobre el video todo va un poco más chico). */
  s: number;
  vertical: boolean;
  format: Format;
  mode: Mode;
  position: Position;
  theme: ResolvedTheme;
  /** Caja del contenido (donde va el componente). */
  region: Box;
  /** Zona segura del formato (lejos de bordes y de la interfaz de la red). */
  safe: Box;
  duration: number;
  measure: Measurer;
  families: { display: string; body: string };
  /** Color de fondo detrás del contenido (para contraste). */
  ground: string;
  /**
   * Sincronía con la voz: segundo (desde el inicio del componente) en que se dice cada elemento, en el orden de
   * `cueTexts` del componente. Sin esto, cada componente usa su reloj de siempre.
   */
  cues?: number[] | null;
};

// ─── Color y tipografía ───────────────────────────────────────────────────

export const col = (k: Kit, token: string, alpha = 1) => resolveColor(k.theme, token, alpha);
export const hexOf = (k: Kit, token: string) => tokenHex(k.theme, token);

export function display(k: Kit, weight = 800, tracking = -0.025): FontSpec {
  return { family: k.families.display, weight, tracking };
}
export function body(k: Kit, weight = 600, tracking = -0.005): FontSpec {
  return { family: k.families.body, weight, tracking };
}
export function eyebrowFont(k: Kit): FontSpec {
  return { family: k.families.body, weight: 700, tracking: 0.16, uppercase: true };
}

export function fit(k: Kit, text: string, font: FontSpec, o: FitOptions): Fit {
  return fitText(k.measure, text, font, o);
}

/** Color de texto legible sobre un fondo (hex). */
export function inkOn(k: Kit, bg: string, prefer = "text", min = 3): string {
  const want = hexOf(k, prefer);
  if (contrast(want, bg) >= min) return want;
  if (contrast(k.theme.accentText, bg) >= min) return k.theme.accentText;
  const a = k.theme.text;
  const b = k.theme.accentText;
  const c = k.theme.bg;
  return [a, b, c].sort((x, y) => contrast(y, bg) - contrast(x, bg))[0]!;
}

// ─── Nodos básicos ────────────────────────────────────────────────────────

type CommonOpts = { id?: string; label?: string; role?: Role; shadow?: Shadow; on?: string; overlap?: boolean; alpha?: number };

const common = (o: CommonOpts, box: Box) => ({
  tracks: {},
  box,
  ...(o.id ? { id: o.id } : {}),
  ...(o.label ? { label: o.label } : {}),
  ...(o.role ? { role: o.role } : {}),
  ...(o.shadow ? { shadow: o.shadow } : {}),
  ...(o.on ? { on: o.on } : {}),
  ...(o.overlap ? { overlap: true } : {}),
  ...(o.alpha != null ? { alpha: o.alpha } : {}),
});

export function rect(b: Box & { r?: number; fill?: Fill; stroke?: Stroke; grow?: RectNode["grow"] } & CommonOpts): RectNode {
  return { kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: b.r ?? 0, ...(b.fill ? { fill: b.fill } : {}), ...(b.stroke ? { stroke: b.stroke } : {}), ...(b.grow ? { grow: b.grow } : {}), ...common({ role: "shape", ...b }, { x: b.x, y: b.y, w: b.w, h: b.h }) };
}

export function ellipse(o: { cx: number; cy: number; rx: number; ry?: number; fill?: Fill; stroke?: Stroke; arc?: EllipseNode["arc"] } & CommonOpts): EllipseNode {
  const ry = o.ry ?? o.rx;
  return { kind: "ellipse", cx: o.cx, cy: o.cy, rx: o.rx, ry, ...(o.fill ? { fill: o.fill } : {}), ...(o.stroke ? { stroke: o.stroke } : {}), ...(o.arc ? { arc: o.arc } : {}), ...common({ role: "shape", ...o }, { x: o.cx - o.rx, y: o.cy - ry, w: 2 * o.rx, h: 2 * ry }) };
}

/** Ícono de Lucide centrado en (cx, cy) con lado `size`. */
export function icon(k: Kit, name: IconName, cx: number, cy: number, size: number, o: { color: Fill; weight?: number; fill?: Fill } & CommonOpts): PathNode {
  const s = size / 24;
  return {
    kind: "path",
    paths: iconPaths(name),
    tf: { x: cx - size / 2, y: cy - size / 2, s },
    stroke: { color: o.color, width: (o.weight ?? 1.9) * s, cap: "round", join: "round" },
    ...(o.fill ? { fill: o.fill } : {}),
    ...common({ role: "decor", ...o }, { x: cx - size / 2, y: cy - size / 2, w: size, h: size }),
  };
}

/** Trazado libre (`d` en píxeles del lienzo). */
export function path(d: string | string[], o: { stroke?: Stroke; fill?: Fill; head?: PathNode["head"]; drawMode?: PathNode["drawMode"]; box?: Box } & CommonOpts): PathNode {
  const paths = (Array.isArray(d) ? d : [d]).map((x) => parsePath(x));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths)
    for (const sub of p.subs)
      for (const sg of sub.segs)
        if (sg.c !== "Z") {
          x0 = Math.min(x0, sg.x);
          y0 = Math.min(y0, sg.y);
          x1 = Math.max(x1, sg.x);
          y1 = Math.max(y1, sg.y);
        }
  const box = o.box ?? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  return {
    kind: "path",
    paths,
    tf: { x: 0, y: 0, s: 1 },
    ...(o.stroke ? { stroke: o.stroke } : {}),
    ...(o.fill ? { fill: o.fill } : {}),
    ...(o.head ? { head: o.head } : {}),
    ...(o.drawMode ? { drawMode: o.drawMode } : {}),
    ...common({ role: "decor", ...o }, box),
  };
}

export function group(children: Node[], o: CommonOpts & { clip?: GroupNode["clip"]; box?: Box } = {}): GroupNode {
  const boxes = children.map((c) => c.box);
  let box = o.box;
  if (!box) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    box = boxes.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  return { kind: "group", children, ...(o.clip ? { clip: o.clip } : {}), ...common({ role: "decor", ...o }, box) };
}

/** Nodo de texto a partir de un ajuste (`fit`), ubicado en una caja. */
export function textNode(
  k: Kit,
  f: Fit,
  x: number,
  y: number,
  w: number,
  o: CommonOpts & {
    color: Fill;
    align?: "left" | "center" | "right";
    /** Palabras resaltadas (frase o palabras sueltas) y cómo. */
    emphasis?: { words: string; style: "marker" | "underline" | "strike" | "accent"; color?: Fill; textColor?: string };
    strikeAll?: { color: Fill };
  },
): TextNode {
  const lines = placeLines(f, x, y, w, o.align ?? "left");
  const node: TextNode = {
    kind: "text",
    lines: lines.map((l) => ({ text: l.text, x: l.x, baseline: l.baseline, w: l.w })),
    font: f.font,
    size: f.size,
    tracking: f.tracking,
    color: o.color,
    lineHeight: f.lineHeight,
    ...(f.overflow ? { overflow: true } : {}),
    ...common({ role: "text", ...o }, { x: Math.min(...lines.map((l) => l.x)), y, w: Math.max(...lines.map((l) => l.w)), h: f.height }),
  };
  if (o.emphasis?.words) {
    const words = placeWords(k.measure, f, lines);
    const marked = matchMarked(words.map((w) => w.text), o.emphasis.words);
    const runs = groupRuns(words, marked);
    if (o.emphasis.style === "accent") node.spans = runs.map((r) => ({ line: r.line, x: r.x0, text: r.text, color: o.emphasis!.color ?? col(k, "accent") }));
    else
      node.marks = runs.map<TextMark>((r) => ({
        kind: o.emphasis!.style as TextMark["kind"],
        line: r.line,
        x0: r.x0,
        x1: r.x1,
        color: o.emphasis!.color ?? col(k, "accent"),
        ...(o.emphasis!.textColor ? { textColor: o.emphasis!.textColor } : {}),
      }));
  }
  if (o.strikeAll) node.marks = [...(node.marks ?? []), ...lines.map<TextMark>((l, i) => ({ kind: "strike", line: i, x0: l.x, x1: l.x + l.w, color: o.strikeAll!.color }))];
  return node;
}

function matchMarked(words: string[], target: string): Set<number> {
  return matchWords(words, target);
}
function groupRuns(words: PlacedWord[], marked: Set<number>): { line: number; x0: number; x1: number; text: string }[] {
  const out: { line: number; x0: number; x1: number; text: string; last: number }[] = [];
  for (const w of words) {
    if (!marked.has(w.index)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.line === w.line && prev.last === w.index - 1) {
      prev.x1 = w.x + w.w;
      prev.text = `${prev.text} ${w.text}`;
      prev.last = w.index;
    } else out.push({ line: w.line, x0: w.x, x1: w.x + w.w, text: w.text, last: w.index });
  }
  return out.map((r) => ({ line: r.line, x0: r.x0, x1: r.x1, text: r.text }));
}
export { normWord };

/** Número que cuenta. `x` es el ancla según `align`; `top` es el borde de arriba de la línea. */
export function counter(
  k: Kit,
  value: string,
  o: CommonOpts & { x: number; top: number; size: number; font: FontSpec; align?: "left" | "center" | "right"; color: Fill; affixColor?: Fill; from?: number },
): CounterNode {
  const fmt: CountFormat = parseCount(value, o.from ?? 0);
  const font = `${o.font.weight} ${Math.round(o.size * 10) / 10}px ${o.font.family}`;
  const tracking = (o.font.tracking ?? 0) * o.size;
  const m = k.measure;
  const digitW = Math.max(...[..."0123456789"].map((d) => m(d, font, 0)));
  const parts = splitFinal(fmt.final);
  const prefixW = parts.prefix ? m(parts.prefix, font, tracking) + tracking : 0;
  const suffixW = parts.suffix ? m(parts.suffix, font, tracking) + tracking * 0.5 : 0;
  const digitsW = [...parts.digits].reduce((a, ch) => a + (/\d/.test(ch) ? digitW : m(ch, font, 0)) + tracking, 0);
  const w = prefixW + digitsW + suffixW;
  const align = o.align ?? "center";
  const left = align === "center" ? o.x - w / 2 : align === "right" ? o.x - w : o.x;
  const lh = o.size * 1.0;
  const baseline = o.top + lh / 2 + o.size * 0.36;
  return {
    kind: "counter",
    fmt,
    x: o.x,
    baseline,
    align,
    font,
    size: o.size,
    tracking,
    color: o.color,
    affixColor: o.affixColor ?? o.color,
    digitW,
    prefixW,
    suffixW,
    ...common({ role: "text", ...o }, { x: left, y: o.top, w, h: lh }),
  };
}

function splitFinal(final: string) {
  const m = final.match(/^(.*?)(\d+(?:[.,]\d+)*)(.*)$/);
  return m ? { prefix: m[1] ?? "", digits: m[2]!, suffix: m[3] ?? "" } : { prefix: final, digits: "", suffix: "" };
}

/** Ancho que va a ocupar un número (para diagramar antes de crearlo). */
export function counterWidth(k: Kit, value: string, size: number, font: FontSpec): number {
  return counter(k, value, { x: 0, top: 0, size, font, align: "left", color: "#000" }).box.w;
}

// ─── Estilo de la casa ────────────────────────────────────────────────────

/** Sombra de las tarjetas (más marcada sobre el video, para separarlas de la imagen). */
export function cardShadow(k: Kit, strength = 1): Shadow {
  if (k.mode === "overlay") return { color: rgba("#000000", 0.42 * strength), blur: 46 * k.u, y: 18 * k.u };
  return k.theme.dark ? { color: rgba("#000000", 0.38 * strength), blur: 60 * k.u, y: 26 * k.u } : { color: rgba("#1d1a14", 0.12 * strength), blur: 48 * k.u, y: 18 * k.u };
}

export type CardVariant = "surface" | "accent" | "ghost" | "muted";

/** Tarjeta: superficie con degradado sutil, borde fino con luz arriba y sombra suave. */
export function card(k: Kit, b: Box, o: { variant?: CardVariant; r?: number; shadow?: boolean; label?: string; id?: string } = {}): RectNode {
  const v = o.variant ?? "surface";
  const r = o.r ?? 34 * k.s;
  const th = k.theme;
  const lw = Math.max(1, 1.6 * k.u);
  if (v === "accent") {
    return rect({
      ...b,
      r,
      fill: { kind: "linear", x0: b.x, y0: b.y, x1: b.x + b.w * 0.3, y1: b.y + b.h, stops: [[0, mix(th.accent, "#ffffff", th.dark ? 0.14 : 0.1)], [1, th.accent]] },
      stroke: { color: { kind: "linear", x0: 0, y0: b.y, x1: 0, y1: b.y + b.h, stops: [[0, rgba("#ffffff", 0.35)], [0.5, rgba("#ffffff", 0.08)], [1, rgba("#ffffff", 0.04)]] }, width: lw },
      ...(o.shadow !== false ? { shadow: { color: rgba(th.accent, k.mode === "overlay" ? 0.4 : 0.42), blur: 70 * k.u, y: 20 * k.u } } : {}),
      role: "card",
      ...(o.label ? { label: o.label } : {}),
      ...(o.id ? { id: o.id } : {}),
    });
  }
  const base = v === "muted" ? mix(th.surface, th.bg, 0.45) : th.surface;
  const top = mix(base, th.text, th.dark ? 0.05 : 0.0);
  return rect({
    ...b,
    r,
    fill:
      v === "ghost"
        ? rgba(th.text, th.dark ? 0.04 : 0.03)
        : { kind: "linear", x0: 0, y0: b.y, x1: 0, y1: b.y + b.h, stops: [[0, rgba(top, k.mode === "overlay" ? 0.94 : 1)], [1, rgba(base, k.mode === "overlay" ? 0.94 : 1)]] },
    stroke: { color: { kind: "linear", x0: 0, y0: b.y, x1: 0, y1: b.y + b.h, stops: [[0, rgba(th.text, th.dark ? 0.2 : 0.1)], [0.35, rgba(th.text, th.dark ? 0.09 : 0.07)], [1, rgba(th.text, th.dark ? 0.05 : 0.06)]] }, width: lw },
    ...(o.shadow !== false && v !== "ghost" ? { shadow: cardShadow(k) } : {}),
    role: "card",
    ...(o.label ? { label: o.label } : {}),
    ...(o.id ? { id: o.id } : {}),
  });
}

/** Color de fondo efectivo de una tarjeta (para el contraste del texto encima). */
export function cardGround(k: Kit, v: CardVariant = "surface"): string {
  const th = k.theme;
  if (v === "accent") return th.accent;
  if (v === "muted") return mix(th.surface, th.bg, 0.45);
  if (v === "ghost") return k.ground;
  return th.surface;
}

/**
 * Eyebrow: texto chico en mayúsculas espaciadas con un punto del acento delante. Devuelve los nodos y su caja.
 */
export function eyebrow(
  k: Kit,
  text: string,
  x: number,
  y: number,
  o: { align?: "left" | "center"; maxW?: number; size?: number; color?: string; dot?: boolean; pill?: boolean } = {},
): { nodes: Node[]; box: Box; h: number } {
  const size = o.size ?? 30 * k.s;
  const maxW = o.maxW ?? k.region.w;
  const pill = o.pill ?? o.align === "center";
  const dot = o.dot !== false;
  const dotD = size * 0.42;
  const gap = size * 0.6;
  const padX = pill ? size * 0.95 : 0;
  const f = fitLine(k.measure, text, eyebrowFont(k), size, size * 0.7, maxW - (dot ? dotD + gap : 0) - 2 * padX);
  const w = f.widths[0]! + (dot ? dotD + gap : 0) + 2 * padX;
  const h = pill ? f.size * 2.3 : f.lineHeight;
  const left = o.align === "center" ? x - w / 2 : x;
  const accentHex = o.color ?? k.theme.accent;
  const color = o.color ? o.color : col(k, "accent");
  const nodes: Node[] = [];
  if (pill) {
    nodes.push(
      rect({
        x: left,
        y,
        w,
        h,
        r: h / 2,
        fill: rgba(accentHex.startsWith("#") ? accentHex : k.theme.accent, k.theme.dark ? 0.13 : 0.1),
        stroke: { color: rgba(accentHex.startsWith("#") ? accentHex : k.theme.accent, 0.38), width: Math.max(1, 1.5 * k.u) },
        role: "decor",
      }),
    );
  }
  const textColor = pill && contrast(k.theme.accent, mix(k.ground, k.theme.accent, 0.13)) < 3 ? col(k, "text") : color;
  if (dot) nodes.push(ellipse({ cx: left + padX + dotD / 2, cy: y + h / 2, rx: dotD / 2, fill: color, role: "decor", overlap: true }));
  nodes.push(textNode(k, f, left + padX + (dot ? dotD + gap : 0), y + (h - f.lineHeight) / 2, f.widths[0]!, { color: textColor, on: pill ? mix(k.ground, k.theme.accent, 0.13) : k.ground, label: "el título chico", overlap: pill }));
  return { nodes, box: { x: left, y, w, h }, h };
}

/** Tile cuadrado redondeado con un ícono dentro (insignia de las listas, tarjetas y notificaciones). */
export function iconTile(k: Kit, name: IconName, cx: number, cy: number, size: number, o: { variant?: "accent" | "soft" | "outline"; r?: number; label?: string; ink?: string } = {}): GroupNode {
  const v = o.variant ?? "accent";
  const th = k.theme;
  const r = o.r ?? size * 0.3;
  const b = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
  const bg =
    v === "accent"
      ? rect({ ...b, r, fill: { kind: "linear", x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, stops: [[0, mix(th.accent, "#ffffff", 0.18)], [1, th.accent]] }, shadow: { color: rgba(th.accent, 0.45), blur: size * 0.45, y: size * 0.12 }, role: "decor" })
      : v === "soft"
        ? rect({ ...b, r, fill: rgba(th.accent, th.dark ? 0.16 : 0.12), stroke: { color: rgba(th.accent, 0.35), width: Math.max(1, 1.5 * k.u) }, role: "decor" })
        : rect({ ...b, r, stroke: { color: rgba(o.ink ?? th.text, 0.3), width: Math.max(1, 1.5 * k.u) }, role: "decor" });
  const ink = o.ink ?? (v === "accent" ? th.accentText : th.accent);
  const ic = icon(k, name, cx, cy, size * 0.52, { color: ink, weight: 2 });
  return group([bg, ic], { role: "decor", ...(o.label ? { label: o.label } : {}), box: b });
}

/** Insignia redonda con un número ("1", "02"). */
export function numberBadge(k: Kit, text: string, cx: number, cy: number, d: number, o: { variant?: "accent" | "soft" } = {}): GroupNode {
  const th = k.theme;
  const accent = (o.variant ?? "accent") === "accent";
  const circle = ellipse({
    cx,
    cy,
    rx: d / 2,
    fill: accent ? { kind: "linear", x0: cx - d / 2, y0: cy - d / 2, x1: cx + d / 2, y1: cy + d / 2, stops: [[0, mix(th.accent, "#ffffff", 0.18)], [1, th.accent]] } : rgba(th.accent, 0.16),
    ...(accent ? { shadow: { color: rgba(th.accent, 0.4), blur: d * 0.4, y: d * 0.1 } } : { stroke: { color: rgba(th.accent, 0.4), width: Math.max(1, 1.5 * k.u) } }),
    role: "decor",
  });
  const font = display(k, 800, -0.02);
  const size = d * (text.length > 1 ? 0.4 : 0.46);
  const f = fitLine(k.measure, text, font, size, size * 0.6, d * 0.8);
  const t = textNode(k, f, cx - f.widths[0]! / 2, cy - f.lineHeight / 2, f.widths[0]!, { color: accent ? th.accentText : th.accent, on: accent ? th.accent : k.ground, overlap: true });
  return group([circle, t], { role: "decor", box: { x: cx - d / 2, y: cy - d / 2, w: d, h: d } });
}

const common0 = (o: CommonOpts): CommonOpts => ({ ...(o.id ? { id: o.id } : {}), ...(o.label ? { label: o.label } : {}), ...(o.overlap ? { overlap: true } : {}) });

/** Línea recta o curva (con `bend`, fracción del largo) como `d` de SVG. */
export function lineD(x1: number, y1: number, x2: number, y2: number, bend = 0): string {
  if (!bend) return `M${x1} ${y1}L${x2} ${y2}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / (len || 1);
  const ny = (x2 - x1) / (len || 1);
  return `M${x1} ${y1}Q${mx + nx * len * bend} ${my + ny * len * bend} ${x2} ${y2}`;
}

/** Flecha que se dibuja (con punta que la sigue). */
export function arrow(k: Kit, x1: number, y1: number, x2: number, y2: number, o: { color?: Fill; width?: number; bend?: number; headSize?: number } & CommonOpts = {}): PathNode {
  const w = o.width ?? 5 * k.s;
  const color = o.color ?? col(k, "accent");
  return path(lineD(x1, y1, x2, y2, o.bend ?? 0), { stroke: { color, width: w, cap: "round" }, head: { size: o.headSize ?? w * 3.2, color }, role: "decor", ...common0(o) });
}

/** Subrayado de pincel (curva suave, más gruesa al medio): se dibuja con `draw`. */
export function brushUnderline(k: Kit, x0: number, x1: number, y: number, o: { color?: Fill; width?: number } = {}): PathNode {
  const w = x1 - x0;
  const d = `M${x0} ${y + w * 0.012}C${x0 + w * 0.3} ${y - w * 0.02} ${x0 + w * 0.65} ${y - w * 0.018} ${x1} ${y - w * 0.004}`;
  return path(d, { stroke: { color: o.color ?? col(k, "accent"), width: o.width ?? 12 * k.s, cap: "round" }, role: "decor", overlap: true });
}

/** Tilde (check) como trazo dentro de una caja de lado `size` centrada en (cx, cy). */
export function checkPath(k: Kit, cx: number, cy: number, size: number, o: { color: Fill; width?: number }): PathNode {
  const s = size;
  const d = `M${cx - s * 0.3} ${cy + s * 0.02}L${cx - s * 0.08} ${cy + s * 0.24}L${cx + s * 0.32} ${cy - s * 0.22}`;
  return path(d, { stroke: { color: o.color, width: o.width ?? s * 0.13, cap: "round", join: "round" }, role: "decor", overlap: true, box: { x: cx - s / 2, y: cy - s / 2, w: s, h: s } });
}

/** Una cruz (x) dibujable. */
export function crossPath(k: Kit, cx: number, cy: number, size: number, o: { color: Fill; width?: number }): PathNode {
  const a = size * 0.24;
  return path([`M${cx - a} ${cy - a}L${cx + a} ${cy + a}`, `M${cx + a} ${cy - a}L${cx - a} ${cy + a}`], { stroke: { color: o.color, width: o.width ?? size * 0.12, cap: "round" }, drawMode: "sequence", role: "decor", overlap: true, box: { x: cx - size / 2, y: cy - size / 2, w: size, h: size } });
}

/** Distribuye `n` elementos a lo largo de `total` con un hueco fijo. */
export function spread(n: number, total: number, gap: number): number {
  return (total - gap * (n - 1)) / n;
}

/** Ritmo de la escena: tiempos de entrada que respetan lo que dura el tramo. */
export function pace(k: Kit, items: number, opts: { start?: number; min?: number; max?: number; budget?: number } = {}): { start: number; each: number } {
  const start = opts.start ?? 0.15;
  const budget = opts.budget ?? Math.max(0.6, k.duration * 0.45);
  const each = Math.max(opts.min ?? 0.08, Math.min(opts.max ?? 0.35, budget / Math.max(1, items)));
  return { start, each };
}

export { mix, rgba, contrast };
export type { Fit, FontSpec };
