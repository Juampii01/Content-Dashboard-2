/**
 * Nodos compilados de una escena: lo que el renderizador dibuja. Están en píxeles del lienzo final y llevan sus
 * pistas de animación (keyframes por propiedad). Los arman los componentes (components/) y las capas primitivas
 * del esquema (compile.ts).
 */
import { applyEase, clamp01, type Ease } from "./easing";
import type { ParsedPath } from "./path";

export type Box = { x: number; y: number; w: number; h: number };

/** Propiedades animables. x e y son desplazamientos en píxeles; draw/fill/reveal/chars/mark… van de 0 a 1. */
export const PROPS = ["opacity", "x", "y", "scale", "scaleX", "scaleY", "rotation", "draw", "fill", "reveal", "value", "chars", "mark", "strike", "underline"] as const;
export type Prop = (typeof PROPS)[number];

export const PROP_DEFAULTS: Record<Prop, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  draw: 1,
  fill: 1,
  reveal: 1,
  value: 1,
  chars: 1,
  mark: 1,
  strike: 1,
  underline: 1,
};

/** Un keyframe: en el segundo t la propiedad vale v; `ease` es la curva para llegar a este keyframe. */
export type Key = { t: number; v: number; ease?: Ease };
export type Track = Key[];
export type Tracks = Partial<Record<Prop, Track>>;

export type GradientStop = [number, string];
export type Gradient =
  | { kind: "linear"; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | { kind: "radial"; cx: number; cy: number; r: number; stops: GradientStop[]; sx?: number; sy?: number };
/** Relleno: color CSS ya resuelto o degradado en píxeles del lienzo. */
export type Fill = string | Gradient;
export type Stroke = { color: Fill; width: number; cap?: "round" | "butt" | "square"; join?: "round" | "miter" | "bevel"; dash?: number[] };
export type Shadow = { color: string; blur: number; x?: number; y?: number };

/** Para qué sirve el nodo (lo usa el validador: los textos se revisan contra su fondo y la zona segura). */
export type Role = "text" | "card" | "shape" | "decor" | "backdrop";

type Common = {
  id?: string;
  /** Nombre legible para los avisos del validador ("el título", "la barra 2"). */
  label?: string;
  tracks: Tracks;
  /** Caja que ocupa ya asentado (sin animación). Centro de escala y rotación salvo `pivot`. */
  box: Box;
  pivot?: [number, number];
  /** Opacidad base (se multiplica por la pista de opacidad). */
  alpha?: number;
  shadow?: Shadow;
  /** Cómo recorta la pista `reveal` (cortina). */
  reveal?: "left" | "right" | "up" | "down" | "center";
  role?: Role;
  /** Color (hex) que queda detrás del texto, para revisar el contraste. */
  on?: string;
  /** Puede pisar a otros sin que sea un error (resaltados, brillos, insignias). */
  overlap?: boolean;
  /** No participa de la salida automática (ya tiene la suya). */
  noExit?: boolean;
  composite?: "source-over" | "lighter" | "screen" | "multiply";
  /** Su escala late en bucle (pulse): no cuenta para saber cuándo termina la entrada. */
  ambient?: boolean;
};

export type RectNode = Common & {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  fill?: Fill;
  stroke?: Stroke;
  /** Con la pista `fill`, el rectángulo crece desde ese borde (barras, niveles del embudo). */
  grow?: "right" | "left" | "up" | "down";
};

export type EllipseNode = Common & {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: Fill;
  stroke?: Stroke;
  /** Arco (grados, 0 = arriba, sentido horario). Con la pista `draw` se dibuja de a poco. */
  arc?: { start: number; sweep: number };
};

export type PathNode = Common & {
  kind: "path";
  paths: ParsedPath[];
  /** Transformación de las coordenadas del trazado al lienzo. */
  tf: { x: number; y: number; s: number; sx?: number; sy?: number };
  fill?: Fill;
  stroke?: Stroke;
  drawMode?: "together" | "sequence";
  /** Punta de flecha que sigue al trazo mientras se dibuja. */
  head?: { size: number; color: Fill };
  /** Relleno con regla par-impar (íconos con agujeros). */
  evenOdd?: boolean;
};

export type TextLine = { text: string; x: number; baseline: number; w: number };
/**
 * Marca sobre una parte del texto: marcador detrás (`marker`, pista `mark`), subrayado (`underline`) o tachado
 * (`strike`). Todas las marcas del nodo se barren en orden con su pista.
 */
export type TextMark = { kind: "marker" | "underline" | "strike"; line: number; x0: number; x1: number; color: Fill; textColor?: string; thickness?: number };
export type TextNode = Common & {
  kind: "text";
  lines: TextLine[];
  font: string;
  size: number;
  /** Espaciado entre letras en píxeles. */
  tracking: number;
  color: Fill;
  marks?: TextMark[];
  /** Tramos con otro color (palabras en acento): se dibujan encima de su línea, en su posición. */
  spans?: { line: number; x: number; text: string; color: Fill }[];
  /** El texto no entró en su caja ni con el tamaño mínimo (lo avisa el validador). */
  overflow?: boolean;
  lineHeight: number;
};

/** Cómo se escribe un número que cuenta ("x2", "+40%", "10K", "6/10", "12,345"). */
export type CountFormat = {
  prefix: string;
  suffix: string;
  from: number;
  to: number;
  decimals: number;
  thousands: "" | "," | ".";
  decimal: "." | ",";
  /** El texto exacto del final (se muestra tal cual cuando termina de contar). */
  final: string;
};

export type CounterNode = Common & {
  kind: "counter";
  fmt: CountFormat;
  /** Punto de anclaje y línea base. */
  x: number;
  baseline: number;
  align: "left" | "center" | "right";
  font: string;
  size: number;
  tracking: number;
  color: Fill;
  affixColor: Fill;
  /** Ancho fijo de cada dígito (así el número no "baila" mientras cuenta). */
  digitW: number;
  /** Ancho de prefijo y sufijo (medidos). */
  prefixW: number;
  suffixW: number;
};

export type GroupNode = Common & {
  kind: "group";
  children: Node[];
  clip?: { x: number; y: number; w: number; h: number; r: number };
};

export type ImageNode = Common & { kind: "image"; src: string; x: number; y: number; w: number; h: number; r: number; fit: "cover" | "contain" };

export type Node = RectNode | EllipseNode | PathNode | TextNode | CounterNode | GroupNode | ImageNode;

// ─── Pistas ───────────────────────────────────────────────────────────────

/** Valor de una pista en el instante t. */
export function valueAt(track: Track | undefined, t: number, def: number): number {
  if (!track || !track.length) return def;
  if (t <= track[0]!.t) return track[0]!.v;
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!;
    if (t <= b.t) {
      const a = track[i - 1]!;
      const span = b.t - a.t;
      if (span <= 1e-9) return b.v;
      const p = applyEase(b.ease, (t - a.t) / span);
      return a.v + (b.v - a.v) * p;
    }
  }
  return track[track.length - 1]!.v;
}

export function propAt(node: { tracks: Tracks }, prop: Prop, t: number): number {
  return valueAt(node.tracks[prop], t, PROP_DEFAULTS[prop]);
}

/** Agrega keyframes a una pista (quedan ordenados por tiempo). */
export function addKeys(node: { tracks: Tracks }, prop: Prop, keys: Key[]): void {
  const cur = node.tracks[prop] ?? [];
  const merged = [...cur, ...keys].sort((a, b) => a.t - b.t);
  node.tracks[prop] = merged;
}

/** Último instante con animación de entrada (para comprimir si el tramo es corto). */
export function lastKeyTime(nodes: Node[]): number {
  let last = 0;
  const visit = (n: Node) => {
    for (const k of Object.keys(n.tracks) as Prop[]) {
      if (n.ambient && k === "scale") continue;
      const tr = n.tracks[k];
      if (tr?.length) last = Math.max(last, tr[tr.length - 1]!.t);
    }
    if (n.kind === "group") n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return last;
}

/** Multiplica los tiempos de todas las pistas (y suma un desfase). */
export function retime(nodes: Node[], scale: number, offset = 0): void {
  const visit = (n: Node) => {
    for (const k of Object.keys(n.tracks) as Prop[]) {
      const tr = n.tracks[k];
      if (tr) n.tracks[k] = tr.map((key) => ({ ...key, t: key.t * scale + offset }));
    }
    if (n.kind === "group") n.children.forEach(visit);
  };
  nodes.forEach(visit);
}

export const progressBetween = (t: number, a: number, b: number) => clamp01((t - a) / Math.max(1e-6, b - a));

/** Recorre el árbol (con la profundidad). */
export function walk(nodes: Node[], fn: (n: Node, parents: GroupNode[]) => void, parents: GroupNode[] = []): void {
  for (const n of nodes) {
    fn(n, parents);
    if (n.kind === "group") walk(n.children, fn, [...parents, n]);
  }
}

export function unionBox(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
