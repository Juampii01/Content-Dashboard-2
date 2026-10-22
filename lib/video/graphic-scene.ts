/**
 * Diseño y animación de los gráficos del b-roll "a medida".
 *
 * `buildScene` arma la escena (elementos con su caja, lo que se dibuja y su animación) para un spec, un formato
 * y una duración; `elementState` dice cómo está cada elemento en un instante. La vista previa del navegador
 * (components/editor/graphic-canvas.tsx) la dibuja en un <canvas> y el worker la dibuja con Pillow
 * (worker/video/graphics.py, que es una copia línea por línea de este archivo: si cambias algo aquí, cámbialo allá
 * y corre las pruebas de los dos lados).
 *
 * Sin dependencias de servidor ni del DOM: la medición de textos llega como función.
 */
import type { GraphicSpec, GraphicSpecOf, GraphicTheme } from "./graphics";

export type FontRef = { family: "inter" | "montserrat"; weight: 700 | 800 | 900 };
/** Ancho en píxeles de un texto con una fuente y un tamaño. */
export type Measure = (text: string, font: FontRef, size: number) => number;

export type Run = { text: string; x: number; baseline: number; size: number; font: FontRef; color: string; spacing: number };
export type Counter = {
  prefix: string;
  suffix: string;
  /** El número tal como se escribió (se muestra exacto al final). */
  text: string;
  to: number;
  decimals: number;
  thousands: "" | "." | ",";
  decimalChar: "." | ",";
  /** Borde derecho de las cifras y línea base, relativos a la caja. */
  right: number;
  baseline: number;
  size: number;
  font: FontRef;
  digitsColor: string;
  affixColor: string;
  start: number;
  dur: number;
};
export type Paint =
  | { type: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string; alpha: number; stroke?: string; strokeAlpha?: number; strokeWidth?: number }
  | { type: "circle"; cx: number; cy: number; r: number; fill: string; alpha: number; stroke?: string; strokeWidth?: number }
  | { type: "text"; runs: Run[] }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: "glow"; color: string; alpha: number }
  | { type: "counter"; counter: Counter };

export type AnimKind = "fade" | "up" | "slide" | "pop" | "zoom" | "wipe-x" | "wipe-y";
export type Anim = { kind: AnimKind; start: number; dur: number; dist?: number; from?: number };
export type Element = { x: number; y: number; w: number; h: number; paints: Paint[]; anim: Anim; pad: number };

export type Box = { x: number; y: number; w: number; h: number };
export type Stop = [number, number];
export type Scene = {
  width: number;
  height: number;
  mode: "full" | "overlay";
  theme: GraphicTheme;
  duration: number;
  elements: Element[];
  /** Velo del modo "overlay": degradado vertical del color de fondo de la marca (fracción de alto, opacidad). */
  veil: Stop[] | null;
  /** Escala de los tiempos de entrada (< 1 si el tramo es corto) y duración de la salida. */
  timeScale: number;
  exit: number;
  box: Box;
};

export type ElementState = { opacity: number; dx: number; dy: number; scale: number; reveal: number };

// ─── Curvas ───────────────────────────────────────────────────────────────

export const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
export const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
export const easeInCubic = (p: number) => p ** 3;
export const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
export const easeOutBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
export const easeOutExpo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));

// ─── Cajas por formato y modo ─────────────────────────────────────────────

/** Zona del contenido. En pantalla completa queda arriba de los subtítulos; sobre el video, en una franja sin la cara. */
export function contentBox(width: number, height: number, mode: "full" | "overlay", position: "top" | "bottom"): Box {
  const vertical = height > width;
  const frac = (x0: number, y0: number, y1: number): Box => ({ x: x0, y: height * y0, w: width - 2 * x0, h: height * (y1 - y0) });
  if (mode === "full") return vertical ? frac(96, 0.11, 0.6) : frac(200, 0.1, 0.7);
  if (vertical) return position === "top" ? frac(80, 0.06, 0.34) : frac(80, 0.58, 0.82);
  return position === "top" ? frac(200, 0.07, 0.42) : frac(200, 0.58, 0.9);
}

export function veilStops(width: number, height: number, position: "top" | "bottom"): Stop[] {
  const vertical = height > width;
  if (position === "top")
    return vertical
      ? [[0, 0.88], [0.22, 0.78], [0.42, 0.35], [0.56, 0]]
      : [[0, 0.86], [0.3, 0.7], [0.5, 0.3], [0.66, 0]];
  return vertical
    ? [[0.45, 0], [0.55, 0.4], [0.66, 0.8], [1, 0.9]]
    : [[0.45, 0], [0.58, 0.35], [0.72, 0.78], [1, 0.88]];
}

// ─── Texto ────────────────────────────────────────────────────────────────

export function spacedWidth(measure: Measure, text: string, font: FontRef, size: number, spacing: number): number {
  if (!spacing) return measure(text, font, size);
  let w = 0;
  for (const ch of text) w += measure(ch, font, size);
  return w + spacing * Math.max(0, [...text].length - 1);
}

function wrap(measure: Measure, text: string, font: FontRef, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, font, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

export type Fitted = { size: number; lines: string[]; widths: number[] };

/**
 * El tamaño más grande (entre max y min) en el que el texto entra en `maxLines` líneas de `maxWidth`.
 * Con `balance`, las líneas quedan parejas (sin una palabra sola al final).
 */
export function fitText(measure: Measure, text: string, font: FontRef, max: number, min: number, maxWidth: number, maxLines: number, balance = true): Fitted {
  let size = Math.round(max);
  const floor = Math.round(min);
  let lines = wrap(measure, text, font, size, maxWidth);
  for (;;) {
    lines = wrap(measure, text, font, size, maxWidth);
    const widest = Math.max(0, ...lines.map((l) => measure(l, font, size)));
    if ((lines.length <= maxLines && widest <= maxWidth) || size <= floor) break;
    size = Math.max(floor, Math.floor(size * 0.94));
  }
  if (balance && lines.length > 1) {
    let target = maxWidth;
    for (let i = 0; i < 24; i++) {
      const narrower = target * 0.95;
      const attempt = wrap(measure, text, font, size, narrower);
      if (attempt.length !== lines.length) break;
      lines = attempt;
      target = narrower;
    }
  }
  return { size, lines, widths: lines.map((l) => measure(l, font, size)) };
}

/** Línea base de la línea i de un bloque con alto de línea lh (igual en el navegador y en el worker). */
export const baselineOf = (i: number, lh: number, size: number) => i * lh + lh * 0.5 + size * 0.35;

function textRuns(fitted: Fitted, font: FontRef, color: string, lh: number, width: number, align: "left" | "center"): Run[] {
  return fitted.lines.map((text, i) => ({
    text,
    x: align === "center" ? (width - fitted.widths[i]!) / 2 : 0,
    baseline: baselineOf(i, lh, fitted.size),
    size: fitted.size,
    font,
    color,
    spacing: 0,
  }));
}

function elementPad(paints: Paint[]): number {
  let size = 0;
  for (const p of paints) {
    if (p.type === "text") for (const r of p.runs) size = Math.max(size, r.size);
    if (p.type === "counter") size = Math.max(size, p.counter.size);
  }
  return Math.round(size * 0.3 + 8);
}

const el = (box: Box, paints: Paint[], anim: Anim): Element => ({ ...box, paints, anim, pad: elementPad(paints) });

/** Texto en mayúsculas con espaciado (eyebrow): reduce el tamaño hasta que entra en una línea. */
function eyebrow(measure: Measure, text: string, maxSize: number, maxWidth: number, color: string): { run: Run; width: number; size: number } {
  const font: FontRef = { family: "inter", weight: 700 };
  const upper = text.toUpperCase();
  let size = Math.round(maxSize);
  let width = spacedWidth(measure, upper, font, size, Math.round(size * 0.16));
  while (width > maxWidth && size > 18) {
    size = Math.max(18, Math.floor(size * 0.94));
    width = spacedWidth(measure, upper, font, size, Math.round(size * 0.16));
  }
  return { run: { text: upper, x: 0, baseline: size * 0.5 + size * 0.35, size, font, color, spacing: Math.round(size * 0.16) }, width, size };
}

// ─── Escena ───────────────────────────────────────────────────────────────

type Ctx = { measure: Measure; box: Box; s: number; theme: GraphicTheme; family: FontRef["family"]; overlay: boolean; vertical: boolean; duration: number };

const SHRINK = [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55];

export function buildScene(spec: GraphicSpec, width: number, height: number, duration: number, measure: Measure): Scene {
  const u = Math.min(width, height) / 1080;
  const box = contentBox(width, height, spec.mode, spec.position);
  const overlay = spec.mode === "overlay";
  const base: Omit<Ctx, "s"> = { measure, box, theme: spec.theme, family: spec.font, overlay, vertical: height > width, duration };
  let elements: Element[] = [];
  // Si no entra en la zona, se achica todo un poco y se vuelve a armar.
  for (const k of SHRINK) {
    const ctx: Ctx = { ...base, s: (overlay ? 0.8 : 1) * k * u };
    const built = layout(spec, ctx);
    elements = built.elements;
    if (built.height <= box.h) break;
  }
  const exit = Math.min(0.4, duration * 0.16);
  let last = 0;
  for (const e of elements) {
    last = Math.max(last, e.anim.start + e.anim.dur);
    for (const p of e.paints) if (p.type === "counter") last = Math.max(last, p.counter.start + p.counter.dur);
  }
  const available = duration - exit - 0.15;
  const timeScale = last > 0 ? Math.max(0.3, Math.min(1, available / last)) : 1;
  return { width, height, mode: spec.mode, theme: spec.theme, duration, elements, veil: overlay ? veilStops(width, height, spec.position) : null, timeScale, exit, box };
}

/** Estado de un elemento en el instante t (segundos desde que empieza el gráfico). */
export function elementState(scene: Scene, e: Element, t: number): ElementState {
  const a = e.anim;
  const ts = scene.timeScale;
  const p = clamp01((t - a.start * ts) / Math.max(0.001, a.dur * ts));
  const st: ElementState = { opacity: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
  const dist = a.dist ?? 0;
  if (a.kind === "fade") st.opacity = easeOutCubic(p);
  else if (a.kind === "up") {
    const q = easeOutCubic(p);
    st.opacity = q;
    st.dy = (1 - q) * dist;
  } else if (a.kind === "slide") {
    const q = easeOutCubic(p);
    st.opacity = q;
    st.dx = -(1 - q) * dist;
  } else if (a.kind === "pop") {
    const from = a.from ?? 0.85;
    st.scale = from + (1 - from) * easeOutBack(p);
    st.opacity = easeOutCubic(clamp01(p * 1.6));
  } else if (a.kind === "zoom") {
    const q = easeOutCubic(p);
    st.scale = (a.from ?? 1.12) + (1 - (a.from ?? 1.12)) * q;
    st.opacity = q;
  } else {
    st.reveal = easeInOutCubic(p);
    st.opacity = p > 0 ? 1 : 0;
  }
  const exitP = clamp01((t - (scene.duration - scene.exit)) / Math.max(0.001, scene.exit));
  if (exitP > 0) {
    const q = easeInCubic(exitP);
    st.opacity *= 1 - q;
    st.dy -= q * 24 * (Math.min(scene.width, scene.height) / 1080);
  }
  return st;
}

/** Texto del contador en el instante t (al terminar, el número exacto como se escribió). */
export function counterText(scene: Scene, c: Counter, t: number): string {
  const p = clamp01((t - c.start * scene.timeScale) / Math.max(0.001, c.dur * scene.timeScale));
  if (p >= 1) return c.text;
  const v = c.to * easeOutExpo(p);
  if (c.decimals > 0) return v.toFixed(c.decimals).replace(".", c.decimalChar);
  const n = Math.floor(v + 0.5);
  if (!c.thousands) return String(n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, c.thousands);
}

/** Parte un valor como "+40%" en prefijo, número y sufijo. */
export function splitValue(value: string): { prefix: string; num: string; suffix: string; to: number; decimals: number; thousands: "" | "." | ","; decimalChar: "." | "," } {
  const m = value.match(/^(\D*?)(\d+(?:[.,]\d+)*)(.*)$/);
  const prefix = m?.[1] ?? "";
  const num = m?.[2] ?? "0";
  const suffix = m?.[3] ?? "";
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) return { prefix, num, suffix, to: Number(num.replace(/[.,]/g, "")), decimals: 0, thousands: num.includes(".") ? "." : ",", decimalChar: "," };
  const dec = num.match(/^(\d+)([.,])(\d+)$/);
  if (dec) return { prefix, num, suffix, to: Number(`${dec[1]}.${dec[3]}`), decimals: dec[3]!.length, thousands: "", decimalChar: dec[2] as "." | "," };
  return { prefix, num, suffix, to: Number(num.replace(/[.,]/g, "")), decimals: 0, thousands: "", decimalChar: "," };
}

type Built = { elements: Element[]; height: number };

function layout(spec: GraphicSpec, ctx: Ctx): Built {
  switch (spec.template) {
    case "number":
      return layoutNumber(spec, ctx);
    case "list":
      return layoutList(spec, ctx);
    case "quote":
      return layoutQuote(spec, ctx);
    case "keyword":
      return layoutKeyword(spec, ctx);
    case "compare":
      return layoutCompare(spec, ctx);
    case "flow":
      return layoutFlow(spec, ctx);
  }
}

function layoutNumber(spec: GraphicSpecOf<"number">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const display: FontRef = { family: c.family, weight: 900 };
  const v = splitValue(spec.value);
  const size = fitText(measure, spec.value, display, (c.vertical ? 340 : 300) * s, 110 * s, box.w, 1, false).size;
  const prefixW = measure(v.prefix, display, size);
  const numW = measure(v.num, display, size);
  const valueW = prefixW + numW + measure(v.suffix, display, size);
  const labelFont: FontRef = { family: c.family, weight: 800 };
  const label = spec.label ? fitText(measure, spec.label, labelFont, 60 * s, 32 * s, Math.min(box.w, 860 * s), 2) : null;
  const labelLh = label ? label.size * 1.18 : 0;
  const valueH = size * 1.02;
  const barH = Math.max(6, 12 * s);
  const gap1 = 26 * s;
  const gap2 = 34 * s;
  const height = valueH + gap1 + barH + (label ? gap2 + label.lines.length * labelLh : 0);
  let y = box.y + (box.h - height) / 2;
  const cx = box.x + box.w / 2;
  const out: Element[] = [];
  if (!c.overlay) {
    const gw = valueW * 1.5 + 220 * s;
    const gh = size * 2.3;
    out.push(el({ x: cx - gw / 2, y: y + valueH / 2 - gh / 2, w: gw, h: gh }, [{ type: "glow", color: theme.accent, alpha: 0.3 }], { kind: "fade", start: 0, dur: 0.7 }));
  }
  out.push(
    el({ x: cx - valueW / 2, y, w: valueW, h: valueH }, [
      {
        type: "counter",
        counter: {
          prefix: v.prefix,
          suffix: v.suffix,
          text: v.num,
          to: v.to,
          decimals: v.decimals,
          thousands: v.thousands,
          decimalChar: v.decimalChar,
          right: prefixW + numW,
          baseline: baselineOf(0, valueH, size),
          size,
          font: display,
          digitsColor: theme.text,
          affixColor: theme.accent,
          start: 0.1,
          dur: Math.min(1.2, Math.max(0.6, c.duration * 0.4)),
        },
      },
    ], { kind: "pop", start: 0.04, dur: 0.55, from: 0.82 }),
  );
  y += valueH + gap1;
  const barW = Math.min(valueW * 0.42, 240 * s);
  out.push(el({ x: cx - barW / 2, y, w: barW, h: barH }, [{ type: "rect", x: 0, y: 0, w: barW, h: barH, r: barH / 2, fill: theme.accent, alpha: 1 }], { kind: "wipe-x", start: 0.5, dur: 0.45 }));
  y += barH;
  if (label) {
    y += gap2;
    const w = Math.max(...label.widths);
    out.push(el({ x: cx - w / 2, y, w, h: label.lines.length * labelLh }, [{ type: "text", runs: textRuns(label, labelFont, c.overlay ? theme.text : theme.muted, labelLh, w, "center") }], { kind: "up", start: 0.42, dur: 0.5, dist: 30 * s }));
  }
  return { elements: out, height };
}

function layoutList(spec: GraphicSpecOf<"list">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const head: FontRef = { family: c.family, weight: 800 };
  const title = spec.title ? fitText(measure, spec.title, head, 66 * s, 40 * s, box.w, 2) : null;
  const titleLh = title ? title.size * 1.12 : 0;
  const d = 78 * s;
  const gap = 30 * s;
  const pad = 30 * s;
  const textW = box.w - 2 * pad - d - gap;
  const itemFont: FontRef = { family: c.family, weight: 800 };
  const size = Math.min(...spec.items.map((it) => fitText(measure, it, itemFont, 56 * s, 32 * s, textW, 2).size));
  const items = spec.items.map((it) => fitText(measure, it, itemFont, size, size, textW, 2));
  const lh = size * 1.18;
  const rows = items.map((it) => Math.max(d, it.lines.length * lh) + 2 * pad);
  const rowGap = 22 * s;
  const titleGap = 40 * s;
  const height = (title ? title.lines.length * titleLh + titleGap : 0) + rows.reduce((a, b) => a + b, 0) + rowGap * (rows.length - 1);
  let y = box.y + (box.h - height) / 2;
  const out: Element[] = [];
  if (title) {
    const h = title.lines.length * titleLh;
    out.push(el({ x: box.x, y, w: box.w, h }, [{ type: "text", runs: textRuns(title, head, theme.text, titleLh, box.w, "left") }], { kind: "up", start: 0, dur: 0.5, dist: 30 * s }));
    y += h + titleGap;
  }
  const stagger = Math.max(0.3, Math.min(0.7, (c.duration - 1.6) / items.length));
  items.forEach((it, i) => {
    const h = rows[i]!;
    const start = 0.25 + i * stagger;
    const textH = it.lines.length * lh;
    const runs = textRuns(it, itemFont, theme.text, lh, textW, "left").map((r) => ({ ...r, x: r.x + pad + d + gap, baseline: r.baseline + (h - textH) / 2 }));
    out.push(
      el({ x: box.x, y, w: box.w, h }, [
        { type: "rect", x: 0, y: 0, w: box.w, h, r: 28 * s, fill: theme.surface, alpha: c.overlay ? 0.92 : 1, stroke: theme.accent, strokeAlpha: 0.28, strokeWidth: Math.max(2, 2 * s) },
        { type: "text", runs },
      ], { kind: "slide", start, dur: 0.5, dist: 70 * s }),
    );
    const badgeFont: FontRef = { family: c.family, weight: 900 };
    const num = String(i + 1);
    const ns = Math.round(40 * s);
    out.push(
      el({ x: box.x + pad, y: y + (h - d) / 2, w: d, h: d }, [
        { type: "circle", cx: d / 2, cy: d / 2, r: d / 2, fill: theme.accent, alpha: 1 },
        { type: "text", runs: [{ text: num, x: (d - measure(num, badgeFont, ns)) / 2, baseline: d / 2 + ns * 0.35, size: ns, font: badgeFont, color: theme.accentText, spacing: 0 }] },
      ], { kind: "pop", start: start + 0.12, dur: 0.45, from: 0.4 }),
    );
    y += h + rowGap;
  });
  return { elements: out, height };
}

/** Normaliza una palabra para comparar (minúsculas, sin tildes ni signos). */
const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ%]+/g, "");

/** Índices (en el orden de las palabras) de las que van resaltadas. */
export function highlightIndexes(words: string[], highlight: string): Set<number> {
  const target = highlight.split(/\s+/).map(norm).filter(Boolean);
  const out = new Set<number>();
  if (!target.length) return out;
  const plain = words.map(norm);
  for (let i = 0; i + target.length <= plain.length; i++) {
    if (target.every((t, k) => plain[i + k] === t)) {
      for (let k = 0; k < target.length; k++) out.add(i + k);
      return out;
    }
  }
  plain.forEach((w, i) => target.includes(w) && w && out.add(i));
  return out;
}

function layoutQuote(spec: GraphicSpecOf<"quote">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const font: FontRef = { family: c.family, weight: 900 };
  const fitted = fitText(measure, spec.text, font, 100 * s, 48 * s, box.w, 5);
  const size = fitted.size;
  const lh = size * 1.14;
  const qm = Math.round(150 * s);
  const qmH = qm * 0.62;
  const gap = 14 * s;
  const height = qmH + gap + fitted.lines.length * lh;
  const top = box.y + (box.h - height) / 2;
  const out: Element[] = [];
  const cx = box.x + box.w / 2;
  const qw = measure("“", font, qm);
  out.push(el({ x: cx - qw / 2, y: top, w: qw, h: qmH }, [{ type: "text", runs: [{ text: "“", x: 0, baseline: qm * 0.86, size: qm, font, color: theme.accent, spacing: 0 }] }], { kind: "pop", start: 0, dur: 0.5, from: 0.5 }));
  const words = fitted.lines.flatMap((l) => l.split(" "));
  const marked = highlightIndexes(words, spec.highlight);
  const step = Math.max(0.05, Math.min(0.14, (c.duration * 0.42) / Math.max(1, words.length)));
  const space = measure(" ", font, size);
  const markers: Element[] = [];
  const words_: Element[] = [];
  let k = 0;
  fitted.lines.forEach((line, li) => {
    const lineTop = top + qmH + gap + li * lh;
    let x = box.x + (box.w - fitted.widths[li]!) / 2;
    for (const word of line.split(" ")) {
      const ww = measure(word, font, size);
      const start = 0.15 + k * step;
      const baseline = baselineOf(0, lh, size);
      words_.push(el({ x, y: lineTop, w: ww, h: lh }, [{ type: "text", runs: [{ text: word, x: 0, baseline, size, font, color: theme.text, spacing: 0 }] }], { kind: "up", start, dur: 0.4, dist: 28 * s }));
      if (marked.has(k)) {
        const px = size * 0.1;
        const mh = size * 1.0;
        const mb: Box = { x: x - px, y: lineTop + lh / 2 - mh / 2, w: ww + 2 * px, h: mh };
        const anim: Anim = { kind: "wipe-x", start: start + 0.25, dur: 0.35 };
        markers.push(el(mb, [{ type: "rect", x: 0, y: 0, w: mb.w, h: mb.h, r: size * 0.12, fill: theme.accent, alpha: 1 }], anim));
        markers.push(el(mb, [{ type: "text", runs: [{ text: word, x: px, baseline: baseline - (mb.y - lineTop), size, font, color: theme.accentText, spacing: 0 }] }], anim));
      }
      x += ww + space;
      k++;
    }
  });
  return { elements: [...out, ...words_, ...markers], height };
}

function layoutKeyword(spec: GraphicSpecOf<"keyword">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const font: FontRef = { family: c.family, weight: 900 };
  const fitted = fitText(measure, spec.text, font, 230 * s, 80 * s, box.w * 0.88, 2);
  const size = fitted.size;
  const lh = size * 1.12;
  const label = spec.label ? eyebrow(measure, spec.label, 34 * s, box.w, theme.accent) : null;
  const labelGap = 30 * s;
  const height = (label ? label.size * 1.2 + labelGap : 0) + fitted.lines.length * lh;
  let y = box.y + (box.h - height) / 2;
  const cx = box.x + box.w / 2;
  const out: Element[] = [];
  if (label) {
    out.push(el({ x: cx - label.width / 2, y, w: label.width, h: label.size * 1.2 }, [{ type: "text", runs: [{ ...label.run, baseline: label.size * 0.6 + label.size * 0.35 }] }], { kind: "up", start: 0, dur: 0.45, dist: 24 * s }));
    y += label.size * 1.2 + labelGap;
  }
  const blockH = fitted.lines.length * lh;
  const blockW = Math.max(...fitted.widths);
  out.push(el({ x: cx - blockW / 2, y, w: blockW, h: blockH }, [{ type: "text", runs: textRuns(fitted, font, theme.text, lh, blockW, "center") }], { kind: "zoom", start: 0.05, dur: 0.5, from: 1.12 }));
  fitted.lines.forEach((line, i) => {
    const lw = fitted.widths[i]!;
    const lx = cx - lw / 2;
    const lineTop = y + i * lh;
    const baseline = baselineOf(0, lh, size);
    const anim: Anim = { kind: "wipe-x", start: 0.55 + i * 0.14, dur: 0.5 };
    if (spec.emphasis === "underline") {
      const bh = Math.max(8, size * 0.085);
      out.push(el({ x: lx, y: lineTop + baseline + size * 0.14, w: lw, h: bh }, [{ type: "rect", x: 0, y: 0, w: lw, h: bh, r: bh / 2, fill: theme.accent, alpha: 1 }], anim));
    } else {
      const px = size * 0.16;
      const mh = size * 0.98;
      const mb: Box = { x: lx - px, y: lineTop + lh / 2 - mh / 2, w: lw + 2 * px, h: mh };
      out.push(el(mb, [{ type: "rect", x: 0, y: 0, w: mb.w, h: mb.h, r: size * 0.1, fill: theme.accent, alpha: 1 }], anim));
      out.push(el(mb, [{ type: "text", runs: [{ text: line, x: px, baseline: baseline - (mb.y - lineTop), size, font, color: theme.accentText, spacing: 0 }] }], anim));
    }
  });
  return { elements: out, height };
}

function layoutCompare(spec: GraphicSpecOf<"compare">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const pad = 40 * s;
  const gap = (c.vertical ? 64 : 96) * s;
  const cardW = c.vertical ? box.w : (box.w - gap) / 2;
  const font: FontRef = { family: c.family, weight: 800 };
  const size = Math.min(fitText(measure, spec.left.text, font, 60 * s, 32 * s, cardW - 2 * pad, 3).size, fitText(measure, spec.right.text, font, 60 * s, 32 * s, cardW - 2 * pad, 3).size);
  const left = fitText(measure, spec.left.text, font, size, size, cardW - 2 * pad, 3);
  const right = fitText(measure, spec.right.text, font, size, size, cardW - 2 * pad, 3);
  const lh = size * 1.18;
  const pillH = 54 * s;
  const pillGap = 24 * s;
  const cardH = pad + pillH + pillGap + Math.max(left.lines.length, right.lines.length) * lh + pad;
  const height = c.vertical ? 2 * cardH + gap : cardH;
  const top = box.y + (box.h - height) / 2;
  const second = Math.max(0.5, Math.min(1.1, c.duration * 0.3));
  const card = (x: number, y: number, side: { label: string; text: string }, fitted: Fitted, strong: boolean): Element => {
    const pill = eyebrow(measure, side.label, 28 * s, cardW - 2 * pad - 48 * s, strong ? theme.accentText : theme.muted);
    const pillW = pill.width + 48 * s;
    const runs = textRuns(fitted, font, strong ? theme.text : theme.muted, lh, cardW - 2 * pad, "left").map((r) => ({ ...r, x: r.x + pad, baseline: r.baseline + pad + pillH + pillGap }));
    return el({ x, y, w: cardW, h: cardH }, [
      { type: "rect", x: 0, y: 0, w: cardW, h: cardH, r: 34 * s, fill: theme.surface, alpha: c.overlay ? 0.92 : 1, stroke: strong ? theme.accent : theme.muted, strokeAlpha: strong ? 1 : 0.3, strokeWidth: Math.max(2, (strong ? 3 : 2) * s) },
      { type: "rect", x: pad, y: pad, w: pillW, h: pillH, r: pillH / 2, fill: strong ? theme.accent : theme.muted, alpha: strong ? 1 : 0.18 },
      { type: "text", runs: [{ ...pill.run, x: pad + 24 * s, baseline: pad + pillH / 2 + pill.size * 0.35 }] },
      { type: "text", runs },
    ], { kind: "up", start: strong ? second : 0.05, dur: 0.5, dist: 40 * s });
  };
  const x1 = box.x;
  const y1 = top;
  const x2 = c.vertical ? box.x : box.x + cardW + gap;
  const y2 = c.vertical ? top + cardH + gap : top;
  const out: Element[] = [card(x1, y1, spec.left, left, false)];
  // Tachado de la primera opción.
  const sh = Math.max(5, size * 0.07);
  const strikes: Paint[] = left.lines.map((_, i) => ({ type: "rect" as const, x: 0, y: baselineOf(i, lh, size) - size * 0.3 - sh / 2, w: left.widths[i]!, h: sh, r: sh / 2, fill: theme.accent, alpha: 0.95 }));
  const textTop = y1 + pad + pillH + pillGap;
  out.push(el({ x: x1 + pad, y: textTop, w: Math.max(...left.widths), h: left.lines.length * lh }, strikes, { kind: "wipe-x", start: second + 0.4, dur: 0.45 }));
  out.push(card(x2, y2, spec.right, right, true));
  const d = 84 * s;
  const bcx = c.vertical ? box.x + box.w / 2 : x1 + cardW + gap / 2;
  const bcy = c.vertical ? y1 + cardH + gap / 2 : top + cardH / 2;
  const aw = Math.max(4, 6 * s);
  const arm = d * 0.22;
  out.push(
    el({ x: bcx - d / 2, y: bcy - d / 2, w: d, h: d }, [
      { type: "circle", cx: d / 2, cy: d / 2, r: d / 2, fill: c.overlay ? theme.surface : theme.bg, alpha: 1, stroke: theme.accent, strokeWidth: Math.max(2, 3 * s) },
      c.vertical
        ? { type: "arrow", x1: d / 2, y1: d / 2 - arm, x2: d / 2, y2: d / 2 + arm, color: theme.accent, width: aw }
        : { type: "arrow", x1: d / 2 - arm, y1: d / 2, x2: d / 2 + arm, y2: d / 2, color: theme.accent, width: aw },
    ], { kind: "pop", start: second - 0.12, dur: 0.45, from: 0.4 }),
  );
  return { elements: out, height };
}

function layoutFlow(spec: GraphicSpecOf<"flow">, c: Ctx): Built {
  const { measure, box, s, theme } = c;
  const font: FontRef = { family: c.family, weight: 800 };
  const title = spec.title ? eyebrow(measure, spec.title, 34 * s, box.w, theme.accent) : null;
  const titleGap = 36 * s;
  const pad = 30 * s;
  const conn = (c.vertical ? 74 : 92) * s;
  const nodeW = c.vertical ? Math.min(box.w, 760 * s) : (box.w - 2 * conn) / 3;
  const maxLines = c.vertical ? 2 : 3;
  const size = Math.min(...spec.steps.map((st) => fitText(measure, st, font, 54 * s, 30 * s, nodeW - 2 * pad, maxLines).size));
  const steps = spec.steps.map((st) => fitText(measure, st, font, size, size, nodeW - 2 * pad, maxLines));
  const lh = size * 1.16;
  const numSize = Math.round(26 * s);
  const numH = numSize * 1.3;
  const numGap = 10 * s;
  const nodeH = pad + numH + numGap + Math.max(...steps.map((x) => x.lines.length)) * lh + pad;
  const titleH = title ? title.size * 1.2 + titleGap : 0;
  const height = titleH + (c.vertical ? 3 * nodeH + 2 * conn : nodeH);
  let y = box.y + (box.h - height) / 2;
  const cx = box.x + box.w / 2;
  const out: Element[] = [];
  if (title) {
    out.push(el({ x: cx - title.width / 2, y, w: title.width, h: title.size * 1.2 }, [{ type: "text", runs: [{ ...title.run, baseline: title.size * 0.6 + title.size * 0.35 }] }], { kind: "up", start: 0, dur: 0.45, dist: 24 * s }));
    y += titleH;
  }
  const step = Math.max(0.35, Math.min(0.75, (c.duration - 1.4) / 3));
  const numFont: FontRef = { family: "inter", weight: 700 };
  const nodes: Box[] = steps.map((_, i) => (c.vertical ? { x: cx - nodeW / 2, y: y + i * (nodeH + conn), w: nodeW, h: nodeH } : { x: box.x + i * (nodeW + conn), y, w: nodeW, h: nodeH }));
  steps.forEach((st, i) => {
    const last = i === steps.length - 1;
    const n = nodes[i]!;
    const start = 0.15 + i * step;
    const num = `0${i + 1}`;
    const color = last ? theme.accentText : theme.text;
    const align = c.vertical ? "center" : "left";
    const innerW = nodeW - 2 * pad;
    const runs = textRuns(st, font, color, lh, innerW, align).map((r) => ({ ...r, x: r.x + pad, baseline: r.baseline + pad + numH + numGap }));
    const numW = spacedWidth(measure, num, numFont, numSize, Math.round(numSize * 0.16));
    out.push(
      el(n, [
        { type: "rect", x: 0, y: 0, w: n.w, h: n.h, r: 30 * s, fill: last ? theme.accent : theme.surface, alpha: last || !c.overlay ? 1 : 0.92, stroke: theme.accent, strokeAlpha: last ? 0 : 0.4, strokeWidth: Math.max(2, 2 * s) },
        { type: "text", runs: [{ text: num, x: align === "center" ? (n.w - numW) / 2 : pad, baseline: pad + numH / 2 + numSize * 0.35, size: numSize, font: numFont, color: last ? theme.accentText : theme.accent, spacing: Math.round(numSize * 0.16) }] },
        { type: "text", runs },
      ], { kind: "pop", start, dur: 0.5, from: 0.86 }),
    );
    if (!last) {
      const next = nodes[i + 1]!;
      const aw = Math.max(4, 6 * s);
      const g = 12 * s;
      if (c.vertical) {
        const y0 = n.y + n.h + g;
        const y1 = next.y - g;
        out.push(el({ x: cx - 20 * s, y: y0, w: 40 * s, h: y1 - y0 }, [{ type: "arrow", x1: 20 * s, y1: 0, x2: 20 * s, y2: y1 - y0, color: theme.accent, width: aw }], { kind: "wipe-y", start: start + 0.3, dur: step * 0.75 }));
      } else {
        const x0 = n.x + n.w + g;
        const x1 = next.x - g;
        out.push(el({ x: x0, y: n.y + n.h / 2 - 20 * s, w: x1 - x0, h: 40 * s }, [{ type: "arrow", x1: 0, y1: 20 * s, x2: x1 - x0, y2: 20 * s, color: theme.accent, width: aw }], { kind: "wipe-x", start: start + 0.3, dur: step * 0.75 }));
      }
    }
  });
  return { elements: out, height };
}
