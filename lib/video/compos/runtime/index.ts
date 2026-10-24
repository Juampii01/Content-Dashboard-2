/**
 * Runtime de las composiciones: corre DENTRO del sandbox (contexto de node:vm sin generación de código en el worker y
 * en la app; Web Worker sin red en el navegador). Se empaqueta como un script suelto (RUNTIME_SOURCE, ver
 * scripts/motion-bundle.mjs) que define `__compos` en el global del sandbox:
 *
 *   __compos.setup(envJson)         arma `env` con los datos (ComposEnvData)
 *   __compos.define(mod)            recibe el módulo ya evaluado (`export default {…}`)
 *   __compos.frame(t) → string      JSON de { ok, frame: { o, l, n } } o { ok: false, error, line }
 *
 * Nada de lo que hay aquí ve el lienzo real: `ctx` es un grabador que arma la lista de dibujo (datos). La lista la
 * dibuja lib/video/compos/replay.ts con el lienzo real, igual en la vista previa y en el render.
 */
import { FONT_RE, measure } from "./measure";
import { COMPOS_LIMITS, COMPOSITE_OPS, COLOR_RE, FILTER_RE, type ComposEnvData } from "../contract";

type Op = unknown[];
type G = Record<string, unknown>;

const LIM = COMPOS_LIMITS;
const COMPOSITES = new Set<string>(COMPOSITE_OPS);

class ComposError extends Error {}
function fail(msg: string): never {
  throw new ComposError(msg);
}

// ─── Estado del cuadro ───────────────────────────────────────────────────

let opCount = 0;
let layerSeq = 0;
let layerIds = 0;
let frameLayers: Record<string, Op[]> = {};
let layersUsed = 0;

function count(n = 1) {
  opCount += n;
  if (opCount > LIM.opsPerFrame) fail(`Demasiadas operaciones de dibujo en un cuadro (más de ${LIM.opsPerFrame}). Simplifica: menos partículas o menos repeticiones.`);
}

const num = (v: unknown, name: string): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) fail(`${name}: el número no es válido (${String(v)}).`);
  return n;
};
const nums = (args: unknown[], name: string): number[] => args.map((a, i) => num(a, `${name} (argumento ${i + 1})`));

// ─── Estilos (degradados) ────────────────────────────────────────────────

class Gradient {
  stops: [number, string][] = [];
  ver = 0;
  constructor(
    readonly kind: "l" | "r" | "c",
    readonly args: number[],
  ) {}
  addColorStop(offset: unknown, color: unknown) {
    const o = num(offset, "addColorStop");
    if (o < 0 || o > 1) fail("addColorStop: el offset va de 0 a 1.");
    this.stops.push([o, color3(color, "addColorStop")]);
    this.ver++;
  }
  ser() {
    return { g: this.kind, a: this.args, s: this.stops.slice(0, 32) };
  }
}

function color3(v: unknown, name: string): string {
  const s = String(v ?? "").trim();
  if (s.length > 80 || !COLOR_RE.test(s)) fail(`${name}: color no válido («${s.slice(0, 40)}»). Usa #hex, rgb(), rgba(), hsl() o un nombre.`);
  return s;
}

// ─── Fuentes de imagen (manijas) ─────────────────────────────────────────

const VIDEO = Object.freeze({ __src: "video" });
const PERSON = Object.freeze({ __src: "person" });
type Sil = { __src: "sil"; color: string; grow: number };
type AssetHandle = { __src: "asset"; id: string; width: number; height: number; kind: string; title: string };

// ─── El grabador (la API de Canvas 2D) ───────────────────────────────────

const PROPS: Record<string, (v: unknown) => unknown> = {
  globalAlpha: (v) => Math.max(0, Math.min(1, num(v, "globalAlpha"))),
  globalCompositeOperation: (v) => {
    const s = String(v);
    if (!COMPOSITES.has(s)) fail(`globalCompositeOperation no permitido: ${s.slice(0, 30)}`);
    return s;
  },
  filter: (v) => {
    const s = String(v).trim() || "none";
    if (s.length > 160 || !FILTER_RE.test(s)) fail(`filter no permitido: «${s.slice(0, 50)}». Usa blur(Npx), brightness(), contrast(), saturate(), grayscale(), sepia(), invert(), opacity(), hue-rotate(Ndeg).`);
    return s;
  },
  lineWidth: (v) => Math.max(0, num(v, "lineWidth")),
  lineCap: (v) => (["butt", "round", "square"].includes(String(v)) ? String(v) : fail("lineCap: butt, round o square.")),
  lineJoin: (v) => (["miter", "round", "bevel"].includes(String(v)) ? String(v) : fail("lineJoin: miter, round o bevel.")),
  miterLimit: (v) => num(v, "miterLimit"),
  lineDashOffset: (v) => num(v, "lineDashOffset"),
  font: (v) => {
    const s = String(v);
    if (s.length > 120 || !FONT_RE.test(s)) fail(`font no válido: «${s.slice(0, 60)}». Ejemplo: '800 96px "Montserrat"' (usa env.font()).`);
    return s;
  },
  textAlign: (v) => (["left", "right", "center", "start", "end"].includes(String(v)) ? String(v) : fail("textAlign no válido.")),
  textBaseline: (v) => (["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"].includes(String(v)) ? String(v) : fail("textBaseline no válido.")),
  letterSpacing: (v) => {
    const s = String(v).trim();
    if (!/^-?[\d.]+px$/.test(s)) fail("letterSpacing va en px, por ejemplo \"4px\".");
    return s;
  },
  shadowBlur: (v) => Math.max(0, num(v, "shadowBlur")),
  shadowColor: (v) => color3(v, "shadowColor"),
  shadowOffsetX: (v) => num(v, "shadowOffsetX"),
  shadowOffsetY: (v) => num(v, "shadowOffsetY"),
  imageSmoothingEnabled: (v) => Boolean(v),
};

type State = Record<string, unknown> & { fillStyle: unknown; strokeStyle: unknown; font: string; letterSpacing: string };

const DEFAULTS = (): State => ({
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  filter: "none",
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  font: '500 10px "Inter"',
  textAlign: "start",
  textBaseline: "alphabetic",
  letterSpacing: "0px",
  shadowBlur: 0,
  shadowColor: "rgba(0,0,0,0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  imageSmoothingEnabled: true,
});

class Rec {
  // Propiedades del lienzo (getters y setters con validación, definidos más abajo en el prototipo).
  declare globalAlpha: number;
  declare globalCompositeOperation: string;
  declare filter: string;
  declare fillStyle: unknown;
  declare strokeStyle: unknown;
  declare lineWidth: number;
  declare font: string;
  declare textAlign: string;
  declare textBaseline: string;
  declare letterSpacing: string;
  _ops: Op[] = [];
  _st: State = DEFAULTS();
  _stack: State[] = [];
  /** Lo último que se mandó de cada estilo (para reenviar un degradado si cambió). */
  _sent: { fill: unknown; fillVer: number; stroke: unknown; strokeVer: number } = { fill: "#000000", fillVer: 0, stroke: "#000000", strokeVer: 0 };
  _sentStack: Rec["_sent"][] = [];
  _id: string;
  _ver = 0;
  _snap: string | null = null;
  readonly canvas: { width: number; height: number };
  constructor(
    readonly W: number,
    readonly H: number,
    id: string,
  ) {
    this._id = id;
    this.canvas = { width: W, height: H };
  }

  _push(op: Op) {
    count();
    this._ops.push(op);
    this._snap = null;
  }
  _syncStyles(fill: boolean, stroke: boolean) {
    const s = this._st;
    if (fill) {
      const f = s.fillStyle;
      const ver = f instanceof Gradient ? f.ver : 0;
      if (f !== this._sent.fill || ver !== this._sent.fillVer) {
        this._push(["p", "fillStyle", f instanceof Gradient ? f.ser() : f]);
        this._sent.fill = f;
        this._sent.fillVer = ver;
      }
    }
    if (stroke) {
      const f = s.strokeStyle;
      const ver = f instanceof Gradient ? f.ver : 0;
      if (f !== this._sent.stroke || ver !== this._sent.strokeVer) {
        this._push(["p", "strokeStyle", f instanceof Gradient ? f.ser() : f]);
        this._sent.stroke = f;
        this._sent.strokeVer = ver;
      }
    }
  }

  // Estado
  save() {
    this._stack.push({ ...this._st });
    this._sentStack.push({ ...this._sent });
    if (this._stack.length > 64) fail("Demasiados save() sin restore().");
    this._push(["s"]);
  }
  restore() {
    const prev = this._stack.pop();
    if (!prev) return;
    this._st = prev;
    this._sent = this._sentStack.pop() ?? this._sent;
    this._push(["r"]);
  }

  // Transformaciones
  translate(x: unknown, y: unknown) {
    this._push(["t", ...nums([x, y], "translate")]);
  }
  scale(x: unknown, y: unknown) {
    this._push(["sc", ...nums([x, y ?? x], "scale")]);
  }
  rotate(a: unknown) {
    this._push(["ro", num(a, "rotate")]);
  }
  transform(...a: unknown[]) {
    this._push(["tf", ...nums(a.slice(0, 6), "transform")]);
  }
  setTransform(...a: unknown[]) {
    if (a.length === 0) return this.resetTransform();
    this._push(["st", ...nums(a.slice(0, 6), "setTransform")]);
  }
  resetTransform() {
    this._push(["rt"]);
  }

  // Caminos
  beginPath() {
    this._push(["bp"]);
  }
  closePath() {
    this._push(["cp"]);
  }
  moveTo(x: unknown, y: unknown) {
    this._push(["mt", ...nums([x, y], "moveTo")]);
  }
  lineTo(x: unknown, y: unknown) {
    this._push(["lt", ...nums([x, y], "lineTo")]);
  }
  bezierCurveTo(...a: unknown[]) {
    this._push(["bz", ...nums(a.slice(0, 6), "bezierCurveTo")]);
  }
  quadraticCurveTo(...a: unknown[]) {
    this._push(["qc", ...nums(a.slice(0, 4), "quadraticCurveTo")]);
  }
  arc(x: unknown, y: unknown, r: unknown, a0: unknown, a1: unknown, ccw?: unknown) {
    const v = nums([x, y, r, a0, a1], "arc");
    this._push(["ar", v[0], v[1], Math.max(0, v[2]!), v[3], v[4], Boolean(ccw)]);
  }
  arcTo(...a: unknown[]) {
    const v = nums(a.slice(0, 5), "arcTo");
    v[4] = Math.max(0, v[4]!);
    this._push(["at", ...v]);
  }
  ellipse(x: unknown, y: unknown, rx: unknown, ry: unknown, rot: unknown, a0: unknown, a1: unknown, ccw?: unknown) {
    const v = nums([x, y, rx, ry, rot, a0, a1], "ellipse");
    this._push(["el", v[0], v[1], Math.max(0, v[2]!), Math.max(0, v[3]!), v[4], v[5], v[6], Boolean(ccw)]);
  }
  rect(...a: unknown[]) {
    this._push(["re", ...nums(a.slice(0, 4), "rect")]);
  }
  roundRect(x: unknown, y: unknown, w: unknown, h: unknown, r?: unknown) {
    const v = nums([x, y, w, h], "roundRect");
    const rr = Array.isArray(r) ? nums(r.slice(0, 4), "roundRect").map((n) => Math.max(0, n)) : Math.max(0, num(r ?? 0, "roundRect"));
    this._push(["rr", ...v, rr]);
  }

  // Dibujo
  fill(rule?: unknown) {
    this._syncStyles(true, false);
    this._push(["f", rule === "evenodd" ? "evenodd" : "nonzero"]);
  }
  stroke() {
    this._syncStyles(false, true);
    this._push(["k"]);
  }
  clip(rule?: unknown) {
    this._push(["cl", rule === "evenodd" ? "evenodd" : "nonzero"]);
  }
  fillRect(...a: unknown[]) {
    this._syncStyles(true, false);
    this._push(["fr", ...nums(a.slice(0, 4), "fillRect")]);
  }
  strokeRect(...a: unknown[]) {
    this._syncStyles(false, true);
    this._push(["sr", ...nums(a.slice(0, 4), "strokeRect")]);
  }
  clearRect(...a: unknown[]) {
    this._push(["cr", ...nums(a.slice(0, 4), "clearRect")]);
  }
  fillText(text: unknown, x: unknown, y: unknown, maxWidth?: unknown) {
    this._syncStyles(true, false);
    const s = String(text ?? "").slice(0, LIM.textChars);
    this._push(maxWidth == null ? ["ft", s, ...nums([x, y], "fillText")] : ["ft", s, ...nums([x, y, maxWidth], "fillText")]);
  }
  strokeText(text: unknown, x: unknown, y: unknown, maxWidth?: unknown) {
    this._syncStyles(false, true);
    const s = String(text ?? "").slice(0, LIM.textChars);
    this._push(maxWidth == null ? ["kt", s, ...nums([x, y], "strokeText")] : ["kt", s, ...nums([x, y, maxWidth], "strokeText")]);
  }
  measureText(text: unknown) {
    return measure(this._st.font, parseFloat(this._st.letterSpacing) || 0, String(text ?? ""));
  }
  setLineDash(d: unknown) {
    const arr = Array.isArray(d) ? nums(d.slice(0, 16), "setLineDash").map((n) => Math.max(0, n)) : [];
    this._push(["ld", arr]);
  }
  getLineDash() {
    return [];
  }
  createLinearGradient(...a: unknown[]) {
    return new Gradient("l", nums(a.slice(0, 4), "createLinearGradient"));
  }
  createRadialGradient(...a: unknown[]) {
    const v = nums(a.slice(0, 6), "createRadialGradient");
    v[2] = Math.max(0, v[2]!);
    v[5] = Math.max(0, v[5]!);
    return new Gradient("r", v);
  }
  createConicGradient(...a: unknown[]) {
    return new Gradient("c", nums(a.slice(0, 3), "createConicGradient"));
  }
  createPattern() {
    return fail("createPattern no está disponible: repite el dibujo con un bucle.");
  }
  getImageData() {
    return fail("getImageData no está disponible: las composiciones no leen píxeles.");
  }
  putImageData() {
    return fail("putImageData no está disponible.");
  }

  drawImage(src: unknown, ...a: unknown[]) {
    if (a.length !== 2 && a.length !== 4 && a.length !== 8) fail("drawImage lleva 2, 4 u 8 números después de la imagen.");
    const v = nums(a, "drawImage");
    const s = src as { __src?: string } | Rec | null;
    if (s instanceof Rec) {
      if (s === (this as Rec)) fail("Una capa no se puede dibujar sobre sí misma.");
      this._push(["ly", s._snapshot(), ...v]);
      return;
    }
    switch (s?.__src) {
      case "video":
        this._push(["v", ...v]);
        return;
      case "person":
        this._push(["pe", ...v]);
        return;
      case "sil": {
        const sil = s as Sil;
        this._push(["sil", sil.color, sil.grow, ...v]);
        return;
      }
      case "asset":
        this._push(["img", (s as AssetHandle).id, ...v]);
        return;
      default:
        fail("drawImage: la imagen tiene que ser env.video, env.person, env.silhouette(…), env.assets[i] o una capa de env.layer().");
    }
  }
  drawVideo(...a: unknown[]) {
    this.drawImage(VIDEO, ...(a.length ? a : [0, 0, this.W, this.H]));
  }
  drawPerson(...a: unknown[]) {
    this.drawImage(PERSON, ...(a.length ? a : [0, 0, this.W, this.H]));
  }

  _snapshot(): string {
    if (this._snap) return this._snap;
    const key = `${this._id}.${this._ver++}`;
    if (!(key in frameLayers)) {
      layersUsed++;
      if (layersUsed > LIM.layersPerFrame * 4) fail(`Demasiadas capas por cuadro (más de ${LIM.layersPerFrame}).`);
    }
    // Cada versión cerrada de la capa: lo que tenía cuando se dibujó (con lo pendiente de save/restore cerrado).
    const ops = this._ops.slice();
    for (let i = 0; i < this._stack.length; i++) ops.push(["r"]);
    frameLayers[key] = ops;
    this._snap = key;
    return key;
  }
}

// Propiedades del grabador (con validación al asignar).
for (const name of Object.keys(PROPS)) {
  Object.defineProperty(Rec.prototype, name, {
    get(this: Rec) {
      return this._st[name];
    },
    set(this: Rec, v: unknown) {
      const clean = PROPS[name]!(v);
      if (this._st[name] === clean) return;
      this._st[name] = clean;
      this._push(["p", name, clean]);
    },
  });
}
for (const name of ["fillStyle", "strokeStyle"] as const) {
  Object.defineProperty(Rec.prototype, name, {
    get(this: Rec) {
      return this._st[name];
    },
    set(this: Rec, v: unknown) {
      this._st[name] = v instanceof Gradient ? v : color3(v, name);
    },
  });
}

// ─── Utilidades de env ───────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const c01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

const ease = {
  linear: (p: number) => c01(p),
  inQuad: (p: number) => c01(p) ** 2,
  outQuad: (p: number) => 1 - (1 - c01(p)) ** 2,
  inOutQuad: (p: number) => (c01(p) < 0.5 ? 2 * c01(p) ** 2 : 1 - (-2 * c01(p) + 2) ** 2 / 2),
  inCubic: (p: number) => c01(p) ** 3,
  outCubic: (p: number) => 1 - (1 - c01(p)) ** 3,
  inOutCubic: (p: number) => (c01(p) < 0.5 ? 4 * c01(p) ** 3 : 1 - (-2 * c01(p) + 2) ** 3 / 2),
  inQuart: (p: number) => c01(p) ** 4,
  outQuart: (p: number) => 1 - (1 - c01(p)) ** 4,
  inOutQuart: (p: number) => (c01(p) < 0.5 ? 8 * c01(p) ** 4 : 1 - (-2 * c01(p) + 2) ** 4 / 2),
  inExpo: (p: number) => (c01(p) === 0 ? 0 : 2 ** (10 * c01(p) - 10)),
  outExpo: (p: number) => (c01(p) === 1 ? 1 : 1 - 2 ** (-10 * c01(p))),
  inOutExpo: (p: number) => {
    const q = c01(p);
    return q === 0 ? 0 : q === 1 ? 1 : q < 0.5 ? 2 ** (20 * q - 10) / 2 : (2 - 2 ** (-20 * q + 10)) / 2;
  },
  inSine: (p: number) => 1 - Math.cos((c01(p) * Math.PI) / 2),
  outSine: (p: number) => Math.sin((c01(p) * Math.PI) / 2),
  inOutSine: (p: number) => -(Math.cos(Math.PI * c01(p)) - 1) / 2,
  inBack: (p: number) => 2.70158 * c01(p) ** 3 - 1.70158 * c01(p) ** 2,
  outBack: (p: number) => 1 + 2.70158 * (c01(p) - 1) ** 3 + 1.70158 * (c01(p) - 1) ** 2,
  inOutBack: (p: number) => {
    const q = c01(p);
    const k = 1.70158 * 1.525;
    return q < 0.5 ? ((2 * q) ** 2 * ((k + 1) * 2 * q - k)) / 2 : ((2 * q - 2) ** 2 * ((k + 1) * (q * 2 - 2) + k) + 2) / 2;
  },
  outElastic: (p: number) => {
    const q = c01(p);
    return q === 0 ? 0 : q === 1 ? 1 : 2 ** (-10 * q) * Math.sin((q * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (p: number) => {
    let q = c01(p);
    const n = 7.5625;
    const d = 2.75;
    if (q < 1 / d) return n * q * q;
    if (q < 2 / d) return n * (q -= 1.5 / d) * q + 0.75;
    if (q < 2.5 / d) return n * (q -= 2.25 / d) * q + 0.9375;
    return n * (q -= 2.625 / d) * q + 0.984375;
  },
};

function spring(t: number, o: { stiffness?: number; damping?: number; mass?: number; from?: number; to?: number; velocity?: number } = {}): number {
  const k = o.stiffness ?? 170;
  const c = o.damping ?? 18;
  const m = o.mass ?? 1;
  const from = o.from ?? 0;
  const to = o.to ?? 1;
  if (t <= 0) return from;
  const x0 = from - to;
  const v0 = o.velocity ?? 0;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
  } else {
    x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
  }
  return to + x;
}

function rng(seed: number): () => number {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y = 0, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy) * 2 - 1;
}

function hexRgb(hex: string): [number, number, number] {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(c01(a) * 1000) / 1000})`;
};
const mix = (a: string, b: string, p: number) => {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const q = c01(p);
  return `#${x.map((v, i) => Math.round(lerp(v, y[i]!, q)).toString(16).padStart(2, "0")).join("")}`;
};

// ─── env ────────────────────────────────────────────────────────────────

let env: G | null = null;
let mod: { render: (ctx: Rec, t: number, env: G) => void; background?: string } | null = null;
let main: Rec | null = null;

function makeEnv(d: ComposEnvData): G {
  const W = d.width;
  const H = d.height;
  const u = Math.min(W, H) / 1080;
  const f = d.face;
  const mx = f.w * 0.25;
  const my = f.h * 0.3;
  const words = d.words.map((w) => Object.freeze({ ...w }));
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9ñ%$]+/g, "");
  const assets = d.assets.map((a) => Object.freeze({ __src: "asset", id: a.id, width: a.width, height: a.height, kind: a.kind, title: a.title }));
  const e: G = {
    W,
    H,
    u,
    vertical: H > W,
    fps: 30,
    duration: d.duration,
    seed: d.seed,
    words: Object.freeze(words),
    text: words.map((w) => w.text).join(" "),
    params: Object.freeze({ ...d.params }),
    brand: Object.freeze({ ...d.brand }),
    fonts: Object.freeze({ sans: "Inter", display: d.brand.display, serif: "Instrument Serif", mono: "JetBrains Mono", hand: "Caveat", cut: "Anton" }),
    face: Object.freeze({ ...f, cx: f.x + f.w / 2, cy: f.y + f.h / 2 }),
    safe: Object.freeze({ x: f.x - mx, y: f.y - my, w: f.w + mx * 2, h: f.h + my * 2 }),
    captions: Object.freeze({ ...d.captions }),
    hasMask: d.mask,
    video: VIDEO,
    person: PERSON,
    assets: Object.freeze(assets),
    silhouette: (color: unknown, grow: unknown) => Object.freeze({ __src: "sil", color: color3(color, "silhouette"), grow: clamp(num(grow ?? 10, "silhouette"), 0, 80) }),
    layer: () => {
      if (layerSeq >= LIM.layersPerFrame) fail(`Demasiadas capas por cuadro (máximo ${LIM.layersPerFrame}). Reutiliza una capa.`);
      layerSeq++;
      return new Rec(W, H, `L${layerIds++}`);
    },
    freeY: (blockH: number, prefer: "below" | "above" = "below") => {
      const m = 24 * u;
      const capTop = d.captions.visible ? d.captions.y : H - 40 * u;
      const sTop = f.y - my;
      const sBot = f.y + f.h + my;
      const regions = { above: { a: 40 * u, b: Math.min(sTop, capTop) }, below: { a: sBot, b: capTop } };
      const room = (r: { a: number; b: number }) => Math.max(0, r.b - r.a);
      const other = prefer === "below" ? "above" : "below";
      const pick = room(regions[prefer]) >= blockH + m ? prefer : room(regions[other]) >= blockH + m ? other : room(regions[prefer]) >= room(regions[other]) ? prefer : other;
      const r = regions[pick];
      const y = pick === "below" ? Math.min(r.a + m + blockH / 2, r.b - blockH / 2) : Math.max(r.b - m - blockH / 2, r.a + blockH / 2);
      return { y, room: room(r), fits: room(r) >= blockH, where: pick };
    },
    clamp,
    lerp,
    map: (v: number, a0: number, a1: number, b0: number, b1: number, cl = true) => {
      const p = a1 === a0 ? 0 : (v - a0) / (a1 - a0);
      return lerp(b0, b1, cl ? c01(p) : p);
    },
    progress: (t: number, start: number, dur: number) => (dur <= 0 ? (t >= start ? 1 : 0) : c01((t - start) / dur)),
    ease: Object.freeze(ease),
    spring,
    rng,
    noise,
    rgba,
    mix,
    font: (weight: unknown, size: unknown, family: unknown, style?: unknown) => `${style === "italic" ? "italic " : ""}${String(weight ?? 700)} ${Math.max(1, num(size, "font")).toFixed(2)}px "${String(family ?? "Inter")}"`,
    wordAt: (t: number) => words.find((w) => t >= w.t0 && t < w.t1) ?? null,
    timeOf: (q: unknown, from = 0) => {
      const test = q instanceof RegExp ? (s: string) => q.test(s) : (s: string) => norm(s).startsWith(norm(String(q)).slice(0, Math.max(3, norm(String(q)).length - 1)));
      const w = words.find((x) => x.t0 >= from - 1e-6 && test(x.text));
      return w ? w.t0 : null;
    },
    fit: (ctx: Rec, text: string, font: (s: number) => string, maxW: number, maxSize: number, minSize = 8) => {
      const m = measure(font(100), parseFloat(ctx._st.letterSpacing) || 0, String(text));
      return clamp((100 * maxW) / Math.max(1, m.width), minSize, maxSize);
    },
    wrap: (ctx: Rec, text: string, maxW: number, maxLines = 4) => {
      const ws = String(text).split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = "";
      for (const w of ws) {
        const next = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(next).width <= maxW || !cur) cur = next;
        else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
      return lines.slice(0, maxLines);
    },
    letters: (ctx: Rec, text: string) => {
      const out: { ch: string; x: number; w: number }[] = [];
      let prefix = "";
      for (const ch of String(text)) {
        const x = ctx.measureText(prefix).width;
        prefix += ch;
        out.push({ ch, x, w: ctx.measureText(prefix).width - x });
      }
      return out;
    },
    tint: (src: unknown, color: string) => {
      const L = (e.layer as () => Rec)();
      L.drawImage(src, 0, 0, W, H);
      L.globalCompositeOperation = "source-atop";
      L.fillStyle = color;
      L.fillRect(0, 0, W, H);
      return L;
    },
    glitch: (ctx: Rec, src: unknown, o: { intensity?: number; seed?: number; slices?: number; split?: number } = {}) => {
      const k = c01(o.intensity ?? 0.6);
      const r = rng((o.seed ?? 1) * 7919 + 13);
      const slices = clamp(Math.round(o.slices ?? 8), 1, 24);
      const split = (o.split ?? 12) * u * k;
      if (k <= 0.001) {
        ctx.drawImage(src, 0, 0, W, H);
        return;
      }
      const base = (e.layer as () => Rec)();
      // Franjas corridas.
      let y = 0;
      for (let i = 0; i < slices; i++) {
        const h = i === slices - 1 ? H - y : Math.max(4, (H / slices) * (0.4 + r() * 1.2));
        const dx = (r() - 0.5) * 140 * u * k * (r() < 0.55 ? 1 : 0.15);
        base.drawImage(src, 0, y, W, h, dx, y, W, h);
        y += h;
        if (y >= H) break;
      }
      // Separación RGB (sumando canales).
      ctx.save();
      const red = (e.tint as (s: unknown, c: string) => Rec)(base, "#ff0000");
      const green = (e.tint as (s: unknown, c: string) => Rec)(base, "#00ff00");
      const blue = (e.tint as (s: unknown, c: string) => Rec)(base, "#0000ff");
      ctx.drawImage(base, 0, 0, W, H);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.85;
      ctx.drawImage(red, -split, 0, W, H);
      ctx.drawImage(blue, split, 0, W, H);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(green, 0, split * 0.3, W, H);
      ctx.restore();
    },
    particles: (o: { seed?: number; count?: number; t: number; x?: number; y?: number; spread?: number; speed?: number; gravity?: number; life?: number; size?: number; angle?: number }) => {
      const r = rng((o.seed ?? 1) * 104729 + 7);
      const n = clamp(Math.round(o.count ?? 40), 1, 600);
      const out: { x: number; y: number; size: number; alpha: number; angle: number; i: number }[] = [];
      const t = Math.max(0, o.t);
      const life = o.life ?? 1.2;
      for (let i = 0; i < n; i++) {
        const dir = (o.angle ?? -Math.PI / 2) + (r() - 0.5) * (o.spread ?? Math.PI * 2);
        const sp = (o.speed ?? 900 * u) * (0.35 + r() * 0.85);
        const l = life * (0.5 + r() * 0.7);
        const tt = Math.min(t, l);
        const drag = 1 - Math.exp(-2.2 * tt);
        const x = (o.x ?? W / 2) + (Math.cos(dir) * sp * drag) / 2.2;
        const y = (o.y ?? H / 2) + (Math.sin(dir) * sp * drag) / 2.2 + 0.5 * (o.gravity ?? 1400 * u) * tt * tt;
        const alpha = t >= l ? 0 : 1 - (t / l) ** 2;
        out.push({ x, y, size: (o.size ?? 10 * u) * (0.4 + r() * 1.1), alpha, angle: dir + t * (r() - 0.5) * 6, i });
      }
      return out;
    },
    project: (x: number, y: number, z: number, o: { cx?: number; cy?: number; fov?: number } = {}) => {
      const fov = o.fov ?? 1400;
      const s = fov / Math.max(1, fov + z);
      const cx = o.cx ?? W / 2;
      const cy = o.cy ?? H / 2;
      return { x: cx + (x - cx) * s, y: cy + (y - cy) * s, s };
    },
    card3d: (ctx: Rec, src: unknown, o: { x: number; y: number; w: number; h: number; rx?: number; ry?: number; fov?: number; strips?: number; shade?: number; sx?: number; sy?: number; sw?: number; sh?: number }) => {
      const rx = ((o.rx ?? 0) * Math.PI) / 180;
      const ry = ((o.ry ?? 0) * Math.PI) / 180;
      const fov = o.fov ?? 1600;
      const n = clamp(Math.round(o.strips ?? 28), 2, 64);
      const srcW = (src as { width?: number })?.width ?? W;
      const srcH = (src as { height?: number })?.height ?? H;
      const sx0 = o.sx ?? 0;
      const sy0 = o.sy ?? 0;
      const sw = o.sw ?? srcW;
      const sh = o.sh ?? srcH;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      const pt = (u0: number, v0: number) => {
        // Punto de la tarjeta (u0, v0 en -0.5…0.5) girado en X y en Y, en perspectiva.
        let x = u0 * o.w;
        let y = v0 * o.h;
        let z = 0;
        const y1 = y * Math.cos(rx) - z * Math.sin(rx);
        const z1 = y * Math.sin(rx) + z * Math.cos(rx);
        y = y1;
        z = z1;
        const x2 = x * Math.cos(ry) + z * Math.sin(ry);
        const z2 = -x * Math.sin(ry) + z * Math.cos(ry);
        x = x2;
        z = z2;
        const s = fov / Math.max(1, fov + z);
        return { x: cx + x * s, y: cy + y * s };
      };
      // Tiras a lo largo del eje que más se deforma.
      const vertical = Math.abs(Math.sin(ry)) >= Math.abs(Math.sin(rx));
      const facing = Math.cos(rx) * Math.cos(ry);
      // Las tiras van a una capa (la sombra de cada tira se aplica solo donde hay dibujo) y la capa al lienzo.
      const out = ctx;
      ctx = (e.layer as () => Rec)();
      for (let i = 0; i < n; i++) {
        const a = i / n - 0.5;
        const b = (i + 1) / n - 0.5;
        const ov = 1.4 / n; // solapa un poco para que no se vean costuras
        const p0 = vertical ? pt(a, -0.5) : pt(-0.5, a);
        const p1 = vertical ? pt(b + ov, -0.5) : pt(0.5, a);
        const p2 = vertical ? pt(a, 0.5) : pt(-0.5, b + ov);
        const segW = vertical ? sw / n : sw;
        const segH = vertical ? sh : sh / n;
        const ssx = vertical ? sx0 + (sw * i) / n : sx0;
        const ssy = vertical ? sy0 : sy0 + (sh * i) / n;
        const kx = vertical ? 1 + ov * n : 1;
        const ky = vertical ? 1 : 1 + ov * n;
        ctx.save();
        ctx.setTransform((p1.x - p0.x) / (segW * kx), (p1.y - p0.y) / (segW * kx), (p2.x - p0.x) / (segH * ky), (p2.y - p0.y) / (segH * ky), p0.x, p0.y);
        if (facing < 0) ctx.globalAlpha = 0;
        ctx.drawImage(src, ssx, ssy, segW, segH, 0, 0, segW, segH);
        const shade = (o.shade ?? 0.35) * (vertical ? Math.abs(Math.sin(ry)) * (a + 0.5) : Math.abs(Math.sin(rx)) * (a + 0.5));
        if (shade > 0.01) {
          ctx.globalCompositeOperation = "source-atop";
          ctx.fillStyle = `rgba(0,0,0,${Math.round(Math.min(0.8, shade) * 1000) / 1000})`;
          ctx.fillRect(0, 0, segW, segH);
        }
        ctx.restore();
      }
      out.drawImage(ctx, 0, 0, W, H);
    },
    motionBlur: (ctx: Rec, draw: (c: Rec, tt: number) => void, t: number, o: { samples?: number; shutter?: number } = {}) => {
      const n = clamp(Math.round(o.samples ?? 6), 2, 12);
      const sh = o.shutter ?? 1 / 60;
      const acc = (e.layer as () => Rec)();
      for (let i = 0; i < n; i++) {
        const L = (e.layer as () => Rec)();
        draw(L, t - sh * (i / (n - 1)) + sh / 2);
        acc.globalAlpha = 1 / (i + 1);
        acc.drawImage(L, 0, 0, W, H);
        layerSeq--; // la capa de la muestra se reutiliza en la siguiente vuelta
      }
      ctx.drawImage(acc, 0, 0, W, H);
    },
    zoomBlur: (ctx: Rec, src: unknown, o: { cx?: number; cy?: number; scale?: number; amount?: number; samples?: number } = {}) => {
      const n = clamp(Math.round(o.samples ?? 8), 1, 16);
      const cx = o.cx ?? W / 2;
      const cy = o.cy ?? H / 2;
      const s = o.scale ?? 1;
      const amt = o.amount ?? 0.08;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const k = s * (1 + (amt * i) / Math.max(1, n - 1));
        ctx.globalAlpha = i === 0 ? 1 : 1 / (i + 1);
        ctx.drawImage(src, cx - (cx * k), cy - (cy * k), W * k, H * k);
      }
      ctx.restore();
    },
  };
  return e;
}

// ─── Entrada ────────────────────────────────────────────────────────────

const lineOf = (err: unknown): number | null => {
  const m = /composicion\.js:(\d+)/.exec(String((err as { stack?: string })?.stack ?? ""));
  return m ? Number(m[1]) : null;
};

const api = {
  setup(json: string) {
    const data = JSON.parse(json) as ComposEnvData;
    env = makeEnv(data);
    // Aleatorio determinista por composición.
    const r = rng(data.seed || 1);
    Math.random = r;
  },
  define(m: unknown) {
    const obj = m as { render?: unknown; background?: unknown } | null;
    if (!obj || typeof obj !== "object") fail("El módulo tiene que exportar un objeto: export default { render(ctx, t, env) { … } }.");
    if (typeof obj.render !== "function") fail("Falta la función render(ctx, t, env) en el export default.");
    if (obj.background != null && obj.background !== "video" && obj.background !== "none") fail('background tiene que ser "video" o "none".');
    mod = obj as typeof mod;
  },
  defaults(): string {
    const p = (mod as { params?: unknown } | null)?.params;
    const out: Record<string, string> = {};
    if (p && typeof p === "object") for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (typeof v === "string" || typeof v === "number") out[k.slice(0, 40)] = String(v).slice(0, 160);
    return JSON.stringify(out);
  },
  frame(t: number): string {
    try {
      if (!env || !mod) fail("La composición no se cargó.");
      opCount = 0;
      layerSeq = 0;
      layerIds = 0;
      layersUsed = 0;
      frameLayers = {};
      main = new Rec(env!.W as number, env!.H as number, "M");
      if (mod!.background !== "none") main.drawVideo();
      const tt = clamp(Number(t) || 0, 0, env!.duration as number);
      mod!.render(main, tt, env!);
      const ops = main._ops;
      for (let i = 0; i < main._stack.length; i++) ops.push(["r"]);
      return JSON.stringify({ ok: true, frame: { o: ops, l: frameLayers, n: opCount } });
    } catch (err) {
      const limit = err instanceof ComposError;
      let msg = "";
      try {
        msg = String((err as { message?: unknown })?.message ?? err).slice(0, 400);
      } catch {
        msg = "error desconocido";
      }
      return JSON.stringify({ ok: false, error: msg, line: lineOf(err), kind: limit && /Demasiad/.test(msg) ? "limit" : "error" });
    }
  },
};

// Sin consola real dentro del sandbox (igual en Node y en el navegador).
const quiet = () => undefined;
(globalThis as unknown as G).console = Object.freeze({ log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet });
(globalThis as unknown as G).__compos = Object.freeze(api);
