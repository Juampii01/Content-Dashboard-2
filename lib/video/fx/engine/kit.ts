/**
 * Piezas comunes de la biblioteca ampliada de efectos (texto, llamadas de atención, tarjetas, looks, cámara, marcos y
 * recorte): entrada y salida, tarjetas con la marca, textos que entran, trazos a mano, texturas (grano y polvo) y
 * cómo dibujar el video dentro de un rectángulo. Todo en coordenadas del video final y determinista (el mismo instante
 * da el mismo cuadro en la vista previa y en el worker).
 */
import { backOut, clamp, clamp01, easeIn, easeOut, fitSize, FxFrame, hexRgb, lerp, rgba, rng, roundRect, wrap, type FxCtx, type Layer, type Xf } from "./core";

export { backOut, clamp, clamp01, easeIn, easeOut, fitSize, lerp, rgba, rng, roundRect, wrap };

/** Entrada y salida del efecto: `a` es la opacidad (0 → 1 → 0), `inP` y `outP` el avance de cada una. */
export function envelope(f: FxFrame, inDur = 0.35, outDur = 0.3): { a: number; inP: number; outP: number } {
  const inP = easeOut(f.t / inDur);
  const outP = easeIn(clamp01((f.t - (f.spec.duration - outDur)) / outDur));
  return { a: clamp01(Math.min(inP, 1 - outP)), inP, outP };
}

/** Fuente de títulos de Mi marca (Inter o Montserrat). */
export const displayFamily = (f: FxFrame) => (f.spec.display === "montserrat" ? f.fonts.display : f.fonts.sans);

/** Tono claro u oscuro sobre un color (para texto encima del acento). */
export function onColor(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? "#0b1020" : "#ffffff";
}

export function mix(a: string, b: string, k: number): string {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * clamp01(k));
  return `#${[m(r1, r2), m(g1, g2), m(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Sombra en píxeles del lienzo real. */
export function shadow(f: FxFrame, blur: number, y = 0, color = "rgba(0,0,0,0.35)"): void {
  f.ctx.shadowColor = color;
  f.ctx.shadowBlur = blur * f.u * f.pixelScale;
  f.ctx.shadowOffsetX = 0;
  f.ctx.shadowOffsetY = y * f.u * f.pixelScale;
}
export function noShadow(ctx: FxCtx): void {
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowColor = "rgba(0,0,0,0)";
}

/**
 * Tarjeta con la marca: superficie casi opaca, borde fino, un brillo arriba y sombra suave. `tone`: "surface" (la de
 * Mi marca), "light" (papel blanco, para stickers) o "glass" (el video desenfocado detrás).
 */
export function card(f: FxFrame, x: number, y: number, w: number, h: number, r: number, tone: "surface" | "light" | "glass" = "surface", alpha = 1): void {
  const { ctx, spec, u } = f;
  ctx.save();
  ctx.globalAlpha *= alpha;
  shadow(f, 46, 18, "rgba(0,0,0,0.38)");
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = tone === "light" ? "#ffffff" : tone === "glass" ? "rgba(0,0,0,0.02)" : rgba(spec.surface, 0.96);
  ctx.fill();
  noShadow(ctx);
  if (tone === "glass") {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, "blur(24px)");
    ctx.fillStyle = "rgba(6,10,24,0.55)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  if (tone !== "light") {
    const g = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    g.addColorStop(0, "rgba(255,255,255,0.07)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();
    roundRect(ctx, x + 1 * u, y + 1 * u, w - 2 * u, h - 2 * u, r);
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 2 * u;
    ctx.stroke();
  }
  ctx.restore();
}

/** Pastilla con texto (rótulos chicos en mono o sans). Devuelve su ancho. */
export function pill(f: FxFrame, text: string, x: number, y: number, opts: { size?: number; bg?: string; color?: string; mono?: boolean; align?: "left" | "center" | "right"; weight?: number } = {}): number {
  const { ctx, u } = f;
  const size = (opts.size ?? 26) * u;
  ctx.save();
  ctx.font = f.font(opts.weight ?? (opts.mono ? 600 : 700), size, opts.mono ? f.fonts.mono : f.fonts.sans);
  const tw = ctx.measureText(text).width;
  const w = tw + size * 1.4;
  const h = size * 1.9;
  const x0 = opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  roundRect(ctx, x0, y - h / 2, w, h, h / 2);
  ctx.fillStyle = opts.bg ?? f.spec.accent;
  ctx.fill();
  ctx.fillStyle = opts.color ?? onColor(opts.bg ?? f.spec.accent);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + size * 0.7, y + size * 0.04);
  ctx.restore();
  return w;
}

/** Arriba de la cara si entra; si no, debajo (las tarjetas nunca tapan la cara). */
export function avoidFace(f: FxFrame, h: number, preferTop: number, maxBottom = f.H * 0.68): number {
  const safe = f.faceSafe;
  const overlaps = (y: number) => y < safe.y + safe.h && y + h > safe.y;
  if (!overlaps(preferTop)) return preferTop;
  const below = safe.y + safe.h + 24 * f.u;
  if (below + h <= maxBottom) return below;
  const above = safe.y - h - 24 * f.u;
  if (above >= f.H * 0.05) return above;
  return preferTop;
}

/** Zona de lectura debajo de la cara (para palabras grandes que no la tapan). */
export function belowFace(f: FxFrame, h: number): number {
  const safe = f.faceSafe;
  return clamp(safe.y + safe.h + 30 * f.u, f.H * 0.12, f.H * (f.vertical ? 0.66 : 0.7) - h);
}

/** Centro vertical de un texto grande: debajo de la cara en vertical, al costado en horizontal. */
export function textAnchor(f: FxFrame, h: number): { cx: number; cy: number; maxW: number } {
  if (f.vertical) return { cx: f.W / 2, cy: belowFace(f, h) + h / 2, maxW: f.W * 0.86 };
  const right = f.faceCx < f.W / 2;
  return { cx: right ? f.W * 0.72 : f.W * 0.28, cy: f.H * 0.46, maxW: f.W * 0.4 };
}

/** Texto con sombra suave (legible sobre cualquier video). */
export function shadowText(f: FxFrame, text: string, x: number, y: number, color = "#ffffff", blur = 22): void {
  const { ctx } = f;
  ctx.save();
  shadow(f, blur, 4, "rgba(0,0,0,0.5)");
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Trazo "a mano": curva con temblor según la semilla. `p` (0–1) dibuja solo una parte. */
export function handStroke(ctx: FxCtx, pts: [number, number][], p: number, wobble: number, seed: number): void {
  const r = rng(seed);
  const n = Math.max(2, Math.ceil(pts.length * clamp01(p)));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]!;
    const jx = (r() - 0.5) * wobble;
    const jy = (r() - 0.5) * wobble;
    if (i === 0) ctx.moveTo(x + jx, y + jy);
    else ctx.lineTo(x + jx, y + jy);
  }
  ctx.stroke();
}

/** Puntos de una elipse (para círculos a mano), con una vuelta un poco más larga que la circunferencia. */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 64, turns = 1.08, start = -2.2): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2 * turns;
    const k = 1 + 0.05 * Math.sin(i * 0.4);
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

/** Estrella de `n` puntas. */
export function starPath(ctx: FxCtx, cx: number, cy: number, r: number, inner = 0.45, n = 5, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i * Math.PI) / n;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Destello de cuatro puntas (brillos). */
export function sparklePath(ctx: FxCtx, cx: number, cy: number, r: number): void {
  const k = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  ctx.closePath();
}

export function heartPath(ctx: FxCtx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.6, cy - s * 0.1, cx - s * 0.9, cy - s * 1.25, cx, cy - s * 0.45);
  ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.25, cx + s * 1.6, cy - s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

/** Check y cruz dibujados (trazo redondo). `p` 0–1 dibuja parte del trazo. */
export function checkStroke(ctx: FxCtx, cx: number, cy: number, r: number, p: number): void {
  const pts: [number, number][] = [
    [cx - r * 0.5, cy + r * 0.02],
    [cx - r * 0.14, cy + r * 0.38],
    [cx + r * 0.55, cy - r * 0.36],
  ];
  polyline(ctx, pts, p);
}
export function crossStroke(ctx: FxCtx, cx: number, cy: number, r: number, p: number): void {
  const a = clamp01(p * 2);
  const b = clamp01(p * 2 - 1);
  polyline(ctx, [[cx - r * 0.42, cy - r * 0.42], [cx + r * 0.42, cy + r * 0.42]], a);
  if (b > 0) polyline(ctx, [[cx + r * 0.42, cy - r * 0.42], [cx - r * 0.42, cy + r * 0.42]], b);
}

/** Una línea quebrada dibujada hasta `p` de su largo. */
export function polyline(ctx: FxCtx, pts: [number, number][], p: number): void {
  if (p <= 0 || pts.length < 2) return;
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]));
  let left = lens.reduce((a, b) => a + b, 0) * clamp01(p);
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < lens.length && left > 0; i++) {
    const k = Math.min(1, left / lens[i]!);
    ctx.lineTo(lerp(pts[i]![0], pts[i + 1]![0], k), lerp(pts[i]![1], pts[i + 1]![1], k));
    left -= lens[i]!;
  }
  ctx.stroke();
}

/**
 * El video dentro de un rectángulo (cubriéndolo, centrado en la cara si hay que recortar). `zoom` agranda el cuadro
 * dentro del rectángulo.
 */
export function videoIn(f: FxFrame, x: number, y: number, w: number, h: number, r = 0, zoom = 1, filter = "none"): void {
  const { ctx, W, H } = f;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const s = Math.max(w / W, h / H) * zoom;
  // Centro de la cara dentro del rectángulo, sin dejar bordes vacíos.
  const fx = clamp(f.faceCx * s, w / 2, W * s - w / 2);
  const fy = clamp(f.faceCy * s, h * 0.42, H * s - h * 0.58);
  const ox = x + w / 2 - fx;
  const oy = y + h * 0.42 - fy;
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, filter);
  ctx.restore();
}

/** Escala mínima para que una rotación `rot` (radianes) no deje bordes vacíos. */
export function coverScale(f: FxFrame, rot: number): number {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return Math.max((f.W * c + f.H * s) / f.W, (f.W * s + f.H * c) / f.H);
}

/** Ruido suave determinista (suma de senos), entre -1 y 1. */
export function wander(t: number, seed: number, speed = 1): number {
  const a = (seed % 997) / 997;
  return (Math.sin(t * 1.7 * speed + a * 6.28) * 0.5 + Math.sin(t * 2.9 * speed + a * 11.3) * 0.3 + Math.sin(t * 5.3 * speed + a * 3.7) * 0.2) / 1;
}

/** Textura de ruido (grano) de `size` px reales, una vez por semilla. */
export function grainTile(f: FxFrame, seed: number, size = 256): Layer {
  return f.persistent(`grain${seed % 4}`, size, size, (l) => {
    const img = l.ctx.createImageData(size, size);
    const r = rng(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(128 + (r() + r() + r() - 1.5) * 120);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    l.ctx.putImageData(img, 0, 0);
  });
}

/** Cubre el cuadro con una textura repetida (corrida según el cuadro, para que "viva"). */
export function tileOver(f: FxFrame, tile: Layer, alpha: number, op: string, frameSeed: number, scale = 1): void {
  const { ctx, W, H } = f;
  const r = rng(frameSeed);
  const size = (tile.canvas.width / f.pixelScale) * scale;
  const ox = -r() * size;
  const oy = -r() * size;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = op;
  for (let y = oy; y < H; y += size) for (let x = ox; x < W; x += size) ctx.drawImage(tile.canvas, x, y, size, size);
  ctx.restore();
}

/** Número del cuadro (para que las texturas cambien a 30 cuadros por segundo, igual en la vista previa y el render). */
export const frameIndex = (f: FxFrame) => Math.floor(f.t * 30 + 1e-6);

/** El video base con un leve zoom (para que el cuadro "respire" mientras dura el efecto). */
export function breathe(f: FxFrame, amount = 0.04): Xf {
  const k = clamp01(f.t / Math.max(0.5, f.spec.duration));
  return { s: 1 + amount * k, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 };
}

/** Texto principal en mayúsculas (o un respaldo). */
export const upperText = (f: FxFrame, fallback: string) => (f.spec.text || fallback).toLocaleUpperCase("es");

/** Ítems con respaldo hasta `n`. */
export function itemsOr(f: FxFrame, fallback: string[], n = fallback.length): string[] {
  const out = f.spec.items.filter(Boolean).slice(0, n);
  for (const x of fallback) if (out.length < Math.min(n, fallback.length)) out.push(x);
  return out;
}

/** Instante en que aparece el ítem `i` (lo que marcó la app al decirlo, o repartido). */
export function markAt(f: FxFrame, i: number, n: number, first = 0.35): number {
  const m = f.spec.marks[i];
  if (m != null) return m;
  const span = Math.max(0.6, f.spec.duration - first - 0.8);
  return first + (span * i) / Math.max(1, n);
}

/** Palabra que se está diciendo (índice), o la última dicha. */
export function wordNow(f: FxFrame): number {
  const ws = f.spec.words;
  let last = -1;
  for (let i = 0; i < ws.length; i++) {
    if (ws[i]!.t0 <= f.t) last = i;
    else break;
  }
  return last;
}

/** Medidas de un texto en una fuente (ancho) y tamaño que entra. */
export function fitFont(f: FxFrame, text: string, weight: number, family: string, maxW: number, maxSize: number, minSize = 18): { size: number; font: string; width: number } {
  const size = fitSize(f.ctx, text, (s) => f.font(weight, s, family), maxW, maxSize * f.u, minSize * f.u);
  const font = f.font(weight, size, family);
  f.ctx.font = font;
  return { size, font, width: f.ctx.measureText(text).width };
}

/** Ancho de una línea con interletrado manual (algunas fuentes del worker no aplican letterSpacing). */
export function spacedWidth(ctx: FxCtx, text: string, spacing: number): number {
  return ctx.measureText(text).width + Math.max(0, [...text].length - 1) * spacing;
}

/** Texto con interletrado manual. */
export function spacedText(ctx: FxCtx, text: string, x: number, y: number, spacing: number, align: "left" | "center" = "left"): void {
  let cx = align === "center" ? x - spacedWidth(ctx, text, spacing) / 2 : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prev;
}
