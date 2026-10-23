/**
 * Efectos con especificación de referencia: zoom digital, portada de revista, checklist, letras de vidrio, teléfono con
 * tareas, gráfico que crece y muro de titulares. Los números (tamaños, tiempos, colores) siguen la especificación y
 * están en píxeles de un cuadro de 1080 de lado corto (`u`).
 */
import { backOut, bounce, clamp, clamp01, easeInOut, easeOut, fitSize, FxFrame, letterOffsets, lerp, rgba, rng, roundRect, wrap, type FxCtx, type Layer, type Xf } from "./core";

const exitAlpha = (f: FxFrame, len = 0.25) => clamp01((f.spec.duration - f.t) / len);

// ─── 05 Zoom digital ──────────────────────────────────────────────────────

/** Escala del zoom digital en un instante: 1,0 → 1,3 en la primera palabra fuerte, 1,6 en la segunda de la misma frase y
 * de vuelta a 1,0 (corte seco) cuando termina la frase. */
export function digitalZoomScale(words: { t0: number; t1: number; stop: boolean; strong: boolean }[], t: number): number {
  let z = 1;
  for (const w of words) {
    if (w.t0 > t) break;
    if (w.strong) z = z === 1 ? 1.3 : 1.6;
    if (w.stop && w.t1 <= t) z = 1;
  }
  return z;
}

export function digitalZoom(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const z = digitalZoomScale(spec.words, t);
  f.drawBase(ctx, { s: z, px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 });
  // Subtítulos propios: lo ya dicho de la frase en una línea chica y la palabra actual en grande debajo.
  const idx = spec.words.findIndex((w) => t >= w.t0 && t < Math.max(w.t1, w.t0 + 0.12));
  const lastSaid = idx >= 0 ? idx : spec.words.reduce((acc, w, i) => (w.t1 <= t ? i : acc), -1);
  if (lastSaid < 0) return;
  // Si la palabra ya terminó y no empezó otra, se mantiene en pantalla hasta la siguiente (sin parpadeo).
  const cur = spec.words[lastSaid]!;
  let first = lastSaid;
  while (first > 0 && !spec.words[first - 1]!.stop) first--;
  const said = spec.words.slice(Math.max(first, lastSaid - 6), lastSaid).map((w) => w.text).join(" ");
  const cy = H * (f.vertical ? 0.7 : 0.78);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18 * u * f.pixelScale;
  ctx.shadowOffsetY = 4 * u * f.pixelScale;
  ctx.fillStyle = "#ffffff";
  if (said) {
    const size = fitSize(ctx, said, (s) => f.font(600, s, f.fonts.sans), W * 0.84, 44 * u, 20 * u);
    ctx.font = f.font(600, size, f.fonts.sans);
    ctx.globalAlpha = 0.86;
    ctx.fillText(said, W / 2, cy - 118 * u);
  }
  ctx.globalAlpha = 1;
  const big = cur.text;
  const size = fitSize(ctx, big, (s) => f.font(800, s, f.fonts.sans), W * 0.86, 128 * u, 40 * u);
  ctx.font = f.font(800, size, f.fonts.sans);
  ctx.fillText(big, W / 2, cy);
  ctx.restore();
}

// ─── 16 Portada de revista ────────────────────────────────────────────────

export function coverStory(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  // Todo el cuadro con un zoom muy lento de 1,05 a 1,0.
  const s = lerp(1.05, 1, clamp01(t / spec.duration));
  const xf: Xf = { s, px: W / 2, py: H / 2, tx: 0, ty: 0 };
  f.drawBase(ctx, xf);
  const word = (spec.text || "PORTADA").toLocaleUpperCase("es");
  const size = fitSize(ctx, word, (sz) => f.font(400, sz, f.fonts.serif), W * 0.94, H * (f.vertical ? 0.24 : 0.42));
  ctx.font = f.font(400, size, f.fonts.serif);
  const cap = size * 0.7;
  const face = spec.face;
  // La cabeza tapa la parte de abajo de las letras: la línea de base va a la altura de los ojos (con lugar arriba).
  const baseline = clamp(face.y + face.h * 0.42, H * 0.1 + cap, H * 0.62);
  const letters = letterOffsets(ctx, word);
  const total = ctx.measureText(word).width;
  const x0 = (W - total) / 2;
  f.behind(() => {
    ctx.save();
    ctx.font = f.font(400, size, f.fonts.serif);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 24 * u * f.pixelScale;
    letters.forEach((l, i) => {
      const p = easeOut((t - 0.12 - i * 0.05) / 0.4);
      if (p <= 0) return;
      ctx.globalAlpha = p;
      ctx.fillText(l.ch, x0 + l.x, baseline + (1 - p) * 34 * u);
    });
    ctx.restore();
  });
  f.drawPerson(ctx, xf);
  // Un velo muy suave abajo para que se lea el texto de portada (el color sigue natural).
  const g = ctx.createLinearGradient(0, H * 0.58, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.58, W, H * 0.42);
  // Arriba a la izquierda, en mono chico: mes y año · número.
  const enter = easeOut((t - 0.2) / 0.4);
  ctx.save();
  ctx.globalAlpha = enter;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = f.font(500, 30 * u, f.fonts.mono);
  ctx.fillText((spec.kicker || "").toLocaleUpperCase("es"), 64 * u, (f.vertical ? 190 : 90) * u);
  ctx.restore();
  // Abajo a la izquierda, serif itálica en dos líneas (el titular se puede mover desde el lienzo de la revisión).
  const lines = spec.items.slice(0, 2);
  const lsize = 74 * u;
  const by = H * (f.vertical ? 0.765 : 0.82);
  const box = { x: 64 * u, y: by - lsize * 0.82, w: W * 0.8, h: lsize * 0.82 + Math.max(0, lines.length - 1) * lsize * 1.02 + lsize * 0.3 };
  f.movable(box, () => {
    const lp = easeOut((t - 0.45) / 0.45);
    ctx.save();
    ctx.globalAlpha *= lp;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, i) => {
      const fit = fitSize(ctx, line, (sz) => f.font(400, sz, f.fonts.serif, "italic"), W * 0.8, lsize);
      ctx.font = f.font(400, fit, f.fonts.serif, "italic");
      ctx.fillText(line, 64 * u, by + i * lsize * 1.02 + (1 - lp) * 20 * u);
    });
    ctx.restore();
  });
}

// ─── 07 Checklist ─────────────────────────────────────────────────────────

function glassCard(f: FxFrame, x: number, y: number, w: number, h: number, r: number, tint = 0.6): void {
  const { ctx, u } = f;
  ctx.save();
  // Sombra suave.
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 40 * u * f.pixelScale;
  ctx.shadowOffsetY = 16 * u * f.pixelScale;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgba(0,0,0,0.01)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, "blur(22px)");
  ctx.fillStyle = `rgba(0,0,0,${tint})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save();
  roundRect(ctx, x + 1 * u, y + 1 * u, w - 2 * u, h - 2 * u, r);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  ctx.restore();
}

function checkMark(ctx: FxCtx, cx: number, cy: number, r: number, p: number, color: string, width: number): void {
  if (p <= 0) return;
  const pts = [
    [cx - r * 0.42, cy + r * 0.02],
    [cx - r * 0.1, cy + r * 0.32],
    [cx + r * 0.45, cy - r * 0.3],
  ] as const;
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const len = (l1 + l2) * clamp01(p);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (len <= l1) ctx.lineTo(lerp(pts[0][0], pts[1][0], len / l1), lerp(pts[0][1], pts[1][1], len / l1));
  else {
    ctx.lineTo(pts[1][0], pts[1][1]);
    const k = (len - l1) / l2;
    ctx.lineTo(lerp(pts[1][0], pts[2][0], k), lerp(pts[1][1], pts[2][1], k));
  }
  ctx.stroke();
  ctx.restore();
}

/** Ubicación de una tarjeta: arriba (donde pide el efecto) salvo que tape la cara; si tapa, debajo de la cara. */
function placeAvoidingFace(f: FxFrame, h: number, preferTop: number, maxBottom: number): number {
  const safe = f.faceSafe;
  const overlaps = (y: number) => y < safe.y + safe.h && y + h > safe.y;
  if (!overlaps(preferTop)) return preferTop;
  const above = safe.y - h - 24 * f.u;
  if (above >= f.H * 0.06) return above;
  const below = safe.y + safe.h + 24 * f.u;
  if (below + h <= maxBottom) return below;
  return preferTop;
}

export function checklist(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  f.drawBase(ctx);
  const items = spec.items.length ? spec.items : ["Primer paso", "Segundo paso", "Tercer paso"];
  const w = W * (f.vertical ? 0.85 : 0.5);
  const rowH = 108 * u;
  const pad = 40 * u;
  const h = pad * 2 + 54 * u + rowH * items.length;
  const x = f.vertical ? (W - w) / 2 : W * 0.06;
  const y0 = placeAvoidingFace(f, h, f.vertical ? H * 0.1 : H * 0.12, H * 0.6);
  // La tarjeta se puede mover desde el lienzo de la revisión.
  f.movable({ x, y: y0, w, h }, () => checklistCard(f, items, x, y0, w, h, rowH, pad));
}

function checklistCard(f: FxFrame, items: string[], x: number, y0: number, w: number, h: number, rowH: number, pad: number): void {
  const { ctx, spec, t, u } = f;
  const enter = easeOut(t / 0.3);
  const alpha = enter * exitAlpha(f);
  if (alpha <= 0) return;
  const y = y0 + (1 - enter) * 30 * u;
  ctx.save();
  ctx.globalAlpha = alpha;
  glassCard(f, x, y, w, h, 30 * u);
  // Rótulo: mono chico en mayúsculas, gris, con un punto de color.
  ctx.fillStyle = spec.accent;
  ctx.beginPath();
  ctx.arc(x + pad + 7 * u, y + pad + 12 * u, 7 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(220,224,232,0.72)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const label = (spec.text || "TODO LO QUE TIENES QUE HACER").toLocaleUpperCase("es");
  const lsize = fitSize(ctx, label, (s) => f.font(500, s, f.fonts.mono), w - pad * 2 - 30 * u, 28 * u);
  ctx.font = f.font(500, lsize, f.fonts.mono);
  ctx.fillText(label, x + pad + 26 * u, y + pad + 12 * u);
  items.forEach((item, i) => {
    const ry = y + pad + 54 * u + rowH * i + rowH / 2;
    const cx = x + pad + 24 * u;
    const at = spec.marks[i] ?? 0.6 + i * 0.6;
    const p = (t - at) / 0.45;
    const done = p >= 0;
    if (!done) {
      // Aún no dicho: círculo vacío y una barra gris.
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(cx, ry, 22 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = f.font(600, 44 * u, f.fonts.sans);
      const bw = Math.min(w - pad * 2 - 80 * u, Math.max(160 * u, ctx.measureText(item).width));
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      roundRect(ctx, cx + 48 * u, ry - 11 * u, bw, 22 * u, 11 * u);
      ctx.fill();
      return;
    }
    const sc = bounce(p);
    ctx.save();
    ctx.translate(cx, ry);
    ctx.scale(sc, sc);
    ctx.fillStyle = spec.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 22 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    checkMark(ctx, cx, ry, 22 * u, (t - at - 0.08) / 0.25, spec.accentText, 5 * u);
    ctx.save();
    ctx.globalAlpha *= easeOut(p / 0.4);
    ctx.fillStyle = "#ffffff";
    const size = fitSize(ctx, item, (s) => f.font(600, s, f.fonts.sans), w - pad * 2 - 80 * u, 44 * u);
    ctx.font = f.font(600, size, f.fonts.sans);
    ctx.fillText(item, cx + 48 * u, ry + 1 * u);
    ctx.restore();
  });
  ctx.restore();
}

// ─── 17 Letras de vidrio ──────────────────────────────────────────────────

export function glassType(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const word = (spec.text || "FOCO").toLocaleUpperCase("es");
  const family = spec.display === "montserrat" ? f.fonts.display : f.fonts.sans;
  const size = fitSize(ctx, word, (s) => f.font(900, s, family), W * 0.94, H * (f.vertical ? 0.26 : 0.44));
  const font = f.font(900, size, family);
  ctx.font = font;
  const letters = letterOffsets(ctx, word);
  const total = ctx.measureText(word).width;
  const x0 = (W - total) / 2;
  const face = f.spec.face;
  const baseline = clamp(face.y + face.h * 0.72, H * 0.08 + size * 0.72, H * 0.66);
  const top = baseline - size * 0.74;
  const lettersIn = 0.1 + letters.length * 0.05 + 0.35;
  const exit = exitAlpha(f, 0.3);
  // 1. Máscara de las letras (cada una entra subiendo).
  const shape = f.layer("glass-shape");
  const sx = shape.ctx;
  sx.font = font;
  sx.textAlign = "left";
  sx.textBaseline = "alphabetic";
  sx.fillStyle = "#ffffff";
  letters.forEach((l, i) => {
    const p = easeOut((t - 0.1 - i * 0.05) / 0.35);
    if (p <= 0) return;
    sx.globalAlpha = p * exit;
    sx.fillText(l.ch, x0 + l.x, baseline + (1 - p) * 40 * u);
  });
  sx.globalAlpha = 1;
  // 2. Adentro del vidrio: el fondo corrido 14 px, desenfocado y aclarado un 20 %.
  const inner = f.layer("glass-inner", 0.5);
  f.drawBase(inner.ctx, { s: 1, px: 0, py: 0, tx: 14 * u, ty: 8 * u }, "blur(12px) brightness(1.2)", 1, 0.5);
  inner.ctx.fillStyle = "rgba(255,255,255,0.14)";
  inner.ctx.fillRect(0, 0, W, H);
  maskWith(inner, shape);
  // 3. Sombra suave (copia oscura y desenfocada de las letras).
  const shadow = f.layer("glass-shadow");
  shadow.ctx.drawImage(shape.canvas, 0, 0, W, H);
  shadow.ctx.globalCompositeOperation = "source-in";
  shadow.ctx.fillStyle = "rgba(0,0,0,0.38)";
  shadow.ctx.fillRect(0, 0, W, H);
  // 4. Borde interior blanco suave y filo de luz arriba de cada letra.
  const rim = f.layer("glass-rim");
  rim.ctx.font = font;
  rim.ctx.textBaseline = "alphabetic";
  rim.ctx.strokeStyle = "rgba(255,255,255,0.55)";
  rim.ctx.lineWidth = 7 * u;
  rim.ctx.lineJoin = "round";
  letters.forEach((l, i) => {
    const p = easeOut((t - 0.1 - i * 0.05) / 0.35);
    if (p <= 0) return;
    rim.ctx.strokeText(l.ch, x0 + l.x, baseline + (1 - p) * 40 * u);
  });
  // Filo de luz: la parte de arriba de cada letra (la letra menos ella misma corrida hacia abajo).
  rim.ctx.globalCompositeOperation = "source-over";
  const edge = f.layer("glass-edge");
  edge.ctx.drawImage(shape.canvas, 0, 0, W, H);
  edge.ctx.globalCompositeOperation = "destination-out";
  edge.ctx.drawImage(shape.canvas, 0, 5 * u, W, H);
  edge.ctx.globalCompositeOperation = "source-in";
  edge.ctx.fillStyle = "rgba(255,255,255,0.85)";
  edge.ctx.fillRect(0, 0, W, H);
  maskWith(rim, shape);
  // 5. Brillo diagonal que cruza de izquierda a derecha en 0,5 s.
  const shineP = (t - lettersIn) / 0.5;
  const shine = shineP > 0 && shineP < 1 ? f.layer("glass-shine") : null;
  if (shine) {
    const bx = lerp(x0 - W * 0.3, x0 + total + W * 0.1, shineP);
    const g = shine.ctx.createLinearGradient(bx, top, bx + W * 0.22, top + size);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.65)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    shine.ctx.fillStyle = g;
    shine.ctx.fillRect(0, 0, W, H);
    maskWith(shine, shape);
  }
  f.behind(() => {
    ctx.save();
    ctx.filter = f.scaleFilter("blur(16px)");
    ctx.drawImage(shadow.canvas, 0, 12 * u, W, H);
    ctx.restore();
    ctx.drawImage(inner.canvas, 0, 0, W, H);
    ctx.drawImage(rim.canvas, 0, 0, W, H);
    ctx.drawImage(edge.canvas, 0, 0, W, H);
    if (shine) ctx.drawImage(shine.canvas, 0, 0, W, H);
  });
  f.drawPerson(ctx);
}

/** Deja en `ctx` solo lo que cae dentro de la forma. */
function maskWith(target: Layer, shape: Layer): void {
  const ctx = target.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(shape.canvas, 0, 0, target.canvas.width, target.canvas.height);
  ctx.restore();
}

// ─── 06 Teléfono con tareas ───────────────────────────────────────────────

export function phoneMockup(f: FxFrame): void {
  const { ctx, W, H, u } = f;
  f.drawBase(ctx);
  // ~230 px de ancho en la referencia (720 de ancho): 320 en 1080.
  const pw = 320 * u;
  const ph = pw * 2.05;
  const right = f.faceCx <= W / 2;
  const margin = 70 * u;
  const cx = right ? W - margin - pw / 2 : margin + pw / 2;
  const safe = f.faceSafe;
  const hOverlap = cx - pw * 0.62 < safe.x + safe.w && cx + pw * 0.62 > safe.x;
  let cy = hOverlap ? safe.y + safe.h + 30 * u + ph / 2 : Math.max(f.faceCy + ph * 0.1, H * 0.3);
  cy = clamp(cy, ph / 2 + H * 0.05, H * (f.vertical ? 0.62 : 0.72) - ph / 2 + ph * 0.1);
  // El teléfono se puede mover desde el lienzo de la revisión (caja sin girar, centrada donde queda quieto).
  f.movable({ x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph }, () => phoneBody(f, cx, cy, pw, ph, right, margin));
}

function phoneBody(f: FxFrame, cx: number, cy: number, pw: number, ph: number, right: boolean, margin: number): void {
  const { ctx, spec, t, u } = f;
  const enter = easeOut(t / 0.4);
  const exit = easeIn01(clamp01((t - (spec.duration - 0.3)) / 0.3));
  const off = (1 - enter + exit) * (pw + margin * 2) * (right ? 1 : -1);
  ctx.save();
  ctx.translate(cx + off, cy);
  ctx.rotate((-10 * Math.PI) / 180);
  // Sombra suave.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 50 * u * f.pixelScale;
  ctx.shadowOffsetY = 24 * u * f.pixelScale;
  roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 56 * u);
  ctx.fillStyle = "#050506";
  ctx.fill();
  ctx.restore();
  // Marco con un filo de luz.
  roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 56 * u);
  const rimG = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
  rimG.addColorStop(0, "#3a3d44");
  rimG.addColorStop(0.5, "#101114");
  rimG.addColorStop(1, "#2a2c31");
  ctx.strokeStyle = rimG;
  ctx.lineWidth = 4 * u;
  ctx.stroke();
  // Pantalla: app oscura.
  const b = 11 * u;
  const sxp = -pw / 2 + b;
  const syp = -ph / 2 + b;
  const sw = pw - b * 2;
  const sh = ph - b * 2;
  ctx.save();
  roundRect(ctx, sxp, syp, sw, sh, 46 * u);
  ctx.clip();
  const bgG = ctx.createLinearGradient(0, syp, 0, syp + sh);
  bgG.addColorStop(0, "#14161c");
  bgG.addColorStop(1, "#0b0c10");
  ctx.fillStyle = bgG;
  ctx.fillRect(sxp, syp, sw, sh);
  // Isla.
  ctx.fillStyle = "#000000";
  roundRect(ctx, -sw * 0.17, syp + 14 * u, sw * 0.34, 30 * u, 15 * u);
  ctx.fill();
  // Título "Hoy".
  const title = spec.text || "Hoy";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = f.font(800, 52 * u, f.fonts.sans);
  ctx.fillText(title, sxp + 24 * u, syp + 128 * u);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = f.font(500, 19 * u, f.fonts.sans);
  const items = spec.items.length ? spec.items.slice(0, 4) : ["Grabar el reel", "Editar", "Publicar", "Responder"];
  const doneCount = items.filter((_, i) => t >= 0.45 + i * 0.1).length;
  ctx.fillText(`${doneCount} de ${items.length} tareas`, sxp + 24 * u, syp + 158 * u);
  items.forEach((item, i) => {
    const ry = syp + 214 * u + i * 86 * u;
    roundRect(ctx, sxp + 14 * u, ry - 34 * u, sw - 28 * u, 70 * u, 18 * u);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    const at = 0.45 + i * 0.1;
    const p = (t - at) / 0.3;
    const dx = sxp + 44 * u;
    if (p < 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2.5 * u;
      ctx.beginPath();
      ctx.arc(dx, ry + 1 * u, 13 * u, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(dx, ry + 1 * u);
      const sc = bounce(p);
      ctx.scale(sc, sc);
      ctx.fillStyle = spec.accent;
      ctx.beginPath();
      ctx.arc(0, 0, 13 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      checkMark(ctx, dx, ry + 1 * u, 13 * u, p * 1.4, spec.accentText, 3 * u);
    }
    ctx.fillStyle = p >= 0 ? "rgba(255,255,255,0.55)" : "#ffffff";
    const size = fitSize(ctx, item, (s) => f.font(600, s, f.fonts.sans), sw - 100 * u, 23 * u);
    ctx.font = f.font(600, size, f.fonts.sans);
    ctx.textBaseline = "middle";
    ctx.fillText(item, dx + 28 * u, ry + 2 * u);
    if (p >= 0) {
      const tw = ctx.measureText(item).width * clamp01(p * 1.5);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(dx + 28 * u, ry + 1 * u, tw, 2 * u);
    }
    ctx.textBaseline = "alphabetic";
  });
  ctx.restore();
  ctx.restore();
}

const easeIn01 = (p: number) => clamp01(p) ** 2;

// ─── 10 Gráfico que crece ─────────────────────────────────────────────────

export function chartCurve(x: number): number {
  // Casi plana al principio y subiendo fuerte al final.
  return (Math.exp(4.2 * x) - 1) / (Math.exp(4.2) - 1);
}

export function chartGrow(f: FxFrame): void {
  const { ctx, t, W, H, u } = f;
  f.drawBase(ctx);
  const fade = easeOut(t / 0.2) * exitAlpha(f);
  ctx.fillStyle = `rgba(0,0,0,${0.6 * fade})`;
  ctx.fillRect(0, 0, W, H);
  if (fade <= 0) return;
  const left = W * (f.vertical ? 0.1 : 0.2);
  const right = W * (f.vertical ? 0.9 : 0.8);
  // El gráfico va arriba o debajo de la cara (nunca encima): la franja libre más alta.
  const safe = f.faceSafe;
  const minH = H * (f.vertical ? 0.17 : 0.3);
  const aboveTop = H * 0.07;
  const aboveBottom = safe.y - 30 * u;
  const belowTop = safe.y + safe.h + 50 * u;
  const belowBottom = H * (f.vertical ? 0.62 : 0.8);
  let top = H * 0.14;
  let bottom = H * (f.vertical ? 0.47 : 0.62);
  if (aboveBottom - aboveTop >= minH) {
    top = aboveTop + 30 * u;
    bottom = Math.min(aboveBottom, aboveTop + H * 0.36);
  } else if (belowBottom - belowTop >= minH) {
    top = belowTop;
    bottom = belowBottom;
  }
  // El gráfico (días, línea y pastilla) se puede mover desde el lienzo de la revisión; el velo oscuro queda quieto.
  f.movable({ x: left - 40 * u, y: top - 40 * u, w: right - left + 80 * u, h: bottom - top + 140 * u }, () => chartBody(f, fade, left, right, top, bottom));
}

function chartBody(f: FxFrame, fade: number, left: number, right: number, top: number, bottom: number): void {
  const { ctx, spec, t, u } = f;
  const days = ["L", "M", "M", "J", "V", "S", "D"];
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = f.font(500, 30 * u, f.fonts.mono);
  days.forEach((d, i) => {
    const x = lerp(left, right, i / (days.length - 1));
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(d, x, top);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x - 1 * u, top + 22 * u, 2 * u, bottom - top - 22 * u);
  });
  const y0 = bottom - 20 * u;
  const y1 = top + 70 * u;
  const p = easeInOut((t - 0.15) / 0.6);
  const n = 64;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    if (x > p) break;
    pts.push([lerp(left, right, x), lerp(y0, y1, chartCurve(x))]);
  }
  if (p > 0 && pts.length) {
    const tipX = lerp(left, right, p);
    const tipY = lerp(y0, y1, chartCurve(p));
    pts.push([tipX, tipY]);
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    // Brillo del color de acento (14 px) y la línea.
    ctx.save();
    ctx.strokeStyle = spec.accent;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 10 * u;
    ctx.shadowColor = spec.accent;
    ctx.shadowBlur = 28 * u * f.pixelScale;
    path();
    ctx.stroke();
    ctx.filter = f.scaleFilter("blur(14px)");
    ctx.globalAlpha *= 0.8;
    ctx.lineWidth = 16 * u;
    path();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = rgba("#ffffff", 0.35);
    ctx.lineWidth = 3 * u;
    ctx.lineCap = "round";
    path();
    ctx.stroke();
    ctx.restore();
    // Punto blanco en la punta.
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = rgba(spec.accent, 0.9);
    ctx.shadowBlur = 20 * u * f.pixelScale;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 13 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Pastilla "ESCALA ↗" con rebote al llegar arriba.
    const pp = (t - 0.75) / 0.45;
    if (pp > 0) {
      const label = `${(spec.text || "ESCALA").toLocaleUpperCase("es")} ↗`;
      ctx.font = f.font(800, 40 * u, f.fonts.sans);
      const tw = ctx.measureText(label).width;
      const bw = tw + 52 * u;
      const bh = 76 * u;
      const bx = Math.min(tipX - bw - 30 * u, right - bw);
      const by = tipY + 30 * u;
      const sc = backOut(clamp01(pp), 2.4);
      ctx.save();
      ctx.translate(bx + bw, by);
      ctx.scale(sc, sc);
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 24 * u * f.pixelScale;
      roundRect(ctx, -bw, 0, bw, bh, bh / 2);
      ctx.fillStyle = spec.accent;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = spec.accentText;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, -bw / 2, bh / 2 + 2 * u);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ─── 08 Muro de titulares ─────────────────────────────────────────────────

/** Lugares de las notas alrededor de la cabeza (centro de cada nota). */
export function wallSlots(f: FxFrame, n: number): { x: number; y: number }[] {
  const { W, H } = f;
  const cx = f.faceCx;
  const cy = f.faceCy;
  const fw = f.spec.face.w;
  const base = f.vertical
    ? [
        { x: cx - fw * 1.25, y: cy - H * 0.13 },
        { x: cx + fw * 1.25, y: cy - H * 0.11 },
        { x: cx - fw * 1.3, y: cy + H * 0.04 },
        { x: cx + fw * 1.3, y: cy + H * 0.06 },
        { x: cx, y: cy - H * 0.23 },
      ]
    : [
        { x: cx - W * 0.24, y: cy - H * 0.22 },
        { x: cx + W * 0.24, y: cy - H * 0.2 },
        { x: cx - W * 0.3, y: cy + H * 0.12 },
        { x: cx + W * 0.3, y: cy + H * 0.14 },
        { x: cx, y: cy - H * 0.36 },
      ];
  return base.slice(0, n).map((s) => ({ x: clamp(s.x, W * 0.18, W * 0.82), y: clamp(s.y, H * 0.08, H * 0.6) }));
}

export function headlineWall(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const items = spec.items.length ? spec.items.slice(0, 5) : ["Nadie te lo dice", "El error de todos", "Lo que sí funciona", "Así empezó todo", "La verdad"];
  const slots = wallSlots(f, items.length);
  const r = rng(spec.seed);
  const tilts = items.map(() => (r() * 12 - 6) * (Math.PI / 180));
  const nw = W * (f.vertical ? 0.4 : 0.24);
  const exit = exitAlpha(f);
  f.behind(() => {
    items.forEach((text, i) => {
      const p = (t - 0.1 - i * 0.07) / 0.4;
      if (p <= 0) return;
      const s = slots[i]!;
      ctx.save();
      ctx.globalAlpha *= clamp01(p * 2.5) * exit;
      ctx.translate(s.x, s.y);
      ctx.rotate(tilts[i]!);
      const sc = 0.85 + 0.15 * backOut(clamp01(p), 2.2);
      ctx.scale(sc, sc);
      ctx.font = f.font(400, 56 * u, f.fonts.serif);
      const lines = wrap(ctx, text, nw - 56 * u, 3);
      const nh = 64 * u + lines.length * 58 * u;
      ctx.shadowColor = "rgba(0,0,0,0.32)";
      ctx.shadowBlur = 22 * u * f.pixelScale;
      ctx.shadowOffsetY = 10 * u * f.pixelScale;
      ctx.fillStyle = "#F6F3EC";
      ctx.fillRect(-nw / 2, -nh / 2, nw, nh);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      // Línea de nota (papel) y titular en serif.
      ctx.fillStyle = "rgba(29,27,24,0.08)";
      ctx.fillRect(-nw / 2, -nh / 2 + 18 * u, nw, 2 * u);
      ctx.fillStyle = "#1d1b18";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      lines.forEach((line, k) => ctx.fillText(line, 0, -nh / 2 + 84 * u + k * 58 * u));
      // Chinche roja arriba.
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.arc(3 * u, -nh / 2 + 6 * u, 13 * u, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(-4 * u, -nh / 2 - 4 * u, 1 * u, 0, -nh / 2, 14 * u);
      g.addColorStop(0, "#ff8a80");
      g.addColorStop(1, "#c62828");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -nh / 2, 13 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  });
  f.drawPerson(ctx);
}
