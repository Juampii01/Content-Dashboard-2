/**
 * Looks y ambiente: viñeta, grano, fuga de luz, polvo, VHS, glitch, aberración cromática, monocromo de marca, duotono,
 * fondo desenfocado, destellos, cine, película cálida y brillo suave. Entran y salen con un fundido corto sobre el
 * video (no cortan de golpe el color). Las texturas son propias (ruido determinista).
 */
import { clamp01, easeOut, FxFrame, lerp, rgba, rng, type Xf } from "./core";
import { envelope, frameIndex, grainTile, mix, noShadow, sparklePath, tileOver, wander } from "./kit";

const ID: Xf = { s: 1, px: 0, py: 0, tx: 0, ty: 0 };

/** Fundido de los looks: 0,3 s de entrada y de salida. */
const look = (f: FxFrame) => envelope(f, 0.3, 0.3).a;

export function vignetteOver(f: FxFrame, strength: number, inner = 0.45): void {
  const { ctx, W, H } = f;
  if (strength <= 0) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const k = H / W;
  ctx.scale(1, k);
  const r = (W / 2) * Math.SQRT2 * 1.02;
  const g = ctx.createRadialGradient(0, 0, r * inner, 0, 0, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(-W / 2, -H / (2 * k), W, H / k);
  ctx.restore();
}

/** Separa los canales del cuadro: cada uno con su propia transformación (aberración, VHS, glitch). */
export function channelSplit(f: FxFrame, xfs: [Xf, Xf, Xf], alpha = 1, filter = "none"): void {
  const { ctx, W, H } = f;
  const out = f.layer("ch-out");
  out.ctx.fillStyle = "#000000";
  out.ctx.fillRect(0, 0, W, H);
  (["#ff0000", "#00ff00", "#0000ff"] as const).forEach((color, i) => {
    const l = f.layer(`ch${i}`);
    f.drawBase(l.ctx, xfs[i], filter);
    l.ctx.globalCompositeOperation = "multiply";
    l.ctx.fillStyle = color;
    l.ctx.fillRect(0, 0, W, H);
    l.ctx.globalCompositeOperation = "source-over";
    out.ctx.globalCompositeOperation = "lighter";
    out.ctx.drawImage(l.canvas, 0, 0, W, H);
    out.ctx.globalCompositeOperation = "source-over";
  });
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(out.canvas, 0, 0, W, H);
  ctx.restore();
}

// ─── Viñeta ────────────────────────────────────────────────────────────────

export function vignette(f: FxFrame): void {
  f.drawBase(f.ctx);
  vignetteOver(f, 0.7 * look(f), 0.38);
}

// ─── Grano de película ─────────────────────────────────────────────────────

export function filmGrain(f: FxFrame): void {
  const { ctx, spec, W, H } = f;
  const a = look(f);
  f.drawBase(ctx);
  f.drawBase(ctx, ID, "contrast(1.08) saturate(0.88)", a);
  const fi = frameIndex(f);
  const tile = grainTile(f, spec.seed, 256);
  tileOver(f, tile, 0.32 * a, "overlay", spec.seed + fi * 7919, 1.4);
  // Parpadeo leve de exposición.
  const r = rng(spec.seed + fi);
  const flick = (r() - 0.5) * 0.06 * a;
  ctx.fillStyle = flick > 0 ? `rgba(255,250,240,${flick})` : `rgba(0,0,0,${-flick})`;
  ctx.fillRect(0, 0, W, H);
  vignetteOver(f, 0.35 * a);
}

// ─── Fuga de luz ───────────────────────────────────────────────────────────

export function lightLeak(f: FxFrame): void {
  const { ctx, spec, t, W, H } = f;
  const a = look(f);
  f.drawBase(ctx);
  const r = rng(spec.seed);
  const blobs = [
    { c: "255,120,40", r: 0.9 },
    { c: "255,60,80", r: 0.7 },
    { c: "255,210,120", r: 0.6 },
  ];
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  blobs.forEach((b, i) => {
    const sp = 0.12 + r() * 0.1;
    const phase = r() * 6.28;
    const x = W * (0.5 + 0.7 * Math.sin(t * sp * 2 + phase) * (i % 2 ? -1 : 1));
    const y = H * (0.2 + 0.6 * r() + 0.08 * Math.cos(t * sp * 3 + phase));
    const rad = Math.max(W, H) * b.r;
    const pulse = 0.55 + 0.45 * Math.sin(t * 1.3 + phase);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${b.c},${0.55 * pulse * a})`);
    g.addColorStop(0.5, `rgba(${b.c},${0.18 * pulse * a})`);
    g.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
  ctx.restore();
}

// ─── Polvo y rayas ─────────────────────────────────────────────────────────

export function dust(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  const a = look(f);
  f.drawBase(ctx);
  f.drawBase(ctx, ID, "sepia(0.25) contrast(1.06)", a * 0.8);
  const fi = frameIndex(f);
  const r = rng(spec.seed + fi * 104729);
  ctx.save();
  ctx.globalAlpha *= a;
  const n = 10 + Math.floor(r() * 14);
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * H;
    const s = (1.5 + r() * 5) * u;
    ctx.fillStyle = r() < 0.7 ? `rgba(20,16,10,${0.5 + r() * 0.4})` : `rgba(255,255,240,${0.4 + r() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.5 + r()), r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Un pelo de vez en cuando.
  if (r() < 0.35) {
    const x = r() * W;
    const y = r() * H;
    ctx.strokeStyle = "rgba(20,16,10,0.55)";
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (r() - 0.5) * 120 * u, y + r() * 80 * u, x + (r() - 0.5) * 160 * u, y + r() * 120 * u, x + (r() - 0.5) * 90 * u, y + 150 * u);
    ctx.stroke();
  }
  // Rayas verticales que duran varios cuadros.
  const rs = rng(spec.seed + Math.floor(fi / 9) * 31);
  const scratches = Math.floor(rs() * 3);
  for (let i = 0; i < scratches; i++) {
    const x = rs() * W;
    ctx.fillStyle = `rgba(255,255,240,${0.12 + rs() * 0.2})`;
    ctx.fillRect(x + (r() - 0.5) * 6 * u, 0, (1 + rs() * 2) * u, H);
  }
  ctx.restore();
  vignetteOver(f, 0.4 * a);
}

// ─── VHS ───────────────────────────────────────────────────────────────────

export function vhs(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const a = look(f);
  f.drawBase(ctx);
  const fi = frameIndex(f);
  const r = rng(spec.seed + fi * 31);
  const shift = (6 + r() * 3) * u;
  channelSplit(f, [{ ...ID, tx: shift }, ID, { ...ID, tx: -shift * 0.6 }], a, "saturate(1.35) contrast(1.12) blur(1.2px)");
  ctx.save();
  ctx.globalAlpha *= a;
  // Líneas de barrido.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < H; y += 6 * u) ctx.fillRect(0, y, W, 2.2 * u);
  // Banda de "tracking" que baja.
  const by = ((t * 0.35 + (spec.seed % 100) / 100) % 1.2) * H - H * 0.1;
  const bh = 60 * u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, by, W, bh);
  ctx.clip();
  f.drawBase(ctx, { ...ID, tx: (r() - 0.5) * 40 * u }, "brightness(1.3)", 0.7);
  ctx.restore();
  tileOver(f, grainTile(f, spec.seed + 3, 128), 0.25, "overlay", spec.seed + fi * 13, 1);
  // Rótulos de cámara casera.
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6 * u * f.pixelScale;
  ctx.font = f.font(700, 46 * u, f.fonts.mono);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const top = (f.vertical ? 170 : 90) * u;
  const label = (spec.kicker || "REC").toLocaleUpperCase("es");
  if (label === "REC" && Math.floor(t * 1.5) % 2 === 0) {
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(76 * u, top - 16 * u, 14 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
  }
  ctx.fillText(label === "REC" ? "REC" : label, label === "REC" ? 104 * u : 64 * u, top);
  ctx.textAlign = "right";
  ctx.fillText("PLAY ▶", W - 64 * u, top);
  const secs = Math.floor(t);
  ctx.font = f.font(700, 40 * u, f.fonts.mono);
  ctx.fillText(`SP 0:00:${String(secs).padStart(2, "0")}`, W - 64 * u, H - (f.vertical ? 300 : 80) * u);
  noShadow(ctx);
  ctx.restore();
}

// ─── Glitch ────────────────────────────────────────────────────────────────

/** Intensidad del glitch en un cuadro: ráfagas cortas a ritmo irregular (determinista). */
export function glitchAmount(seed: number, fi: number): number {
  const r = rng(seed + Math.floor(fi / 3) * 977);
  const burst = r() < 0.38 ? 0.4 + r() * 0.6 : 0;
  return fi < 4 ? 1 : burst;
}

export function glitch(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  const a = look(f);
  f.drawBase(ctx);
  const fi = frameIndex(f);
  const k = glitchAmount(spec.seed, fi) * a;
  const r = rng(spec.seed + fi * 7);
  // Entre ráfagas queda una separación de color mínima (el look sigue presente).
  const sh = (5 + 24 * k) * u * Math.max(a, k);
  if (k <= 0.01) {
    channelSplit(f, [{ ...ID, tx: sh }, ID, { ...ID, tx: -sh }], a);
    return;
  }
  channelSplit(f, [{ ...ID, tx: sh }, ID, { ...ID, tx: -sh }], 1);
  // Tajadas corridas.
  const slices = 4 + Math.floor(r() * 6);
  for (let i = 0; i < slices; i++) {
    const y = r() * H;
    const h = (10 + r() * 90) * u;
    const dx = (r() - 0.5) * 160 * u * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, h);
    ctx.clip();
    f.drawBase(ctx, { ...ID, tx: dx }, r() < 0.3 ? "invert(1) hue-rotate(90deg)" : "none");
    ctx.restore();
  }
  // Bloques de color.
  for (let i = 0; i < 3; i++) {
    if (r() > 0.6 * k) continue;
    ctx.fillStyle = rgba(i % 2 ? spec.accent : "#ffffff", 0.35 + r() * 0.3);
    ctx.fillRect(r() * W, r() * H, (40 + r() * 220) * u, (8 + r() * 40) * u);
  }
}

// ─── Aberración cromática ──────────────────────────────────────────────────

export function chroma(f: FxFrame): void {
  const { ctx, t, W, H } = f;
  const a = look(f);
  f.drawBase(ctx);
  const k = (0.012 + 0.004 * Math.sin(t * 2.2)) * a;
  channelSplit(f, [{ s: 1 + k, px: W / 2, py: H / 2, tx: 0, ty: 0 }, ID, { s: 1 - k * 0.6, px: W / 2, py: H / 2, tx: 0, ty: 0 }], a);
  vignetteOver(f, 0.25 * a);
}

// ─── Monocromo de marca ────────────────────────────────────────────────────

export function bwAccent(f: FxFrame): void {
  const { ctx, spec, W, H } = f;
  const a = look(f);
  f.drawBase(ctx);
  const l = f.layer("mono");
  f.drawBase(l.ctx, ID, "grayscale(1) contrast(1.18) brightness(1.02)");
  l.ctx.globalCompositeOperation = "color";
  l.ctx.fillStyle = rgba(spec.accent, 0.62);
  l.ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.drawImage(l.canvas, 0, 0, W, H);
  ctx.restore();
  vignetteOver(f, 0.3 * a);
}

// ─── Duotono ───────────────────────────────────────────────────────────────

export function duotone(f: FxFrame): void {
  const { ctx, spec, W, H } = f;
  const a = look(f);
  f.drawBase(ctx);
  const l = f.layer("duo");
  f.drawBase(l.ctx, ID, "grayscale(1) contrast(1.35)");
  l.ctx.globalCompositeOperation = "lighten";
  l.ctx.fillStyle = mix(spec.bg, spec.accent, 0.18);
  l.ctx.fillRect(0, 0, W, H);
  l.ctx.globalCompositeOperation = "darken";
  l.ctx.fillStyle = mix(spec.accent, "#ffffff", 0.35);
  l.ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.drawImage(l.canvas, 0, 0, W, H);
  ctx.restore();
}

// ─── Fondo desenfocado ─────────────────────────────────────────────────────

export function bgBlur(f: FxFrame): void {
  const { ctx } = f;
  const a = look(f);
  f.drawBase(ctx);
  // Sin recorte todavía (vista previa), el desenfoque va más suave para que se vea dónde actúa.
  f.drawBase(ctx, { s: 1.03, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 }, "blur(22px) brightness(0.92)", a * (f.hasMask ? 1 : 0.5));
  f.drawPerson(ctx);
}

// ─── Destellos ─────────────────────────────────────────────────────────────

export function sparkles(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  const a = look(f);
  f.drawBase(ctx);
  const r = rng(spec.seed);
  const face = spec.face;
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  ctx.save();
  for (let i = 0; i < 16; i++) {
    const ang = r() * Math.PI * 2;
    const dist = (0.75 + r() * 0.9) * Math.max(face.w, face.h);
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 1.1;
    const period = 0.9 + r() * 1.1;
    const phase = r() * period;
    const q = ((t + phase) % period) / period;
    const tw = f.host.reducedMotion ? 0.7 : Math.sin(q * Math.PI) ** 2;
    const size = (14 + r() * 22) * u * tw;
    if (size < 1) continue;
    ctx.globalAlpha = a * tw;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(q * 1.2);
    ctx.shadowColor = spec.accent;
    ctx.shadowBlur = 24 * u * f.pixelScale;
    ctx.fillStyle = i % 3 ? "#ffffff" : mix(spec.accent, "#ffffff", 0.4);
    sparklePath(ctx, 0, 0, size);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ─── Cine ──────────────────────────────────────────────────────────────────

export function letterbox(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const { inP, outP } = envelope(f, 0.5, 0.45);
  const k = inP * (1 - outP);
  f.drawBase(ctx);
  f.drawBase(ctx, { s: 1.02, px: W / 2, py: H / 2, tx: 0, ty: 0 }, "contrast(1.12) saturate(0.92)", k);
  const bar = H * (f.vertical ? 0.11 : 0.12) * k;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
  if (spec.kicker) {
    ctx.save();
    ctx.globalAlpha *= easeOut((t - 0.6) / 0.5) * (1 - outP);
    ctx.font = f.font(500, 30 * u, f.fonts.mono);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = spec.kicker.toLocaleUpperCase("es").split("").join(" ");
    ctx.fillText(text, W / 2, H - bar / 2);
    ctx.restore();
  }
}

// ─── Película cálida ───────────────────────────────────────────────────────

export function warmFilm(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const a = look(f);
  f.drawBase(ctx);
  const weave = f.host.reducedMotion ? 0 : 1;
  const xf: Xf = { s: 1.02, px: W / 2, py: H / 2, tx: wander(t * 3, spec.seed) * 2 * u * weave, ty: wander(t * 3, spec.seed + 5) * 3 * u * weave };
  f.drawBase(ctx, xf, "sepia(0.32) saturate(1.18) contrast(1.06) brightness(1.04)", a);
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = `rgba(255,150,60,${0.28 * a})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  tileOver(f, grainTile(f, spec.seed + 1, 256), 0.18 * a, "overlay", spec.seed + frameIndex(f) * 17, 1.6);
  vignetteOver(f, 0.45 * a);
}

// ─── Brillo suave ──────────────────────────────────────────────────────────

export function dreamyGlow(f: FxFrame): void {
  const { ctx } = f;
  const a = look(f);
  f.drawBase(ctx);
  const l = f.layer("glow", 0.5);
  f.drawBase(l.ctx, ID, "brightness(1.15) contrast(1.25) blur(18px)", 1, 0.5);
  ctx.save();
  ctx.globalAlpha *= 0.55 * a;
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(l.canvas, 0, 0, f.W, f.H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= 0.06 * a;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, f.W, f.H);
  ctx.restore();
  void clamp01;
  void lerp;
}
