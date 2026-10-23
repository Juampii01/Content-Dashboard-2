/**
 * Motor de efectos: base común. Dibuja con la API Canvas 2D (el <canvas> del navegador o skia-canvas en el worker),
 * en coordenadas del video final (1080×1920 o 1920×1080) aunque el lienzo sea más chico (vista previa).
 *
 * Cada cuadro se arma en capas: el fondo (el cuadro del video, con su encuadre o reemplazado), lo que va detrás de la
 * persona, la persona (el cuadro recortado con la máscara) y lo que va adelante. Determinista: el mismo instante da el
 * mismo cuadro.
 */
import type { FxSpec } from "../compile";
import { animState, applyAnimGeometry, applyTransform, type Box as PlaceBox } from "../../canvas/place-math";

export type ImageLike = { width: number; height: number };

export interface FxCtx {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /** Matriz actual (navegador y skia-canvas la tienen). */
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
  globalAlpha: number;
  globalCompositeOperation: string;
  filter: string;
  imageSmoothingEnabled: boolean;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  quadraticCurveTo(a: number, b: number, c: number, d: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  clip(rule?: "nonzero" | "evenodd"): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setLineDash(d: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(o: number, c: string): void };
  drawImage(img: unknown, ...args: number[]): void;
}

export type Layer = { canvas: ImageLike; ctx: FxCtx };

export type FxSources = {
  /** El cuadro del video ya encuadrado (cualquier tamaño: se dibuja a todo el cuadro). */
  frame: ImageLike | null;
  /** La máscara de la persona: imagen con alfa (blanca donde está la persona). null = todavía no hay recorte. */
  mask: ImageLike | null;
  /** Imágenes por clave (miniaturas de tus reels: "t0", "t1"…). */
  images?: Record<string, ImageLike | undefined>;
};

export type FxHost = {
  /** Crea un lienzo de `w`×`h` píxeles reales (sin escala). */
  makeCanvas(w: number, h: number): Layer;
  /** Fuentes por papel. */
  fonts: FxFonts;
  /** Movimiento reducido (vista previa con "reducir movimiento"): sin temblores ni giros continuos. */
  reducedMotion?: boolean;
};

export type FxFonts = { sans: string; display: string; serif: string; mono: string; hand: string; cut: string };

/** Familias del worker (worker/motion/lib.mjs las registra con estos nombres). */
export const WORKER_FONTS: FxFonts = { sans: "Inter", display: "Montserrat", serif: "Instrument Serif", mono: "JetBrains Mono", hand: "Caveat", cut: "Anton" };

/** Transformación de la imagen del video: escala `s` alrededor de (px, py) y corrimiento. */
export type Xf = { s: number; px: number; py: number; tx: number; ty: number; rot?: number };
export const IDENTITY: Xf = { s: 1, px: 0, py: 0, tx: 0, ty: 0 };

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (p: number) => 1 - (1 - clamp01(p)) ** 3;
export const easeInOut = (p: number) => {
  const q = clamp01(p);
  return q < 0.5 ? 4 * q ** 3 : 1 - (-2 * q + 2) ** 3 / 2;
};
export const easeIn = (p: number) => clamp01(p) ** 3;
/** Se pasa un poco y vuelve (rebote chico). */
export const backOut = (p: number, k = 1.70158) => {
  const q = clamp01(p) - 1;
  return 1 + (k + 1) * q ** 3 + k * q ** 2;
};
/** Rebote amortiguado (para el check y las pastillas). */
export const bounce = (p: number) => {
  const q = clamp01(p);
  return 1 - Math.exp(-6 * q) * Math.cos(q * Math.PI * 3.2) * (1 - q);
};

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp01(a) * 1000) / 1000})`;
};

export function roundRect(ctx: FxCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Tamaño de fuente para que `text` entre en `maxW` (sin pasar de `maxSize`). */
export function fitSize(ctx: FxCtx, text: string, font: (size: number) => string, maxW: number, maxSize: number, minSize = 8): number {
  ctx.font = font(100);
  const w = ctx.measureText(text).width || 1;
  return clamp((100 * maxW) / w, minSize, maxSize);
}

/** Corta un texto en renglones que entran en `maxW` con la fuente actual. */
export function wrap(ctx: FxCtx, text: string, maxW: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[.,;:]?$/, "")}…`;
    return kept;
  }
  return lines;
}

/** Posición x (desde el comienzo del texto) de cada letra, con el ancho real de los prefijos (respeta el interletrado). */
export function letterOffsets(ctx: FxCtx, text: string): { ch: string; x: number; w: number }[] {
  const chars = [...text];
  const out: { ch: string; x: number; w: number }[] = [];
  let prefix = "";
  for (const ch of chars) {
    const x = ctx.measureText(prefix).width;
    prefix += ch;
    out.push({ ch, x, w: ctx.measureText(prefix).width - x });
  }
  return out;
}

/**
 * Lo que recibe cada efecto en un cuadro: el lienzo (ya escalado al tamaño lógico), el instante y utilidades para
 * dibujar el video, la persona recortada y su silueta.
 */
export class FxFrame {
  readonly W: number;
  readonly H: number;
  /** Unidad: 1 en un 1080 de lado corto. */
  readonly u: number;
  readonly vertical: boolean;
  private personCache = new Map<string, Layer>();
  /** Caja de diseño del elemento movible de este cuadro (la que muestra el lienzo de la revisión). */
  movableBox: PlaceBox | null = null;
  /** Matriz de afuera del elemento movible: el video de fondo (vidrio de la tarjeta) se dibuja sin moverse. */
  private baseMatrix: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;

  constructor(
    readonly ctx: FxCtx,
    readonly spec: FxSpec,
    readonly t: number,
    readonly src: FxSources,
    readonly host: FxHost,
    readonly pixelScale: number,
    private pool: LayerPool,
  ) {
    this.W = spec.width;
    this.H = spec.height;
    this.u = Math.min(this.W, this.H) / 1080;
    this.vertical = this.H > this.W;
  }

  get fonts(): FxFonts {
    return this.host.fonts;
  }

  /** ¿Hay recorte de la persona en este cuadro? */
  get hasMask(): boolean {
    return Boolean(this.src.mask);
  }

  /** Lienzo auxiliar del tamaño del cuadro (reutilizado entre cuadros), con la escala de la vista previa. */
  layer(name: string, scale = 1): Layer {
    const ps = this.pixelScale * scale;
    const l = this.pool.get(name, Math.max(1, Math.round(this.W * ps)), Math.max(1, Math.round(this.H * ps)), this.host);
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.globalAlpha = 1;
    l.ctx.globalCompositeOperation = "source-over";
    l.ctx.filter = "none";
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    l.ctx.setTransform(ps, 0, 0, ps, 0, 0);
    return l;
  }

  /** Aplica una transformación de la imagen del video al contexto. */
  applyXf(ctx: FxCtx, xf: Xf): void {
    ctx.translate(xf.px + xf.tx, xf.py + xf.ty);
    if (xf.rot) ctx.rotate(xf.rot);
    ctx.scale(xf.s, xf.s);
    ctx.translate(-xf.px, -xf.py);
  }

  /** El cuadro del video (con una transformación y un filtro opcionales). */
  drawBase(ctx: FxCtx = this.ctx, xf: Xf = IDENTITY, filter = "none", alpha = 1, layerScale = 1): void {
    if (!this.src.frame) {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, this.W, this.H);
      return;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (filter !== "none") ctx.filter = this.scaleFilter(filter, layerScale);
    // Dentro del elemento movido, el video sigue en su lugar (el recorte sí se mueve con el elemento).
    const m = ctx === this.ctx ? this.baseMatrix : null;
    if (m) ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    this.applyXf(ctx, xf);
    ctx.drawImage(this.src.frame, 0, 0, this.W, this.H);
    ctx.restore();
  }

  /**
   * Dibuja el elemento superpuesto que la persona puede mover (tarjeta, teléfono, gráfico, titular): con el lugar y la
   * animación de la revisión (`spec.place`) alrededor del centro de su caja de diseño. Sin `place`, igual que siempre.
   */
  movable(box: PlaceBox, draw: () => void): void {
    this.movableBox = box;
    const place = this.spec.place;
    if (!place) {
      draw();
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    this.baseMatrix = ctx.getTransform ? ctx.getTransform() : null;
    applyTransform(ctx, place.transform, box, this.W, this.H);
    if (place.anim) {
      const st = animState(place.anim, this.t, this.spec.duration);
      ctx.globalAlpha *= st.alpha;
      applyAnimGeometry(ctx, st, box, this.W, this.H, 80 * this.u);
    }
    try {
      draw();
    } finally {
      this.baseMatrix = null;
      ctx.restore();
    }
  }

  /** Los filtros de blur van en píxeles del lienzo real (en la vista previa, más chicos). */
  scaleFilter(filter: string, layerScale = 1): string {
    return filter.replace(/blur\(([\d.]+)px\)/g, (_, n) => `blur(${(Number(n) * this.pixelScale * layerScale).toFixed(2)}px)`);
  }

  /** Capa con la persona recortada (cuadro × máscara), con la transformación dada. Vacía si no hay máscara. */
  personLayer(xf: Xf = IDENTITY): Layer | null {
    if (!this.src.mask || !this.src.frame) return null;
    const key = `${xf.s.toFixed(4)}|${xf.px.toFixed(1)}|${xf.py.toFixed(1)}|${xf.tx.toFixed(1)}|${xf.ty.toFixed(1)}|${(xf.rot ?? 0).toFixed(4)}`;
    const hit = this.personCache.get(key);
    if (hit) return hit;
    const l = this.layer(`person${this.personCache.size}`);
    l.ctx.save();
    this.applyXf(l.ctx, xf);
    l.ctx.drawImage(this.src.frame, 0, 0, this.W, this.H);
    l.ctx.globalCompositeOperation = "destination-in";
    l.ctx.imageSmoothingEnabled = true;
    l.ctx.drawImage(this.src.mask, 0, 0, this.W, this.H);
    l.ctx.restore();
    this.personCache.set(key, l);
    return l;
  }

  /** Dibuja a la persona recortada. Sin máscara, no dibuja nada (lo de "detrás" se ve más tenue: ver `behind`). */
  drawPerson(ctx: FxCtx = this.ctx, xf: Xf = IDENTITY, alpha = 1): void {
    const l = this.personLayer(xf);
    if (!l) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(l.canvas, 0, 0, this.W, this.H);
    ctx.restore();
  }

  /**
   * Silueta de la persona en un color, engordada `grow` píxeles (para bordes de papel y contornos): la máscara se
   * dibuja corrida en 10 direcciones. `jitter` mueve cada copia un poco (contorno "a mano" que tiembla).
   */
  silhouette(name: string, color: string, grow: number, xf: Xf = IDENTITY, jitter = 0, seed = 1, scale = 0.5): Layer | null {
    if (!this.src.mask) return null;
    // A media resolución: son bordes y sombras (se agranda al dibujarla) y cuesta 10 veces la máscara.
    const l = this.layer(name, scale);
    const r = rng(seed);
    l.ctx.save();
    const steps = grow > 0 ? 10 : 1;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const d = grow * (1 + (r() - 0.5) * jitter);
      l.ctx.save();
      l.ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
      this.applyXf(l.ctx, xf);
      l.ctx.drawImage(this.src.mask, 0, 0, this.W, this.H);
      l.ctx.restore();
    }
    l.ctx.globalCompositeOperation = "source-in";
    l.ctx.fillStyle = color;
    l.ctx.fillRect(0, 0, this.W, this.H);
    l.ctx.restore();
    return l;
  }

  /**
   * Dibuja lo que va detrás de la persona. Sin máscara (vista previa antes del recorte) se dibuja más tenue, para que
   * se vea dónde va sin tapar la cara.
   */
  behind(draw: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    if (this.spec.mask && !this.src.mask) ctx.globalAlpha *= 0.5;
    draw();
    ctx.restore();
  }

  /** Imagen por clave (miniaturas). */
  image(key: string): ImageLike | undefined {
    return this.src.images?.[key];
  }

  font(weight: number | string, size: number, family: string, style = ""): string {
    return `${style ? `${style} ` : ""}${weight} ${Math.max(1, size).toFixed(2)}px "${family}"`;
  }

  /** Lo que no se tapa nunca: la cara con un margen. */
  get faceSafe(): { x: number; y: number; w: number; h: number } {
    const f = this.spec.face;
    const mx = f.w * 0.25;
    const my = f.h * 0.3;
    return { x: f.x - mx, y: f.y - my, w: f.w + mx * 2, h: f.h + my * 2 };
  }

  get faceCx(): number {
    return this.spec.face.x + this.spec.face.w / 2;
  }
  get faceCy(): number {
    return this.spec.face.y + this.spec.face.h / 2;
  }
}

/** Lienzos auxiliares reutilizados entre cuadros (crearlos en cada cuadro es caro, sobre todo en el navegador). */
export class LayerPool {
  private layers = new Map<string, Layer>();
  get(name: string, w: number, h: number, host: FxHost): Layer {
    const cur = this.layers.get(name);
    if (cur && cur.canvas.width === w && cur.canvas.height === h) return cur;
    const l = host.makeCanvas(w, h);
    this.layers.set(name, l);
    return l;
  }
}
