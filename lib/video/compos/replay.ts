/**
 * Dibuja la lista de una composición (lo que devolvió el sandbox) en el lienzo real, con el motor de efectos: igual en
 * la vista previa (<canvas>) y en el worker (skia-canvas). Es la tercera barrera: no confía en la lista (puede venir
 * de un sandbox del navegador). Cada operación se revisa (nombre conocido, números finitos, colores, filtros, modos de
 * mezcla y fuentes válidos, tope de operaciones y de capas anidadas); lo que no pasa se salta.
 *
 * La lista está en píxeles del video final; el lienzo ya viene escalado (pixelScale) por FxRenderer.
 */
import type { FxCtx, FxFrame, Layer } from "../fx/engine/core";
import { COLOR_RE, COMPOSITE_OPS, COMPOS_LIMITS, FILTER_RE, type ComposFrame } from "./contract";
import { FONT_RE, measure } from "./runtime/measure";

const COMPOSITES = new Set<string>(COMPOSITE_OPS);
const PROPS = new Set([
  "globalAlpha",
  "globalCompositeOperation",
  "filter",
  "fillStyle",
  "strokeStyle",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "lineDashOffset",
  "font",
  "textAlign",
  "textBaseline",
  "letterSpacing",
  "shadowBlur",
  "shadowColor",
  "shadowOffsetX",
  "shadowOffsetY",
  "imageSmoothingEnabled",
]);
const ENUMS: Record<string, Set<string>> = {
  lineCap: new Set(["butt", "round", "square"]),
  lineJoin: new Set(["miter", "round", "bevel"]),
  textAlign: new Set(["left", "right", "center", "start", "end"]),
  textBaseline: new Set(["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"]),
};

type Ctx2 = FxCtx & { roundRect?: (x: number, y: number, w: number, h: number, r: number | number[]) => void; arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void; resetTransform?: () => void; letterSpacing?: string; miterLimit: number; lineDashOffset: number; createConicGradient?: (a: number, x: number, y: number) => { addColorStop(o: number, c: string): void } };

type Text = { spacing: number; font: string };

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const allFin = (a: unknown[], from: number, n: number) => {
  for (let i = from; i < from + n; i++) if (!fin(a[i])) return false;
  return true;
};

/** Familias de las composiciones → las del lienzo (en el navegador se llaman distinto). */
function fontMap(f: FxFrame): Record<string, string> {
  const fonts = f.fonts;
  return { Inter: fonts.sans, Montserrat: fonts.display, "Instrument Serif": fonts.serif, "JetBrains Mono": fonts.mono, Caveat: fonts.hand, Anton: fonts.cut };
}

function remapFont(font: string, map: Record<string, string>): string | null {
  const m = FONT_RE.exec(font);
  if (!m) return null;
  const fam = m[5]!.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  const real = map[fam] ?? map.Inter!;
  return `${m[1] ?? ""}${m[3] ? `${m[3]} ` : ""}${Number(m[4]).toFixed(2)}px "${real}"`;
}

type Style = string | { g: "l" | "r" | "c"; a: number[]; s: [number, string][] };

function makeStyle(ctx: Ctx2, v: unknown): unknown {
  if (typeof v === "string") return v.length <= 80 && COLOR_RE.test(v) ? v : null;
  const g = v as Style;
  if (!g || typeof g !== "object" || !Array.isArray(g.a) || !Array.isArray(g.s)) return null;
  let grad: { addColorStop(o: number, c: string): void } | null = null;
  try {
    if (g.g === "l" && g.a.length === 4 && allFin(g.a, 0, 4)) grad = ctx.createLinearGradient(g.a[0]!, g.a[1]!, g.a[2]!, g.a[3]!);
    else if (g.g === "r" && g.a.length === 6 && allFin(g.a, 0, 6) && g.a[2]! >= 0 && g.a[5]! >= 0) grad = ctx.createRadialGradient(g.a[0]!, g.a[1]!, g.a[2]!, g.a[3]!, g.a[4]!, g.a[5]!);
    else if (g.g === "c" && g.a.length === 3 && allFin(g.a, 0, 3) && ctx.createConicGradient) grad = ctx.createConicGradient(g.a[0]!, g.a[1]!, g.a[2]!);
    if (!grad) return null;
    for (const st of g.s.slice(0, 32)) if (Array.isArray(st) && fin(st[0]) && st[0] >= 0 && st[0] <= 1 && typeof st[1] === "string" && COLOR_RE.test(st[1])) grad.addColorStop(st[0], st[1]);
  } catch {
    return null;
  }
  return grad;
}

/** Imagen y su tamaño en unidades del video final (el lienzo real puede ser más chico: vista previa). */
type Src = { img: unknown; kx: number; ky: number };

class Player {
  private ops = 0;
  private layerCanvases = new Map<string, Layer>();
  private nextLayer = 0;
  private map: Record<string, string>;
  constructor(
    private f: FxFrame,
    private frame: ComposFrame,
  ) {
    this.map = fontMap(f);
  }

  /** Dibuja una lista en un contexto (el principal o el de una capa). */
  run(ctx: Ctx2, list: unknown[], depth: number): void {
    const text: Text = { spacing: 0, font: '500 10px "Inter"' };
    let saves = 0;
    const ps = this.f.pixelScale;
    for (const raw of list) {
      if (++this.ops > COMPOS_LIMITS.opsPerFrame * 1.5) break;
      if (!Array.isArray(raw) || typeof raw[0] !== "string") continue;
      const op = raw as unknown[];
      const a = op;
      try {
        switch (op[0]) {
          case "s":
            ctx.save();
            saves++;
            break;
          case "r":
            if (saves > 0) {
              ctx.restore();
              saves--;
            }
            break;
          case "t":
            if (allFin(a, 1, 2)) ctx.translate(a[1] as number, a[2] as number);
            break;
          case "sc":
            if (allFin(a, 1, 2)) ctx.scale(a[1] as number, a[2] as number);
            break;
          case "ro":
            if (allFin(a, 1, 1)) ctx.rotate(a[1] as number);
            break;
          case "tf":
            if (allFin(a, 1, 6)) ctx.transform(a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number, a[6] as number);
            break;
          case "st":
            // setTransform del módulo es en unidades del video: se compone con la escala del lienzo.
            if (allFin(a, 1, 6)) ctx.setTransform((a[1] as number) * ps, (a[2] as number) * ps, (a[3] as number) * ps, (a[4] as number) * ps, (a[5] as number) * ps, (a[6] as number) * ps);
            break;
          case "rt":
            ctx.setTransform(ps, 0, 0, ps, 0, 0);
            break;
          case "bp":
            ctx.beginPath();
            break;
          case "cp":
            ctx.closePath();
            break;
          case "mt":
            if (allFin(a, 1, 2)) ctx.moveTo(a[1] as number, a[2] as number);
            break;
          case "lt":
            if (allFin(a, 1, 2)) ctx.lineTo(a[1] as number, a[2] as number);
            break;
          case "bz":
            if (allFin(a, 1, 6)) ctx.bezierCurveTo(a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number, a[6] as number);
            break;
          case "qc":
            if (allFin(a, 1, 4)) ctx.quadraticCurveTo(a[1] as number, a[2] as number, a[3] as number, a[4] as number);
            break;
          case "ar":
            if (allFin(a, 1, 5) && (a[3] as number) >= 0) ctx.arc(a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number, a[6] === true);
            break;
          case "at":
            if (allFin(a, 1, 5) && (a[5] as number) >= 0) ctx.arcTo(a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number);
            break;
          case "el":
            if (allFin(a, 1, 7) && (a[3] as number) >= 0 && (a[4] as number) >= 0) ctx.ellipse(a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number, a[6] as number, a[7] as number, a[8] === true);
            break;
          case "re":
            if (allFin(a, 1, 4)) ctx.rect(a[1] as number, a[2] as number, a[3] as number, a[4] as number);
            break;
          case "rr": {
            if (!allFin(a, 1, 4)) break;
            const r = Array.isArray(a[5]) ? (a[5] as unknown[]).filter(fin).slice(0, 4).map((n) => Math.max(0, n)) : fin(a[5]) ? Math.max(0, a[5]) : 0;
            if (ctx.roundRect) ctx.roundRect(a[1] as number, a[2] as number, a[3] as number, a[4] as number, r);
            else roundRectPath(ctx, a[1] as number, a[2] as number, a[3] as number, a[4] as number, Array.isArray(r) ? (r[0] ?? 0) : r);
            break;
          }
          case "f":
            ctx.fill(a[1] === "evenodd" ? "evenodd" : "nonzero");
            break;
          case "k":
            ctx.stroke();
            break;
          case "cl":
            ctx.clip(a[1] === "evenodd" ? "evenodd" : "nonzero");
            break;
          case "fr":
            if (allFin(a, 1, 4)) ctx.fillRect(a[1] as number, a[2] as number, a[3] as number, a[4] as number);
            break;
          case "sr":
            if (allFin(a, 1, 4)) ctx.strokeRect(a[1] as number, a[2] as number, a[3] as number, a[4] as number);
            break;
          case "cr":
            if (allFin(a, 1, 4)) ctx.clearRect(a[1] as number, a[2] as number, a[3] as number, a[4] as number);
            break;
          case "ft":
          case "kt":
            if (typeof a[1] === "string" && allFin(a, 2, 2)) this.text(ctx, text, op[0] === "kt", (a[1] as string).slice(0, COMPOS_LIMITS.textChars), a[2] as number, a[3] as number, fin(a[4]) ? a[4] : undefined);
            break;
          case "ld":
            if (Array.isArray(a[1])) ctx.setLineDash((a[1] as unknown[]).filter(fin).slice(0, 16).map((n) => Math.max(0, n)));
            break;
          case "p":
            this.prop(ctx, text, String(a[1]), a[2]);
            break;
          case "v":
          case "pe":
          case "sil":
          case "img":
          case "ly":
            this.image(ctx, op, depth);
            break;
        }
      } catch {
        // Una operación que el lienzo rechaza se salta (nunca rompe el cuadro).
      }
    }
    while (saves-- > 0) ctx.restore();
  }

  private prop(ctx: Ctx2, text: Text, name: string, v: unknown): void {
    if (!PROPS.has(name)) return;
    const ps = this.f.pixelScale;
    switch (name) {
      case "fillStyle":
      case "strokeStyle": {
        const st = makeStyle(ctx, v);
        if (st != null) (ctx as unknown as Record<string, unknown>)[name] = st;
        return;
      }
      case "globalCompositeOperation":
        if (typeof v === "string" && COMPOSITES.has(v)) ctx.globalCompositeOperation = v;
        return;
      case "filter":
        if (typeof v === "string" && v.length <= 160 && FILTER_RE.test(v)) ctx.filter = this.f.scaleFilter(v);
        return;
      case "font": {
        if (typeof v !== "string" || v.length > 120) return;
        const real = remapFont(v, this.map);
        if (real) {
          ctx.font = real;
          text.font = v;
        }
        return;
      }
      case "letterSpacing":
        if (typeof v === "string" && /^-?[\d.]+px$/.test(v)) text.spacing = parseFloat(v) || 0;
        return;
      case "shadowColor":
        if (typeof v === "string" && COLOR_RE.test(v)) ctx.shadowColor = v;
        return;
      // Sombras: no las escala la transformación del lienzo (van en píxeles reales).
      case "shadowBlur":
        if (fin(v) && v >= 0) ctx.shadowBlur = v * ps;
        return;
      case "shadowOffsetX":
        if (fin(v)) ctx.shadowOffsetX = v * ps;
        return;
      case "shadowOffsetY":
        if (fin(v)) ctx.shadowOffsetY = v * ps;
        return;
      case "imageSmoothingEnabled":
        ctx.imageSmoothingEnabled = v === true;
        return;
      case "globalAlpha":
        if (fin(v)) ctx.globalAlpha = Math.max(0, Math.min(1, v));
        return;
      default:
        if (ENUMS[name]) {
          if (typeof v === "string" && ENUMS[name]!.has(v)) (ctx as unknown as Record<string, unknown>)[name] = v;
        } else if (fin(v)) (ctx as unknown as Record<string, unknown>)[name] = name === "lineWidth" ? Math.max(0, v) : v;
    }
  }

  /** Texto: nativo sin interletrado; con interletrado, letra a letra con las mismas tablas que midió el módulo. */
  private text(ctx: Ctx2, text: Text, stroke: boolean, s: string, x: number, y: number, maxW?: number): void {
    if (!text.spacing) {
      if (stroke) ctx.strokeText(s, x, y);
      else ctx.fillText(s, x, y, maxW);
      return;
    }
    const total = measure(text.font, text.spacing, s).width;
    const align = ctx.textAlign;
    let start = x;
    if (align === "center") start = x - total / 2;
    else if (align === "right" || align === "end") start = x - total;
    ctx.save();
    ctx.textAlign = "left";
    let prefix = "";
    for (const ch of s) {
      const cx = start + measure(text.font, text.spacing, prefix).width;
      if (stroke) ctx.strokeText(ch, cx, y);
      else ctx.fillText(ch, cx, y);
      prefix += ch;
    }
    ctx.restore();
  }

  /** Fuente de una imagen: el video, la persona, la silueta, una imagen permitida o una capa (ya dibujada). */
  private source(op: unknown[], depth: number): { src: Src | null; args: unknown[]; fallback?: boolean } {
    const f = this.f;
    const W = f.W;
    const H = f.H;
    const unit = (img: { width: number; height: number } | null | undefined, w: number, h: number): Src | null => (img ? { img, kx: img.width / w, ky: img.height / h } : null);
    switch (op[0]) {
      case "v":
        return { src: f.src.frame ? unit(f.src.frame, W, H) : null, args: op.slice(1) };
      case "pe": {
        // Sin recorte (todavía no llegó a la vista previa): el cuadro del video como respaldo, nunca un hueco vacío.
        const l = f.personLayer();
        if (l) return { src: unit(l.canvas, W, H), args: op.slice(1) };
        return { src: f.src.frame ? unit(f.src.frame, W, H) : null, args: op.slice(1), fallback: true };
      }
      case "sil": {
        const color = typeof op[1] === "string" && COLOR_RE.test(op[1]) ? op[1] : "#ffffff";
        const grow = fin(op[2]) ? Math.max(0, Math.min(80, op[2])) : 10;
        const l = f.silhouette(`cmp-sil-${color}-${grow}`, color, grow);
        return { src: l ? unit(l.canvas, W, H) : null, args: op.slice(3) };
      }
      case "img": {
        const img = typeof op[1] === "string" ? f.image(op[1]) : undefined;
        // Las imágenes se usan con su tamaño propio (coordenadas de origen en sus píxeles).
        return { src: img ? { img, kx: 1, ky: 1 } : null, args: op.slice(2) };
      }
      case "ly": {
        const key = typeof op[1] === "string" ? op[1] : "";
        const list = this.frame.l?.[key];
        if (!Array.isArray(list) || depth >= 4) return { src: null, args: [] };
        let layer = this.layerCanvases.get(key);
        if (!layer) {
          if (this.nextLayer >= COMPOS_LIMITS.layersPerFrame * 2) return { src: null, args: [] };
          layer = f.layer(`cmp${this.nextLayer++}`);
          this.run(layer.ctx as Ctx2, list, depth + 1);
          this.layerCanvases.set(key, layer);
        }
        return { src: unit(layer.canvas, W, H), args: op.slice(2) };
      }
    }
    return { src: null, args: [] };
  }

  private image(ctx: Ctx2, op: unknown[], depth: number): void {
    const { src, args, fallback } = this.source(op, depth);
    const W = this.f.W;
    const H = this.f.H;
    if (!src) {
      // Sin cuadro del video todavía (vista previa cargando): un fondo oscuro donde iría.
      if (op[0] === "v") {
        ctx.save();
        ctx.fillStyle = "#0b1020";
        if (args.length >= 4 && allFin(args, 0, 4)) ctx.fillRect(args[args.length - 4] as number, args[args.length - 3] as number, args[args.length - 2] as number, args[args.length - 1] as number);
        else ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      return;
    }
    const n = args.length;
    if (!allFin(args, 0, n)) return;
    const v = args as number[];
    const img = src.img;
    // Respaldo de la persona sin recorte: el video, algo transparente (lo que iba "detrás" se sigue viendo).
    if (fallback) {
      ctx.save();
      ctx.globalAlpha *= FALLBACK_ALPHA;
    }
    try {
      this.draw(ctx, img, src, v, n);
    } finally {
      if (fallback) ctx.restore();
    }
  }

  private draw(ctx: Ctx2, img: Src["img"], src: Src, v: number[], n: number): void {
    const natW = (img as { width: number }).width / src.kx;
    const natH = (img as { height: number }).height / src.ky;
    if (n === 2) ctx.drawImage(img, 0, 0, (img as { width: number }).width, (img as { height: number }).height, v[0]!, v[1]!, natW, natH);
    else if (n === 4) ctx.drawImage(img, 0, 0, (img as { width: number }).width, (img as { height: number }).height, v[0]!, v[1]!, v[2]!, v[3]!);
    else if (n === 8) {
      if (v[2]! <= 0 || v[3]! <= 0) return;
      ctx.drawImage(img, v[0]! * src.kx, v[1]! * src.ky, v[2]! * src.kx, v[3]! * src.ky, v[4]!, v[5]!, v[6]!, v[7]!);
    }
  }
}

/** Opacidad del video cuando hace de respaldo de la persona (la vista previa sin recorte todavía). */
export const FALLBACK_ALPHA = 0.7;

function roundRectPath(ctx: FxCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
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

/** Dibuja un cuadro de la composición. Sin lista (todavía no llegó o falló), el cuadro del video tal cual. */
export function replayComposition(f: FxFrame, frame: ComposFrame | null | undefined): void {
  if (!frame || !Array.isArray(frame.o)) {
    f.drawBase(f.ctx);
    return;
  }
  const ctx = f.ctx as Ctx2;
  ctx.save();
  try {
    new Player(f, frame).run(ctx, frame.o, 0);
  } finally {
    ctx.restore();
  }
}
