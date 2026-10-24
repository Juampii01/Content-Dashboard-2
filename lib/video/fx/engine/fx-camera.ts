/**
 * Movimientos de cámara sobre el video: sacudida, impacto, pulso, paneo lento, zoom con rebote, inclinación, cámara en
 * mano, acercamiento, zoom seco y giro de entrada. Siempre cubren el cuadro (nunca se ven bordes vacíos) y los que no son
 * un golpe vuelven suave a la normalidad antes de terminar.
 */
import { backOut, clamp01, easeIn, easeInOut, easeOut, FxFrame, lerp, rng } from "./core";
import { coverScale, frameIndex, wander } from "./kit";

/** Dibuja el cuadro con escala, giro y corrimiento alrededor de la cara, agrandando lo justo para no dejar bordes. */
export function camera(f: FxFrame, s: number, rot = 0, tx = 0, ty = 0, filter = "none", pivot?: { x: number; y: number }): void {
  const px = pivot?.x ?? f.faceCx;
  const py = pivot?.y ?? f.faceCy;
  const { W, H } = f;
  // Escala mínima para que el corrimiento no deje bordes (alrededor del pivote).
  const need = Math.max(1, (px + tx) / Math.max(1, px), (W - px - tx) / Math.max(1, W - px), (py + ty) / Math.max(1, py), (H - py - ty) / Math.max(1, H - py));
  const k = Math.max(s, need) * (rot ? coverScale(f, rot) : 1);
  f.drawBase(f.ctx, { s: k, px, py, tx, ty, rot }, filter);
}

/** 0 → 1 → 0 en los bordes del efecto (para volver a la normalidad sin salto). */
const ramp = (f: FxFrame, inDur = 0.3, outDur = 0.35) => Math.min(easeInOut(f.t / inDur), 1 - easeInOut((f.t - (f.spec.duration - outDur)) / outDur));

const flash = (f: FxFrame, amount: number) => {
  if (amount <= 0.01) return;
  f.ctx.fillStyle = `rgba(255,255,255,${amount})`;
  f.ctx.fillRect(0, 0, f.W, f.H);
};

export function shake(f: FxFrame): void {
  const { spec, t, u } = f;
  if (f.host.reducedMotion) return camera(f, 1.02);
  const r = rng(spec.seed + frameIndex(f) * 7);
  const amp = 34 * u * Math.exp(-t * 2.2) * ramp(f, 0.04, 0.2);
  camera(f, 1.05, (r() - 0.5) * 0.03 * (amp / (34 * u)), (r() - 0.5) * 2 * amp, (r() - 0.5) * 2 * amp);
}

export function impact(f: FxFrame): void {
  const { spec, t, u } = f;
  const k = Math.exp(-t * 7) * Math.cos(t * 26);
  const r = rng(spec.seed + frameIndex(f));
  const amp = f.host.reducedMotion ? 0 : 22 * u * Math.exp(-t * 9);
  camera(f, 1 + 0.16 * Math.max(0, k) + 0.04 * ramp(f, 0.01, 0.3), 0, (r() - 0.5) * 2 * amp, (r() - 0.5) * 2 * amp, t < 0.08 ? "blur(3px)" : "none");
  flash(f, 0.5 * Math.exp(-t * 16));
}

/** Escala del pulso en un instante: golpe corto en cada marca (o cada medio segundo si no hay). */
export function pulseScale(marks: number[], t: number, duration: number): number {
  const beats = marks.length ? marks : Array.from({ length: Math.max(1, Math.floor(duration / 0.5)) }, (_, i) => 0.1 + i * 0.5);
  let last = -1;
  for (const m of beats) if (m <= t) last = m;
  if (last < 0) return 1;
  const d = t - last;
  return 1 + 0.085 * (d < 0.04 ? d / 0.04 : Math.exp(-(d - 0.04) * 7));
}

export function beatPulse(f: FxFrame): void {
  const s = pulseScale(f.spec.marks, f.t, f.spec.duration);
  camera(f, 1 + (0.04 + (s - 1)) * ramp(f, 0.05, 0.2));
}

export function slowPan(f: FxFrame): void {
  const { spec, t, W } = f;
  const dir = spec.seed % 2 ? 1 : -1;
  const k = ramp(f, 0.4, 0.4);
  const p = easeInOut(t / spec.duration);
  camera(f, 1 + 0.12 * k, 0, dir * lerp(-0.045, 0.045, p) * W * k, 0);
}

export function bounceZoom(f: FxFrame): void {
  const { t } = f;
  const inP = clamp01(t / 0.55);
  // Resorte: entra con sobrepaso y se asienta.
  const spring = 1 - Math.exp(-6 * inP) * Math.cos(inP * Math.PI * 3.4);
  const out = 1 - easeInOut((t - (f.spec.duration - 0.3)) / 0.3);
  camera(f, 1 + 0.22 * spring * out);
}

export function tilt(f: FxFrame): void {
  const { spec } = f;
  const dir = spec.seed % 2 ? 1 : -1;
  camera(f, 1.02, ((dir * 4.5 * Math.PI) / 180) * ramp(f, 0.35, 0.35));
}

export function handheld(f: FxFrame): void {
  const { spec, t, u } = f;
  if (f.host.reducedMotion) return camera(f, 1.04);
  const k = ramp(f, 0.5, 0.5);
  camera(f, 1.05, wander(t, spec.seed + 3, 0.8) * 0.009 * k, wander(t, spec.seed, 0.9) * 12 * u * k, wander(t, spec.seed + 9, 0.7) * 10 * u * k);
}

export function pushIn(f: FxFrame): void {
  camera(f, 1 + 0.18 * easeInOut(f.t / f.spec.duration));
}

export function snapZoom(f: FxFrame): void {
  const at = f.spec.marks[0] ?? Math.min(0.3, f.spec.duration * 0.2);
  const on = f.t >= at && f.t < f.spec.duration - 0.06;
  camera(f, on ? 1.45 : 1, 0, 0, 0, on && f.t - at < 0.05 ? "blur(2px)" : "none");
}

export function rollIn(f: FxFrame): void {
  const { spec, t } = f;
  const dir = spec.seed % 2 ? 1 : -1;
  const p = clamp01(t / 0.55);
  const e = backOut(p, 1.6);
  const rot = (dir * -14 * Math.PI * (1 - e)) / 180;
  camera(f, lerp(1.35, 1, easeOut(p)), rot, 0, 0, t < 0.18 ? `blur(${(6 * (1 - t / 0.18)).toFixed(1)}px)` : "none");
  void easeIn;
}
