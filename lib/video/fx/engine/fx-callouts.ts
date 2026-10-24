/**
 * Llamadas de atención: flecha y círculo a mano, lupa, marco que destella, emoji que salta (emojis dibujados, sin
 * imágenes de terceros), estallido, sí/no, antes y después, foco, encuadre de cámara, globo de diálogo y sello.
 */
import { backOut, bounce, clamp, clamp01, easeIn, easeInOut, easeOut, FxFrame, lerp, rgba, rng, roundRect, wrap, type FxCtx } from "./core";
import { breathe, checkStroke, crossStroke, displayFamily, ellipsePts, envelope, fitFont, frameIndex, handStroke, heartPath, mix, noShadow, onColor, pill, shadow, sparklePath, starPath } from "./kit";

/** Corrimiento del elemento movido en el lienzo (para lo que depende de dónde quedó: la lupa y el foco). */
function moved(f: FxFrame, box: { x: number; y: number; w: number; h: number }): { cx: number; cy: number; scale: number } {
  const tr = f.spec.place?.transform;
  return { cx: box.x + box.w / 2 + (tr?.x ?? 0) * f.W, cy: box.y + box.h / 2 + (tr?.y ?? 0) * f.H, scale: tr?.scale ?? 1 };
}

// ─── Flecha a mano ─────────────────────────────────────────────────────────

export function arrowDraw(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const face = spec.face;
  const { a } = envelope(f, 0.05, 0.3);
  // Desde abajo a un costado de la cara, curvada hacia ella.
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const tip: [number, number] = [face.x + face.w / 2 + side * face.w * 0.62, face.y + face.h * 0.62];
  const tail: [number, number] = [tip[0] + side * 230 * u, tip[1] + 300 * u];
  const ctrl: [number, number] = [tail[0] + side * 30 * u, tip[1] + 40 * u];
  const pts: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const q = i / 30;
    const x = (1 - q) ** 2 * tail[0] + 2 * (1 - q) * q * ctrl[0] + q * q * tip[0];
    const y = (1 - q) ** 2 * tail[1] + 2 * (1 - q) * q * ctrl[1] + q * q * tip[1];
    pts.push([x, y]);
  }
  const label = spec.text;
  ctx.font = f.font(700, 64 * u, f.fonts.hand);
  const lw = label ? ctx.measureText(label).width : 0;
  const minX = Math.min(tip[0], tail[0], tail[0] - lw / 2) - 30 * u;
  const maxX = Math.max(tip[0], tail[0], tail[0] + lw / 2) + 30 * u;
  const box = { x: minX, y: tip[1] - 40 * u, w: maxX - minX, h: tail[1] - tip[1] + 130 * u };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const p = easeOut((t - 0.1) / 0.45);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    shadow(f, 14, 3, "rgba(0,0,0,0.45)");
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 12 * u;
    const boil = f.host.reducedMotion ? 0 : Math.floor(t * 8) % 3;
    handStroke(ctx, pts, p, 3 * u, spec.seed + boil);
    if (p >= 0.98) {
      const hp = easeOut((t - 0.5) / 0.15);
      const [x1, y1] = pts[pts.length - 1]!;
      const [x0, y0] = pts[pts.length - 4]!;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = 56 * u * hp;
      ctx.beginPath();
      ctx.moveTo(x1 - Math.cos(ang - 0.5) * len, y1 - Math.sin(ang - 0.5) * len);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(ang + 0.5) * len, y1 - Math.sin(ang + 0.5) * len);
      ctx.stroke();
    }
    if (label) {
      ctx.globalAlpha *= easeOut((t - 0.35) / 0.3);
      ctx.font = f.font(700, 64 * u, f.fonts.hand);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, tail[0], tail[1] + 14 * u);
    }
    ctx.restore();
  });
}

// ─── Círculo a mano ────────────────────────────────────────────────────────

export function circleHand(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const face = spec.face;
  const { a } = envelope(f, 0.05, 0.3);
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const rx = face.w * 0.85;
  const ry = face.h * 0.8;
  const box = { x: cx - rx - 20 * u, y: cy - ry - 20 * u, w: rx * 2 + 40 * u, h: ry * 2 + 40 * u };
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    shadow(f, 12, 2, "rgba(0,0,0,0.4)");
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = 11 * u;
    const boil = f.host.reducedMotion ? 0 : Math.floor(t * 8) % 3;
    handStroke(ctx, ellipsePts(cx, cy, rx, ry, 72, 1.12), easeInOut((t - 0.05) / 0.55), 5 * u, spec.seed + boil * 7);
    ctx.restore();
  });
}

// ─── Lupa ──────────────────────────────────────────────────────────────────

export function magnifier(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const face = spec.face;
  const r = Math.max(150 * u, Math.min(240 * u, face.w * 0.75));
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h * 0.48;
  const box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  const { a, inP } = envelope(f, 0.35, 0.3);
  const zoom = lerp(1, 1.9, easeOut((t - 0.15) / 0.5));
  const at = moved(f, box);
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const s = lerp(0.6, 1, backOut(inP));
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    // Mango.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    shadow(f, 26, 10, "rgba(0,0,0,0.45)");
    roundRect(ctx, -16 * u, r * 0.98, 32 * u, r * 0.95, 14 * u);
    ctx.fillStyle = "#1c2233";
    ctx.fill();
    noShadow(ctx);
    roundRect(ctx, -20 * u, r * 0.92, 40 * u, 46 * u, 10 * u);
    ctx.fillStyle = spec.accent;
    ctx.fill();
    ctx.restore();
    // El vidrio: el video agrandado alrededor del lugar donde quedó la lupa.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    f.drawBase(ctx, { s: zoom, px: at.cx, py: at.cy, tx: 0, ty: 0 });
    const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
    g.addColorStop(0, "rgba(255,255,255,0.28)");
    g.addColorStop(0.35, "rgba(255,255,255,0.04)");
    g.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 14 * u;
    shadow(f, 24, 6, "rgba(0,0,0,0.4)");
    ctx.stroke();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 9 * u, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(spec.accent, 0.9);
    ctx.lineWidth = 4 * u;
    ctx.stroke();
    ctx.restore();
  });
}

// ─── Marco que destella ────────────────────────────────────────────────────

export function flashFrame(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx);
  const { a } = envelope(f, 0.08, 0.25);
  const pulse = f.host.reducedMotion ? 0.8 : 0.55 + 0.45 * Math.abs(Math.cos(t * Math.PI * 2.2));
  const k = a * pulse;
  const inset = 26 * u;
  ctx.save();
  // Brillo hacia adentro.
  for (const [w, al] of [
    [120, 0.25],
    [60, 0.35],
  ] as const) {
    ctx.strokeStyle = rgba(spec.accent, al * k);
    ctx.lineWidth = w * u;
    roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 54 * u);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(mix(spec.accent, "#ffffff", 0.25), k);
  ctx.lineWidth = 14 * u;
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 54 * u);
  ctx.stroke();
  ctx.restore();
}

// ─── Emoji que salta ───────────────────────────────────────────────────────

const EMOJI_ALIASES: Record<string, string> = {
  fuego: "fire",
  corazon: "heart",
  corazón: "heart",
  amor: "heart",
  cohete: "rocket",
  idea: "bulb",
  foco: "bulb",
  ojos: "eyes",
  mira: "eyes",
  dinero: "money",
  plata: "money",
  estrella: "star",
  risa: "laugh",
  jaja: "laugh",
};

export function emojiName(text: string): string {
  const k = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return EMOJI_ALIASES[text.toLowerCase().trim()] ?? EMOJI_ALIASES[k] ?? "star";
}

/** Dibuja un emoji propio (vectorial, sin imágenes de terceros) centrado en (0, 0) con radio `r`. */
export function drawEmoji(ctx: FxCtx, name: string, r: number, t: number, family = "Inter"): void {
  const circle = (fill: string | CanvasGradientLike) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const face = () => {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#ffe680");
    g.addColorStop(1, "#f7b500");
    circle(g);
  };
  switch (name) {
    case "fire": {
      const flick = Math.sin(t * 14) * 0.05;
      const flame = (s: number, c0: string, c1: string) => {
        ctx.save();
        ctx.scale(s, s * (1 + flick));
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.05);
        ctx.bezierCurveTo(r * 0.35, -r * 0.55, r * 0.95, -r * 0.25, r * 0.78, r * 0.35);
        ctx.bezierCurveTo(r * 0.65, r * 0.85, r * 0.25, r, 0, r);
        ctx.bezierCurveTo(-r * 0.25, r, -r * 0.7, r * 0.85, -r * 0.8, r * 0.3);
        ctx.bezierCurveTo(-r * 0.9, -r * 0.1, -r * 0.5, -r * 0.3, -r * 0.35, -r * 0.65);
        ctx.bezierCurveTo(-r * 0.15, -r * 0.35, -r * 0.05, -r * 0.6, 0, -r * 1.05);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      };
      flame(1, "#ff8a00", "#ff2d2d");
      ctx.save();
      ctx.translate(0, r * 0.25);
      flame(0.58, "#ffe14d", "#ff9d00");
      ctx.restore();
      break;
    }
    case "heart": {
      const beat = 1 + 0.06 * Math.max(0, Math.sin(t * 9));
      ctx.save();
      ctx.scale(beat, beat);
      heartPath(ctx, 0, r * 0.05, r * 0.95);
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, "#ff5a7a");
      g.addColorStop(1, "#e3123c");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-r * 0.42, -r * 0.35, r * 0.18, r * 0.11, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();
      ctx.restore();
      break;
    }
    case "rocket": {
      ctx.save();
      ctx.rotate(Math.PI / 4);
      const fl = 0.8 + 0.2 * Math.sin(t * 30);
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.6);
      ctx.lineTo(0, r * (0.6 + 0.55 * fl));
      ctx.lineTo(r * 0.2, r * 0.6);
      ctx.fillStyle = "#ffb000";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.45, -r * 0.6, r * 0.42, r * 0.2, r * 0.3, r * 0.62);
      ctx.lineTo(-r * 0.3, r * 0.62);
      ctx.bezierCurveTo(-r * 0.42, r * 0.2, -r * 0.45, -r * 0.6, 0, -r);
      ctx.closePath();
      ctx.fillStyle = "#eef2f8";
      ctx.fill();
      ctx.fillStyle = "#e3263c";
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sgn * r * 0.32, r * 0.1);
        ctx.lineTo(sgn * r * 0.62, r * 0.62);
        ctx.lineTo(sgn * r * 0.28, r * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, -r * 0.22, r * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = "#2b8cff";
      ctx.fill();
      ctx.lineWidth = r * 0.06;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "bulb": {
      const glow = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.save();
      ctx.shadowColor = "rgba(255,214,0,0.9)";
      ctx.shadowBlur = r * 0.6 * glow;
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.72, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(r * 0.3, r * 0.48);
      ctx.lineTo(-r * 0.3, r * 0.48);
      ctx.closePath();
      ctx.fillStyle = "#ffd84a";
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#9aa4b8";
      roundRect(ctx, -r * 0.32, r * 0.5, r * 0.64, r * 0.36, r * 0.08);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = r * 0.05;
      for (const y of [0.62, 0.74]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, r * y);
        ctx.lineTo(r * 0.3, r * y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.arc(-r * 0.12, -r * 0.3, r * 0.3, Math.PI * 1.05, Math.PI * 1.45);
      ctx.stroke();
      break;
    }
    case "eyes": {
      const look = Math.sin(t * 2.4) * r * 0.12;
      for (const sx of [-0.48, 0.48]) {
        ctx.beginPath();
        ctx.ellipse(sx * r, 0, r * 0.42, r * 0.58, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = r * 0.05;
        ctx.strokeStyle = "#1c2233";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx * r + look, r * 0.12, r * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "#1c2233";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx * r + look - r * 0.07, r * 0.05, r * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      break;
    }
    case "money": {
      ctx.save();
      ctx.rotate(-0.15);
      roundRect(ctx, -r, -r * 0.55, r * 2, r * 1.1, r * 0.12);
      ctx.fillStyle = "#2fbf71";
      ctx.fill();
      roundRect(ctx, -r * 0.86, -r * 0.42, r * 1.72, r * 0.84, r * 0.08);
      ctx.strokeStyle = "#1d8a50";
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "#1d8a50";
      ctx.fill();
      ctx.fillStyle = "#e8fff2";
      ctx.font = `800 ${(r * 0.44).toFixed(1)}px "${family}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, r * 0.02);
      ctx.restore();
      break;
    }
    case "laugh": {
      face();
      ctx.strokeStyle = "#6b3d00";
      ctx.lineWidth = r * 0.09;
      ctx.lineCap = "round";
      for (const sx of [-0.36, 0.36]) {
        ctx.beginPath();
        ctx.moveTo(sx * r - r * 0.16, -r * 0.2);
        ctx.lineTo(sx * r, -r * 0.3);
        ctx.lineTo(sx * r + r * 0.16, -r * 0.2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.08);
      ctx.quadraticCurveTo(0, r * 0.95, r * 0.5, r * 0.08);
      ctx.closePath();
      ctx.fillStyle = "#6b3d00";
      ctx.fill();
      ctx.fillStyle = "#4fc3ff";
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * r * 0.78, -r * 0.02, r * 0.12, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      starPath(ctx, 0, 0, r, 0.48);
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, "#ffe680");
      g.addColorStop(1, "#ffb300");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = r * 0.06;
      ctx.strokeStyle = "#f59e0b";
      ctx.stroke();
    }
  }
}
type CanvasGradientLike = ReturnType<FxCtx["createLinearGradient"]>;

export function emojiBounce(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const face = spec.face;
  const r = 110 * u;
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const cx = clamp(face.x + face.w / 2 + side * (face.w * 0.75 + r * 0.6), r * 1.3, W - r * 1.3);
  const cy = Math.max(r * 1.4, face.y - r * 0.1);
  const box = { x: cx - r * 1.2, y: cy - r * 1.2, w: r * 2.4, h: r * 2.4 };
  const { a } = envelope(f, 0.05, 0.25);
  const drop = bounce(clamp01(t / 0.7));
  const y = lerp(cy - 280 * u, cy, drop);
  const squash = t > 0.25 && t < 0.4 ? 1 - 0.12 * Math.sin(((t - 0.25) / 0.15) * Math.PI) : 1;
  const wiggle = f.host.reducedMotion ? 0 : Math.sin(t * 7) * 0.12 * Math.exp(-t * 0.6) + Math.sin(t * 2) * 0.04;
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a * clamp01(t / 0.12);
    ctx.translate(cx, y + (f.host.reducedMotion ? 0 : Math.sin(t * 2.4) * 8 * u));
    ctx.rotate(wiggle);
    ctx.scale(1 / squash, squash);
    shadow(f, 30, 14, "rgba(0,0,0,0.35)");
    drawEmoji(ctx, emojiName(spec.text || "estrella"), r, f.host.reducedMotion ? 0.5 : t, f.fonts.sans);
    ctx.restore();
  });
}

// ─── Estallido ─────────────────────────────────────────────────────────────

export function stickerBurst(f: FxFrame): void {
  const { ctx, spec, t, u } = f;
  f.drawBase(ctx);
  const r = rng(spec.seed);
  const cx = f.faceCx;
  const cy = f.faceCy;
  const n = 22;
  const colors = [spec.accent, "#ffffff", mix(spec.accent, "#ffffff", 0.5), "#ffd84a"];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const speed = (420 + r() * 480) * u;
    const delay = r() * 0.12;
    const life = 1.2 + r() * 1.0;
    const p = clamp01((t - delay) / life);
    if (p <= 0 || p >= 1) {
      r();
      r();
      continue;
    }
    const e = easeOut(p);
    const x = cx + Math.cos(ang) * speed * e;
    const y = cy + Math.sin(ang) * speed * e + 200 * u * p * p;
    const size = (18 + r() * 26) * u * (1 - p * 0.6);
    const kind = Math.floor(r() * 3);
    ctx.save();
    ctx.globalAlpha = 1 - easeIn(p);
    ctx.translate(x, y);
    ctx.rotate(p * 6 * (i % 2 ? 1 : -1));
    ctx.fillStyle = colors[i % colors.length]!;
    if (kind === 0) starPath(ctx, 0, 0, size, 0.45);
    else if (kind === 1) sparklePath(ctx, 0, 0, size * 1.2);
    else {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }
  // Destellos que quedan titilando alrededor hasta el final.
  const exit = clamp01((spec.duration - t) / 0.3);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.3;
    const dist = Math.max(spec.face.w, spec.face.h) * (0.85 + (i % 3) * 0.18);
    const tw = Math.sin(((t - 0.5 + i * 0.17) / 0.7) * Math.PI) ** 2 * clamp01((t - 0.5) / 0.3) * exit;
    if (tw <= 0.02) continue;
    ctx.save();
    ctx.globalAlpha = tw;
    ctx.fillStyle = i % 2 ? "#ffffff" : mix(spec.accent, "#ffffff", 0.3);
    ctx.shadowColor = spec.accent;
    ctx.shadowBlur = 18 * u * f.pixelScale;
    sparklePath(ctx, cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, (16 + (i % 3) * 8) * u * tw);
    ctx.fill();
    ctx.restore();
  }
  // Anillo que se abre.
  const ring = clamp01(t / 0.45);
  if (ring < 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, 80 * u + 420 * u * easeOut(ring), 0, Math.PI * 2);
    ctx.strokeStyle = rgba(spec.accent, 0.7 * (1 - ring));
    ctx.lineWidth = 14 * u * (1 - ring);
    ctx.stroke();
  }
}

// ─── Sí / No ───────────────────────────────────────────────────────────────

export const isNo = (text: string) => /^(no|nunca|mal|falso|error|x|jam[aá]s)\b/i.test(text.trim());

export function checkCross(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const no = isNo(spec.text || "");
  const color = no ? "#ef4444" : "#22c55e";
  const label = (spec.text || (no ? "NO" : "SÍ")).toLocaleUpperCase("es");
  const r = 130 * u;
  const face = spec.face;
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const cx = clamp(face.x + face.w / 2 + side * (face.w * 0.6 + r * 1.1), r * 1.3, W - r * 1.3);
  const cy = face.y + face.h * 0.45;
  const box = { x: cx - r * 1.4, y: cy - r * 1.1, w: r * 2.8, h: r * 2.6 + 30 * u };
  const { a } = envelope(f, 0.05, 0.25);
  const pop = backOut(clamp01(t / 0.3), 2.2);
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    shadow(f, 36, 14, "rgba(0,0,0,0.4)");
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, r - 10 * u, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 5 * u;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 26 * u;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const p = easeOut((t - 0.2) / 0.3);
    if (no) crossStroke(ctx, 0, 0, r, p);
    else checkStroke(ctx, 0, 0, r, p);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= a * easeOut((t - 0.35) / 0.3);
    const fit = fitFont(f, label, 900, displayFamily(f), r * 2.8, 76, 30);
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    shadow(f, 20, 4, "rgba(0,0,0,0.5)");
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, cx, cy + r * 1.1 + fit.size);
    ctx.restore();
  });
}

// ─── Antes y después ───────────────────────────────────────────────────────

export function beforeAfter(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  const { a, outP } = envelope(f, 0.01, 0.3);
  f.drawBase(ctx);
  const split = W * lerp(1, 0.5, easeInOut((t - 0.1) / 0.6)) + outP * W * 0.5;
  const [before, after] = [spec.items[0] || "ANTES", spec.items[1] || "DESPUÉS"].map((s) => s.toLocaleUpperCase("es"));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, split, H);
  ctx.clip();
  f.drawBase(ctx, { s: 1, px: 0, py: 0, tx: 0, ty: 0 }, "grayscale(1) contrast(1.05) brightness(0.82)");
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= a;
  // Divisor con su manija.
  ctx.fillStyle = "#ffffff";
  shadow(f, 18, 0, "rgba(0,0,0,0.45)");
  ctx.fillRect(split - 3 * u, 0, 6 * u, H);
  ctx.beginPath();
  ctx.arc(split, H * 0.5, 40 * u, 0, Math.PI * 2);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = "#0b1020";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(split + s * 10 * u, H * 0.5 - 12 * u);
    ctx.lineTo(split + s * 24 * u, H * 0.5);
    ctx.lineTo(split + s * 10 * u, H * 0.5 + 12 * u);
    ctx.closePath();
    ctx.fill();
  }
  const top = (f.vertical ? 150 : 70) * u;
  const show = easeOut((t - 0.5) / 0.3);
  ctx.globalAlpha *= show;
  pill(f, before, Math.min(split - 30 * u, W * 0.5 - 30 * u), top, { size: 30, bg: "rgba(10,12,20,0.75)", color: "#ffffff", mono: true, align: "right" });
  pill(f, after, Math.max(split + 30 * u, W * 0.5 + 30 * u), top, { size: 30, mono: true, align: "left" });
  ctx.restore();
}

// ─── Foco ──────────────────────────────────────────────────────────────────

export function spotlight(f: FxFrame): void {
  const { ctx, spec, W, H, u } = f;
  f.drawBase(ctx);
  const face = spec.face;
  const r = Math.max(face.w, face.h) * 0.95;
  const box = { x: face.x + face.w / 2 - r, y: face.y + face.h / 2 - r, w: r * 2, h: r * 2 };
  const { a } = envelope(f, 0.45, 0.4);
  const at = moved(f, box);
  const rr = r * at.scale;
  const l = f.layer("spot");
  l.ctx.fillStyle = `rgba(0,0,0,${0.78 * a})`;
  l.ctx.fillRect(0, 0, W, H);
  l.ctx.globalCompositeOperation = "destination-out";
  const g = l.ctx.createRadialGradient(at.cx, at.cy, rr * 0.55, at.cx, at.cy, rr * 1.15);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  l.ctx.fillStyle = g;
  l.ctx.fillRect(0, 0, W, H);
  ctx.drawImage(l.canvas, 0, 0, W, H);
  // Un halo cálido muy leve donde cae la luz.
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const h = ctx.createRadialGradient(at.cx, at.cy - rr * 0.3, 0, at.cx, at.cy, rr);
  h.addColorStop(0, `rgba(255,236,200,${0.12 * a})`);
  h.addColorStop(1, "rgba(255,236,200,0)");
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // El lienzo mueve el foco (sin dibujar nada más).
  f.movable(box, () => undefined);
  void u;
}

// ─── Encuadre de cámara ────────────────────────────────────────────────────

export function focusBrackets(f: FxFrame): void {
  const { ctx, spec, t, W, H, u } = f;
  f.drawBase(ctx, { s: lerp(1, 1.06, easeOut(t / 0.6)), px: f.faceCx, py: f.faceCy, tx: 0, ty: 0 });
  const { a } = envelope(f, 0.05, 0.3);
  const safe = f.faceSafe;
  const p = easeInOut((t - 0.05) / 0.5);
  const x0 = lerp(40 * u, safe.x, p);
  const y0 = lerp((f.vertical ? 140 : 60) * u, safe.y, p);
  const x1 = lerp(W - 40 * u, safe.x + safe.w, p);
  const y1 = lerp(H - (f.vertical ? 260 : 60) * u, safe.y + safe.h, p);
  const arm = 60 * u;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 7 * u;
  ctx.lineCap = "round";
  shadow(f, 12, 0, "rgba(0,0,0,0.5)");
  for (const [x, y, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * arm);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * arm, y);
    ctx.stroke();
  }
  // Rótulo y punto de grabación que titila.
  const blink = f.host.reducedMotion || Math.floor(t * 2) % 2 === 0;
  const ly = y0 - 34 * u;
  if (blink) {
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(x0 + 14 * u, ly, 12 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = f.font(600, 32 * u, f.fonts.mono);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText((spec.kicker || "REC").toLocaleUpperCase("es"), x0 + 38 * u, ly);
  const secs = Math.floor(t);
  ctx.textAlign = "right";
  ctx.fillText(`00:00:${String(secs).padStart(2, "0")}`, x1, ly);
  ctx.restore();
}

// ─── Globo de diálogo ──────────────────────────────────────────────────────

export function speechBubble(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const text = spec.text || "¿Y ahora qué?";
  const face = spec.face;
  const fam = displayFamily(f);
  ctx.font = f.font(800, 58 * u, fam);
  const maxW = W * (f.vertical ? 0.56 : 0.3);
  const lines = wrap(ctx, text, maxW, 3);
  const lh = 66 * u;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = tw + 90 * u;
  const h = lines.length * lh + 70 * u;
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const x = clamp(side > 0 ? face.x + face.w * 0.85 : face.x + face.w * 0.15 - w, 30 * u, W - w - 30 * u);
  const y = Math.max((f.vertical ? 130 : 50) * u, face.y - h * 0.75);
  const tail: [number, number] = [face.x + face.w / 2 + side * face.w * 0.35, face.y + face.h * 0.15];
  const box = { x, y, w, h };
  const pop = backOut(clamp01(t / 0.3), 2);
  const { a } = envelope(f, 0.05, 0.25);
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a;
    const ox = side > 0 ? x : x + w;
    ctx.translate(ox, y + h);
    ctx.scale(pop, pop);
    ctx.translate(-ox, -(y + h));
    shadow(f, 34, 12, "rgba(0,0,0,0.35)");
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y, w, h, 44 * u);
    ctx.fill();
    // Cola del globo hacia la boca.
    const bx = side > 0 ? x + 70 * u : x + w - 70 * u;
    ctx.beginPath();
    ctx.moveTo(bx - 26 * u, y + h - 4 * u);
    ctx.quadraticCurveTo(lerp(bx, tail[0], 0.5), lerp(y + h, tail[1], 0.4), lerp(bx, tail[0], 0.75), lerp(y + h, tail[1], 0.75));
    ctx.quadraticCurveTo(bx + 10 * u, y + h + 20 * u, bx + 30 * u, y + h - 4 * u);
    ctx.closePath();
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = "#0b1020";
    ctx.font = f.font(800, 58 * u, fam);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => ctx.fillText(line, x + w / 2, y + 35 * u + lh * (i + 0.5)));
    ctx.restore();
  });
}

// ─── Sello ─────────────────────────────────────────────────────────────────

export function badgeStamp(f: FxFrame): void {
  const { ctx, spec, t, W, u } = f;
  f.drawBase(ctx);
  const word = (spec.text || "NUEVO").toLocaleUpperCase("es");
  const r = 150 * u;
  const face = spec.face;
  const side = face.x + face.w / 2 < W / 2 ? 1 : -1;
  const cx = clamp(face.x + face.w / 2 + side * (face.w * 0.7 + r), r * 1.2, W - r * 1.2);
  const cy = Math.max(r * 1.4, face.y + face.h * 0.1);
  const box = { x: cx - r * 1.15, y: cy - r * 1.15, w: r * 2.3, h: r * 2.3 };
  const { a } = envelope(f, 0.02, 0.25);
  const hit = clamp01(t / 0.18);
  const s = t < 0.18 ? lerp(2.4, 1, easeIn(hit)) : 1 + 0.06 * Math.exp(-(t - 0.18) * 10) * Math.cos((t - 0.18) * 30);
  const spin = (f.host.reducedMotion ? 0 : t * 0.35) - 0.2;
  f.movable(box, () => {
    ctx.save();
    ctx.globalAlpha *= a * clamp01(t / 0.08);
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.rotate(spin);
    shadow(f, 30, 12, "rgba(0,0,0,0.4)");
    starPath(ctx, 0, 0, r, 0.88, 18);
    ctx.fillStyle = spec.accent;
    ctx.fill();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(onColor(spec.accent), 0.6);
    ctx.lineWidth = 4 * u;
    ctx.setLineDash([10 * u, 8 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Texto alrededor del círculo.
    const ring = `${word} • ${word} • `;
    ctx.font = f.font(700, 26 * u, f.fonts.mono);
    ctx.fillStyle = onColor(spec.accent);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const chars = [...ring];
    chars.forEach((ch, i) => {
      ctx.save();
      ctx.rotate((i / chars.length) * Math.PI * 2);
      ctx.fillText(ch, 0, -r * 0.6);
      ctx.restore();
    });
    ctx.rotate(-spin);
    const fit = fitFont(f, word, 900, displayFamily(f), r * 0.95, 70, 24);
    ctx.font = fit.font;
    ctx.fillText(word, 0, fit.size * 0.05);
    ctx.restore();
  });
  void frameIndex;
  void easeOut;
  void breathe;
}
