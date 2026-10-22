/**
 * Trazados SVG sin Path2D: se leen una vez a comandos absolutos (M, L, C, Z), se miden y se dibujan en el canvas con
 * moveTo/lineTo/bezierCurveTo. Así funcionan igual en el navegador y en skia-canvas, y se pueden dibujar "a medias"
 * (trazo que se dibuja: `draw`) cortando la curva exacta donde termina el progreso.
 */

export type Seg =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: "Z" };

/** Un subtrazado (desde un M) con su largo y el de cada segmento. */
export type SubPath = { segs: Seg[]; lens: number[]; length: number; closed: boolean; start: [number, number] };
export type ParsedPath = { subs: SubPath[]; length: number };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Arco SVG → curvas cúbicas (como mucho 90° por curva). */
function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) return [{ c: "L", x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  let a = t1;
  const pt = (ang: number) => {
    const ex = rx * Math.cos(ang);
    const ey = ry * Math.sin(ang);
    return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy] as const;
  };
  const der = (ang: number) => {
    const ex = -rx * Math.sin(ang);
    const ey = ry * Math.cos(ang);
    return [cos * ex - sin * ey, sin * ex + cos * ey] as const;
  };
  for (let i = 0; i < n; i++) {
    const b = a + step;
    const [px, py] = pt(a);
    const [qx, qy] = pt(b);
    const [dax, day] = der(a);
    const [dbx, dby] = der(b);
    out.push({ c: "C", x1: px + k * dax, y1: py + k * day, x2: qx - k * dbx, y2: qy - k * dby, x: i === n - 1 ? x2 : qx, y: i === n - 1 ? y2 : qy });
    a = b;
  }
  return out;
}

/** Lee un `d` de SVG a comandos absolutos M, L, C y Z. */
export function parsePathData(d: string): Seg[] {
  const tokens = tokenize(d);
  const out: Seg[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const num = () => {
    const v = tokens[i++];
    return typeof v === "number" ? v : 0;
  };
  while (i < tokens.length) {
    const tk = tokens[i];
    if (typeof tk === "string") {
      cmd = tk;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      out.push({ c: "Z" });
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    if (typeof tokens[i] !== "number") continue;
    switch (C) {
      case "M": {
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        sx = x;
        sy = y;
        out.push({ c: "M", x, y });
        cmd = rel ? "l" : "L";
        lastC = lastQ = null;
        break;
      }
      case "L":
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      case "H":
        x = (rel ? x : 0) + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      case "V":
        y = (rel ? y : 0) + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      case "C": {
        const x1 = (rel ? x : 0) + num();
        const y1 = (rel ? y : 0) + num();
        const x2 = (rel ? x : 0) + num();
        const y2 = (rel ? y : 0) + num();
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastC = [x2, y2];
        lastQ = null;
        break;
      }
      case "S": {
        const x1 = lastC ? 2 * x - lastC[0] : x;
        const y1 = lastC ? 2 * y - lastC[1] : y;
        const x2 = (rel ? x : 0) + num();
        const y2 = (rel ? y : 0) + num();
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastC = [x2, y2];
        lastQ = null;
        break;
      }
      case "Q": {
        const qx = (rel ? x : 0) + num();
        const qy = (rel ? y : 0) + num();
        const nx = (rel ? x : 0) + num();
        const ny = (rel ? y : 0) + num();
        out.push({ c: "C", x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: nx + (2 / 3) * (qx - nx), y2: ny + (2 / 3) * (qy - ny), x: nx, y: ny });
        x = nx;
        y = ny;
        lastQ = [qx, qy];
        lastC = null;
        break;
      }
      case "T": {
        const qx: number = lastQ ? 2 * x - lastQ[0] : x;
        const qy: number = lastQ ? 2 * y - lastQ[1] : y;
        const nx = (rel ? x : 0) + num();
        const ny = (rel ? y : 0) + num();
        out.push({ c: "C", x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: nx + (2 / 3) * (qx - nx), y2: ny + (2 / 3) * (qy - ny), x: nx, y: ny });
        x = nx;
        y = ny;
        lastQ = [qx, qy];
        lastC = null;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const nx = (rel ? x : 0) + num();
        const ny = (rel ? y : 0) + num();
        out.push(...arcToCubics(x, y, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, nx, ny));
        x = nx;
        y = ny;
        lastC = lastQ = null;
        break;
      }
      default:
        i++;
    }
  }
  return out;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function cubicLength(x0: number, y0: number, s: Extract<Seg, { c: "C" }>): number {
  let len = 0;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const nx = cubicAt(x0, s.x1, s.x2, s.x, t);
    const ny = cubicAt(y0, s.y1, s.y2, s.y, t);
    len += Math.hypot(nx - px, ny - py);
    px = nx;
    py = ny;
  }
  return len;
}

/** Agrupa en subtrazados y mide cada segmento. */
export function measurePath(segs: Seg[]): ParsedPath {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let x = 0;
  let y = 0;
  for (const s of segs) {
    if (s.c === "M") {
      cur = { segs: [s], lens: [0], length: 0, closed: false, start: [s.x, s.y] };
      subs.push(cur);
      x = s.x;
      y = s.y;
      continue;
    }
    if (!cur) {
      cur = { segs: [{ c: "M", x, y }], lens: [0], length: 0, closed: false, start: [x, y] };
      subs.push(cur);
    }
    let len = 0;
    if (s.c === "L") {
      len = Math.hypot(s.x - x, s.y - y);
      x = s.x;
      y = s.y;
    } else if (s.c === "C") {
      len = cubicLength(x, y, s);
      x = s.x;
      y = s.y;
    } else {
      len = Math.hypot(cur.start[0] - x, cur.start[1] - y);
      x = cur.start[0];
      y = cur.start[1];
      cur.closed = true;
    }
    cur.segs.push(s);
    cur.lens.push(len);
    cur.length += len;
  }
  return { subs, length: subs.reduce((a, s) => a + s.length, 0) };
}

const cache = new Map<string, ParsedPath>();
export function parsePath(d: string): ParsedPath {
  let hit = cache.get(d);
  if (!hit) {
    hit = measurePath(parsePathData(d));
    if (cache.size > 2000) cache.clear();
    cache.set(d, hit);
  }
  return hit;
}

/** Lo mínimo del canvas que hace falta para trazar. */
export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  closePath(): void;
};

/** Parte una cúbica en t y devuelve la primera mitad (de Casteljau). */
function splitCubic(x0: number, y0: number, s: Extract<Seg, { c: "C" }>, t: number) {
  const lx = (a: number, b: number) => a + (b - a) * t;
  const ax = lx(x0, s.x1), ay = lx(y0, s.y1);
  const bx = lx(s.x1, s.x2), by = lx(s.y1, s.y2);
  const cx = lx(s.x2, s.x), cy = lx(s.y2, s.y);
  const dx = lx(ax, bx), dy = lx(ay, by);
  const ex = lx(bx, cx), ey = lx(by, cy);
  const fx = lx(dx, ex), fy = lx(dy, ey);
  return { x1: ax, y1: ay, x2: dx, y2: dy, x: fx, y: fy };
}

/**
 * Traza el camino en el contexto, transformado (escala y desplazamiento), hasta el progreso `draw` (0–1).
 * `mode`: "together" dibuja todos los subtrazados a la vez (íconos), "sequence" uno detrás del otro (firma, flecha).
 */
export function tracePath(ctx: PathSink, path: ParsedPath, tf: { x: number; y: number; s: number; sx?: number; sy?: number }, draw = 1, mode: "together" | "sequence" = "together"): void {
  const sx = tf.s * (tf.sx ?? 1);
  const sy = tf.s * (tf.sy ?? 1);
  const X = (v: number) => tf.x + v * sx;
  const Y = (v: number) => tf.y + v * sy;
  let budgetSeq = path.length * draw;
  for (const sub of path.subs) {
    let budget = mode === "together" ? sub.length * draw : Math.min(sub.length, budgetSeq);
    if (mode === "sequence") budgetSeq -= sub.length;
    if (budget <= 0.0001 && draw < 1) continue;
    const full = draw >= 1 || budget >= sub.length - 1e-6;
    let x = sub.start[0];
    let y = sub.start[1];
    ctx.moveTo(X(x), Y(y));
    for (let i = 1; i < sub.segs.length; i++) {
      const s = sub.segs[i]!;
      const len = sub.lens[i]!;
      if (!full && budget <= 0) break;
      const part = full || len <= budget ? 1 : budget / Math.max(1e-6, len);
      budget -= len;
      if (s.c === "L" || s.c === "Z") {
        const tx = s.c === "Z" ? sub.start[0] : s.x;
        const ty = s.c === "Z" ? sub.start[1] : s.y;
        if (s.c === "Z" && part >= 1) ctx.closePath();
        else ctx.lineTo(X(x + (tx - x) * part), Y(y + (ty - y) * part));
        x = tx;
        y = ty;
      } else if (s.c === "C") {
        const c = part >= 1 ? s : splitCubic(x, y, s, part);
        ctx.bezierCurveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y));
        x = s.x;
        y = s.y;
      }
    }
  }
}

/** Caja que ocupa el camino (aproximada con los puntos de control). */
export function pathBounds(path: ParsedPath): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sub of path.subs)
    for (const s of sub.segs) {
      if (s.c === "Z") continue;
      const pts = s.c === "C" ? [s.x1, s.y1, s.x2, s.y2, s.x, s.y] : [s.x, s.y];
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]!);
        x1 = Math.max(x1, pts[i]!);
        y0 = Math.min(y0, pts[i + 1]!);
        y1 = Math.max(y1, pts[i + 1]!);
      }
    }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Punto y dirección en el progreso p del camino completo (para la punta de una flecha que se dibuja). */
export function pointAt(path: ParsedPath, p: number): { x: number; y: number; angle: number } {
  let budget = path.length * Math.max(0, Math.min(1, p));
  let last = { x: 0, y: 0, angle: 0 };
  for (const sub of path.subs) {
    let x = sub.start[0];
    let y = sub.start[1];
    for (let i = 1; i < sub.segs.length; i++) {
      const s = sub.segs[i]!;
      const len = sub.lens[i]!;
      const t = len <= 0 ? 1 : Math.min(1, budget / len);
      if (s.c === "C") {
        const px = cubicAt(x, s.x1, s.x2, s.x, t);
        const py = cubicAt(y, s.y1, s.y2, s.y, t);
        const t2 = Math.max(0, t - 0.02);
        const qx = cubicAt(x, s.x1, s.x2, s.x, t2);
        const qy = cubicAt(y, s.y1, s.y2, s.y, t2);
        last = { x: px, y: py, angle: Math.atan2(py - qy, px - qx) || last.angle };
        x = s.x;
        y = s.y;
      } else {
        const tx = s.c === "Z" ? sub.start[0] : s.x;
        const ty = s.c === "Z" ? sub.start[1] : s.y;
        last = { x: x + (tx - x) * t, y: y + (ty - y) * t, angle: Math.atan2(ty - y, tx - x) };
        x = tx;
        y = ty;
      }
      budget -= len;
      if (budget <= 0) return last;
    }
  }
  return last;
}


/** Curva suave (Catmull-Rom → cúbicas) por todos los puntos. */
export function smoothThrough(pts: number[][]): string {
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const t = 0.18;
    d += `C${p1[0]! + (p2[0]! - p0[0]!) * t} ${p1[1]! + (p2[1]! - p0[1]!) * t} ${p2[0]! - (p3[0]! - p1[0]!) * t} ${p2[1]! - (p3[1]! - p1[1]!) * t} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
