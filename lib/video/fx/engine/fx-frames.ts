/**
 * Marcos y fondos: teléfono, foto instantánea, foto con cinta, papel rasgado, cuaderno, pantalla de computadora,
 * pantalla dividida, tres paneles, tira de película y ventana del navegador. El video se achica hasta su marco y al
 * final vuelve a pantalla completa (sin salto). Todos genéricos: sin logos ni marcas de terceros.
 */
import { clamp01, easeInOut, easeOut, FxFrame, lerp, rgba, rng, roundRect, wrap } from "./core";
import { displayFamily, fitFont, frameIndex, grainTile, mix, noShadow, onColor, shadow, tileOver, videoIn } from "./kit";

type Rect = { x: number; y: number; w: number; h: number };

/** Avance del marco: entra en 0,5 s y sale en 0,4 s. */
const frameP = (f: FxFrame) => Math.min(easeInOut(f.t / 0.5), 1 - easeInOut((f.t - (f.spec.duration - 0.4)) / 0.4));

const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

/** Fondo con la marca: degradado, un brillo del acento y la grilla fina de 48 px. */
export function brandBackdrop(f: FxFrame, alpha = 1): void {
  const { ctx, spec, W, H, u } = f;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix(spec.bg, spec.accent, 0.12));
  g.addColorStop(1, mix(spec.bg, "#000000", 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, Math.max(W, H) * 0.7);
  r.addColorStop(0, rgba(spec.accent, 0.28));
  r.addColorStop(1, rgba(spec.accent, 0));
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 48 * u) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = 0; y <= H; y += 48 * u) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** El video desenfocado y oscuro de fondo. */
function blurBackdrop(f: FxFrame, alpha = 1): void {
  f.drawBase(f.ctx, { s: 1.15, px: f.W / 2, py: f.H / 2, tx: 0, ty: 0 }, "blur(30px) brightness(0.55) saturate(1.1)", alpha);
}

/** Papel crema con grano (fondo de cuaderno, cinta y papel rasgado). */
function paper(f: FxFrame, ctx = f.ctx, color = "#f3ede1"): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, f.W, f.H);
  ctx.restore();
}

const full = (f: FxFrame): Rect => ({ x: 0, y: 0, w: f.W, h: f.H });

// ─── Teléfono ──────────────────────────────────────────────────────────────

export function phoneFrame(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  brandBackdrop(f, k);
  const pw = f.vertical ? W * 0.64 : H * 0.48;
  const ph = pw * (19.5 / 9);
  const target: Rect = { x: (W - pw) / 2, y: (H - ph) / 2 + (f.vertical && spec.text ? 60 * u : 0), w: pw, h: ph };
  const scr = lerpRect(full(f), { x: target.x + 20 * u, y: target.y + 20 * u, w: pw - 40 * u, h: ph - 40 * u }, k);
  ctx.save();
  if (k > 0) {
    shadow(f, 80, 30, `rgba(0,0,0,${0.5 * k})`);
    roundRect(ctx, lerp(0, target.x, k), lerp(0, target.y, k), lerp(W, pw, k), lerp(H, ph, k), 78 * u * k);
    ctx.fillStyle = "#0d0f14";
    ctx.fill();
    noShadow(ctx);
    roundRect(ctx, lerp(0, target.x, k) + 4 * u, lerp(0, target.y, k) + 4 * u, lerp(W, pw, k) - 8 * u, lerp(H, ph, k) - 8 * u, 74 * u * k);
    ctx.strokeStyle = `rgba(255,255,255,${0.16 * k})`;
    ctx.lineWidth = 3 * u;
    ctx.stroke();
  }
  videoIn(f, scr.x, scr.y, scr.w, scr.h, 58 * u * k);
  if (k > 0.5) {
    ctx.globalAlpha *= (k - 0.5) * 2;
    roundRect(ctx, target.x + pw / 2 - 70 * u, target.y + 38 * u, 140 * u, 38 * u, 19 * u);
    ctx.fillStyle = "#000000";
    ctx.fill();
  }
  ctx.restore();
  if (spec.text && k > 0.3) {
    ctx.save();
    ctx.globalAlpha *= easeOut((t - 0.4) / 0.4) * k;
    const fit = fitFont(f, spec.text, 800, displayFamily(f), W * 0.86, 70, 30);
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(spec.text, W / 2, f.vertical ? target.y - 40 * u : target.y + ph + fit.size * 1.2);
    ctx.restore();
  }
}

// ─── Foto instantánea ──────────────────────────────────────────────────────

export function polaroid(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  blurBackdrop(f, k);
  const pw = f.vertical ? W * 0.8 : H * 0.7;
  const photo = pw - 70 * u;
  const ph = photo + 35 * u + 190 * u;
  const cx = W / 2;
  const cy = H * (f.vertical ? 0.46 : 0.5);
  const rot = (-4 * Math.PI) / 180;
  const fr: Rect = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
  const img = lerpRect(full(f), { x: fr.x + 35 * u, y: fr.y + 35 * u, w: photo, h: photo }, k);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot * k);
  ctx.translate(-cx, -cy);
  if (k > 0) {
    ctx.save();
    ctx.globalAlpha *= k;
    shadow(f, 60, 26, "rgba(0,0,0,0.45)");
    ctx.fillStyle = "#fbfaf6";
    ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
    noShadow(ctx);
    ctx.restore();
  }
  videoIn(f, img.x, img.y, img.w, img.h, 0, 1, k > 0.5 ? "contrast(1.05) saturate(1.08) sepia(0.08)" : "none");
  if (k > 0.4 && spec.text) {
    ctx.globalAlpha *= easeOut((t - 0.55) / 0.5);
    const fit = fitFont(f, spec.text, 700, f.fonts.hand, pw - 100 * u, 92, 30);
    ctx.font = fit.font;
    ctx.fillStyle = "#1f2433";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.text, cx, fr.y + 35 * u + photo + 105 * u);
  }
  ctx.restore();
}

// ─── Foto con cinta ────────────────────────────────────────────────────────

function tape(f: FxFrame, x: number, y: number, w: number, rot: number): void {
  const { ctx, u } = f;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(236,226,196,0.82)";
  const h = 64 * u;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + (w * i) / 6, -h / 2 + (i % 2 ? 4 : -2) * u);
  ctx.lineTo(w / 2, h / 2);
  for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 + (w * i) / 6, h / 2 + (i % 2 ? -3 : 3) * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function tapeFrame(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  ctx.save();
  ctx.globalAlpha *= k;
  paper(f, ctx, "#ece5d6");
  tileOver(f, grainTile(f, spec.seed + 2, 256), 0.12, "multiply", spec.seed, 1.3);
  ctx.restore();
  const pw = f.vertical ? W * 0.78 : H * 0.62;
  const ph = f.vertical ? pw * 1.25 : pw * 1.05;
  const cx = W / 2;
  const cy = H * 0.47;
  const fr: Rect = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
  const img = lerpRect(full(f), { x: fr.x + 22 * u, y: fr.y + 22 * u, w: pw - 44 * u, h: ph - 44 * u }, k);
  const rot = ((3 * Math.PI) / 180) * k;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.translate(-cx, -cy);
  if (k > 0) {
    ctx.save();
    ctx.globalAlpha *= k;
    shadow(f, 40, 16, "rgba(60,40,10,0.35)");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
    noShadow(ctx);
    ctx.restore();
  }
  videoIn(f, img.x, img.y, img.w, img.h);
  if (k > 0.6) {
    ctx.globalAlpha *= (k - 0.6) / 0.4;
    tape(f, fr.x + 40 * u, fr.y + 10 * u, 230 * u, -0.7);
    tape(f, fr.x + fr.w - 40 * u, fr.y + fr.h - 10 * u, 230 * u, -0.6);
  }
  ctx.restore();
}

// ─── Papel rasgado ─────────────────────────────────────────────────────────

/** Borde rasgado de un rectángulo (dientes irregulares deterministas). */
function tornPath(f: FxFrame, ctx: FxFrame["ctx"], r: Rect, seed: number, tooth: number): void {
  const rr = rng(seed);
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(4, Math.round(len / tooth));
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      const q = i / n;
      const j = (rr() - 0.5) * tooth * 1.4;
      pts.push([lerp(x0, x1, q) + nx * j, lerp(y0, y1, q) + ny * j]);
    }
  };
  edge(r.x, r.y, r.x + r.w, r.y);
  edge(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
  edge(r.x + r.w, r.y + r.h, r.x, r.y + r.h);
  edge(r.x, r.y + r.h, r.x, r.y);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  void f;
}

export function paperFrame(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  if (k <= 0) return;
  // El hueco se abre: de un tajo chico a casi todo el cuadro.
  const hw = lerp(W * 1.4, W * (f.vertical ? 0.8 : 0.6), k);
  const hh = lerp(H * 1.4, H * (f.vertical ? 0.62 : 0.74), k);
  const hole: Rect = { x: f.faceCx - hw / 2, y: Math.max(40 * u, f.faceCy - hh * 0.4), w: hw, h: hh };
  hole.x = Math.max(-W * 0.2, Math.min(W * 1.2 - hw, hole.x));
  const l = f.layer("paper");
  paper(f, l.ctx, "#f1ebdf");
  l.ctx.save();
  l.ctx.globalCompositeOperation = "destination-out";
  tornPath(f, l.ctx, hole, spec.seed, 26 * u);
  l.ctx.fill();
  l.ctx.restore();
  ctx.save();
  ctx.globalAlpha *= clamp01(k * 3);
  shadow(f, 30, 6, "rgba(40,28,10,0.55)");
  ctx.drawImage(l.canvas, 0, 0, W, H);
  noShadow(ctx);
  // Fibras blancas del borde.
  tornPath(f, ctx, hole, spec.seed, 26 * u);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 7 * u;
  ctx.stroke();
  tileOver(f, grainTile(f, spec.seed + 5, 256), 0.08, "multiply", spec.seed, 1.5);
  ctx.restore();
}

// ─── Cuaderno ──────────────────────────────────────────────────────────────

export function notebook(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  ctx.save();
  ctx.globalAlpha *= k;
  paper(f, ctx, "#fbfaf4");
  ctx.strokeStyle = "rgba(80,130,220,0.35)";
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  for (let y = 160 * u; y < H; y += 64 * u) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(220,60,60,0.55)";
  ctx.beginPath();
  ctx.moveTo(110 * u, 0);
  ctx.lineTo(110 * u, H);
  ctx.stroke();
  // Agujeros del espiral.
  ctx.fillStyle = "#d9d6cc";
  for (let y = 120 * u; y < H; y += 140 * u) {
    ctx.beginPath();
    ctx.arc(46 * u, y, 16 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const pw = f.vertical ? W * 0.7 : H * 0.6;
  const ph = f.vertical ? pw * 1.2 : pw;
  const cx = W / 2 + 40 * u;
  const cy = H * (f.vertical ? 0.42 : 0.47);
  const fr: Rect = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph };
  const img = lerpRect(full(f), fr, k);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((-2 * Math.PI) / 180) * k);
  ctx.translate(-cx, -cy);
  if (k > 0) {
    ctx.save();
    ctx.globalAlpha *= k;
    shadow(f, 30, 10, "rgba(0,0,0,0.25)");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(fr.x - 14 * u, fr.y - 14 * u, fr.w + 28 * u, fr.h + 28 * u);
    noShadow(ctx);
    ctx.restore();
  }
  videoIn(f, img.x, img.y, img.w, img.h);
  if (k > 0.6) {
    ctx.globalAlpha *= (k - 0.6) / 0.4;
    tape(f, cx, fr.y - 6 * u, 200 * u, 0.04);
  }
  ctx.restore();
  if (spec.text && k > 0.5) {
    ctx.save();
    ctx.globalAlpha *= easeOut((t - 0.6) / 0.4) * k;
    const fit = fitFont(f, spec.text, 700, f.fonts.hand, W * 0.7, 96, 30);
    ctx.font = fit.font;
    ctx.fillStyle = "#1f3b8a";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const ty = fr.y + fr.h + (f.vertical ? 150 : 90) * u;
    ctx.fillText(spec.text, cx, Math.min(H - 60 * u, ty));
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 7 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - fit.width / 2, Math.min(H - 60 * u, ty) + 22 * u);
    ctx.quadraticCurveTo(cx, Math.min(H - 60 * u, ty) + 36 * u, cx + fit.width / 2, Math.min(H - 60 * u, ty) + 18 * u);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Pantalla de computadora ───────────────────────────────────────────────

export function computerScreen(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  brandBackdrop(f, k);
  const mw = f.vertical ? W * 0.92 : W * 0.66;
  const mh = mw * (10 / 16);
  const mx = (W - mw) / 2;
  const my = H * (f.vertical ? 0.3 : 0.14);
  const bezel = 22 * u;
  const bar = 54 * u;
  const scr: Rect = { x: mx + bezel, y: my + bezel + bar, w: mw - bezel * 2, h: mh - bezel * 2 - bar };
  const img = lerpRect(full(f), scr, k);
  ctx.save();
  if (k > 0) {
    ctx.save();
    ctx.globalAlpha *= k;
    // Pie.
    ctx.fillStyle = "#1a1d26";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 60 * u, my + mh);
    ctx.lineTo(W / 2 + 60 * u, my + mh);
    ctx.lineTo(W / 2 + 90 * u, my + mh + 130 * u);
    ctx.lineTo(W / 2 - 90 * u, my + mh + 130 * u);
    ctx.closePath();
    ctx.fill();
    roundRect(ctx, W / 2 - 200 * u, my + mh + 124 * u, 400 * u, 22 * u, 11 * u);
    ctx.fill();
    shadow(f, 60, 24, "rgba(0,0,0,0.5)");
    roundRect(ctx, mx, my, mw, mh, 30 * u);
    ctx.fillStyle = "#0e1016";
    ctx.fill();
    noShadow(ctx);
    // Barra de la ventana.
    ctx.fillStyle = "#1c2030";
    ctx.fillRect(scr.x, my + bezel, scr.w, bar);
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(scr.x + 30 * u + i * 30 * u, my + bezel + bar / 2, 9 * u, 0, Math.PI * 2);
      ctx.fill();
    });
    if (spec.kicker) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = f.font(600, 26 * u, f.fonts.sans);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.kicker, W / 2, my + bezel + bar / 2);
      // Punto "en vivo".
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(W / 2 - ctx.measureText(spec.kicker).width / 2 - 22 * u, my + bezel + bar / 2, 8 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  videoIn(f, img.x, img.y, img.w, img.h, 0);
  ctx.restore();
}

// ─── Pantalla dividida ─────────────────────────────────────────────────────

export function splitTwo(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  const fam = displayFamily(f);
  if (f.vertical) {
    const split = lerp(H, H * 0.58, k);
    videoIn(f, 0, 0, W, split, 0, 1);
    ctx.save();
    ctx.fillStyle = spec.surface;
    ctx.fillRect(0, split, W, H - split);
    ctx.fillStyle = spec.accent;
    ctx.fillRect(0, split, W, 8 * u);
    ctx.globalAlpha *= easeOut((t - 0.45) / 0.4) * k;
    if (spec.kicker) {
      ctx.font = f.font(600, 30 * u, f.fonts.mono);
      ctx.fillStyle = spec.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(spec.kicker.toLocaleUpperCase("es"), 70 * u, split + 110 * u);
    }
    ctx.font = f.font(800, 78 * u, fam);
    const lines = wrap(ctx, spec.text || "La idea", W - 140 * u, 4);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, 70 * u, split + 210 * u + i * 90 * u));
    ctx.restore();
  } else {
    const split = lerp(W, W * 0.55, k);
    videoIn(f, 0, 0, split, H, 0, 1);
    ctx.save();
    ctx.fillStyle = spec.surface;
    ctx.fillRect(split, 0, W - split, H);
    ctx.fillStyle = spec.accent;
    ctx.fillRect(split, 0, 8 * u, H);
    ctx.globalAlpha *= easeOut((t - 0.45) / 0.4) * k;
    ctx.font = f.font(800, 72 * u, fam);
    const lines = wrap(ctx, spec.text || "La idea", W * 0.38, 5);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (spec.kicker) {
      ctx.font = f.font(600, 30 * u, f.fonts.mono);
      ctx.fillStyle = spec.accent;
      ctx.fillText(spec.kicker.toLocaleUpperCase("es"), split + 70 * u, H * 0.32);
    }
    ctx.font = f.font(800, 72 * u, fam);
    ctx.fillStyle = "#ffffff";
    lines.forEach((l, i) => ctx.fillText(l, split + 70 * u, H * 0.32 + 100 * u + i * 84 * u));
    ctx.restore();
  }
  void onColor;
}

// ─── Tres paneles ──────────────────────────────────────────────────────────

export function splitThree(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const out = 1 - easeInOut((t - (spec.duration - 0.35)) / 0.35);
  const filters = ["none", "grayscale(1) contrast(1.15)", "saturate(1.4) contrast(1.05)"];
  const zooms = [1.0, 1.35, 1.8];
  const gap = 10 * u;
  for (let i = 0; i < 3; i++) {
    const p = easeOut((t - i * 0.12) / 0.4) * out;
    if (p <= 0) continue;
    const dir = i % 2 ? 1 : -1;
    if (f.vertical) {
      const h = (H - gap * 2) / 3;
      const y = i * (h + gap);
      const x = dir * (1 - p) * W;
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y - gap, W, h + gap * 2);
      videoIn(f, x, y, W, h, 0, zooms[i]!, filters[i]!);
      if (i === 2) {
        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = rgba(spec.accent, 0.35);
        ctx.fillRect(x, y, W, h);
      }
      ctx.restore();
    } else {
      const w = (W - gap * 2) / 3;
      const x = i * (w + gap);
      const y = dir * (1 - p) * H;
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(x - gap, y, w + gap * 2, H);
      videoIn(f, x, y, w, H, 0, zooms[i]!, filters[i]!);
      ctx.restore();
    }
  }
}

// ─── Tira de película ──────────────────────────────────────────────────────

export function filmStrip(f: FxFrame): void {
  const { ctx, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  ctx.save();
  ctx.globalAlpha *= k;
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const sw = f.vertical ? W * 0.84 : H * 0.62 * (16 / 12);
  const fh = f.vertical ? sw * 1.05 : H * 0.62;
  const sx = (W - sw) / 2;
  const drift = (f.host.reducedMotion ? 0 : t * 40 * u) % (fh + 40 * u);
  const center = H / 2 - fh / 2;
  const holes = 46 * u;
  ctx.save();
  ctx.globalAlpha *= k;
  // Cinta: se dibujan el cuadro anterior, el actual y el siguiente.
  ctx.fillStyle = "#1a1714";
  ctx.fillRect(sx - holes - 30 * u, 0, sw + holes * 2 + 60 * u, H);
  for (let y = -((drift + 3000 * u) % (60 * u)); y < H; y += 60 * u) {
    for (const hx of [sx - holes - 6 * u, sx + sw + 18 * u]) {
      roundRect(ctx, hx, y, 34 * u, 38 * u, 6 * u);
      ctx.fillStyle = "#f5efe2";
      ctx.fill();
    }
  }
  ctx.restore();
  for (const off of [-1, 1]) {
    const y = center + off * (fh + 40 * u) + drift - (fh + 40 * u) * 0.0;
    if (k <= 0) continue;
    ctx.save();
    ctx.globalAlpha *= k * 0.55;
    videoIn(f, sx, y, sw, fh, 0, 1.2, "grayscale(0.4) brightness(0.7)");
    ctx.restore();
  }
  const cur = lerpRect(full(f), { x: sx, y: center + drift * 0, w: sw, h: fh }, k);
  videoIn(f, cur.x, cur.y, cur.w, cur.h, 0, 1, k > 0.5 ? "sepia(0.2) contrast(1.08)" : "none");
  if (k > 0.5) {
    ctx.save();
    ctx.globalAlpha *= (k - 0.5) * 2;
    ctx.fillStyle = "#ff9f1c";
    ctx.font = f.font(600, 24 * u, f.fonts.mono);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`▸ ${12 + (frameIndex(f) % 3)}A`, sx + 8 * u, center + fh + 22 * u);
    ctx.restore();
  }
  void rgba;
}

// ─── Ventana del navegador ─────────────────────────────────────────────────

export function browserWindow(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const k = frameP(f);
  f.drawBase(ctx);
  brandBackdrop(f, k);
  const target: Rect = { x: (W - (f.vertical ? W * 0.9 : W * 0.62)) / 2, y: 0, w: f.vertical ? W * 0.9 : W * 0.62, h: f.vertical ? H * 0.66 : H * 0.8 };
  target.y = (H - target.h) / 2 - (f.vertical ? 30 * u : 0);
  const win = lerpRect(full(f), target, k);
  const head = 120 * u * k;
  const r = 28 * u * k;
  if (k > 0) {
    ctx.save();
    shadow(f, 70, 26, `rgba(0,0,0,${0.5 * k})`);
    roundRect(ctx, win.x, win.y, win.w, win.h, r);
    ctx.fillStyle = "#f4f5f8";
    ctx.fill();
    noShadow(ctx);
    ctx.globalAlpha *= clamp01(k * 1.5 - 0.3);
    const { x: wx, y: wy, w: ww } = win;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(wx + 40 * u + i * 32 * u, wy + 36 * u * k, 10 * u, 0, Math.PI * 2);
      ctx.fill();
    });
    // Barra de dirección.
    roundRect(ctx, wx + 30 * u, wy + 62 * u * k, ww - 60 * u, 46 * u, 23 * u);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#dde1e8";
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    // Candado.
    const ly = wy + 62 * u * k + 18 * u;
    ctx.fillStyle = "#5b6478";
    roundRect(ctx, wx + 52 * u, ly, 18 * u, 16 * u, 3 * u);
    ctx.fill();
    ctx.strokeStyle = "#5b6478";
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.arc(wx + 61 * u, ly, 6 * u, Math.PI, 0);
    ctx.stroke();
    const url = spec.text || "tumarca.com";
    const typed = url.slice(0, Math.max(0, Math.floor(url.length * clamp01((t - 0.45) / 0.6))));
    ctx.font = f.font(500, 26 * u, f.fonts.sans);
    ctx.fillStyle = "#1c2233";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(typed, wx + 86 * u, ly + 6 * u, ww - 160 * u);
    ctx.restore();
  }
  ctx.save();
  roundRect(ctx, win.x, win.y + head, win.w, win.h - head, r);
  ctx.clip();
  videoIn(f, win.x, win.y + head, win.w, win.h - head);
  ctx.restore();
}
