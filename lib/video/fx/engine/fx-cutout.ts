/**
 * Efectos con tu recorte (la máscara de la persona que arma el worker): texto detrás de ti, contorno brillante, sombra,
 * eco, fondo de marca, fondo en blanco y negro, clones y sticker. Sin recorte (vista previa mientras se calcula), lo de
 * detrás se ve tenue y la persona no se duplica.
 */
import { backOut, clamp01, easeOut, FxFrame, IDENTITY, lerp, letterOffsets, rgba, rng, type Xf } from "./core";
import { brandBackdrop } from "./fx-frames";
import { displayFamily, envelope, fitFont, mix, noShadow } from "./kit";

// ─── Texto detrás de ti ────────────────────────────────────────────────────

export function textBehind(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const xf: Xf = { s: lerp(1.04, 1, clamp01(t / spec.duration)), px: W / 2, py: H / 2, tx: 0, ty: 0 };
  f.drawBase(ctx, xf);
  const word = (spec.text || "AHORA").toLocaleUpperCase("es");
  const fam = displayFamily(f);
  const fit = fitFont(f, word, 900, fam, W * 0.96, f.vertical ? 330 : 380, 60);
  const face = spec.face;
  const baseline = Math.min(H * 0.62, Math.max(fit.size * 0.9 + H * 0.06, face.y + face.h * 0.95));
  const { a } = envelope(f, 0.05, 0.3);
  f.behind(() => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fit.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const g = ctx.createLinearGradient(0, baseline - fit.size, 0, baseline);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, mix("#ffffff", spec.accent, 0.55));
    const letters = letterOffsets(ctx, word);
    const x0 = (W - fit.width) / 2;
    letters.forEach((l, i) => {
      const p = easeOut((t - 0.08 - i * 0.05) / 0.45);
      if (p <= 0) return;
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.fillStyle = g;
      ctx.fillText(l.ch, x0 + l.x, baseline + (1 - p) * 90 * u);
      ctx.restore();
    });
    ctx.restore();
  });
  f.drawPerson(ctx, xf);
}

// ─── Contorno brillante ────────────────────────────────────────────────────

export function glowOutline(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const { a } = envelope(f, 0.25, 0.3);
  const pulse = f.host.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 5);
  const sil = f.silhouette("glow-sil", mix(spec.accent, "#ffffff", 0.2), 9 * u, IDENTITY, 0, spec.seed);
  if (sil) {
    ctx.save();
    ctx.globalAlpha *= a * pulse;
    ctx.shadowColor = spec.accent;
    ctx.shadowBlur = 50 * u * f.pixelScale;
    ctx.drawImage(sil.canvas, 0, 0, W, H);
    ctx.shadowBlur = 22 * u * f.pixelScale;
    ctx.drawImage(sil.canvas, 0, 0, W, H);
    noShadow(ctx);
    ctx.restore();
  }
  f.drawPerson(ctx);
}

// ─── Sombra ────────────────────────────────────────────────────────────────

export function dropShadow(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const { a, inP } = envelope(f, 0.35, 0.3);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
  ctx.fillRect(0, 0, W, H);
  const off = 46 * u * inP;
  const sil = f.silhouette("shadow-sil", mix(spec.accent, "#000000", 0.35), 0, { s: 1, px: 0, py: 0, tx: off, ty: off * 0.6 }, 0, spec.seed, 0.5);
  if (sil) {
    ctx.save();
    ctx.globalAlpha *= 0.75 * a;
    ctx.filter = f.scaleFilter("blur(10px)");
    ctx.drawImage(sil.canvas, 0, 0, W, H);
    ctx.restore();
  }
  f.drawPerson(ctx);
  void t;
}

// ─── Eco ───────────────────────────────────────────────────────────────────

export function echo(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const { a } = envelope(f, 0.2, 0.3);
  const spread = easeOut(t / 0.5) * (f.host.reducedMotion ? 0.6 : 0.85 + 0.15 * Math.sin(t * 4));
  const dir = f.faceCx < W / 2 ? 1 : -1;
  f.behind(() => {
    for (let i = 3; i >= 1; i--) {
      const sil = f.silhouette(`echo${i}`, i % 2 ? spec.accent : "#ffffff", 0, { s: 1, px: 0, py: 0, tx: dir * 70 * u * i * spread, ty: 0 }, 0, spec.seed, 0.5);
      if (!sil) continue;
      ctx.save();
      ctx.globalAlpha *= a * (0.5 - i * 0.12);
      ctx.drawImage(sil.canvas, 0, 0, W, H);
      ctx.restore();
    }
  });
  f.drawPerson(ctx);
}

// ─── Fondo de marca ────────────────────────────────────────────────────────

export function bgBrand(f: FxFrame): void {
  const { ctx } = f;
  const { a } = envelope(f, 0.3, 0.3);
  f.drawBase(ctx);
  f.behind(() => brandBackdrop(f, a));
  f.drawPerson(ctx);
}

// ─── Fondo en blanco y negro ───────────────────────────────────────────────

export function bgBw(f: FxFrame): void {
  const { ctx } = f;
  const { a } = envelope(f, 0.3, 0.3);
  f.drawBase(ctx);
  f.behind(() => f.drawBase(ctx, IDENTITY, "grayscale(1) contrast(1.12) brightness(0.9)", a));
  f.drawPerson(ctx);
}

// ─── Clones ────────────────────────────────────────────────────────────────

export function cloneTrio(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const { a } = envelope(f, 0.05, 0.3);
  const r = rng(spec.seed);
  f.behind(() => {
    [-1, 1].forEach((side, i) => {
      const p = backOut(clamp01((t - 0.1 - i * 0.15) / 0.4), 1.8);
      if (p <= 0) return;
      const s = 0.78;
      const xf: Xf = { s, px: f.faceCx, py: H, tx: side * W * 0.3 * p, ty: -20 * u * r() };
      const l = f.personLayer(xf);
      if (!l) return;
      ctx.save();
      ctx.globalAlpha *= a * clamp01(p * 2);
      ctx.filter = i ? "saturate(0.6) brightness(0.92)" : "grayscale(0.3) brightness(0.96)";
      ctx.drawImage(l.canvas, 0, 0, W, H);
      ctx.restore();
    });
  });
  f.drawPerson(ctx);
}

// ─── Sticker ───────────────────────────────────────────────────────────────

export function stickerCutout(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const { a } = envelope(f, 0.05, 0.3);
  f.drawBase(ctx);
  f.behind(() => {
    brandBackdrop(f, a);
    // Lunares de la marca.
    ctx.save();
    ctx.globalAlpha *= a * 0.5;
    ctx.fillStyle = rgba(spec.accent, 0.35);
    for (let y = 40 * u; y < H; y += 120 * u) for (let x = (Math.round(y / (120 * u)) % 2) * 60 * u; x < W; x += 120 * u) {
      ctx.beginPath();
      ctx.arc(x, y, 12 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  const pop = lerp(0.86, 1, backOut(clamp01(t / 0.4), 2));
  const wob = f.host.reducedMotion ? 0 : Math.sin(t * 2.2) * 0.02;
  const xf: Xf = { s: pop, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0, rot: -0.04 + wob };
  if (f.hasMask) {
    const border = f.silhouette("sticker-b", "#ffffff", 18 * u, xf, 0, spec.seed);
    if (border) {
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 30 * u * f.pixelScale;
      ctx.shadowOffsetY = 14 * u * f.pixelScale;
      ctx.drawImage(border.canvas, 0, 0, W, H);
      ctx.restore();
    }
    f.drawPerson(ctx, xf);
  }
}
