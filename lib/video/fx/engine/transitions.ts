/**
 * Transiciones (dibujo): cada una transforma el cuadro que se ve en ese instante (antes del corte, el tramo que sale;
 * después, el que entra). Nunca mezclan dos cuadros a la vez: así la unión de tramos y la voz quedan como están.
 */
import type { TransitionKind } from "../transitions";
import { clamp01, easeIn, easeInOut, easeOut, FxFrame, lerp, rgba, rng } from "./core";
import { channelSplit } from "./fx-looks";
import { coverScale, frameIndex, mix } from "./kit";

/** Intensidad de la transición: 0 en los bordes, 1 en el corte. `side`: -1 antes del corte, 1 después. */
function phase(f: FxFrame): { k: number; side: -1 | 1; p: number } {
  const c = f.spec.cut ?? f.spec.duration / 2;
  if (f.t < c) {
    const p = clamp01(f.t / Math.max(0.05, c));
    return { k: easeIn(p), side: -1, p };
  }
  const p = clamp01((f.t - c) / Math.max(0.05, f.spec.duration - c));
  return { k: 1 - easeOut(p), side: 1, p };
}

const blur = (px: number) => (px > 0.4 ? `blur(${px.toFixed(1)}px)` : "none");

function zoomIn(f: FxFrame): void {
  const { k } = phase(f);
  const s = 1 + 1.1 * k;
  f.drawBase(f.ctx, { s, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 }, blur(20 * k));
  for (let i = 1; i <= 2 && k > 0.05; i++) f.drawBase(f.ctx, { s: s * (1 + 0.07 * i * k), px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 }, blur(20 * k + 6 * i), 0.3 * k);
}

function zoomOut(f: FxFrame): void {
  const { k, side } = phase(f);
  // Antes del corte se aleja (más chico, sobre una copia agrandada y borrosa); después llega de lejos.
  const s = side < 0 ? 1 - 0.45 * k : 1 + 0.6 * k;
  if (s < 1) f.drawBase(f.ctx, { s: 1.4, px: f.W / 2, py: f.H / 2, tx: 0, ty: 0 }, "blur(28px) brightness(0.7)");
  f.drawBase(f.ctx, { s, px: f.W / 2, py: f.H / 2, tx: 0, ty: 0 }, blur(16 * k));
}

function whip(f: FxFrame, vertical: boolean): void {
  const { k, side } = phase(f);
  const { W, H } = f;
  const dir = f.spec.seed % 2 ? 1 : -1;
  const span = vertical ? H : W;
  const dist = span * 0.55 * k * (side < 0 ? 1 : -1) * dir * -1;
  if (k < 0.02) {
    f.drawBase(f.ctx);
    return;
  }
  // Barrido con desenfoque de movimiento: copias corridas en la dirección del barrido, a media resolución (es todo
  // borroso igual) y dando la vuelta (lo que sale por un lado entra por el otro: nunca quedan bordes vacíos).
  const l = f.layer("whip", 0.5);
  const steps = 5;
  const at = (o: number, alpha: number, blurPx: number) => {
    for (const wrap of [0, -Math.sign(o || 1) * span]) {
      const off = o + wrap;
      if (Math.abs(off) >= span) continue;
      f.drawBase(l.ctx, { s: 1, px: W / 2, py: H / 2, tx: vertical ? 0 : off, ty: vertical ? off : 0 }, blur(blurPx), alpha, 0.5);
    }
  };
  at(dist, 1, 6 * k);
  for (let i = 1; i <= steps; i++) at(dist * (1 - (i / steps) * 0.35), (0.5 * k) / i, 12 * k);
  f.ctx.drawImage(l.canvas, 0, 0, W, H);
}

function blurT(f: FxFrame): void {
  const { k } = phase(f);
  const b = blur(36 * k);
  f.drawBase(f.ctx, { s: 1 + 0.04 * k, px: f.W / 2, py: f.H / 2, tx: 0, ty: 0 }, b === "none" ? "none" : `${b} brightness(${(1 + 0.12 * k).toFixed(3)})`);
}

function flashT(f: FxFrame, color: string): void {
  const { k } = phase(f);
  f.drawBase(f.ctx, { s: 1 + 0.06 * k, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 }, k > 0.1 ? `brightness(${(1 + 0.8 * k).toFixed(2)})` : "none");
  const c = f.spec.cut ?? f.spec.duration / 2;
  const peak = 1 - clamp01(Math.abs(f.t - c) / Math.max(0.08, f.spec.duration * 0.42));
  f.ctx.fillStyle = rgba(color, easeOut(peak) * 0.95);
  f.ctx.fillRect(0, 0, f.W, f.H);
}

function dip(f: FxFrame, color: string): void {
  const { k } = phase(f);
  f.drawBase(f.ctx);
  f.ctx.fillStyle = rgba(color, easeInOut(k));
  f.ctx.fillRect(0, 0, f.W, f.H);
}

function slide(f: FxFrame, vertical: boolean): void {
  const { k, side } = phase(f);
  const { ctx, spec, W, H } = f;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, mix(spec.bg, spec.accent, 0.3));
  g.addColorStop(1, spec.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const span = (vertical ? H : W) * easeInOut(k);
  // Sale hacia un lado y el siguiente entra desde el otro (un empujón con el color de tu marca en medio).
  const off = side < 0 ? -span : span;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 50 * f.u * f.pixelScale;
  f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: vertical ? 0 : off, ty: vertical ? off : 0 }, blur(8 * k));
  ctx.restore();
  ctx.fillStyle = spec.accent;
  if (vertical) ctx.fillRect(0, side < 0 ? H + off : off - 10 * f.u, W, 10 * f.u);
  else ctx.fillRect(side < 0 ? W + off : off - 10 * f.u, 0, 10 * f.u, H);
}

function spin(f: FxFrame): void {
  const { k, side } = phase(f);
  // Sale girando hacia un lado y el siguiente llega girando desde el otro: un solo giro continuo.
  const rot = (side < 0 ? 1 : -1) * Math.PI * 0.5 * k * (f.spec.seed % 2 ? 1 : -1);
  f.drawBase(f.ctx, { s: coverScale(f, rot) * (1 + 0.15 * k), px: f.W / 2, py: f.H / 2, tx: 0, ty: 0, rot }, blur(18 * k));
}

function glitchT(f: FxFrame): void {
  const { k } = phase(f);
  const { ctx, spec, W, H, u } = f;
  const r = rng(spec.seed + frameIndex(f) * 31);
  const sh = 40 * u * k;
  channelSplit(f, [{ s: 1, px: 0, py: 0, tx: sh, ty: 0 }, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, { s: 1, px: 0, py: 0, tx: -sh, ty: 0 }]);
  for (let i = 0; i < Math.round(8 * k); i++) {
    const y = r() * H;
    const h = (14 + r() * 100) * u;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, h);
    ctx.clip();
    f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: (r() - 0.5) * 220 * u * k, ty: 0 }, r() < 0.3 ? "invert(1)" : "none");
    ctx.restore();
  }
  if (k > 0.6) {
    ctx.fillStyle = rgba(spec.accent, 0.3 * k);
    ctx.fillRect(r() * W, r() * H, 300 * u, 30 * u);
  }
}

function lightLeakT(f: FxFrame): void {
  const { k } = phase(f);
  const { ctx, W, H, t, spec } = f;
  f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, k > 0.1 ? `brightness(${(1 + 0.5 * k).toFixed(2)}) sepia(${(0.3 * k).toFixed(2)})` : "none");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const x = lerp(-W * 0.3, W * 1.3, clamp01(t / spec.duration));
  for (const [c, r, a] of [
    ["255,140,50", 1.1, 0.95],
    ["255,70,90", 0.8, 0.7],
    ["255,230,170", 0.5, 0.9],
  ] as const) {
    const g = ctx.createRadialGradient(x, H * 0.45, 0, x, H * 0.45, Math.max(W, H) * r);
    g.addColorStop(0, `rgba(${c},${a * k})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function iris(f: FxFrame): void {
  const { k } = phase(f);
  const { ctx, spec, W, H } = f;
  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, W, H);
  const maxR = Math.hypot(W, H);
  const r = maxR * (1 - easeInOut(k)) + 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.faceCx, f.faceCy, r, 0, Math.PI * 2);
  ctx.clip();
  f.drawBase(ctx);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(f.faceCx, f.faceCy, r, 0, Math.PI * 2);
  ctx.strokeStyle = spec.accent;
  ctx.lineWidth = 12 * f.u * Math.min(1, k * 3);
  ctx.stroke();
}

function blinds(f: FxFrame): void {
  const { k } = phase(f);
  const { ctx, spec, W, H } = f;
  f.drawBase(ctx);
  const n = 8;
  const bh = H / n;
  ctx.fillStyle = spec.accent;
  for (let i = 0; i < n; i++) {
    const local = clamp01(k * 1.4 - (i / n) * 0.4);
    const h = bh * easeInOut(local);
    ctx.fillStyle = i % 2 ? spec.accent : mix(spec.accent, spec.bg, 0.35);
    ctx.fillRect(0, i * bh + (bh - h) / 2, W, h + 1);
  }
}

function pixelate(f: FxFrame): void {
  const { k } = phase(f);
  const { ctx, W, H } = f;
  if (k < 0.05) {
    f.drawBase(ctx);
    return;
  }
  const blocks = Math.max(6, Math.round(lerp(140, 12, k)));
  const scale = blocks / W / Math.max(0.01, f.pixelScale);
  const l = f.layer("px", Math.max(0.004, scale));
  f.drawBase(l.ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 });
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(l.canvas, 0, 0, W, H);
  ctx.restore();
  void H;
}

function shakeT(f: FxFrame): void {
  const { k } = phase(f);
  const r = rng(f.spec.seed + frameIndex(f) * 7);
  const amp = 40 * f.u * k;
  f.drawBase(f.ctx, { s: 1 + 0.16 * k, px: f.faceCx, py: f.faceCy, tx: (r() - 0.5) * 2 * amp, ty: (r() - 0.5) * 2 * amp }, blur(5 * k));
  const c = f.spec.cut ?? f.spec.duration / 2;
  const fl = 1 - clamp01(Math.abs(f.t - c) / 0.07);
  if (fl > 0) {
    f.ctx.fillStyle = `rgba(255,255,255,${0.35 * fl})`;
    f.ctx.fillRect(0, 0, f.W, f.H);
  }
}

function diagonal(f: FxFrame): void {
  const { side, p } = phase(f);
  const { ctx, spec, W, H } = f;
  f.drawBase(ctx);
  // Una franja ancha que cruza de abajo a la izquierda a arriba a la derecha: tapa el corte en su centro.
  const total = side < 0 ? p * 0.5 : 0.5 + p * 0.5;
  const D = W + H;
  const pos = lerp(-D * 0.6, D * 1.1, easeInOut(total));
  const band = D * 0.55;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-D / 2, -D / 2);
  const g = ctx.createLinearGradient(pos - band / 2, 0, pos + band / 2, 0);
  g.addColorStop(0, rgba(spec.accent, 0));
  g.addColorStop(0.18, spec.accent);
  g.addColorStop(0.82, mix(spec.accent, spec.bg, 0.4));
  g.addColorStop(1, rgba(spec.bg, 0));
  ctx.fillStyle = g;
  ctx.fillRect(pos - band / 2, -D, band, D * 3);
  ctx.restore();
}

function rgbSplit(f: FxFrame): void {
  const { k } = phase(f);
  const sh = 70 * f.u * k;
  if (sh < 0.5) {
    f.drawBase(f.ctx);
    return;
  }
  channelSplit(f, [
    { s: 1 + 0.03 * k, px: f.W / 2, py: f.H / 2, tx: sh, ty: 0 },
    { s: 1, px: 0, py: 0, tx: 0, ty: 0 },
    { s: 1 + 0.03 * k, px: f.W / 2, py: f.H / 2, tx: -sh, ty: sh * 0.4 },
  ]);
}

export const TRANSITION_DRAW: Record<TransitionKind, (f: FxFrame) => void> = {
  tr_zoom_in: zoomIn,
  tr_zoom_out: zoomOut,
  tr_whip: (f) => whip(f, false),
  tr_whip_up: (f) => whip(f, true),
  tr_blur: blurT,
  tr_flash: (f) => flashT(f, "#ffffff"),
  tr_flash_brand: (f) => flashT(f, f.spec.accent),
  tr_fade_black: (f) => dip(f, "#000000"),
  tr_dip_brand: (f) => dip(f, f.spec.bg),
  tr_slide: (f) => slide(f, false),
  tr_slide_up: (f) => slide(f, true),
  tr_spin: spin,
  tr_glitch: glitchT,
  tr_light_leak: lightLeakT,
  tr_iris: iris,
  tr_blinds: blinds,
  tr_pixelate: pixelate,
  tr_shake: shakeT,
  tr_diagonal: diagonal,
  tr_rgb_split: rgbSplit,
};
