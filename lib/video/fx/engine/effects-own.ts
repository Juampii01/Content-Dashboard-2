/**
 * Efectos de diseño propio (a partir de una descripción corta): giro 3D, pared de capturas, ventana de tu app, sales del
 * cuadro, corte con zoom, zoom out, pantalla verde, recorte de papel, garabatos y vértigo.
 */
import { backOut, bounce, clamp, clamp01, easeIn, easeInOut, easeOut, fitSize, FxFrame, IDENTITY, lerp, rgba, rng, roundRect, wrap, type FxCtx, type ImageLike, type Xf } from "./core";

const exitAlpha = (f: FxFrame, len = 0.25) => clamp01((f.spec.duration - f.t) / len);

function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(pa);
  const [r2, g2, b2] = ch(pb);
  const m = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `#${[m(r1!, r2!), m(g1!, g2!), m(b1!, b2!)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Una tarjeta de "tu reel": la miniatura recortada al marco o, si no hay, una tarjeta con tu marca. */
function reelCard(f: FxFrame, ctx: FxCtx, i: number, x: number, y: number, w: number, h: number, r: number): void {
  const { spec, u } = f;
  const img = f.image(spec.thumbs[i % Math.max(1, spec.thumbs.length)] ?? "");
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (img && img.width > 0) {
    const k = Math.max(w / img.width, h / img.height);
    const dw = img.width * k;
    const dh = img.height * k;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    const g = ctx.createLinearGradient(0, y + h * 0.6, 0, y + h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, mixHex(spec.accent, "#000000", 0.15 + (i % 3) * 0.12));
    g.addColorStop(1, mixHex(spec.bg, spec.accent, 0.18));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f.font(500, 22 * u * (w / (200 * u)), f.fonts.mono);
    ctx.fillText(`REEL ${String(i + 1).padStart(2, "0")}`, x + w * 0.1, y + h * 0.14);
    const title = spec.cards[i] ?? "";
    if (title) {
      ctx.font = f.font(800, 30 * u * (w / (200 * u)), f.fonts.sans);
      wrap(ctx, title, w * 0.8, 4).forEach((line, k) => ctx.fillText(line, x + w * 0.1, y + h * 0.62 + k * 34 * u * (w / (200 * u))));
    }
    // Botón de play.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.44, y + h * 0.36);
    ctx.lineTo(x + w * 0.44, y + h * 0.48);
    ctx.lineTo(x + w * 0.58, y + h * 0.42);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ─── 01 Giro 3D ───────────────────────────────────────────────────────────

export function orbit(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const n = Math.max(5, Math.min(8, spec.thumbs.length || 6));
  const cx = f.faceCx;
  const cy = clamp(f.faceCy + spec.face.h * 0.75, H * 0.25, H * 0.58);
  const rx = W * (f.vertical ? 0.46 : 0.3);
  const ry = H * (f.vertical ? 0.11 : 0.16);
  const grow = easeOut(t / 0.7) * (1 - easeIn(clamp01((t - (spec.duration - 0.35)) / 0.35)));
  const speed = f.host.reducedMotion ? 0 : 0.2;
  const base = t * Math.PI * 2 * speed + (spec.seed % 100) / 50;
  const cw = W * (f.vertical ? 0.25 : 0.13);
  const ch = cw * 1.6;
  const cards = Array.from({ length: n }, (_, i) => {
    const a = base + (i * Math.PI * 2) / n;
    const z = Math.cos(a);
    return { i, a, z, x: cx + Math.sin(a) * rx * grow, y: cy - z * ry * grow, s: (0.7 + 0.3 * (z + 1) / 2) * (0.4 + 0.6 * grow) };
  });
  const draw = (c: (typeof cards)[number]) => {
    const squash = 0.55 + 0.45 * Math.abs(Math.cos(c.a));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(c.s * squash, c.s);
    ctx.globalAlpha *= (c.z < 0 ? 0.82 : 1) * clamp01(grow * 1.6);
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 26 * u * f.pixelScale;
    ctx.shadowOffsetY = 12 * u * f.pixelScale;
    roundRect(ctx, -cw / 2 - 5 * u, -ch / 2 - 5 * u, cw + 10 * u, ch + 10 * u, 22 * u);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    reelCard(f, ctx, c.i, -cw / 2, -ch / 2, cw, ch, 18 * u);
    if (c.z < 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.25 * -c.z})`;
      roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 18 * u);
      ctx.fill();
    }
    ctx.restore();
  };
  const back = cards.filter((c) => c.z < 0).sort((a, b) => a.z - b.z);
  const front = cards.filter((c) => c.z >= 0).sort((a, b) => a.z - b.z);
  f.behind(() => back.forEach(draw));
  f.drawPerson(ctx);
  front.forEach(draw);
}

// ─── 02 Pared de capturas ─────────────────────────────────────────────────

export function couchWall(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const n = Math.max(4, Math.min(6, spec.thumbs.length || 6));
  const r = rng(spec.seed);
  const cols = 3;
  const cw = W * (f.vertical ? 0.27 : 0.15);
  const chh = cw * 1.3;
  const top = H * (f.vertical ? 0.1 : 0.08);
  const gapY = chh + 40 * u;
  const exit = exitAlpha(f);
  f.behind(() => {
    for (let i = 0; i < n; i++) {
      const p = (t - 0.1 - i * 0.12) / 0.35;
      if (p <= 0) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = W / 2 + (col - 1) * (cw + (f.vertical ? 48 : 120) * u) + (r() - 0.5) * 30 * u;
      const y = top + row * gapY + chh / 2 + (r() - 0.5) * 30 * u;
      const rot = (r() - 0.5) * 0.18;
      const sc = lerp(1.18, 1, backOut(clamp01(p)));
      ctx.save();
      ctx.globalAlpha *= clamp01(p * 3) * exit;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      // Foto con borde blanco y sombra.
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 24 * u * f.pixelScale;
      ctx.shadowOffsetY = 12 * u * f.pixelScale;
      ctx.fillStyle = "#fbfaf7";
      ctx.fillRect(-cw / 2 - 12 * u, -chh / 2 - 12 * u, cw + 24 * u, chh + 24 * u);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      reelCard(f, ctx, i, -cw / 2, -chh / 2, cw, chh, 4 * u);
      // Cinta.
      ctx.rotate((r() - 0.5) * 0.3);
      ctx.fillStyle = "rgba(240,228,196,0.78)";
      ctx.fillRect(-cw * 0.22, -chh / 2 - 30 * u, cw * 0.44, 40 * u);
      ctx.restore();
    }
  });
  f.drawPerson(ctx);
}

// ─── 03 Ventana de tu app ─────────────────────────────────────────────────

export function uiWorld(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const x = W * (f.vertical ? 0.06 : 0.12);
  const w = W - x * 2;
  const y = H * (f.vertical ? 0.07 : 0.08);
  const h = H * (f.vertical ? 0.4 : 0.62);
  const enter = easeOut(t / 0.35);
  const exit = exitAlpha(f);
  const surface = mixHex(spec.bg, "#ffffff", 0.06);
  f.behind(() => {
    ctx.save();
    ctx.globalAlpha *= enter * exit;
    const s = lerp(0.95, 1, enter);
    ctx.translate(W / 2, y + h / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(y + h / 2));
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 50 * u * f.pixelScale;
    ctx.shadowOffsetY = 24 * u * f.pixelScale;
    roundRect(ctx, x, y, w, h, 34 * u);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = rgba(spec.accent, 0.35);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    // Barra de título con la marca (sin logos de terceros).
    const bar = 78 * u;
    ctx.save();
    roundRect(ctx, x, y, w, h, 34 * u);
    ctx.clip();
    ctx.fillStyle = mixHex(surface, "#ffffff", 0.05);
    ctx.fillRect(x, y, w, bar);
    ctx.restore();
    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    ctx.arc(x + 46 * u, y + bar / 2, 12 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(spec.ink, 0.92);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = f.font(700, 30 * u, f.fonts.sans);
    ctx.fillText(spec.kicker || "Tu estudio", x + 72 * u, y + bar / 2);
    ctx.fillStyle = rgba(spec.muted, 0.8);
    ctx.font = f.font(500, 22 * u, f.fonts.mono);
    ctx.textAlign = "right";
    ctx.fillText("● en vivo", x + w - 34 * u, y + bar / 2);
    // Zona donde caen los clips.
    const zx = x + 34 * u;
    const zy = y + bar + 28 * u;
    const zw = w - 68 * u;
    const zh = h - bar - 28 * u - 150 * u;
    ctx.save();
    ctx.setLineDash([14 * u, 10 * u]);
    ctx.strokeStyle = rgba(spec.ink, 0.22);
    ctx.lineWidth = 2.5 * u;
    roundRect(ctx, zx, zy, zw, zh, 22 * u);
    ctx.stroke();
    ctx.restore();
    const n = 4;
    const cw = (zw - 40 * u - (n - 1) * 22 * u) / n;
    const chh = Math.min(zh - 40 * u, cw * 1.55);
    for (let i = 0; i < n; i++) {
      const at = 0.35 + i * 0.16;
      const p = (t - at) / 0.55;
      if (p <= 0) continue;
      const fall = bounce(clamp01(p));
      const cx = zx + 20 * u + i * (cw + 22 * u);
      const cyEnd = zy + (zh - chh) / 2;
      const cy = lerp(y - chh * 1.2, cyEnd, fall);
      ctx.save();
      ctx.translate(cx + cw / 2, cy + chh / 2);
      ctx.rotate((1 - clamp01(p * 1.3)) * (i % 2 ? 0.2 : -0.2));
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 18 * u * f.pixelScale;
      reelCard(f, ctx, i, -cw / 2, -chh / 2, cw, chh, 14 * u);
      ctx.restore();
    }
    // Línea de comando: se escribe y se ejecuta.
    const cmd = spec.text || "edita mis clips con mi marca";
    const typeStart = 0.35 + n * 0.16 + 0.3;
    const chars = Math.floor(clamp01((t - typeStart) / (cmd.length * 0.035)) * cmd.length);
    const ly = y + h - 112 * u;
    roundRect(ctx, zx, ly, zw, 74 * u, 18 * u);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.fillStyle = spec.accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = f.font(700, 30 * u, f.fonts.mono);
    ctx.fillText("›", zx + 24 * u, ly + 37 * u);
    ctx.fillStyle = rgba(spec.ink, 0.95);
    ctx.font = f.font(500, 28 * u, f.fonts.mono);
    const shown = cmd.slice(0, chars);
    ctx.fillText(shown, zx + 58 * u, ly + 37 * u);
    const typed = t >= typeStart + cmd.length * 0.035;
    if (!typed || Math.floor(t * 2.5) % 2 === 0) {
      const cw2 = ctx.measureText(shown).width;
      ctx.fillStyle = rgba(spec.ink, 0.85);
      ctx.fillRect(zx + 62 * u + cw2, ly + 20 * u, 14 * u, 34 * u);
    }
    // Barra de progreso al ejecutar.
    const run = clamp01((t - typeStart - cmd.length * 0.035 - 0.2) / 0.9);
    if (run > 0) {
      ctx.fillStyle = rgba(spec.ink, 0.12);
      roundRect(ctx, zx, y + h - 26 * u, zw, 8 * u, 4 * u);
      ctx.fill();
      ctx.fillStyle = spec.accent;
      roundRect(ctx, zx, y + h - 26 * u, zw * easeInOut(run), 8 * u, 4 * u);
      ctx.fill();
    }
    ctx.restore();
  });
  f.drawPerson(ctx);
}

// ─── 04 Sales del cuadro ──────────────────────────────────────────────────

function wall(f: FxFrame, ctx: FxCtx, color: string): void {
  const { W, H, spec, u } = f;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  // Textura de yeso (puntos tenues con semilla fija) y luz desde arriba.
  const r = rng(spec.seed ^ 0x9e3779b9);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    const s = (1 + r() * 3) * u;
    ctx.fillRect(r() * W, r() * H, s, s);
  }
  const g = ctx.createRadialGradient(W / 2, H * 0.2, 10 * u, W / 2, H * 0.4, H * 0.8);
  g.addColorStop(0, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export function frameBreak(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const p1 = easeInOut(t / 0.65);
  const S = lerp(1, f.vertical ? 0.64 : 0.58, p1);
  const cy = lerp(H / 2, H * (f.vertical ? 0.44 : 0.47), p1);
  const xf: Xf = { s: S, px: W / 2, py: H / 2, tx: 0, ty: cy - H / 2 };
  const pw = W * S;
  const ph = H * S;
  const px = (W - pw) / 2;
  const py = cy - ph / 2;
  const wallColor = mixHex("#cdc3b1", spec.accent, 0.06);
  wall(f, ctx, wallColor);
  const border = 44 * u * p1;
  // Alambre y clavo.
  if (p1 > 0.4) {
    ctx.save();
    ctx.globalAlpha = clamp01((p1 - 0.4) / 0.4);
    ctx.strokeStyle = "rgba(40,30,20,0.6)";
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.25, py - border * 0.5);
    ctx.lineTo(W / 2, py - border - 90 * u);
    ctx.lineTo(px + pw * 0.75, py - border * 0.5);
    ctx.stroke();
    ctx.fillStyle = "#3b2f25";
    ctx.beginPath();
    ctx.arc(W / 2, py - border - 90 * u, 9 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Sombra del cuadro en la pared.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 50 * u * f.pixelScale * p1;
  ctx.shadowOffsetY = 26 * u * f.pixelScale * p1;
  ctx.fillStyle = "#2a1d12";
  ctx.fillRect(px - border, py - border, pw + border * 2, ph + border * 2);
  ctx.restore();
  // Marco de madera con filete dorado.
  if (border > 0.5) {
    const g = ctx.createLinearGradient(px - border, py - border, px + pw + border, py + ph + border);
    g.addColorStop(0, "#6b4a2b");
    g.addColorStop(0.5, "#3d2817");
    g.addColorStop(1, "#5a3c22");
    ctx.fillStyle = g;
    ctx.fillRect(px - border, py - border, pw + border * 2, ph + border * 2);
    ctx.strokeStyle = "rgba(226,190,120,0.75)";
    ctx.lineWidth = 4 * u;
    ctx.strokeRect(px - 6 * u, py - 6 * u, pw + 12 * u, ph + 12 * u);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(px - border + 3 * u, py - border + 3 * u, pw + border * 2 - 6 * u, ph + border * 2 - 6 * u);
  }
  // La foto adentro del marco.
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  f.drawBase(ctx, xf);
  ctx.restore();
  // Te sales del marco: tu figura crece desde la base del cuadro y queda por delante del borde.
  const p2 = easeOut((t - 0.85) / 0.75);
  if (p2 > 0 && f.hasMask) {
    const grow = 1 + 0.34 * p2;
    const bottom = py + ph;
    const out: Xf = { s: S * grow, px: W / 2, py: H, tx: 0, ty: bottom - H + 30 * u * p2 };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40 * u * f.pixelScale;
    ctx.shadowOffsetY = 18 * u * f.pixelScale;
    f.drawPerson(ctx, out);
    ctx.restore();
  }
}

// ─── 09 Corte con zoom ────────────────────────────────────────────────────

export function zoomCut(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  const c = spec.cut ?? spec.duration / 2;
  let k: number;
  if (t < c) k = easeIn(t / Math.max(0.05, c));
  else k = 1 - easeOut((t - c) / Math.max(0.05, spec.duration - c));
  const s = 1 + 1.3 * k;
  const blur = 22 * k;
  const xf = (extra: number): Xf => ({ s: s * (1 + extra * k), px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 });
  f.drawBase(ctx, xf(0), blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none");
  // Estela radial: copias un poco más grandes y transparentes.
  if (k > 0.05) {
    for (let i = 1; i <= 2; i++) f.drawBase(ctx, xf(0.06 * i), `blur(${(blur + 6 * i).toFixed(1)}px)`, 0.35 * k);
  }
  // Destello mínimo justo en el corte.
  const flash = 1 - clamp01(Math.abs(t - c) / 0.1);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.18 * flash})`;
    ctx.fillRect(0, 0, f.W, f.H);
  }
  void u;
}

// ─── 11 Zoom out ──────────────────────────────────────────────────────────

export function zoomOut(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const p = easeInOut(t / 0.9);
  const S = lerp(1, f.vertical ? 0.62 : 0.6, p);
  const scr = { cx: W / 2, cy: lerp(H / 2, H * (f.vertical ? 0.4 : 0.44), p) };
  // Fondo de la marca con grilla y brillo (estética del producto).
  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.1, 0, W / 2, H * 0.1, H * 0.7);
  glow.addColorStop(0, rgba(spec.accent, 0.28));
  glow.addColorStop(1, rgba(spec.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = rgba(spec.ink, 0.05);
  ctx.lineWidth = 1.5 * u;
  for (let gx = 0; gx < W; gx += 48 * u) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();
  }
  for (let gy = 0; gy < H; gy += 48 * u) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
  }
  const sw = W * S;
  const sh = H * S;
  const sx = scr.cx - sw / 2;
  const sy = scr.cy - sh / 2;
  const bar = 56 * u * p;
  const win = { x: sx - 16 * u * p, y: sy - bar - 16 * u * p, w: sw + 32 * u * p, h: sh + bar + 32 * u * p };
  // Ventana.
  ctx.save();
  ctx.globalAlpha = clamp01(p * 1.5);
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 60 * u * f.pixelScale;
  ctx.shadowOffsetY = 28 * u * f.pixelScale;
  roundRect(ctx, win.x, win.y, win.w, win.h, 30 * u * p);
  ctx.fillStyle = mixHex(spec.bg, "#ffffff", 0.08);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = rgba(spec.accent, 0.4);
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  if (bar > 4 * u) {
    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    ctx.arc(win.x + 36 * u, win.y + 16 * u * p + bar / 2, 9 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(spec.ink, 0.9);
    ctx.font = f.font(700, 24 * u, f.fonts.sans);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(spec.text || "Editando tu reel", win.x + 58 * u, win.y + 16 * u * p + bar / 2);
    const pct = Math.min(99, Math.round(clamp01((t - 0.6) / Math.max(1, spec.duration - 0.8)) * 100));
    ctx.textAlign = "right";
    ctx.fillStyle = spec.accent;
    ctx.font = f.font(600, 22 * u, f.fonts.mono);
    ctx.fillText(`${pct}%`, win.x + win.w - 30 * u, win.y + 16 * u * p + bar / 2);
  }
  ctx.restore();
  // El video adentro de la pantalla (la cámara se aleja de tu cara).
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, 18 * u * p);
  ctx.clip();
  f.drawBase(ctx, { s: S, px: W / 2, py: H / 2, tx: scr.cx - W / 2, ty: scr.cy - H / 2 });
  ctx.restore();
  // Línea de tiempo trabajando debajo de la pantalla.
  const q = clamp01((p - 0.55) / 0.45);
  if (q > 0) {
    const tx = win.x;
    const tw = win.w;
    const ty = win.y + win.h + 40 * u;
    ctx.save();
    ctx.globalAlpha = q * exitAlpha(f);
    const tracks = [
      { c: spec.accent, segs: [0.02, 0.3, 0.34, 0.62, 0.66, 0.97] },
      { c: mixHex(spec.accent, "#ffffff", 0.45), segs: [0.1, 0.24, 0.5, 0.7] },
      { c: rgba(spec.ink, 0.5), segs: [0.0, 1.0] },
    ];
    tracks.forEach((tr, k) => {
      const yy = ty + k * 46 * u;
      ctx.fillStyle = rgba(spec.ink, 0.06);
      roundRect(ctx, tx, yy, tw, 32 * u, 8 * u);
      ctx.fill();
      ctx.fillStyle = tr.c;
      for (let s = 0; s + 1 < tr.segs.length; s += 2) {
        roundRect(ctx, tx + tw * tr.segs[s]!, yy + 4 * u, tw * (tr.segs[s + 1]! - tr.segs[s]!), 24 * u, 6 * u);
        ctx.fill();
      }
    });
    const head = tx + tw * clamp01((t - 0.6) / Math.max(1, spec.duration - 0.6));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(head - 1.5 * u, ty - 12 * u, 3 * u, 46 * 3 * u + 4 * u);
    ctx.beginPath();
    ctx.arc(head, ty - 14 * u, 8 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── 12 Pantalla verde ────────────────────────────────────────────────────

function parseTimer(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? Math.min(5999, n * 60) : 1500;
}

export function greenScreen(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const reveal = easeOut(t / 0.45);
  const rmax = Math.hypot(W, H);
  const app = f.layer("gs-app");
  const a = app.ctx;
  // Fondo de la app: color de la marca, brillo arriba.
  a.fillStyle = spec.bg;
  a.fillRect(0, 0, W, H);
  const g = a.createRadialGradient(W / 2, H * 0.22, 0, W / 2, H * 0.22, H * 0.6);
  g.addColorStop(0, rgba(spec.accent, 0.32));
  g.addColorStop(1, rgba(spec.accent, 0));
  a.fillStyle = g;
  a.fillRect(0, 0, W, H);
  // Encabezado.
  a.fillStyle = spec.accent;
  a.beginPath();
  a.arc(W * 0.08 + 10 * u, H * 0.07, 10 * u, 0, Math.PI * 2);
  a.fill();
  a.fillStyle = rgba(spec.ink, 0.85);
  a.textAlign = "left";
  a.textBaseline = "middle";
  a.font = f.font(600, 28 * u, f.fonts.mono);
  a.fillText("ENFOQUE", W * 0.08 + 34 * u, H * 0.07);
  // Temporizador gigante (cuenta regresiva real, segundo a segundo).
  const total = parseTimer(spec.text || "25:00");
  const left = Math.max(0, total - Math.floor(t));
  const label = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  const size = fitSize(a, "00:00", (s) => f.font(800, s, f.fonts.sans), W * 0.9, H * (f.vertical ? 0.19 : 0.34));
  a.font = f.font(800, size, f.fonts.sans);
  a.textAlign = "center";
  a.textBaseline = "alphabetic";
  a.fillStyle = spec.ink;
  const ty = H * (f.vertical ? 0.27 : 0.42);
  a.fillText(label, W / 2, ty);
  // Barra de progreso del bloque.
  const bw = W * 0.7;
  a.fillStyle = rgba(spec.ink, 0.12);
  roundRect(a, (W - bw) / 2, ty + 34 * u, bw, 12 * u, 6 * u);
  a.fill();
  a.fillStyle = spec.accent;
  roundRect(a, (W - bw) / 2, ty + 34 * u, bw * (1 - left / Math.max(1, total)) + bw * 0.04, 12 * u, 6 * u);
  a.fill();
  // Tareas (se tildan cuando las dices).
  const items = spec.items.slice(0, 3);
  const freeRight = f.faceCx <= W / 2;
  const safe = f.faceSafe;
  const cw = Math.max(W * 0.26, Math.min(W * 0.4, freeRight ? W - (safe.x + safe.w) - 40 * u : safe.x - 40 * u));
  const chipX = freeRight ? W - cw - 32 * u : 32 * u;
  items.forEach((item, i) => {
    const ch = 92 * u;
    const cy = clamp(safe.y, H * 0.36, H * 0.5) + i * (ch + 18 * u);
    const cx = chipX;
    roundRect(a, cx, cy, cw, ch, 24 * u);
    a.fillStyle = mixHex(spec.bg, "#ffffff", 0.12);
    a.fill();
    a.strokeStyle = rgba(spec.ink, 0.1);
    a.lineWidth = 2 * u;
    a.stroke();
    const at = spec.marks[i] ?? 0.8 + i * 0.7;
    const p = (t - at) / 0.4;
    a.save();
    a.translate(cx + 44 * u, cy + ch / 2);
    if (p > 0) {
      const sc = bounce(p);
      a.scale(sc, sc);
      a.fillStyle = spec.accent;
      a.beginPath();
      a.arc(0, 0, 19 * u, 0, Math.PI * 2);
      a.fill();
    } else {
      a.strokeStyle = rgba(spec.ink, 0.4);
      a.lineWidth = 3 * u;
      a.beginPath();
      a.arc(0, 0, 19 * u, 0, Math.PI * 2);
      a.stroke();
    }
    a.restore();
    a.fillStyle = rgba(spec.ink, p > 0 ? 0.6 : 0.95);
    a.textAlign = "left";
    a.textBaseline = "middle";
    const fs = fitSize(a, item, (s) => f.font(600, s, f.fonts.sans), cw - 100 * u, 32 * u);
    a.font = f.font(600, fs, f.fonts.sans);
    a.fillText(item, cx + 78 * u, cy + ch / 2 + 1 * u);
  });
  // Entra con un círculo que se abre desde la cara.
  const exit = exitAlpha(f, 0.3);
  ctx.save();
  if (spec.mask && !f.hasMask) ctx.globalAlpha *= 0.5;
  ctx.globalAlpha *= exit;
  ctx.beginPath();
  ctx.arc(f.faceCx, f.faceCy, rmax * reveal, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(app.canvas, 0, 0, W, H);
  ctx.restore();
  f.drawPerson(ctx);
}

// ─── 13 Recorte de papel ──────────────────────────────────────────────────

export function paperCut(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const reduced = f.host.reducedMotion;
  const step = reduced ? 0 : Math.floor(t * 8);
  const enter = easeOut(t / 0.3);
  // Fondo de papel (con la marca): crema con fibras y papeles rotos.
  const paper = mixHex("#efe6d4", spec.accent, 0.05);
  ctx.save();
  f.drawBase(ctx);
  ctx.globalAlpha = enter * (f.spec.mask && !f.hasMask ? 0.5 : 1);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  const r = rng(spec.seed);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = r() < 0.5 ? "rgba(120,100,70,0.08)" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = (0.6 + r()) * u;
    const x = r() * W;
    const y = r() * H;
    const a = r() * Math.PI;
    const l = (8 + r() * 26) * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  const torn = [spec.accent, "#1d1b18", mixHex(spec.accent, "#ffffff", 0.55)];
  torn.forEach((c, k) => {
    ctx.fillStyle = c;
    ctx.globalAlpha = enter * 0.92;
    ctx.beginPath();
    const cx = W * (k === 0 ? 0.12 : k === 1 ? 0.86 : 0.5);
    const cy = H * (k === 0 ? 0.68 : k === 1 ? 0.2 : 0.86);
    const rad = W * (k === 2 ? 0.5 : 0.28);
    const pts = 18;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = rad * (0.75 + r() * 0.25);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.6;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
  // Letras recortadas tipo nota de rescate.
  const word = (spec.text || "SECRETO").toLocaleUpperCase("es");
  const chips = ["#ffffff", "#1d1b18", spec.accent, "#f2d14b", "#e8e1cf", "#d94f3d"];
  const fams = [f.fonts.cut, f.fonts.serif, f.fonts.display, f.fonts.mono];
  const lr = rng(spec.seed ^ 0x51ed27);
  const chars = [...word];
  const target = W * (f.vertical ? 0.9 : 0.6);
  const cellW = target / Math.max(4, chars.length);
  const baseSize = Math.min(cellW * 1.2, 190 * u);
  const startX = (W - cellW * chars.length) / 2 + cellW / 2;
  const cy = clamp(spec.face.y - spec.face.h * 0.35, H * 0.12, H * 0.5);
  f.behind(() => {
    chars.forEach((ch, i) => {
      const chip = chips[Math.floor(lr() * chips.length)]!;
      const fam = fams[Math.floor(lr() * fams.length)]!;
      const rot = (lr() - 0.5) * 0.3;
      const sz = baseSize * (0.82 + lr() * 0.3);
      const jx = lr();
      const jy = lr();
      const p = (t - 0.15 - i * 0.07) / 0.25;
      if (p <= 0 || ch === " ") return;
      const wobble = rng(spec.seed + i * 131 + step);
      ctx.save();
      ctx.translate(startX + i * cellW + (jx - 0.5) * 10 * u + (wobble() - 0.5) * 4 * u, cy + (jy - 0.5) * 30 * u + (wobble() - 0.5) * 4 * u);
      ctx.rotate(rot + (wobble() - 0.5) * 0.03);
      const sc = lerp(1.4, 1, backOut(clamp01(p), 2));
      ctx.scale(sc, sc);
      ctx.font = f.font(fam === f.fonts.display ? 900 : fam === f.fonts.mono ? 700 : 400, sz, fam);
      const tw = ctx.measureText(ch).width;
      const bw = tw + sz * 0.28;
      const bh = sz * 1.05;
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10 * u * f.pixelScale;
      ctx.shadowOffsetY = 5 * u * f.pixelScale;
      ctx.fillStyle = chip;
      ctx.beginPath();
      const jag = rng(spec.seed + i);
      ctx.moveTo(-bw / 2 + jag() * 6 * u, -bh / 2 + jag() * 6 * u);
      ctx.lineTo(bw / 2 - jag() * 6 * u, -bh / 2 + jag() * 6 * u);
      ctx.lineTo(bw / 2 - jag() * 6 * u, bh / 2 - jag() * 6 * u);
      ctx.lineTo(-bw / 2 + jag() * 6 * u, bh / 2 - jag() * 6 * u);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      const dark = chip === "#1d1b18" || chip === "#d94f3d" || chip === spec.accent;
      ctx.fillStyle = dark ? "#ffffff" : "#1d1b18";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, 0, sz * 0.04);
      ctx.restore();
    });
  });
  // Tu figura con borde blanco de papel y sombra.
  const shadow = f.silhouette("pc-shadow", "rgba(0,0,0,0.35)", 16 * u, { ...IDENTITY, tx: 8 * u, ty: 14 * u });
  if (shadow) {
    ctx.save();
    ctx.filter = f.scaleFilter("blur(10px)");
    ctx.drawImage(shadow.canvas, 0, 0, W, H);
    ctx.restore();
  }
  const border = f.silhouette("pc-border", "#ffffff", 16 * u, IDENTITY, reduced ? 0 : 0.15, spec.seed + step);
  if (border) ctx.drawImage(border.canvas, 0, 0, W, H);
  f.drawPerson(ctx);
}

// ─── 14 Garabatos ─────────────────────────────────────────────────────────

/** Trazo "a mano": una curva con temblor según la semilla del cuadro. */
function handPath(ctx: FxCtx, pts: [number, number][], wobble: number, seed: number): void {
  const r = rng(seed);
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (r() - 0.5) * wobble;
    const jy = (r() - 0.5) * wobble;
    if (i === 0) ctx.moveTo(x + jx, y + jy);
    else {
      const [px, py] = pts[i - 1]!;
      ctx.quadraticCurveTo((px + x) / 2 + (r() - 0.5) * wobble, (py + y) / 2 + (r() - 0.5) * wobble, x + jx, y + jy);
    }
  });
}

function partial(pts: [number, number][], p: number): [number, number][] {
  if (p >= 1) return pts;
  const n = Math.max(2, Math.ceil(pts.length * clamp01(p)));
  return pts.slice(0, n);
}

export function doodleBoil(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const boil = f.host.reducedMotion ? 0 : Math.floor(t * 10) % 3;
  f.drawBase(ctx);
  const ink = "#ffffff";
  const accent = spec.accent;
  const enter = clamp01(t / 0.35);
  // Contorno a mano alrededor tuyo (la silueta engordada menos la silueta un poco menos engordada).
  if (f.hasMask) {
    const outer = f.silhouette("db-outer", "#ffffff", 30 * u, IDENTITY, 0.45, spec.seed + boil * 977);
    const inner = f.silhouette("db-inner", "#000000", 18 * u, IDENTITY, 0.35, spec.seed + boil * 577 + 1);
    if (outer && inner) {
      outer.ctx.save();
      outer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      outer.ctx.globalCompositeOperation = "destination-out";
      outer.ctx.drawImage(inner.canvas, 0, 0, outer.canvas.width, outer.canvas.height);
      outer.ctx.restore();
      ctx.save();
      ctx.globalAlpha = enter * exitAlpha(f);
      ctx.shadowColor = rgba(accent, 0.9);
      ctx.shadowBlur = 14 * u * f.pixelScale;
      ctx.drawImage(outer.canvas, 0, 0, W, H);
      ctx.restore();
    }
  }
  f.drawPerson(ctx);
  // Garabatos del lado libre: flecha a tu cabeza, estrellitas y una palabra a mano subrayada.
  const right = f.faceCx <= W / 2;
  const side = right ? 1 : -1;
  const fx = f.faceCx + side * spec.face.w * 0.95;
  const fy = f.faceCy;
  const ex = exitAlpha(f);
  ctx.save();
  ctx.globalAlpha = ex;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 7 * u;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8 * u * f.pixelScale;
  // Palabra a mano.
  const text = spec.text || "¡clave!";
  const tx = clamp(fx + side * spec.face.w * 0.55, W * 0.2, W * 0.8);
  const ty = clamp(fy - spec.face.h * 0.9, H * 0.1, H * 0.5);
  const tp = easeOut((t - 0.2) / 0.4);
  if (tp > 0) {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(-0.08 * side + (boil - 1) * 0.01);
    ctx.globalAlpha *= tp;
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const size = fitSize(ctx, text, (s) => f.font(700, s, f.fonts.hand), W * 0.42, 110 * u);
    ctx.font = f.font(700, size, f.fonts.hand);
    ctx.fillText(text, 0, 0);
    const tw = ctx.measureText(text).width;
    // Subrayado a mano.
    ctx.strokeStyle = accent;
    handPath(ctx, partial([[-tw / 2, 18 * u], [0, 26 * u], [tw / 2, 14 * u]], easeOut((t - 0.45) / 0.35)), 8 * u, spec.seed + boil * 31);
    ctx.stroke();
    ctx.restore();
  }
  // Flecha a la cabeza.
  const ap = easeOut((t - 0.5) / 0.45);
  if (ap > 0) {
    const sx = tx - side * 10 * u;
    const sy = ty + 60 * u;
    const exx = f.faceCx + side * spec.face.w * 0.62;
    const eyy = fy - spec.face.h * 0.1;
    const mid: [number, number] = [(sx + exx) / 2 + side * 60 * u, (sy + eyy) / 2 + 40 * u];
    const pts: [number, number][] = [[sx, sy], mid, [exx, eyy]];
    handPath(ctx, partial(pts, ap), 10 * u, spec.seed + boil * 17);
    ctx.stroke();
    if (ap >= 1) {
      const ang = Math.atan2(eyy - mid[1], exx - mid[0]);
      handPath(
        ctx,
        [
          [exx - Math.cos(ang - 0.5) * 40 * u, eyy - Math.sin(ang - 0.5) * 40 * u],
          [exx, eyy],
          [exx - Math.cos(ang + 0.5) * 40 * u, eyy - Math.sin(ang + 0.5) * 40 * u],
        ],
        6 * u,
        spec.seed + boil * 7,
      );
      ctx.stroke();
    }
  }
  // Estrellitas.
  const stars: [number, number, number][] = [
    [f.faceCx - side * spec.face.w * 0.85, fy - spec.face.h * 0.75, 30],
    [f.faceCx + side * spec.face.w * 1.25, fy + spec.face.h * 0.55, 24],
    [f.faceCx - side * spec.face.w * 0.6, fy + spec.face.h * 0.95, 20],
  ];
  stars.forEach(([x, y, s], i) => {
    const sp = backOut(clamp01((t - 0.75 - i * 0.12) / 0.3), 2);
    if (sp <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sp, sp);
    ctx.strokeStyle = i === 1 ? accent : ink;
    const r = s * u;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 4;
      handPath(ctx, [[-Math.cos(a) * r, -Math.sin(a) * r], [Math.cos(a) * r, Math.sin(a) * r]], 4 * u, spec.seed + boil * 3 + i * 11 + k);
      ctx.stroke();
    }
    ctx.restore();
  });
  ctx.restore();
}

// ─── 15 Vértigo ───────────────────────────────────────────────────────────

export function vertigo(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const p = easeInOut(t / spec.duration);
  const s = 1 + 0.4 * p;
  if (!f.hasMask) {
    f.drawBase(ctx);
    return;
  }
  // Fondo sin la persona: el cuadro menos la silueta engordada, con el hueco rellenado con el fondo de los costados.
  const plate = f.layer("vt-plate");
  f.drawBase(plate.ctx);
  const hole = f.silhouette("vt-hole", "#000000", 14 * u);
  if (hole) {
    plate.ctx.save();
    plate.ctx.setTransform(1, 0, 0, 1, 0, 0);
    plate.ctx.globalCompositeOperation = "destination-out";
    plate.ctx.drawImage(hole.canvas, 0, 0, plate.canvas.width, plate.canvas.height);
    plate.ctx.restore();
  }
  // Relleno del hueco (a media resolución): el fondo de los costados corrido hacia adentro, desenfocado.
  const fill = f.layer("vt-fill", 0.25);
  for (const d of [360, 220, 120, 50]) {
    fill.ctx.drawImage(plate.canvas, d * u, 0, W, H);
    fill.ctx.drawImage(plate.canvas, -d * u, 0, W, H);
  }
  const full = f.layer("vt-full");
  full.ctx.save();
  full.ctx.filter = f.scaleFilter("blur(8px)");
  full.ctx.drawImage(fill.canvas, 0, 0, W, H);
  full.ctx.restore();
  full.ctx.drawImage(plate.canvas, 0, 0, W, H);
  // Fondo estirándose detrás (alrededor de tu cara), con un leve desenfoque de movimiento.
  const xf: Xf = { s, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 };
  ctx.save();
  f.applyXf(ctx, xf);
  ctx.drawImage(full.canvas, 0, 0, W, H);
  ctx.restore();
  const k = Math.sin(Math.PI * clamp01(t / spec.duration));
  // Viñeta que acompaña el vértigo.
  const g = ctx.createRadialGradient(f.faceCx, f.faceCy, H * 0.15, f.faceCx, f.faceCy, H * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${0.35 * k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Tú, quieto.
  f.drawPerson(ctx);
  void lerp;
  void (null as unknown as ImageLike);
}
