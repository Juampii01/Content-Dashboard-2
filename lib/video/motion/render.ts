/**
 * Renderizador del motor: dibuja una escena compilada en un instante t contra cualquier contexto tipo Canvas 2D
 * (el <canvas> del navegador o skia-canvas en el worker). Determinista: el mismo t da el mismo cuadro.
 */
import { applyEase, clamp01, EASINGS } from "./easing";
import { formatCount } from "./count";
import { pointAt, tracePath, type PathSink } from "./path";
import { propAt, type CounterNode, type EllipseNode, type Fill, type Node, type PathNode, type RectNode, type TextNode } from "./nodes";
import { rgba } from "./color";
import type { CompiledScene } from "./compile";
import { animState, applyAnimGeometry, applyTransform, transformedBox, type PlacedBox } from "../canvas/place-math";

type GradientLike = { addColorStop(offset: number, color: string): void };
type MetricsLike = { width: number };

/**
 * Lo mínimo del API de Canvas 2D que usa el motor. Lo cumplen `CanvasRenderingContext2D` y el contexto de
 * skia-canvas (se pasan tal cual; si TypeScript se queja de la variante, `as unknown as MotionCanvas`).
 */
export interface MotionCanvas extends PathSink {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, a0: number, a1: number, ccw?: boolean): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  clip(rule?: "nonzero" | "evenodd"): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): MetricsLike;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientLike;
  setLineDash(segments: number[]): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export type ImageLike = { width: number; height: number };

export type RenderOptions = {
  /** Escala del contexto respecto del lienzo lógico (vista previa a 0,5): corrige sombras y bordes finos. */
  pixelScale?: number;
  /** Borra el lienzo antes de dibujar (por defecto sí). */
  clear?: boolean;
  /** Dibuja el fondo de la escena (fondo de marca o velo). */
  backdrop?: boolean;
  /** Imágenes ya cargadas por clave (capas "image"). */
  images?: Record<string, ImageLike | undefined>;
  /** Aplica también la opacidad de la animación de la revisión (por defecto no: la compone ffmpeg o la vista previa). */
  animAlpha?: boolean;
};

/** Caja del contenido ya movido y escalado por la revisión (sin animación): la que muestra el lienzo para tocarlo. */
export function placedContentBox(scene: CompiledScene): PlacedBox {
  return transformedBox(scene.content, scene.place?.transform, scene.width, scene.height);
}

// ─── Utilidades ───────────────────────────────────────────────────────────

function paint(ctx: MotionCanvas, f: Fill): unknown {
  if (typeof f === "string") return f;
  if (f.kind === "linear") {
    const g = ctx.createLinearGradient(f.x0, f.y0, f.x1, f.y1);
    for (const [o, c] of f.stops) g.addColorStop(o, c);
    return g;
  }
  const g = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.r);
  for (const [o, c] of f.stops) g.addColorStop(o, c);
  return g;
}

/** Rectángulo redondeado (sin roundRect, para que sea igual en todos lados). */
export function roundRectPath(ctx: MotionCanvas, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (rr <= 0.01) {
    ctx.rect(x, y, w, h);
    return;
  }
  const k = 0.5523 * rr;
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.bezierCurveTo(x + w - rr + k, y, x + w, y + rr - k, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.bezierCurveTo(x + w, y + h - rr + k, x + w - rr + k, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.bezierCurveTo(x + rr - k, y + h, x, y + h - rr + k, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.bezierCurveTo(x, y + rr - k, x + rr - k, y, x + rr, y);
  ctx.closePath();
}

const hasLetterSpacing = (ctx: MotionCanvas) => typeof ctx.letterSpacing === "string";

const measureCache = new WeakMap<object, Map<string, number>>();
/** Mide con el contexto (caché por contexto). El espaciado se suma a mano: igual en todos los navegadores. */
export function measureWith(ctx: MotionCanvas): (text: string, font: string, tracking: number) => number {
  let cache = measureCache.get(ctx);
  if (!cache) {
    cache = new Map();
    measureCache.set(ctx, cache);
  }
  const c = cache;
  return (text, font, tracking) => {
    if (!text) return 0;
    const key = `${font}|${text}`;
    let w = c.get(key);
    if (w == null) {
      if (hasLetterSpacing(ctx)) ctx.letterSpacing = "0px";
      ctx.font = font;
      w = ctx.measureText(text).width;
      if (c.size > 8000) c.clear();
      c.set(key, w);
    }
    return w + tracking * Math.max(0, [...text].length - 1);
  };
}

function fillTextTracked(ctx: MotionCanvas, text: string, x: number, y: number, tracking: number, measure: (t: string) => number): void {
  if (!text) return;
  if (!tracking) {
    ctx.fillText(text, x, y);
    return;
  }
  if (hasLetterSpacing(ctx)) {
    ctx.letterSpacing = `${tracking}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = "0px";
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += measure(ch) + tracking;
  }
}

// ─── Nodos ────────────────────────────────────────────────────────────────

type Env = { ctx: MotionCanvas; px: number; scene: CompiledScene; images: Record<string, ImageLike | undefined>; measure: (text: string, font: string, tracking: number) => number };

function applyShadow(env: Env, n: Node): void {
  const s = n.shadow;
  if (!s) return;
  env.ctx.shadowColor = s.color;
  env.ctx.shadowBlur = s.blur * env.px;
  env.ctx.shadowOffsetX = (s.x ?? 0) * env.px;
  env.ctx.shadowOffsetY = (s.y ?? 0) * env.px;
}

function clearShadow(ctx: MotionCanvas): void {
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawRect(env: Env, n: RectNode, t: number): void {
  const { ctx } = env;
  let { x, y, w, h } = n;
  if (n.tracks.fill?.length && n.grow) {
    const f = Math.max(0, propAt(n, "fill", t));
    if (f <= 0.0005) return;
    if (n.grow === "right") w *= f;
    else if (n.grow === "left") {
      x += w * (1 - f);
      w *= f;
    } else if (n.grow === "up") {
      y += h * (1 - f);
      h *= f;
    } else h *= f;
  }
  const r = Math.min(n.r, Math.abs(w) / 2, Math.abs(h) / 2);
  if (n.fill) {
    applyShadow(env, n);
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = paint(ctx, n.fill);
    ctx.fill();
    clearShadow(ctx);
  }
  if (n.stroke && n.stroke.width > 0) {
    if (!n.fill) applyShadow(env, n);
    const sw = n.stroke.width;
    ctx.beginPath();
    roundRectPath(ctx, x + sw / 2, y + sw / 2, w - sw, h - sw, Math.max(0, r - sw / 2));
    ctx.strokeStyle = paint(ctx, n.stroke.color);
    ctx.lineWidth = sw;
    ctx.setLineDash(n.stroke.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
    clearShadow(ctx);
  }
}

function drawEllipse(env: Env, n: EllipseNode, t: number): void {
  const { ctx } = env;
  const d = clamp01(propAt(n, "draw", t));
  const f = n.tracks.fill?.length ? clamp01(propAt(n, "fill", t)) : 1;
  if (n.arc) {
    const sweep = n.arc.sweep * (n.tracks.draw?.length ? d : 1) * (n.tracks.fill?.length ? f : 1);
    if (Math.abs(sweep) < 1.5) return;
    const a0 = ((n.arc.start - 90) * Math.PI) / 180;
    const a1 = a0 + (sweep * Math.PI) / 180;
    ctx.beginPath();
    ctx.ellipse(n.cx, n.cy, n.rx, n.ry, 0, a0, a1, sweep < 0);
    if (n.stroke) {
      applyShadow(env, n);
      ctx.strokeStyle = paint(ctx, n.stroke.color);
      ctx.lineWidth = n.stroke.width;
      ctx.lineCap = n.stroke.cap ?? "round";
      ctx.stroke();
      clearShadow(ctx);
    }
    return;
  }
  if (n.fill && typeof n.fill !== "string" && n.fill.kind === "radial" && n.fill.sy && n.rx > 0) {
    // Brillo elíptico: el degradado radial se estira con una escala (el canvas no tiene degradados elípticos).
    const f = n.fill;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.scale(f.sx ?? 1, f.sy ?? 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, f.r);
    for (const [o, c] of f.stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, f.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.ellipse(n.cx, n.cy, Math.max(0, n.rx), Math.max(0, n.ry), 0, 0, Math.PI * 2);
  if (n.fill) {
    applyShadow(env, n);
    ctx.fillStyle = paint(ctx, n.fill);
    ctx.fill();
    clearShadow(ctx);
  }
  if (n.stroke && n.stroke.width > 0) {
    const draw = n.tracks.draw?.length ? d : 1;
    if (draw < 1) {
      ctx.beginPath();
      const a0 = -Math.PI / 2;
      ctx.ellipse(n.cx, n.cy, n.rx, n.ry, 0, a0, a0 + draw * Math.PI * 2);
    }
    ctx.strokeStyle = paint(ctx, n.stroke.color);
    ctx.lineWidth = n.stroke.width;
    ctx.lineCap = n.stroke.cap ?? "round";
    ctx.stroke();
  }
}

function drawPath(env: Env, n: PathNode, t: number): void {
  const { ctx } = env;
  const d = n.tracks.draw?.length ? clamp01(propAt(n, "draw", t)) : 1;
  if (d <= 0.001) return;
  if (n.fill) {
    // El relleno llega cuando el trazo está casi completo.
    const fa = n.stroke ? EASINGS.easeOutCubic(clamp01((d - 0.6) / 0.4)) : 1;
    if (fa > 0.001) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * fa;
      applyShadow(env, n);
      ctx.beginPath();
      for (const p of n.paths) tracePath(ctx, p, n.tf, 1);
      ctx.fillStyle = paint(ctx, n.fill);
      ctx.fill(n.evenOdd ? "evenodd" : "nonzero");
      clearShadow(ctx);
      ctx.globalAlpha = prev;
    }
  }
  if (n.stroke && n.stroke.width > 0) {
    if (!n.fill) applyShadow(env, n);
    ctx.beginPath();
    if (n.drawMode === "sequence") {
      const total = n.paths.reduce((a, p) => a + p.length, 0);
      let budget = total * d;
      for (const p of n.paths) {
        if (budget <= 0) break;
        tracePath(ctx, p, n.tf, Math.min(1, budget / Math.max(1e-6, p.length)));
        budget -= p.length;
      }
    } else for (const p of n.paths) tracePath(ctx, p, n.tf, d);
    ctx.strokeStyle = paint(ctx, n.stroke.color);
    ctx.lineWidth = n.stroke.width;
    ctx.lineCap = n.stroke.cap ?? "round";
    ctx.lineJoin = n.stroke.join ?? "round";
    ctx.setLineDash(n.stroke.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
    clearShadow(ctx);
    if (n.head && n.paths.length) {
      const last = n.paths[n.paths.length - 1]!;
      const pt = pointAt(last, d);
      const sx = n.tf.s * (n.tf.sx ?? 1);
      const sy = n.tf.s * (n.tf.sy ?? 1);
      const hx = n.tf.x + pt.x * sx;
      const hy = n.tf.y + pt.y * sy;
      const a = pt.angle;
      const size = n.head.size * Math.min(1, d * 6);
      ctx.beginPath();
      ctx.moveTo(hx - size * Math.cos(a - 0.62), hy - size * Math.sin(a - 0.62));
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - size * Math.cos(a + 0.62), hy - size * Math.sin(a + 0.62));
      ctx.strokeStyle = paint(ctx, n.head.color);
      ctx.lineWidth = n.stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
}

/** Reparte el progreso p entre tramos en orden (cada uno según su largo). */
function sweep(lengths: number[], p: number): number[] {
  const total = lengths.reduce((a, b) => a + b, 0);
  let budget = total * clamp01(p);
  return lengths.map((l) => {
    const v = l <= 0 ? (budget > 0 ? 1 : 0) : clamp01(budget / l);
    budget -= l;
    return v;
  });
}

function drawText(env: Env, n: TextNode, t: number): void {
  const { ctx } = env;
  ctx.font = n.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = (s: string) => env.measure(s, n.font, 0);
  const chars = n.tracks.chars?.length ? clamp01(propAt(n, "chars", t)) : 1;
  const totalChars = n.lines.reduce((a, l) => a + [...l.text].length, 0);
  let budget = Math.round(totalChars * chars);
  const marks = n.marks ?? [];
  const markers = marks.filter((k) => k.kind === "marker");
  const lines = n.lines.map((l) => {
    const len = [...l.text].length;
    const show = Math.max(0, Math.min(len, budget));
    budget -= len;
    return { ...l, visible: show >= len ? l.text : [...l.text].slice(0, show).join("") };
  });
  // Marcadores (detrás del texto).
  const markP = sweep(markers.map((k) => k.x1 - k.x0), n.tracks.mark?.length ? propAt(n, "mark", t) : 1);
  markers.forEach((k, i) => {
    const p = markP[i]!;
    if (p <= 0.001) return;
    const l = n.lines[k.line];
    if (!l) return;
    const padX = n.size * 0.12;
    const h = n.size * (k.thickness ?? 0.98);
    const top = l.baseline - n.size * 0.35 - h / 2;
    ctx.beginPath();
    roundRectPath(ctx, k.x0 - padX, top, (k.x1 - k.x0 + 2 * padX) * p, h, n.size * 0.12);
    ctx.fillStyle = paint(ctx, k.color);
    ctx.fill();
  });
  applyShadow(env, n);
  ctx.fillStyle = paint(ctx, n.color);
  const spans = n.spans ?? [];
  lines.forEach((l, li) => {
    if (!l.visible) return;
    const own = spans.filter((s) => s.line === li);
    if (own.length && l.visible === l.text) {
      // La línea sin las palabras de otro color (se recortan) y después esas palabras con su color.
      ctx.save();
      ctx.beginPath();
      ctx.rect(l.x - n.size, l.baseline - n.size * 1.4, l.w + n.size * 2, n.size * 2);
      for (const s of own) ctx.rect(s.x, l.baseline - n.size * 1.4, env.measure(s.text, n.font, n.tracking), n.size * 2);
      ctx.clip("evenodd");
      fillTextTracked(ctx, l.visible, l.x, l.baseline, n.tracking, m);
      ctx.restore();
      for (const s of own) {
        ctx.fillStyle = paint(ctx, s.color);
        fillTextTracked(ctx, s.text, s.x, l.baseline, n.tracking, m);
      }
      ctx.fillStyle = paint(ctx, n.color);
    } else fillTextTracked(ctx, l.visible, l.x, l.baseline, n.tracking, m);
  });
  clearShadow(ctx);
  // Texto sobre el marcador, con el color del marcador.
  markers.forEach((k, i) => {
    const p = markP[i]!;
    if (p <= 0.001 || !k.textColor) return;
    const l = lines[k.line];
    if (!l?.visible) return;
    const padX = n.size * 0.12;
    const h = n.size * (k.thickness ?? 0.98);
    const top = l.baseline - n.size * 0.35 - h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(k.x0 - padX, top, (k.x1 - k.x0 + 2 * padX) * p, h);
    ctx.clip();
    ctx.fillStyle = k.textColor;
    fillTextTracked(ctx, l.visible, l.x, l.baseline, n.tracking, m);
    ctx.restore();
  });
  // Subrayados y tachados (encima).
  for (const kind of ["underline", "strike"] as const) {
    const list = marks.filter((k) => k.kind === kind);
    if (!list.length) continue;
    const ps = sweep(list.map((k) => k.x1 - k.x0), n.tracks[kind]?.length ? propAt(n, kind, t) : 1);
    list.forEach((k, i) => {
      const p = ps[i]!;
      if (p <= 0.001) return;
      const l = n.lines[k.line];
      if (!l) return;
      const th = n.size * (k.thickness ?? (kind === "strike" ? 0.075 : 0.085));
      const y = kind === "strike" ? l.baseline - n.size * 0.3 : l.baseline + n.size * 0.16;
      const ext = kind === "strike" ? n.size * 0.06 : 0;
      ctx.beginPath();
      roundRectPath(ctx, k.x0 - ext, y - th / 2, (k.x1 - k.x0 + 2 * ext) * p, th, th / 2);
      ctx.fillStyle = paint(ctx, k.color);
      ctx.fill();
    });
  }
}

function drawCounter(env: Env, n: CounterNode, t: number): void {
  const { ctx } = env;
  const p = n.tracks.value?.length ? propAt(n, "value", t) : 1;
  const parts = formatCount(n.fmt, p >= 0.9995 ? 1 : p);
  ctx.font = n.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = (s: string) => env.measure(s, n.font, 0);
  const charW = (ch: string) => (/\d/.test(ch) ? n.digitW : m(ch)) + n.tracking;
  const digitsW = [...parts.digits].reduce((a, ch) => a + charW(ch), 0);
  const prefixW = parts.prefix ? env.measure(parts.prefix, n.font, n.tracking) + n.tracking : 0;
  // El sufijo queda fijo donde termina la cifra final; los dígitos crecen hacia la izquierda.
  const finalDigits = formatCount(n.fmt, 1).digits;
  const finalDigitsW = [...finalDigits].reduce((a, ch) => a + charW(ch), 0);
  const finalW = n.prefixW + finalDigitsW + n.suffixW;
  const left = n.align === "center" ? n.x - finalW / 2 : n.align === "right" ? n.x - finalW : n.x;
  const digitsRight = left + n.prefixW + finalDigitsW;
  applyShadow(env, n);
  let x = digitsRight - digitsW;
  ctx.fillStyle = paint(ctx, n.color);
  for (const ch of parts.digits) {
    const w = charW(ch);
    if (/\d/.test(ch)) ctx.fillText(ch, x + (n.digitW - m(ch)) / 2, n.baseline);
    else ctx.fillText(ch, x, n.baseline);
    x += w;
  }
  ctx.fillStyle = paint(ctx, n.affixColor);
  if (parts.prefix) fillTextTracked(ctx, parts.prefix, digitsRight - digitsW - prefixW, n.baseline, n.tracking, m);
  if (parts.suffix) fillTextTracked(ctx, parts.suffix, digitsRight + n.tracking * 0.5, n.baseline, n.tracking, m);
  clearShadow(ctx);
}

function drawImage(env: Env, n: Extract<Node, { kind: "image" }>): void {
  const img = env.images[n.src];
  if (!img || !img.width || !img.height) return;
  const { ctx } = env;
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, n.x, n.y, n.w, n.h, n.r);
  ctx.clip();
  const ir = img.width / img.height;
  const br = n.w / n.h;
  let w = n.w;
  let h = n.h;
  if ((n.fit === "cover") === ir > br) w = h * ir;
  else h = w / ir;
  ctx.drawImage(img, n.x + (n.w - w) / 2, n.y + (n.h - h) / 2, w, h);
  ctx.restore();
}

function drawNode(env: Env, n: Node, t: number, exit?: { alpha: number; dy: number; scale: number }): void {
  const alpha = (n.alpha ?? 1) * clamp01(propAt(n, "opacity", t)) * (exit?.alpha ?? 1);
  if (alpha <= 0.002) return;
  const reveal = n.tracks.reveal?.length ? clamp01(propAt(n, "reveal", t)) : 1;
  if (reveal <= 0.0005) return;
  const { ctx } = env;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * alpha;
  if (n.composite && n.composite !== "source-over") ctx.globalCompositeOperation = n.composite;
  const dx = propAt(n, "x", t);
  const dy = propAt(n, "y", t) + (exit?.dy ?? 0);
  if (dx || dy) ctx.translate(dx, dy);
  const s = propAt(n, "scale", t) * (exit?.scale ?? 1);
  const sx = s * propAt(n, "scaleX", t);
  const sy = s * propAt(n, "scaleY", t);
  const rot = propAt(n, "rotation", t);
  if (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4 || rot) {
    const [px, py] = n.pivot ?? [n.box.x + n.box.w / 2, n.box.y + n.box.h / 2];
    ctx.translate(px, py);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(sx, sy);
    ctx.translate(-px, -py);
  }
  if (reveal < 1) {
    const b = n.box;
    const pad = Math.max(b.w, b.h) * 0.25 + 40;
    ctx.beginPath();
    const e = applyEase("linear", reveal);
    if (n.reveal === "right") ctx.rect(b.x + b.w * (1 - e), b.y - pad, b.w * e + pad, b.h + 2 * pad);
    else if (n.reveal === "up") ctx.rect(b.x - pad, b.y + b.h * (1 - e), b.w + 2 * pad, b.h * e + pad);
    else if (n.reveal === "down") ctx.rect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h * e + pad);
    else if (n.reveal === "center") ctx.rect(b.x + (b.w * (1 - e)) / 2, b.y - pad, b.w * e, b.h + 2 * pad);
    else ctx.rect(b.x - pad, b.y - pad, b.w * e + pad, b.h + 2 * pad);
    ctx.clip();
  }
  switch (n.kind) {
    case "rect":
      drawRect(env, n, t);
      break;
    case "ellipse":
      drawEllipse(env, n, t);
      break;
    case "path":
      drawPath(env, n, t);
      break;
    case "text":
      drawText(env, n, t);
      break;
    case "counter":
      drawCounter(env, n, t);
      break;
    case "image":
      drawImage(env, n);
      break;
    case "group":
      if (n.clip) {
        ctx.beginPath();
        roundRectPath(ctx, n.clip.x, n.clip.y, n.clip.w, n.clip.h, n.clip.r);
        ctx.clip();
      }
      for (const c of n.children) drawNode(env, c, t);
      break;
  }
  ctx.restore();
}

// ─── Fondo ────────────────────────────────────────────────────────────────

function drawBackdrop(env: Env, t: number): void {
  const { ctx, scene } = env;
  const { width: W, height: H, theme } = scene;
  if (scene.mode === "overlay") {
    // Sin velo (textos sueltos sobre el video): nada de fondo.
    if (!scene.veil.length) return;
    const g = scene.veilAxis === "x" ? ctx.createLinearGradient(0, 0, W, 0) : ctx.createLinearGradient(0, 0, 0, H);
    for (const [pos, a] of scene.veil) g.addColorStop(pos, rgba(theme.bg, a));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  if (theme.backdrop === "plain") return;
  const u = scene.unit;
  const drift = Math.sin((t / Math.max(1, scene.duration)) * Math.PI * 0.9) * 0.025;
  if (theme.backdrop === "glow-grid") {
    // Grilla de 48 px casi invisible, que se apaga hacia los bordes.
    const step = 48 * u;
    ctx.fillStyle = rgba(theme.text, theme.dark ? 0.045 : 0.06);
    for (let x = (W / 2) % step; x < W; x += step) ctx.fillRect(Math.round(x), 0, Math.max(1, u), H);
    for (let y = 0; y < H; y += step) ctx.fillRect(0, Math.round(y), W, Math.max(1, u));
    ctx.save();
    ctx.translate(W / 2, H * 0.4);
    ctx.scale(W * 0.75, H * 0.62);
    const v = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    v.addColorStop(0, rgba(theme.bg, 0));
    v.addColorStop(0.55, rgba(theme.bg, 0.35));
    v.addColorStop(1, rgba(theme.bg, 1));
    ctx.fillStyle = v;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
  // Brillo del acento arriba (se mueve muy despacio) y un segundo brillo abajo.
  const glow = (cx: number, cy: number, rx: number, ry: number, color: string, a: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.45, rgba(color, a * 0.45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  const k = theme.dark ? 1 : 0.55;
  glow(W * (0.5 + drift), -H * 0.04, W * 0.95, H * 0.5, theme.accent, 0.26 * k);
  glow(W * (0.85 - drift), H * 1.02, W * 0.8, H * 0.35, theme.accent2, 0.1 * k);
}

// ─── Escena ───────────────────────────────────────────────────────────────

/** Salida automática: todo baja la opacidad y sube un poco. */
function exitFor(scene: CompiledScene, i: number, count: number, t: number): { alpha: number; dy: number; scale: number } | undefined {
  const ex = scene.exit;
  if (ex.dur <= 0 || t < ex.start) return undefined;
  // Todo sale junto (las capas superpuestas, como un marcador y su texto, no se separan).
  void i;
  void count;
  const q = EASINGS.easeInCubic(clamp01((t - ex.start) / Math.max(0.05, ex.dur)));
  if (ex.kind === "fade") return { alpha: 1 - q, dy: 0, scale: 1 };
  if (ex.kind === "sink") return { alpha: 1 - q, dy: q * 36 * scene.unit, scale: 1 };
  if (ex.kind === "zoom") return { alpha: 1 - q, dy: 0, scale: 1 + 0.08 * q };
  return { alpha: 1 - q, dy: -q * 30 * scene.unit, scale: 1 - 0.025 * q };
}

/**
 * Dibuja la escena compilada en el instante t (segundos desde el inicio). El contexto puede traer una escala (vista
 * previa): la escena se dibuja en sus coordenadas lógicas (1080×1920 o 1920×1080).
 */
export function renderFrame(ctx: MotionCanvas, scene: CompiledScene, t: number, opts: RenderOptions = {}): void {
  const time = Math.max(0, Math.min(t, scene.duration));
  const env: Env = { ctx, scene, px: opts.pixelScale ?? 1, images: opts.images ?? {}, measure: measureWith(ctx) };
  if (opts.clear !== false) ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  clearShadow(ctx);
  if (opts.backdrop !== false) drawBackdrop(env, time);
  applyPlace(ctx, scene, time, opts.animAlpha === true);
  // Respiración: el contenido se acerca un 1,5 % a lo largo de la escena (sin cuadros muertos).
  const breathe = scene.drift ? 1 + 0.015 * EASINGS.easeInOutSine(clamp01(time / scene.duration)) : 1;
  const c = scene.region;
  ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
  ctx.scale(breathe, breathe);
  ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
  const top = scene.nodes;
  top.forEach((n, i) => drawNode(env, n, time, n.noExit ? undefined : exitFor(scene, i, top.length, time)));
  ctx.restore();
}

/**
 * Lugar y animación de la revisión (lib/video/canvas/transform.ts): la transformación alrededor del centro del
 * contenido y el movimiento, la escala y el revelado de la animación. La opacidad no: la compone ffmpeg en el render y
 * la vista previa con la misma rampa (salvo `animAlpha`).
 */
function applyPlace(ctx: MotionCanvas, scene: CompiledScene, t: number, animAlpha: boolean): void {
  const place = scene.place;
  if (!place) return;
  const { width: W, height: H, content } = scene;
  applyTransform(ctx, place.transform, content, W, H);
  if (place.anim) {
    const st = animState(place.anim, t, scene.duration);
    if (animAlpha) ctx.globalAlpha *= st.alpha;
    applyAnimGeometry(ctx, st, content, W, H, 60 * scene.unit);
  }
}
