/**
 * Efectos de texto: máquina de escribir, palabra por palabra, subrayado a mano, resaltador, contador, texto 3D, neón,
 * letra a letra, bloque de palabras, golpe de palabra, decodificar, ola, título de sección y contorno que se llena.
 * Con la tipografía y los colores de Mi marca; los que tienen un elemento lo dejan mover desde el lienzo.
 */
import { backOut, bounce, clamp, clamp01, easeIn, easeInOut, easeOut, FxFrame, lerp, letterOffsets, rgba, rng, roundRect, wrap } from "./core";
import { breathe, card, displayFamily, envelope, fitFont, frameIndex, handStroke, mix, noShadow, onColor, shadow, shadowText, spacedText, spacedWidth, textAnchor, upperText, wordNow } from "./kit";

// ─── Máquina de escribir ───────────────────────────────────────────────────

export function typewriter(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx, breathe(f, 0.03));
  const text = spec.text || spec.words.map((w) => w.text).join(" ") || "Escribe tu frase";
  const { a } = envelope(f, 0.25, 0.3);
  ctx.font = f.font(500, 56 * u, f.fonts.mono);
  const maxW = W * (f.vertical ? 0.78 : 0.5);
  let size = 56 * u;
  let lines = wrap(ctx, text, maxW, 3);
  if (lines.length > 2) {
    size = 46 * u;
    ctx.font = f.font(500, size, f.fonts.mono);
    lines = wrap(ctx, text, maxW, 3);
  }
  const lh = size * 1.32;
  const padX = 44 * u;
  const padY = 38 * u;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width), 200 * u);
  const w = tw + padX * 2 + 30 * u;
  const h = lines.length * lh + padY * 2 + 30 * u;
  const anchor = textAnchor(f, h);
  const x = anchor.cx - w / 2;
  const y = anchor.cy - h / 2;
  f.movable({ x, y, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y + (1 - easeOut(t / 0.3)) * 24 * u, w, h, 22 * u, "glass");
    const top = y + (1 - easeOut(t / 0.3)) * 24 * u;
    // Tres puntos de ventana y el renglón.
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.fillStyle = rgba(c, 0.85);
      ctx.beginPath();
      ctx.arc(x + padX + i * 26 * u, top + 26 * u, 7 * u, 0, Math.PI * 2);
      ctx.fill();
    });
    const total = lines.join("").length;
    const typeDur = Math.min(spec.duration * 0.62, Math.max(0.6, total * 0.055));
    const shown = Math.floor(total * clamp01((t - 0.2) / typeDur));
    let left = shown;
    ctx.font = f.font(500, size, f.fonts.mono);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let cx = x + padX;
    let cy = top + 30 * u + padY + size * 0.9;
    lines.forEach((line, i) => {
      const part = line.slice(0, Math.max(0, left));
      left -= line.length;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(part, x + padX, top + 30 * u + padY + size * 0.9 + i * lh);
      if (part.length) {
        cx = x + padX + ctx.measureText(part).width;
        cy = top + 30 * u + padY + size * 0.9 + i * lh;
      }
    });
    // Cursor que titila (fijo mientras escribe).
    const typing = shown < total && t > 0.2;
    if (typing || Math.floor(t * 2.2) % 2 === 0) {
      ctx.fillStyle = spec.accent;
      ctx.fillRect(cx + 6 * u, cy - size * 0.78, size * 0.5, size * 0.92);
    }
    ctx.restore();
  });
}

// ─── Palabra por palabra ───────────────────────────────────────────────────

const STRONGISH = (w: { text: string; strong: boolean }) => w.strong || /\d/.test(w.text) || w.text.replace(/[^\p{L}]/gu, "").length >= 7;

export function wordPop(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const i = wordNow(f);
  if (i < 0) return;
  const w = spec.words[i]!;
  const word = w.text.replace(/[.,;:]+$/, "").toLocaleUpperCase("es");
  const strong = STRONGISH(w);
  const fam = displayFamily(f);
  const fit = fitFont(f, word, 900, fam, W * 0.86, strong ? 190 : 150, 40);
  const p = clamp01((t - w.t0) / 0.2);
  const s = lerp(0.55, 1, backOut(p, 2.4));
  const cy = H * (f.vertical ? 0.68 : 0.74);
  const rot = ((i % 2 ? 1 : -1) * 2.2 * Math.PI) / 180;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.rotate(rot * (1 - p * 0.4));
  ctx.scale(s, s);
  ctx.font = fit.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if (strong) {
    // La palabra fuerte va sobre un bloque del color de tu marca.
    const bw = fit.width + fit.size * 0.5;
    const bh = fit.size * 1.12;
    shadow(f, 30, 10, "rgba(0,0,0,0.4)");
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 18 * u);
    ctx.fillStyle = spec.accent;
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = onColor(spec.accent);
    ctx.fillText(word, 0, fit.size * 0.04);
  } else {
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = fit.size * 0.14;
    ctx.strokeText(word, 0, fit.size * 0.04);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(word, 0, fit.size * 0.04);
  }
  ctx.restore();
}

// ─── Subrayado a mano ──────────────────────────────────────────────────────

export function underlineDraw(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const word = upperText(f, "CLAVE");
  const fam = displayFamily(f);
  const { a, inP } = envelope(f, 0.3, 0.3);
  const anchor = textAnchor(f, 220 * u);
  const fit = fitFont(f, word, 900, fam, anchor.maxW, 170, 40);
  const box = { x: anchor.cx - fit.width / 2 - 30 * u, y: anchor.cy - fit.size * 0.62, w: fit.width + 60 * u, h: fit.size * 1.3 };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const by = anchor.cy + fit.size * 0.32 + (1 - inP) * 30 * u;
    shadowText(f, word, anchor.cx, by, "#ffffff", 26);
    // El subrayado: dos pasadas a mano que se dibujan de izquierda a derecha.
    const x0 = anchor.cx - fit.width / 2 - 10 * u;
    const x1 = anchor.cx + fit.width / 2 + 10 * u;
    const ly = by + fit.size * 0.18;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 24; k++) {
      const q = k / 24;
      pts.push([lerp(x0, x1, q), ly + Math.sin(q * Math.PI * 1.2) * 8 * u - q * 10 * u]);
    }
    for (let k = 24; k >= 6; k--) {
      const q = k / 24;
      pts.push([lerp(x0 + 40 * u, x1 - 10 * u, q), ly + 22 * u + Math.sin(q * 5) * 5 * u]);
    }
    ctx.strokeStyle = spec.accent;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 14 * u;
    const boil = f.host.reducedMotion ? 0 : Math.floor(t * 8) % 3;
    handStroke(ctx, pts, clamp01((t - 0.3) / 0.55), 4 * u, spec.seed + boil);
    ctx.restore();
  });
}

// ─── Resaltador ────────────────────────────────────────────────────────────

export function highlighter(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f, 0.03));
  const text = spec.text || "La idea principal";
  const fam = displayFamily(f);
  const { a } = envelope(f, 0.25, 0.3);
  const maxW = f.vertical ? W * 0.8 : W * 0.42;
  ctx.font = f.font(800, 92 * u, fam);
  let lines = wrap(ctx, text, maxW, 3);
  let size = 92 * u;
  if (lines.length > 2) {
    size = 74 * u;
    ctx.font = f.font(800, size, fam);
    lines = wrap(ctx, text, maxW, 3);
  }
  const lh = size * 1.22;
  const h = lines.length * lh;
  const anchor = textAnchor(f, h);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const box = { x: anchor.cx - Math.max(...widths) / 2 - 24 * u, y: anchor.cy - h / 2 - 12 * u, w: Math.max(...widths) + 48 * u, h: h + 24 * u };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const hl = f.layer("hl-text");
    lines.forEach((line, i) => {
      const y = anchor.cy - h / 2 + i * lh + lh * 0.5;
      const w = widths[i]!;
      const start = 0.25 + i * 0.35;
      const p = easeInOut((t - start) / 0.45);
      ctx.font = f.font(800, size, fam);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // La franja del resaltador (un poco torcida y con bordes gastados).
      if (p > 0) {
        ctx.save();
        ctx.globalAlpha *= 0.92;
        ctx.fillStyle = spec.accent;
        const x0 = anchor.cx - w / 2 - 16 * u;
        ctx.beginPath();
        ctx.moveTo(x0, y - size * 0.42);
        ctx.lineTo(x0 + (w + 32 * u) * p, y - size * 0.46);
        ctx.lineTo(x0 + (w + 32 * u) * p - 6 * u, y + size * 0.44);
        ctx.lineTo(x0 + 4 * u, y + size * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      shadowText(f, line, anchor.cx, y, "#ffffff", 18);
      // El texto sobre la franja cambia de color (recortado a la parte ya resaltada).
      hl.ctx.font = f.font(800, size, fam);
      hl.ctx.textAlign = "center";
      hl.ctx.textBaseline = "middle";
      hl.ctx.fillStyle = onColor(spec.accent);
      hl.ctx.fillText(line, anchor.cx, y);
      hl.ctx.globalCompositeOperation = "destination-out";
      hl.ctx.fillRect(anchor.cx - w / 2 - 16 * u + (w + 32 * u) * p, y - size, W, size * 2);
      hl.ctx.globalCompositeOperation = "source-over";
    });
    ctx.drawImage(hl.canvas, 0, 0, W, H);
    ctx.restore();
  });
}

// ─── Contador ──────────────────────────────────────────────────────────────

/** Separa la cifra de lo que la rodea: "10.000" → 10000 con punto de miles; "87 %" → 87 y " %"; "$1,5 M" → 1,5 y " M". */
export function parseCount(text: string): { prefix: string; value: number; suffix: string; decimals: number; sep: string; dec: string } | null {
  const m = text.match(/^(\D*?)(\d[\d.,\s]*)(.*)$/);
  if (!m) return null;
  const raw = m[2]!.trim();
  const groups = /^\d{1,3}([.,\s]\d{3})+$/.test(raw);
  let value: number;
  let decimals = 0;
  let sep = ".";
  let dec = ",";
  if (groups) {
    sep = raw.match(/[.,\s]/)![0]!;
    value = Number(raw.replace(/[.,\s]/g, ""));
  } else {
    const d = raw.match(/[.,](\d+)$/);
    if (d) {
      dec = raw.includes(",") ? "," : ".";
      decimals = Math.min(2, d[1]!.length);
    }
    value = Number(raw.replace(/\s/g, "").replace(",", "."));
  }
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1]!, value, suffix: m[3]!, decimals, sep, dec };
}

export function formatCount(n: number, p: { decimals: number; sep: string; dec: string }): string {
  const fixed = n.toFixed(p.decimals);
  const [int, frac] = fixed.split(".");
  const withSep = int!.replace(/\B(?=(\d{3})+(?!\d))/g, p.sep === " " ? " " : p.sep);
  return frac ? `${withSep}${p.dec}${frac}` : withSep;
}

export function counter(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const parsed = parseCount(spec.text || "100");
  const { a, inP } = envelope(f, 0.25, 0.3);
  const k = easeOut(clamp01((t - 0.15) / Math.min(1.4, spec.duration * 0.55)));
  const shown = parsed ? `${parsed.prefix}${formatCount(parsed.value * k, parsed)}${parsed.suffix}` : spec.text;
  const final = parsed ? `${parsed.prefix}${formatCount(parsed.value, parsed)}${parsed.suffix}` : spec.text;
  const fam = displayFamily(f);
  const anchor = textAnchor(f, 300 * u);
  const fit = fitFont(f, final, 900, fam, anchor.maxW, 210, 50);
  const box = { x: anchor.cx - fit.width / 2 - 20 * u, y: anchor.cy - fit.size * 0.75, w: fit.width + 40 * u, h: fit.size * 1.1 + 90 * u };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const s = lerp(0.85, 1, backOut(inP));
    ctx.translate(anchor.cx, anchor.cy);
    ctx.scale(s, s);
    ctx.translate(-anchor.cx, -anchor.cy);
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // La cifra crece con el mismo ancho final (sin saltar): cada dígito en su caja.
    shadow(f, 34, 8, "rgba(0,0,0,0.45)");
    ctx.fillStyle = k >= 1 ? spec.accent : "#ffffff";
    ctx.fillText(shown, anchor.cx, anchor.cy + fit.size * 0.32);
    noShadow(ctx);
    if (k >= 1) {
      const flash = 1 - clamp01((t - 0.15 - Math.min(1.4, spec.duration * 0.55)) / 0.35);
      if (flash > 0) {
        ctx.save();
        ctx.globalAlpha *= flash;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(shown, anchor.cx, anchor.cy + fit.size * 0.32);
        ctx.restore();
      }
    }
    if (spec.kicker) {
      const kf = fitFont(f, spec.kicker, 600, f.fonts.sans, anchor.maxW, 46, 20);
      ctx.font = kf.font;
      ctx.globalAlpha *= easeOut((t - 0.4) / 0.4);
      shadowText(f, spec.kicker, anchor.cx, anchor.cy + fit.size * 0.32 + kf.size * 1.5, "#ffffff", 18);
    }
    ctx.restore();
  });
}

// ─── Texto 3D ──────────────────────────────────────────────────────────────

export function text3d(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const word = upperText(f, "IDEA");
  const fam = displayFamily(f);
  const { a, inP } = envelope(f, 0.4, 0.3);
  const anchor = textAnchor(f, 260 * u);
  const fit = fitFont(f, word, 900, fam, anchor.maxW * 0.92, 190, 40);
  const box = { x: anchor.cx - fit.width / 2 - 40 * u, y: anchor.cy - fit.size * 0.7, w: fit.width + 80 * u, h: fit.size * 1.4 };
  const sway = f.host.reducedMotion ? 0 : Math.sin(t * 1.4 + spec.seed) * 0.5;
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const s = lerp(0.6, 1, backOut(inP, 1.4));
    ctx.translate(anchor.cx, anchor.cy);
    ctx.scale(s * (1 - Math.abs(sway) * 0.05), s);
    ctx.transform(1, 0, sway * 0.08, 1, 0, 0);
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Volumen: copias hacia atrás en tonos más oscuros del acento.
    const depth = 16;
    const dx = (2.2 + sway * 2) * u;
    const dy = 2.6 * u;
    shadow(f, 40, 24, "rgba(0,0,0,0.45)");
    ctx.fillStyle = mix(spec.accent, "#000000", 0.6);
    ctx.fillText(word, dx * depth, dy * depth);
    noShadow(ctx);
    for (let i = depth; i > 0; i--) {
      ctx.fillStyle = mix(spec.accent, "#000000", 0.25 + (i / depth) * 0.35);
      ctx.fillText(word, dx * i, dy * i);
    }
    const g = ctx.createLinearGradient(0, -fit.size * 0.5, 0, fit.size * 0.5);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, mix("#ffffff", spec.accent, 0.35));
    ctx.fillStyle = g;
    ctx.fillText(word, 0, 0);
    ctx.restore();
  });
}

// ─── Neón ──────────────────────────────────────────────────────────────────

/** Parpadeo de encendido (determinista): apagado, chispazo, apagado, encendido. */
export function neonFlicker(t: number): number {
  if (t < 0.12) return 0;
  if (t < 0.18) return 0.9;
  if (t < 0.26) return 0.15;
  if (t < 0.31) return 1;
  if (t < 0.36) return 0.35;
  return 1;
}

export function neonText(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f));
  const { a } = envelope(f, 0.1, 0.25);
  // La escena baja un poco la luz para que el neón brille.
  ctx.fillStyle = `rgba(2,4,14,${0.35 * a})`;
  ctx.fillRect(0, 0, W, H);
  const word = spec.text || "abierto";
  const anchor = textAnchor(f, 240 * u);
  const fit = fitFont(f, word, 700, f.fonts.hand, anchor.maxW * 0.9, 200, 50);
  const box = { x: anchor.cx - fit.width / 2 - 50 * u, y: anchor.cy - fit.size * 0.65, w: fit.width + 100 * u, h: fit.size * 1.3 };
  const on = neonFlicker(t) * a * (f.host.reducedMotion ? 1 : 0.93 + 0.07 * Math.sin(t * 37));
  f.movable(box, () => {
    ctx.save();
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // El tubo apagado se ve siempre.
    ctx.globalAlpha *= a;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 6 * u;
    ctx.strokeText(word, anchor.cx, anchor.cy);
    ctx.globalAlpha = on;
    const glow = mix(spec.accent, "#ffffff", 0.15);
    for (const [blur, width, alpha] of [
      [60, 10, 0.55],
      [28, 8, 0.8],
      [10, 6, 1],
    ] as const) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = blur * u * f.pixelScale;
      ctx.strokeStyle = rgba(glow, alpha);
      ctx.lineWidth = width * u;
      ctx.strokeText(word, anchor.cx, anchor.cy);
    }
    noShadow(ctx);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.6 * u;
    ctx.strokeText(word, anchor.cx, anchor.cy);
    ctx.restore();
  });
}

// ─── Letra a letra ─────────────────────────────────────────────────────────

export function letterBuild(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f));
  const word = upperText(f, "SISTEMA");
  const fam = displayFamily(f);
  const { a } = envelope(f, 0.05, 0.3);
  const anchor = textAnchor(f, 240 * u);
  const fit = fitFont(f, word, 900, fam, anchor.maxW, 180, 40);
  const box = { x: anchor.cx - fit.width / 2 - 20 * u, y: anchor.cy - fit.size * 0.6, w: fit.width + 40 * u, h: fit.size * 1.2 };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fit.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const letters = letterOffsets(ctx, word);
    const x0 = anchor.cx - fit.width / 2;
    const r = rng(spec.seed);
    const step = Math.min(0.08, 0.7 / Math.max(1, letters.length));
    letters.forEach((l, i) => {
      const p = clamp01((t - 0.1 - i * step) / 0.42);
      if (p <= 0) return;
      const e = backOut(p, 1.9);
      const rot = (r() - 0.5) * 0.9 * (1 - e);
      ctx.save();
      ctx.translate(x0 + l.x + l.w / 2, anchor.cy + (1 - e) * 160 * u);
      ctx.rotate(rot);
      ctx.globalAlpha *= clamp01(p * 2.5);
      shadow(f, 22, 6, "rgba(0,0,0,0.45)");
      ctx.fillStyle = "#ffffff";
      ctx.fillText(l.ch, -l.w / 2, 0);
      ctx.restore();
    });
    // Brillo que cruza la palabra cuando ya está armada.
    const done = 0.1 + letters.length * step + 0.42;
    const sweep = clamp01((t - done) / 0.6);
    if (sweep > 0 && sweep < 1) {
      const l = f.layer("lb-shine");
      l.ctx.font = fit.font;
      l.ctx.textAlign = "left";
      l.ctx.textBaseline = "middle";
      l.ctx.fillStyle = spec.accent;
      l.ctx.fillText(word, x0, anchor.cy);
      l.ctx.globalCompositeOperation = "destination-in";
      const gx = x0 - 200 * u + (fit.width + 400 * u) * sweep;
      const g = l.ctx.createLinearGradient(gx - 140 * u, 0, gx + 140 * u, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      l.ctx.fillStyle = g;
      l.ctx.fillRect(0, 0, W, H);
      ctx.drawImage(l.canvas, 0, 0, W, H);
    }
    ctx.restore();
  });
}

// ─── Bloque de palabras ────────────────────────────────────────────────────

export function wordStack(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f, 0.05));
  const items = (spec.items.length ? spec.items : ["GRABA", "EDITA", "PUBLICA"]).slice(0, 3).map((s) => s.toLocaleUpperCase("es"));
  const { a } = envelope(f, 0.15, 0.25);
  // Velo de abajo hacia arriba para que el póster se lea.
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${0.62 * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.35, W, H * 0.65);
  const fam = displayFamily(f);
  const maxW = f.vertical ? W * 0.9 : W * 0.46;
  const sizes = items.map((w) => fitFont(f, w, 900, fam, maxW, f.vertical ? 230 : 190, 50).size);
  const lh = sizes.map((s) => s * 0.96);
  const total = lh.reduce((x, y) => x + y, 0);
  const bottom = H * (f.vertical ? 0.84 : 0.9);
  const cx = f.vertical ? W / 2 : f.faceCx < W / 2 ? W * 0.72 : W * 0.28;
  let y = bottom - total;
  items.forEach((word, i) => {
    const at = spec.marks[i] ?? 0.15 + i * 0.35;
    const p = clamp01((t - at) / 0.3);
    const size = sizes[i]!;
    const lineY = y + lh[i]! * 0.82;
    y += lh[i]!;
    if (p <= 0) return;
    const e = easeOut(p);
    ctx.save();
    ctx.globalAlpha *= a;
    // Cada palabra sube desde detrás de una línea (recortada a su renglón).
    ctx.beginPath();
    ctx.rect(0, lineY - size * 0.86, W, size * 1.02);
    ctx.clip();
    ctx.font = f.font(900, size, fam);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const yy = lineY + (1 - e) * size;
    if (i === 1) {
      ctx.fillStyle = spec.accent;
      ctx.fillText(word, cx, yy);
    } else if (i === 2) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4 * u;
      ctx.strokeText(word, cx, yy);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(word, cx, yy);
    }
    ctx.restore();
  });
}

// ─── Golpe de palabra ──────────────────────────────────────────────────────

export function wordSlam(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const hit = 0.14;
  const after = Math.max(0, t - hit);
  const amp = t >= hit && !f.host.reducedMotion ? 26 * u * Math.exp(-after * 9) : 0;
  const r = rng(spec.seed + frameIndex(f));
  const sx = (r() - 0.5) * 2 * amp;
  const sy = (r() - 0.5) * 2 * amp;
  f.drawBase(ctx, { s: 1.04 + (t >= hit ? 0.06 * Math.exp(-after * 6) : 0), px: W / 2, py: H / 2, tx: sx, ty: sy });
  const { a } = envelope(f, 0.01, 0.25);
  ctx.fillStyle = `rgba(0,0,0,${0.28 * a})`;
  ctx.fillRect(0, 0, W, H);
  const word = upperText(f, "BASTA");
  const fam = displayFamily(f);
  const fit = fitFont(f, word, 900, fam, W * (f.vertical ? 0.88 : 0.6), f.vertical ? 260 : 220, 50);
  const s = t < hit ? lerp(3.2, 1, easeIn(t / hit)) : 1 + 0.04 * Math.exp(-after * 8);
  const cy = H * (f.vertical ? 0.62 : 0.55);
  ctx.save();
  ctx.globalAlpha *= a * clamp01(t / (hit * 0.6));
  ctx.translate(W / 2 + sx * 0.5, cy + sy * 0.5);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.font = fit.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Bloque de color detrás, corrido (como un sello).
  const bw = fit.width + fit.size * 0.45;
  const bh = fit.size * 1.05;
  ctx.fillStyle = spec.accent;
  ctx.fillRect(-bw / 2 + 14 * u, -bh / 2 + 14 * u, bw, bh);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(word, 0, fit.size * 0.05);
  ctx.restore();
  // Destello en el impacto.
  const flash = t >= hit ? Math.exp(-after * 14) : 0;
  if (flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${0.55 * flash})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ─── Decodificar ───────────────────────────────────────────────────────────

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*+=<>";

export function scramble(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const word = upperText(f, "SECRETO");
  const { a } = envelope(f, 0.2, 0.3);
  const anchor = textAnchor(f, 200 * u);
  const chars = [...word];
  const fit = fitFont(f, word, 700, f.fonts.mono, anchor.maxW * 0.86, 140, 36);
  const spacing = fit.size * 0.08;
  ctx.font = fit.font;
  const width = spacedWidth(ctx, word, spacing);
  const box = { x: anchor.cx - width / 2 - 60 * u, y: anchor.cy - fit.size * 0.8, w: width + 120 * u, h: fit.size * 1.6 };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    // Corchetes de terminal.
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 6 * u;
    const bx0 = box.x + 10 * u;
    const bx1 = box.x + box.w - 10 * u;
    const by0 = box.y + 10 * u;
    const by1 = box.y + box.h - 10 * u;
    const arm = 36 * u;
    ctx.beginPath();
    ctx.moveTo(bx0 + arm, by0);
    ctx.lineTo(bx0, by0);
    ctx.lineTo(bx0, by1);
    ctx.lineTo(bx0 + arm, by1);
    ctx.moveTo(bx1 - arm, by0);
    ctx.lineTo(bx1, by0);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(bx1 - arm, by1);
    ctx.stroke();
    const tick = Math.floor(frameIndex(f) / 2);
    const r = rng(spec.seed + tick * 131);
    const lockStart = 0.3;
    const lockSpan = Math.min(1.2, spec.duration * 0.5);
    let x = anchor.cx - width / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = fit.font;
    chars.forEach((ch, i) => {
      const lockAt = lockStart + (lockSpan * (i + 1)) / chars.length;
      const locked = t >= lockAt || ch === " ";
      const g = locked ? ch : GLYPHS[Math.floor(r() * GLYPHS.length)]!;
      ctx.fillStyle = locked ? "#ffffff" : rgba(spec.accent, 0.9);
      shadow(f, locked ? 16 : 24, 0, locked ? "rgba(0,0,0,0.5)" : spec.accent);
      ctx.fillText(g, x, anchor.cy);
      x += ctx.measureText(ch).width + spacing;
    });
    ctx.restore();
  });
}

// ─── Ola ───────────────────────────────────────────────────────────────────

export function waveText(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const text = spec.text || "fluye";
  const fam = displayFamily(f);
  const { a } = envelope(f, 0.3, 0.3);
  const anchor = textAnchor(f, 240 * u);
  const fit = fitFont(f, text, 900, fam, anchor.maxW, 170, 40);
  const box = { x: anchor.cx - fit.width / 2 - 20 * u, y: anchor.cy - fit.size * 0.8, w: fit.width + 40 * u, h: fit.size * 1.6 };
  const still = f.host.reducedMotion;
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fit.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const letters = letterOffsets(ctx, text);
    const x0 = anchor.cx - fit.width / 2;
    const g = ctx.createLinearGradient(x0, 0, x0 + fit.width, 0);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, mix(spec.accent, "#ffffff", 0.35));
    g.addColorStop(1, spec.accent);
    letters.forEach((l, i) => {
      const enter = easeOut((t - i * 0.04) / 0.4);
      const wave = still ? 0 : Math.sin(t * 5 - i * 0.55) * 22 * u;
      ctx.save();
      ctx.globalAlpha *= enter;
      ctx.translate(0, wave + (1 - enter) * 40 * u);
      shadow(f, 20, 6, "rgba(0,0,0,0.4)");
      ctx.fillStyle = g;
      ctx.fillText(l.ch, x0 + l.x, anchor.cy);
      ctx.restore();
    });
    ctx.restore();
  });
}

// ─── Título de sección ─────────────────────────────────────────────────────

export function titleCard(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f, 0.06));
  const { a, inP, outP } = envelope(f, 0.4, 0.35);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(0,0,0,${0.15 * a})`);
  g.addColorStop(0.55, `rgba(0,0,0,${0.35 * a})`);
  g.addColorStop(1, `rgba(0,0,0,${0.7 * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const title = spec.text || "Parte uno";
  const kicker = (spec.kicker || "PARTE 01").toLocaleUpperCase("es");
  const fam = displayFamily(f);
  const cx = W / 2;
  const cy = H * (f.vertical ? 0.7 : 0.62);
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // Rótulo en mono con interletrado.
  ctx.font = f.font(600, 34 * u, f.fonts.mono);
  ctx.fillStyle = spec.accent;
  ctx.globalAlpha *= easeOut((t - 0.05) / 0.35);
  spacedText(ctx, kicker, cx, cy - 150 * u, 10 * u, "center");
  ctx.globalAlpha = a;
  const fit = fitFont(f, title, 800, fam, W * 0.86, 150, 40);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cy - fit.size * 1.05, W, fit.size * 1.25);
  ctx.clip();
  ctx.font = fit.font;
  shadowText(f, title, cx, cy + (1 - inP) * fit.size + outP * -fit.size * 0.3, "#ffffff", 30);
  ctx.restore();
  // La línea se extiende desde el centro.
  const lw = (fit.width + 120 * u) * easeInOut((t - 0.2) / 0.6) * (1 - outP);
  ctx.fillStyle = spec.accent;
  roundRect(ctx, cx - lw / 2, cy + 46 * u, lw, 8 * u, 4 * u);
  ctx.fill();
  ctx.restore();
}

// ─── Contorno que se llena ─────────────────────────────────────────────────

export function outlineFill(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, breathe(f));
  const word = upperText(f, "LLENO");
  const fam = displayFamily(f);
  const { a } = envelope(f, 0.3, 0.3);
  const anchor = textAnchor(f, 260 * u);
  const fit = fitFont(f, word, 900, fam, anchor.maxW, 200, 40);
  const box = { x: anchor.cx - fit.width / 2 - 20 * u, y: anchor.cy - fit.size * 0.62, w: fit.width + 40 * u, h: fit.size * 1.24 };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    shadow(f, 20, 4, "rgba(0,0,0,0.5)");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5 * u;
    ctx.strokeText(word, anchor.cx, anchor.cy);
    noShadow(ctx);
    // El relleno sube con una ola en el borde.
    const p = easeInOut((t - 0.35) / Math.min(1.6, spec.duration * 0.6));
    if (p > 0) {
      const l = f.layer("of-fill");
      l.ctx.font = fit.font;
      l.ctx.textAlign = "center";
      l.ctx.textBaseline = "middle";
      const gr = l.ctx.createLinearGradient(0, anchor.cy - fit.size / 2, 0, anchor.cy + fit.size / 2);
      gr.addColorStop(0, mix(spec.accent, "#ffffff", 0.3));
      gr.addColorStop(1, spec.accent);
      l.ctx.fillStyle = gr;
      l.ctx.fillText(word, anchor.cx, anchor.cy);
      l.ctx.globalCompositeOperation = "destination-in";
      const top = anchor.cy + fit.size * 0.5 - fit.size * 1.05 * p;
      l.ctx.beginPath();
      l.ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20 * u) l.ctx.lineTo(x, top + Math.sin(x / (60 * u) + t * 6) * 10 * u * (1 - p * 0.7));
      l.ctx.lineTo(W, H);
      l.ctx.closePath();
      l.ctx.fill();
      ctx.drawImage(l.canvas, 0, 0, W, H);
    }
    ctx.restore();
  });
  void clamp;
  void bounce;
}
