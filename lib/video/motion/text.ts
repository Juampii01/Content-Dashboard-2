/**
 * Texto del motor: medición con el mismo contexto que dibuja, ajuste de línea, tamaño automático para que entre en
 * una caja (con líneas parejas) y posición de cada palabra (para resaltar, tachar o animar palabra por palabra).
 */

/** Ancho de un texto con una fuente CSS ("800 64px Inter") y un espaciado entre letras en píxeles. */
export type Measurer = (text: string, font: string, tracking: number) => number;

export type FontSpec = {
  /** Familia CSS ya resuelta ("Inter", "\"Montserrat Grafico\""). */
  family: string;
  weight: number;
  /** Espaciado entre letras en em (-0,03 = más apretado). */
  tracking?: number;
  uppercase?: boolean;
};

export const fontCss = (f: FontSpec, size: number) => `${f.weight} ${Math.max(1, Math.round(size * 10) / 10)}px ${f.family}`;

export function prepare(text: string, f: FontSpec): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return f.uppercase ? clean.toLocaleUpperCase("es") : clean;
}

function wrap(m: Measurer, text: string, font: string, tracking: number, maxW: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && m(next, font, tracking) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export type Fit = {
  text: string;
  size: number;
  lines: string[];
  widths: number[];
  /** Alto del bloque (líneas × alto de línea). */
  height: number;
  lineHeight: number;
  font: string;
  tracking: number;
  /** No entró ni con el tamaño mínimo. */
  overflow: boolean;
};

export type FitOptions = {
  max: number;
  min: number;
  maxW: number;
  maxLines: number;
  /** Alto máximo del bloque (opcional). */
  maxH?: number;
  /** Alto de línea relativo al tamaño. */
  leading?: number;
  /** Líneas parejas (sin una palabra sola abajo). */
  balance?: boolean;
};

/** El tamaño más grande (entre max y min) en el que el texto entra en la caja. */
export function fitText(m: Measurer, raw: string, f: FontSpec, o: FitOptions): Fit {
  const text = prepare(raw, f);
  const leading = o.leading ?? 1.12;
  let size = o.max;
  const min = Math.min(o.min, o.max);
  let lines: string[] = [];
  let font = "";
  let tracking = 0;
  let ok = false;
  for (let guard = 0; guard < 60; guard++) {
    font = fontCss(f, size);
    tracking = (f.tracking ?? 0) * size;
    lines = wrap(m, text, font, tracking, o.maxW);
    const widest = Math.max(0, ...lines.map((l) => m(l, font, tracking)));
    const h = lines.length * size * leading;
    ok = lines.length <= o.maxLines && widest <= o.maxW + 0.5 && (o.maxH == null || h <= o.maxH + 0.5);
    if (ok || size <= min) break;
    size = Math.max(min, size * 0.95);
  }
  if (o.balance !== false && lines.length > 1) {
    let target = o.maxW;
    for (let i = 0; i < 30; i++) {
      const narrower = target * 0.96;
      const attempt = wrap(m, text, font, tracking, narrower);
      if (attempt.length !== lines.length) break;
      lines = attempt;
      target = narrower;
    }
  }
  const widths = lines.map((l) => m(l, font, tracking));
  return { text, size, lines, widths, height: lines.length * size * leading, lineHeight: size * leading, font, tracking, overflow: !ok };
}

/** Una línea de alto fijo: achica hasta que entra en el ancho (eyebrows, etiquetas). */
export function fitLine(m: Measurer, raw: string, f: FontSpec, max: number, min: number, maxW: number): Fit {
  return fitText(m, raw, f, { max, min, maxW, maxLines: 1, balance: false, leading: 1.2 });
}

/** Línea base de la línea i (centrada ópticamente en su alto de línea). */
export const baselineOf = (top: number, i: number, lh: number, size: number) => top + i * lh + lh / 2 + size * 0.35;

export type PlacedLine = { text: string; x: number; baseline: number; w: number; top: number };

/** Ubica las líneas de un bloque en una caja (x, y = arriba del bloque). */
export function placeLines(fit: Fit, x: number, y: number, w: number, align: "left" | "center" | "right" = "left"): PlacedLine[] {
  return fit.lines.map((text, i) => {
    const lw = fit.widths[i]!;
    const lx = align === "center" ? x + (w - lw) / 2 : align === "right" ? x + w - lw : x;
    return { text, x: lx, baseline: baselineOf(y, i, fit.lineHeight, fit.size), w: lw, top: y + i * fit.lineHeight };
  });
}

export type PlacedWord = { text: string; line: number; index: number; x: number; w: number; baseline: number; top: number };

/** Posición de cada palabra de las líneas (índice correlativo en todo el bloque). */
export function placeWords(m: Measurer, fit: Fit, lines: PlacedLine[]): PlacedWord[] {
  const out: PlacedWord[] = [];
  let index = 0;
  lines.forEach((l, li) => {
    const words = l.text.split(" ");
    let offset = 0;
    words.forEach((w, wi) => {
      const before = words.slice(0, wi).join(" ");
      offset = wi === 0 ? 0 : m(`${before} `, fit.font, fit.tracking) + fit.tracking;
      out.push({ text: w, line: li, index: index++, x: l.x + offset, w: m(w, fit.font, fit.tracking), baseline: l.baseline, top: l.top });
    });
  });
  return out;
}

/** Normaliza una palabra para comparar (minúsculas, sin tildes ni signos). */
export const normWord = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ%$+]+/g, "");

/** Índices de las palabras que coinciden con `target` (primero la frase seguida; si no, palabra por palabra). */
export function matchWords(words: string[], target: string): Set<number> {
  const want = target.split(/\s+/).map(normWord).filter(Boolean);
  const out = new Set<number>();
  if (!want.length) return out;
  const plain = words.map(normWord);
  for (let i = 0; i + want.length <= plain.length; i++) {
    if (want.every((t, k) => plain[i + k] === t)) {
      for (let k = 0; k < want.length; k++) out.add(i + k);
      return out;
    }
  }
  plain.forEach((w, i) => w && want.includes(w) && out.add(i));
  return out;
}

/** Agrupa índices de palabras seguidas de una misma línea en tramos [desde, hasta]. */
export function wordRuns(words: PlacedWord[], marked: Set<number>): { line: number; x0: number; x1: number; words: PlacedWord[] }[] {
  const runs: { line: number; x0: number; x1: number; words: PlacedWord[] }[] = [];
  for (const w of words) {
    if (!marked.has(w.index)) continue;
    const last = runs[runs.length - 1];
    if (last && last.line === w.line && last.words[last.words.length - 1]!.index === w.index - 1) {
      last.x1 = w.x + w.w;
      last.words.push(w);
    } else runs.push({ line: w.line, x0: w.x, x1: w.x + w.w, words: [w] });
  }
  return runs;
}
