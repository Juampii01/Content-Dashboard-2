/**
 * Tarjetas: tercio inferior, cita, cifra grande, lista numerada, pros y contras, línea de tiempo, barra de progreso,
 * encuesta, comentario, notificación, caja de preguntas, estrellas, etiqueta, buscador y definición. Genéricas (sin
 * logos ni marcas de terceros), con la marca del cliente y movibles desde el lienzo.
 */
import { backOut, bounce, clamp, clamp01, easeIn, easeInOut, easeOut, FxFrame, lerp, rgba, roundRect, wrap } from "./core";
import { avoidFace, breathe, card, checkStroke, crossStroke, displayFamily, envelope, fitFont, itemsOr, markAt, mix, noShadow, onColor, shadow, starPath } from "./kit";
import { formatCount, parseCount } from "./fx-text";

/** Entrada común de una tarjeta: sube y aparece; sale bajando la opacidad. */
function rise(f: FxFrame, y: number, inDur = 0.35): { a: number; y: number } {
  const { a, inP } = envelope(f, inDur, 0.3);
  return { a, y: y + (1 - inP) * 40 * f.u };
}

const cardW = (f: FxFrame, k = 0.84) => f.W * (f.vertical ? k : k * 0.52);
const cardX = (f: FxFrame, w: number) => (f.vertical ? (f.W - w) / 2 : f.faceCx < f.W / 2 ? f.W * 0.94 - w : f.W * 0.06);

// ─── Tercio inferior ───────────────────────────────────────────────────────

export function lowerThird(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const name = spec.text || "Tu nombre";
  const role = spec.kicker || "";
  const fam = displayFamily(f);
  const x = 60 * u;
  const y = H * (f.vertical ? 0.56 : 0.7);
  ctx.font = f.font(800, 64 * u, fam);
  const nw = Math.min(W * 0.8, ctx.measureText(name).width);
  ctx.font = f.font(500, 34 * u, f.fonts.sans);
  const rw = Math.min(W * 0.8, ctx.measureText(role).width);
  const w = Math.max(nw, rw) + 90 * u;
  const h = role ? 170 * u : 110 * u;
  const outP = easeIn(clamp01((t - (spec.duration - 0.4)) / 0.4));
  const bar = easeOut(t / 0.25) * (1 - outP);
  const open = easeInOut((t - 0.15) / 0.45) * (1 - outP);
  f.movable({ x, y, w, h }, () => {
    ctx.save();
    if (bar <= 0) {
      ctx.restore();
      return;
    }
    // Barra de acento que entra primero y abre el panel.
    shadow(f, 40, 14, "rgba(0,0,0,0.4)");
    ctx.fillStyle = rgba(spec.surface, 0.95);
    roundRect(ctx, x, y, Math.max(12 * u, w * open), h, 18 * u);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = spec.accent;
    roundRect(ctx, x, y + h * (1 - bar), 12 * u, h * bar, 6 * u);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w * open, h);
    ctx.clip();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f.font(800, 64 * u, fam);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, x + 44 * u, y + (role ? 86 : 76) * u, W * 0.8);
    if (role) {
      ctx.font = f.font(500, 34 * u, f.fonts.sans);
      ctx.fillStyle = mix(spec.accent, "#ffffff", 0.45);
      ctx.fillText(role, x + 44 * u, y + 138 * u, W * 0.8);
    }
    ctx.restore();
    ctx.restore();
  });
}

// ─── Cita ──────────────────────────────────────────────────────────────────

export function quoteCard(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f, 0.03));
  const text = spec.text || "La constancia le gana al talento";
  const w = cardW(f, 0.86);
  const x = cardX(f, w);
  ctx.font = f.font(400, 76 * u, f.fonts.serif, "italic");
  let size = 76 * u;
  let lines = wrap(ctx, text, w - 140 * u, 5);
  if (lines.length > 3) {
    size = 60 * u;
    ctx.font = f.font(400, size, f.fonts.serif, "italic");
    lines = wrap(ctx, text, w - 140 * u, 5);
  }
  const lh = size * 1.14;
  const h = 150 * u + lines.length * lh + (spec.kicker ? 80 * u : 30 * u);
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.3), f.H * 0.86);
  const { a, y } = rise(f, y0);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 36 * u);
    ctx.fillStyle = spec.accent;
    ctx.font = f.font(400, 220 * u, f.fonts.serif);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("“", x + 46 * u, y + 190 * u);
    ctx.font = f.font(400, size, f.fonts.serif, "italic");
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, i) => {
      const p = easeOut((t - 0.25 - i * 0.18) / 0.4);
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.fillText(line, x + 70 * u, y + 150 * u + i * lh + (1 - p) * 14 * u);
      ctx.restore();
    });
    if (spec.kicker) {
      ctx.globalAlpha *= easeOut((t - 0.6) / 0.4);
      ctx.fillStyle = rgba(spec.accent, 1);
      ctx.fillRect(x + 70 * u, y + h - 78 * u, 40 * u, 4 * u);
      ctx.font = f.font(500, 30 * u, f.fonts.mono);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.kicker, x + 126 * u, y + h - 76 * u);
    }
    ctx.restore();
  });
}

// ─── Cifra grande ──────────────────────────────────────────────────────────

export function bigStat(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f));
  const value = spec.text || "100 %";
  const label = spec.kicker || "";
  const w = cardW(f, 0.8);
  const x = cardX(f, w);
  const fam = displayFamily(f);
  const fit = fitFont(f, value, 900, fam, w - 120 * u, 230, 60);
  ctx.font = f.font(500, 44 * u, f.fonts.sans);
  const lines = label ? wrap(ctx, label, w - 120 * u, 3) : [];
  const h = 110 * u + fit.size * 1.0 + lines.length * 54 * u + 40 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.3), f.H * 0.86);
  const { a, y } = rise(f, y0);
  const parsed = parseCount(value);
  const k = easeOut(clamp01((t - 0.2) / 0.9));
  const shown = parsed && parsed.value >= 2 ? `${parsed.prefix}${formatCount(parsed.value * k, parsed)}${parsed.suffix}` : value;
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 36 * u, "glass");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = f.font(600, 26 * u, f.fonts.mono);
    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    ctx.arc(x + 66 * u, y + 66 * u, 8 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("DATO", x + 88 * u, y + 67 * u);
    ctx.textBaseline = "alphabetic";
    ctx.font = fit.font;
    const g = ctx.createLinearGradient(0, y + 100 * u, 0, y + 100 * u + fit.size);
    g.addColorStop(0, mix(spec.accent, "#ffffff", 0.35));
    g.addColorStop(1, spec.accent);
    ctx.fillStyle = g;
    ctx.fillText(shown, x + 56 * u, y + 96 * u + fit.size * 0.82);
    ctx.font = f.font(500, 44 * u, f.fonts.sans);
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, i) => {
      ctx.save();
      ctx.globalAlpha *= easeOut((t - 0.5 - i * 0.12) / 0.35);
      ctx.fillText(line, x + 60 * u, y + 110 * u + fit.size + i * 54 * u);
      ctx.restore();
    });
    ctx.restore();
  });
}

// ─── Lista numerada ────────────────────────────────────────────────────────

export function numberedList(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const items = itemsOr(f, ["Primera idea", "Segunda idea", "Tercera idea"], 4);
  const title = spec.text;
  const w = cardW(f, 0.86);
  const x = cardX(f, w);
  const rowH = 104 * u;
  const head = title ? 100 * u : 40 * u;
  const h = head + rowH * items.length + 40 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.1 : 0.12), f.H * 0.66);
  const { a, y } = rise(f, y0);
  const fam = displayFamily(f);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 34 * u, "glass");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (title) {
      ctx.font = f.font(800, 50 * u, fam);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(title, x + 50 * u, y + 64 * u, w - 100 * u);
    }
    items.forEach((item, i) => {
      const at = markAt(f, i, items.length);
      const p = clamp01((t - at) / 0.35);
      const ry = y + head + rowH * i + rowH / 2;
      ctx.save();
      ctx.globalAlpha *= 0.25 + 0.75 * easeOut(p);
      ctx.fillStyle = p > 0 ? spec.accent : "rgba(255,255,255,0.15)";
      const s = p > 0 ? backOut(p, 2) : 1;
      ctx.save();
      ctx.translate(x + 82 * u, ry);
      ctx.scale(s, s);
      roundRect(ctx, -34 * u, -34 * u, 68 * u, 68 * u, 18 * u);
      ctx.fill();
      ctx.fillStyle = p > 0 ? onColor(spec.accent) : "rgba(255,255,255,0.6)";
      ctx.font = f.font(700, 32 * u, f.fonts.mono);
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1).padStart(2, "0"), 0, 2 * u);
      ctx.restore();
      const fit = fitFont(f, item, 600, f.fonts.sans, w - 200 * u, 46, 24);
      ctx.font = fit.font;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(item, x + 140 * u + (1 - easeOut(p)) * 20 * u, ry + 2 * u);
      ctx.restore();
    });
    ctx.restore();
  });
}

// ─── Pros y contras ────────────────────────────────────────────────────────

export function prosCons(f: FxFrame): void {
  const { ctx, t, u } = f;
  f.drawBase(ctx);
  const items = itemsOr(f, ["A favor", "También", "En contra", "Ojo"], 4);
  const pros = items.slice(0, 2);
  const cons = items.slice(2, 4);
  const w = cardW(f, 0.9);
  const x = cardX(f, w);
  const colW = (w - 60 * u) / 2;
  const rowH = 96 * u;
  const h = 120 * u + rowH * 2 + 30 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.1 : 0.12), f.H * 0.68);
  const { a, y } = rise(f, y0);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 34 * u, "glass");
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x + w / 2 - 1 * u, y + 40 * u, 2 * u, h - 80 * u);
    const cols: [string[], string, string, boolean][] = [
      [pros, "A FAVOR", "#22c55e", false],
      [cons, "EN CONTRA", "#ef4444", true],
    ];
    cols.forEach(([list, head, color, isCons], c) => {
      const cx = x + 30 * u + c * (colW + 0) + (c ? 30 * u : 0);
      ctx.font = f.font(700, 28 * u, f.fonts.mono);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(head, cx + 20 * u, y + 66 * u);
      list.forEach((item, i) => {
        const k = c * 2 + i;
        const at = markAt(f, k, 4);
        const p = clamp01((t - at) / 0.35);
        const ry = y + 120 * u + rowH * i + rowH / 2;
        ctx.save();
        ctx.globalAlpha *= easeOut(p);
        ctx.beginPath();
        ctx.arc(cx + 40 * u, ry, 24 * u, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 6 * u;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (isCons) crossStroke(ctx, cx + 40 * u, ry, 24 * u, clamp01((t - at - 0.05) / 0.25));
        else checkStroke(ctx, cx + 40 * u, ry, 24 * u, clamp01((t - at - 0.05) / 0.25));
        const fit = fitFont(f, item, 600, f.fonts.sans, colW - 100 * u, 38, 20);
        ctx.font = fit.font;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(item, cx + 80 * u, ry + 2 * u);
        ctx.restore();
      });
    });
    ctx.restore();
  });
}

// ─── Línea de tiempo ───────────────────────────────────────────────────────

export function timelineSteps(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const items = itemsOr(f, ["Inicio", "Paso dos", "Paso tres", "Hoy"], 4);
  const n = items.length;
  const w = f.vertical ? W * 0.86 : W * 0.5;
  const x = f.vertical ? (W - w) / 2 : cardX(f, w);
  const h = 250 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.54 : 0.6), f.H * 0.8);
  const { a, y } = rise(f, y0);
  const ly = y + h / 2;
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    // Franja oscura de fondo, muy suave.
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 40 * u, y, w + 80 * u, h);
    const pad = 50 * u;
    const step = (w - pad * 2) / Math.max(1, n - 1);
    const last = markAt(f, n - 1, n);
    const prog = clamp01((t - markAt(f, 0, n)) / Math.max(0.3, last - markAt(f, 0, n)));
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(ctx, x + pad, ly - 4 * u, w - pad * 2, 8 * u, 4 * u);
    ctx.fill();
    ctx.fillStyle = spec.accent;
    roundRect(ctx, x + pad, ly - 4 * u, (w - pad * 2) * prog, 8 * u, 4 * u);
    ctx.fill();
    items.forEach((item, i) => {
      const nx = x + pad + step * i;
      const p = clamp01((t - markAt(f, i, n)) / 0.3);
      const s = p > 0 ? backOut(p, 2.4) : 0.7;
      ctx.save();
      ctx.translate(nx, ly);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.arc(0, 0, 22 * u, 0, Math.PI * 2);
      ctx.fillStyle = p > 0 ? spec.accent : "#2a3350";
      ctx.fill();
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= 0.3 + 0.7 * easeOut(p);
      const up = i % 2 === 0;
      const fit = fitFont(f, item, 700, f.fonts.sans, step * 1.15, 36, 18);
      ctx.font = fit.font;
      ctx.textAlign = i === 0 ? "left" : i === n - 1 ? "right" : "center";
      ctx.textBaseline = up ? "alphabetic" : "top";
      ctx.fillStyle = "#ffffff";
      const tx = i === 0 ? nx - 20 * u : i === n - 1 ? nx + 20 * u : nx;
      ctx.fillText(item, tx, up ? ly - 48 * u : ly + 48 * u);
      ctx.restore();
    });
    ctx.restore();
  });
}

// ─── Barra de progreso ─────────────────────────────────────────────────────

export function progressBar(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const label = spec.text || "Cargando";
  const target = clamp(Number((spec.kicker || "100").replace(/[^\d]/g, "")) || 100, 0, 100);
  const w = cardW(f, 0.82);
  const x = cardX(f, w);
  const h = 200 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.6), f.H * 0.8);
  const { a, y } = rise(f, y0);
  const fillDur = Math.min(1.8, spec.duration * 0.6);
  const p = easeInOut(clamp01((t - 0.3) / fillDur)) * (target / 100);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 32 * u, "glass");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = f.font(700, 42 * u, f.fonts.sans);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 46 * u, y + 62 * u, w - 260 * u);
    ctx.textAlign = "right";
    ctx.font = f.font(700, 42 * u, f.fonts.mono);
    ctx.fillStyle = spec.accent;
    ctx.fillText(`${Math.round(p * 100)} %`, x + w - 46 * u, y + 62 * u);
    const bx = x + 46 * u;
    const bw = w - 92 * u;
    const by = y + 120 * u;
    const bh = 34 * u;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    if (p > 0) {
      ctx.save();
      roundRect(ctx, bx, by, Math.max(bh, bw * p), bh, bh / 2);
      ctx.clip();
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, mix(spec.accent, "#ffffff", 0.25));
      g.addColorStop(1, spec.accent);
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
      // Rayas que corren.
      ctx.globalAlpha *= 0.18;
      ctx.fillStyle = "#ffffff";
      const off = f.host.reducedMotion ? 0 : (t * 80 * u) % (40 * u);
      for (let sx = bx - 40 * u + off; sx < bx + bw; sx += 40 * u) {
        ctx.beginPath();
        ctx.moveTo(sx, by + bh);
        ctx.lineTo(sx + 20 * u, by + bh);
        ctx.lineTo(sx + 40 * u, by);
        ctx.lineTo(sx + 20 * u, by);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  });
}

// ─── Encuesta ──────────────────────────────────────────────────────────────

export function poll(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const question = spec.text || "¿Te pasó?";
  const opts = itemsOr(f, ["Sí", "No"], 2);
  const w = cardW(f, 0.72);
  const x = cardX(f, w);
  const fam = displayFamily(f);
  ctx.font = f.font(800, 52 * u, fam);
  const qLines = wrap(ctx, question, w - 100 * u, 3);
  const h = 70 * u + qLines.length * 62 * u + opts.length * 112 * u + 30 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.3), f.H * 0.86);
  const pop = backOut(clamp01(t / 0.35), 1.6);
  const { a } = envelope(f, 0.05, 0.3);
  const pick = 0.9 + Math.min(0.6, spec.duration * 0.15);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x + w / 2, y0 + h / 2);
    ctx.rotate(-0.03);
    ctx.scale(pop, pop);
    ctx.translate(-(x + w / 2), -(y0 + h / 2));
    card(f, x, y0, w, h, 40 * u, "light");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = f.font(800, 52 * u, fam);
    ctx.fillStyle = "#0b1020";
    qLines.forEach((l, i) => ctx.fillText(l, x + w / 2, y0 + 70 * u + i * 62 * u));
    opts.forEach((opt, i) => {
      const oy = y0 + 70 * u + qLines.length * 62 * u + i * 112 * u;
      const chosen = i === 0 && t >= pick;
      const p = chosen ? easeOut((t - pick) / 0.35) : 0;
      roundRect(ctx, x + 40 * u, oy, w - 80 * u, 88 * u, 44 * u);
      ctx.fillStyle = "#eef1f6";
      ctx.fill();
      if (p > 0) {
        ctx.save();
        roundRect(ctx, x + 40 * u, oy, w - 80 * u, 88 * u, 44 * u);
        ctx.clip();
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, spec.accent);
        g.addColorStop(1, mix(spec.accent, "#ffffff", 0.3));
        ctx.fillStyle = g;
        ctx.fillRect(x + 40 * u, oy, (w - 80 * u) * p, 88 * u);
        ctx.restore();
      }
      ctx.font = f.font(700, 40 * u, f.fonts.sans);
      ctx.fillStyle = p > 0.5 ? onColor(spec.accent) : "#1c2233";
      ctx.fillText(opt, x + w / 2, oy + 46 * u, w - 200 * u);
      if (chosen) {
        ctx.strokeStyle = onColor(spec.accent);
        ctx.lineWidth = 6 * u;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        checkStroke(ctx, x + w - 96 * u, oy + 44 * u, 26 * u, clamp01((t - pick - 0.15) / 0.25));
      }
    });
    ctx.restore();
  });
}

// ─── Comentario ────────────────────────────────────────────────────────────

export function socialComment(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const text = spec.text || "¿Cómo lo haces?";
  const name = spec.kicker || "Un seguidor";
  const w = cardW(f, 0.84);
  const x = cardX(f, w);
  ctx.font = f.font(500, 44 * u, f.fonts.sans);
  const lines = wrap(ctx, text, w - 210 * u, 4);
  const h = 120 * u + lines.length * 54 * u + 40 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.1 : 0.12), f.H * 0.68);
  const { a, y } = rise(f, y0);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 34 * u, "light");
    // Avatar con la inicial.
    const ax = x + 76 * u;
    const ay = y + 82 * u;
    const g = ctx.createLinearGradient(ax - 40 * u, ay - 40 * u, ax + 40 * u, ay + 40 * u);
    g.addColorStop(0, mix(spec.accent, "#ffffff", 0.3));
    g.addColorStop(1, spec.accent);
    ctx.beginPath();
    ctx.arc(ax, ay, 40 * u, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = onColor(spec.accent);
    ctx.font = f.font(800, 38 * u, f.fonts.sans);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toLocaleUpperCase("es") || "?", ax, ay + 2 * u);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f.font(700, 36 * u, f.fonts.sans);
    ctx.fillStyle = "#0b1020";
    ctx.fillText(name, x + 140 * u, y + 72 * u, w - 260 * u);
    ctx.font = f.font(500, 44 * u, f.fonts.sans);
    ctx.fillStyle = "#1c2233";
    lines.forEach((l, i) => ctx.fillText(l, x + 140 * u, y + 128 * u + i * 54 * u));
    // Corazón que late al final.
    const hp = clamp01((t - 0.8) / 0.4);
    const hs = 1 + 0.3 * Math.sin(hp * Math.PI);
    ctx.save();
    ctx.translate(x + w - 60 * u, y + 70 * u);
    ctx.scale(hs, hs);
    ctx.beginPath();
    ctx.moveTo(0, 14 * u);
    ctx.bezierCurveTo(-26 * u, -2 * u, -14 * u, -22 * u, 0, -10 * u);
    ctx.bezierCurveTo(14 * u, -22 * u, 26 * u, -2 * u, 0, 14 * u);
    ctx.closePath();
    ctx.fillStyle = hp > 0 ? "#ef4444" : "#c5cbd6";
    ctx.fill();
    ctx.restore();
    ctx.restore();
  });
}

// ─── Notificación ──────────────────────────────────────────────────────────

export function notification(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const app = spec.kicker || "Ahora";
  const text = spec.text || "Tienes un mensaje nuevo";
  const w = f.vertical ? W * 0.9 : W * 0.4;
  const x = (W - w) / 2 + (f.vertical ? 0 : W * 0.25);
  ctx.font = f.font(600, 38 * u, f.fonts.sans);
  const lines = wrap(ctx, text, w - 190 * u, 2);
  const h = 104 * u + lines.length * 46 * u;
  const yTarget = (f.vertical ? 110 : 50) * u;
  const enter = bounce(clamp01(t / 0.55));
  const outP = easeIn(clamp01((t - (spec.duration - 0.35)) / 0.35));
  const y = lerp(-h - 40 * u, yTarget, enter) - outP * (h + 80 * u);
  f.movable({ x, y: yTarget, w, h }, () => {
    ctx.save();
    card(f, x, y, w, h, 40 * u, "glass");
    const ix = x + 36 * u;
    const iy = y + h / 2 - 44 * u;
    const g = ctx.createLinearGradient(ix, iy, ix + 88 * u, iy + 88 * u);
    g.addColorStop(0, mix(spec.accent, "#ffffff", 0.25));
    g.addColorStop(1, spec.accent);
    roundRect(ctx, ix, iy, 88 * u, 88 * u, 22 * u);
    ctx.fillStyle = g;
    ctx.fill();
    // Campana simple dentro del ícono.
    ctx.fillStyle = onColor(spec.accent);
    ctx.beginPath();
    ctx.moveTo(ix + 44 * u, iy + 20 * u);
    ctx.quadraticCurveTo(ix + 66 * u, iy + 24 * u, ix + 66 * u, iy + 50 * u);
    ctx.lineTo(ix + 72 * u, iy + 62 * u);
    ctx.lineTo(ix + 16 * u, iy + 62 * u);
    ctx.lineTo(ix + 22 * u, iy + 50 * u);
    ctx.quadraticCurveTo(ix + 22 * u, iy + 24 * u, ix + 44 * u, iy + 20 * u);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ix + 44 * u, iy + 68 * u, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f.font(700, 30 * u, f.fonts.sans);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(app.toLocaleUpperCase("es"), x + 150 * u, y + 56 * u, w - 300 * u);
    ctx.textAlign = "right";
    ctx.font = f.font(500, 28 * u, f.fonts.sans);
    ctx.fillText("ahora", x + w - 40 * u, y + 56 * u);
    ctx.textAlign = "left";
    ctx.font = f.font(600, 38 * u, f.fonts.sans);
    ctx.fillStyle = "#ffffff";
    lines.forEach((l, i) => ctx.fillText(l, x + 150 * u, y + 104 * u + i * 46 * u));
    ctx.restore();
  });
}

// ─── Caja de preguntas ─────────────────────────────────────────────────────

export function questionBox(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const q = spec.text || "¿Por dónde empiezo?";
  const head = spec.kicker || "Me preguntaron";
  const w = cardW(f, 0.76);
  const x = cardX(f, w);
  const fam = displayFamily(f);
  ctx.font = f.font(700, 50 * u, fam);
  const lines = wrap(ctx, q, w - 100 * u, 3);
  const h = 130 * u + lines.length * 62 * u + 50 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.1 : 0.12), f.H * 0.68);
  const pop = backOut(clamp01(t / 0.35), 1.6);
  const { a } = envelope(f, 0.05, 0.3);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x + w / 2, y0 + h / 2);
    ctx.rotate(0.025);
    ctx.scale(pop, pop);
    ctx.translate(-(x + w / 2), -(y0 + h / 2));
    card(f, x, y0, w, h, 38 * u, "light");
    ctx.save();
    roundRect(ctx, x, y0, w, 110 * u, 38 * u);
    ctx.clip();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, spec.accent);
    g.addColorStop(1, mix(spec.accent, "#ffffff", 0.3));
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, 110 * u);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = f.font(700, 38 * u, f.fonts.sans);
    ctx.fillStyle = onColor(spec.accent);
    ctx.fillText(head, x + w / 2, y0 + 56 * u, w - 80 * u);
    ctx.font = f.font(700, 50 * u, fam);
    ctx.fillStyle = "#0b1020";
    const typed = Math.floor(q.length * clamp01((t - 0.35) / Math.min(1.2, q.length * 0.04)));
    let left = typed;
    lines.forEach((l, i) => {
      ctx.fillText(l.slice(0, Math.max(0, left)), x + w / 2, y0 + 150 * u + i * 62 * u);
      left -= l.length + 1;
    });
    ctx.restore();
  });
}

// ─── Estrellas ─────────────────────────────────────────────────────────────

export function ratingStars(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const n = clamp(Number((spec.kicker || "5").replace(/[^\d]/g, "")) || 5, 1, 5);
  const label = spec.text || "";
  const size = 64 * u;
  const gap = 26 * u;
  const rowW = size * 2 * 5 + gap * 4;
  const w = Math.max(rowW + 80 * u, 300 * u);
  const x = f.vertical ? (W - w) / 2 : cardX(f, w);
  const h = label ? 260 * u : 190 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.54 : 0.6), f.H * 0.82);
  const { a, y } = rise(f, y0);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 34 * u, "glass");
    for (let i = 0; i < 5; i++) {
      const cx = x + (w - rowW) / 2 + size + i * (size * 2 + gap);
      const cy = y + 96 * u;
      const on = i < n ? clamp01((t - 0.3 - i * 0.16) / 0.3) : 0;
      ctx.save();
      ctx.translate(cx, cy);
      const s = on > 0 ? backOut(on, 2.6) : 1;
      ctx.scale(s, s);
      starPath(ctx, 0, 0, size, 0.46);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fill();
      if (on > 0) {
        ctx.fillStyle = "#ffc93c";
        ctx.fill();
      }
      ctx.restore();
    }
    if (label) {
      ctx.globalAlpha *= easeOut((t - 0.4) / 0.35);
      ctx.font = f.font(700, 44 * u, f.fonts.sans);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + w / 2, y + 206 * u, w - 60 * u);
    }
    ctx.restore();
  });
}

// ─── Etiqueta ──────────────────────────────────────────────────────────────

export function priceTag(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const word = (spec.text || "GRATIS").toLocaleUpperCase("es");
  const fam = displayFamily(f);
  const fit = fitFont(f, word, 900, fam, 420 * u, 96, 30);
  const tw = fit.width + 150 * u;
  const th = 170 * u;
  const face = spec.face;
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const px = clamp(face.x + face.w / 2 + side * (face.w * 0.7 + tw * 0.55), tw * 0.6, W - tw * 0.6);
  const py = (f.vertical ? 120 : 40) * u;
  const box = { x: px - tw / 2, y: py, w: tw, h: th + 230 * u };
  const { a } = envelope(f, 0.05, 0.3);
  const drop = easeOut(clamp01(t / 0.35));
  const swing = f.host.reducedMotion ? 0 : 0.35 * Math.exp(-t * 1.6) * Math.cos(t * 6.5);
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(px, py - (1 - drop) * 300 * u);
    ctx.rotate(swing);
    // Hilo.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 200 * u);
    ctx.stroke();
    ctx.translate(0, 200 * u);
    ctx.rotate(-Math.PI / 2);
    shadow(f, 34, 0, "rgba(0,0,0,0.4)");
    // Forma de etiqueta (punta hacia arriba).
    const L = tw;
    const Hh = th;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-Hh * 0.38, -Hh / 2);
    ctx.lineTo(-L, -Hh / 2);
    ctx.lineTo(-L, Hh / 2);
    ctx.lineTo(-Hh * 0.38, Hh / 2);
    ctx.closePath();
    ctx.fillStyle = spec.accent;
    ctx.fill();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(-Hh * 0.3, 0, 14 * u, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.rotate(Math.PI / 2);
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = onColor(spec.accent);
    ctx.fillText(word, 0, (L + Hh * 0.38) / 2 + 4 * u, L - Hh * 0.5);
    ctx.restore();
  });
}

// ─── Buscador ──────────────────────────────────────────────────────────────

export function searchBar(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const q = spec.text || "cómo crecer en redes";
  const w = cardW(f, 0.86);
  const x = cardX(f, w);
  const h = 120 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.6), f.H * 0.82);
  const { a, y } = rise(f, y0, 0.3);
  const typeDur = Math.min(spec.duration * 0.55, Math.max(0.5, q.length * 0.05));
  const shown = q.slice(0, Math.floor(q.length * clamp01((t - 0.3) / typeDur)));
  const done = t > 0.3 + typeDur + 0.15;
  const press = done ? 1 - 0.04 * Math.sin(clamp01((t - 0.3 - typeDur - 0.15) / 0.2) * Math.PI) : 1;
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(press, press);
    ctx.translate(-(x + w / 2), -(y + h / 2));
    shadow(f, 40, 14, "rgba(0,0,0,0.35)");
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    noShadow(ctx);
    // Lupa.
    ctx.strokeStyle = "#5b6478";
    ctx.lineWidth = 6 * u;
    ctx.beginPath();
    ctx.arc(x + 70 * u, y + h / 2 - 4 * u, 20 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 84 * u, y + h / 2 + 10 * u);
    ctx.lineTo(x + 100 * u, y + h / 2 + 26 * u);
    ctx.stroke();
    const fit = fitFont(f, q, 500, f.fonts.sans, w - 260 * u, 46, 22);
    ctx.font = fit.font;
    ctx.fillStyle = "#1c2233";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, x + 128 * u, y + h / 2 + 2 * u);
    if (!done && Math.floor(t * 2.4) % 2 === 0) {
      const cw = ctx.measureText(shown).width;
      ctx.fillStyle = spec.accent;
      ctx.fillRect(x + 132 * u + cw, y + h / 2 - 26 * u, 4 * u, 52 * u);
    }
    // Botón.
    ctx.beginPath();
    ctx.arc(x + w - h / 2, y + h / 2, h * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = done ? spec.accent : "#e8ebf1";
    ctx.fill();
    ctx.strokeStyle = done ? onColor(spec.accent) : "#8a93a6";
    ctx.lineWidth = 6 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + w - h / 2 - 14 * u, y + h / 2);
    ctx.lineTo(x + w - h / 2 + 14 * u, y + h / 2);
    ctx.moveTo(x + w - h / 2 + 2 * u, y + h / 2 - 12 * u);
    ctx.lineTo(x + w - h / 2 + 14 * u, y + h / 2);
    ctx.lineTo(x + w - h / 2 + 2 * u, y + h / 2 + 12 * u);
    ctx.stroke();
    ctx.restore();
  });
}

// ─── Definición ────────────────────────────────────────────────────────────

export function definition(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx, breathe(f, 0.03));
  const word = spec.text || "constancia";
  const kind = spec.kicker || "";
  const def = spec.items[0] || "";
  const w = cardW(f, 0.86);
  const x = cardX(f, w);
  ctx.font = f.font(500, 42 * u, f.fonts.sans);
  const lines = def ? wrap(ctx, def, w - 120 * u, 4) : [];
  const h = 230 * u + lines.length * 54 * u + 30 * u;
  const y0 = avoidFace(f, h, f.H * (f.vertical ? 0.5 : 0.3), f.H * 0.86);
  const { a, y } = rise(f, y0);
  f.movable({ x, y: y0, w, h }, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    card(f, x, y, w, h, 30 * u);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const fit = fitFont(f, word, 400, f.fonts.serif, w - 120 * u, 110, 40);
    ctx.font = fit.font;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(word, x + 60 * u, y + 40 * u + fit.size * 0.9);
    if (kind) {
      ctx.font = f.font(400, 40 * u, f.fonts.serif, "italic");
      ctx.fillStyle = mix(spec.accent, "#ffffff", 0.4);
      ctx.fillText(kind, x + 60 * u, y + 70 * u + fit.size * 0.9 + 20 * u);
    }
    const ruleY = y + 200 * u;
    ctx.fillStyle = spec.accent;
    ctx.fillRect(x + 60 * u, ruleY, (w - 120 * u) * easeInOut((t - 0.25) / 0.5), 3 * u);
    ctx.font = f.font(500, 42 * u, f.fonts.sans);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    lines.forEach((l, i) => {
      ctx.save();
      ctx.globalAlpha *= easeOut((t - 0.5 - i * 0.12) / 0.35);
      ctx.fillText(l, x + 60 * u, ruleY + 66 * u + i * 54 * u);
      ctx.restore();
    });
    ctx.restore();
  });
}
