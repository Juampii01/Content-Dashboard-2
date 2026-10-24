/**
 * Composiciones de muestra escritas a mano. Sirven de tres cosas: ejemplos de calidad en el prompt (Claude ve cómo
 * se usa la API), respuestas de la simulación (AI_FAKE=1) y pruebas del motor (validación, paridad y render).
 *
 * Todas usan la marca (env.brand), aparecen cuando se dice lo que muestran (env.timeOf), no tapan la cara (env.safe)
 * ni los subtítulos (env.captions) y salen con su propia animación de salida.
 */
import type { SfxName } from "../sfx-library";

export type ComposSample = {
  key: string;
  name: string;
  /** Para qué momento sirve (lo lee Claude al elegir ejemplos). */
  use: string;
  tags: string[];
  params: { key: string; label: string; value: string }[];
  sounds: { at: number; name: SfxName; gain: number }[];
  hide_captions: boolean;
  code: string;
};

/** Ubicación vertical de un bloque de texto: debajo de la cara y arriba de los subtítulos (o arriba de la cara). */
const PLACE = String.raw`
function placeY(env, blockH) {
  return env.freeY(blockH).y;
}`;

export const COMPOS_SAMPLES: ComposSample[] = [
  {
    key: "letter_glitch",
    name: "Palabra letra a letra con glitch",
    use: "Gancho o palabra clave: una palabra grande que se arma letra a letra y estalla con glitch RGB en el golpe.",
    tags: ["texto-letra-a-letra", "glitch"],
    params: [
      { key: "word", label: "Palabra", value: "IMPARABLE" },
      { key: "kicker", label: "Rótulo", value: "la clave de todo" },
    ],
    sounds: [
      { at: 0.05, name: "swish", gain: -16 },
      { at: 0.75, name: "glitch", gain: -12 },
    ],
    hide_captions: true,
    code: String.raw`${PLACE}
const STEP = 0.055;

export default {
  params: { word: "IMPARABLE", kicker: "la clave de todo" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const word = String(env.params.word || "").toUpperCase().slice(0, 14);
    const letters = [...word];
    const buildEnd = letters.length * STEP + 0.32;
    const strong = env.words.find((w) => w.strong);
    const hit = Math.max(buildEnd + 0.04, strong ? strong.t0 : Math.min(env.duration * 0.5, buildEnd + 0.35));
    const out = env.progress(t, env.duration - 0.32, 0.32);

    ctx.font = env.font(900, 100, env.fonts.cut);
    ctx.letterSpacing = "0px";
    const size = env.fit(ctx, word, (s) => env.font(400, s, env.fonts.cut), W * 0.86, 330 * u, 90 * u);
    const y = placeY(env, size);

    // Velo para que se lea sobre cualquier fondo.
    const veil = ease.outCubic(env.progress(t, 0, 0.35)) * (1 - out);
    const g = ctx.createLinearGradient(0, y - size * 1.4, 0, y + size * 1.1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, env.rgba(env.brand.bg, 0.62 * veil));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y - size * 1.4, W, size * 2.5);

    const L = env.layer();
    L.font = env.font(400, size, env.fonts.cut);
    L.textBaseline = "middle";
    const pos = env.letters(L, word);
    const total = pos.length ? pos[pos.length - 1].x + pos[pos.length - 1].w : 0;
    const x0 = (W - total) / 2;
    letters.forEach((ch, i) => {
      const p = env.progress(t, i * STEP, 0.42);
      if (p <= 0) return;
      const s = env.spring(p * 0.42, { stiffness: 260, damping: 16 });
      const cx = x0 + pos[i].x + pos[i].w / 2;
      L.save();
      L.translate(cx, y + (1 - s) * 140 * u);
      L.rotate((1 - s) * (i % 2 ? 0.25 : -0.25));
      L.scale(0.6 + 0.4 * s, 0.6 + 0.4 * s);
      L.globalAlpha = Math.min(1, p * 2.4);
      L.filter = p < 0.6 ? "blur(" + ((0.6 - p) * 16).toFixed(1) + "px)" : "none";
      L.fillStyle = i === letters.length - 1 ? env.brand.accent : "#ffffff";
      L.fillText(ch, -pos[i].w / 2, 0);
      L.restore();
    });

    // Rótulo chico arriba de la palabra.
    const kp = ease.outCubic(env.progress(t, buildEnd - 0.1, 0.35));
    if (kp > 0) {
      L.save();
      L.globalAlpha = kp;
      L.font = env.font(700, 30 * u, env.fonts.mono);
      L.letterSpacing = (6 * u).toFixed(1) + "px";
      L.textAlign = "center";
      L.fillStyle = env.brand.accent;
      L.fillText(String(env.params.kicker || "").toUpperCase(), W / 2, y - size * 0.62 - (1 - kp) * 20 * u);
      L.restore();
    }

    // Golpe: glitch fuerte que se apaga en 0,3 s, con un destello.
    const gp = env.progress(t, hit, 0.3);
    const glitchOn = t >= hit - 0.02 && gp < 1;
    ctx.save();
    if (out > 0) {
      ctx.globalAlpha = 1 - ease.inCubic(out);
      ctx.translate(W / 2, y);
      const k = 1 + out * 0.25;
      ctx.scale(k, k);
      ctx.translate(-W / 2, -y);
      ctx.filter = "blur(" + (out * 14).toFixed(1) + "px)";
    }
    if (glitchOn) env.glitch(ctx, L, { intensity: 1 - gp * 0.85, seed: Math.floor(t * 30), slices: 10, split: 16 });
    else ctx.drawImage(L, 0, 0);
    ctx.restore();
    if (glitchOn && gp < 0.35) {
      ctx.fillStyle = "rgba(255,255,255," + ((0.35 - gp) * 0.6).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  },
};
`,
  },
  {
    key: "card3d_stat",
    name: "Tarjeta 3D con la cifra",
    use: "Una cifra o resultado: tarjeta de vidrio que entra girando en 3D, la cifra cuenta y un brillo la cruza.",
    tags: ["tarjeta-3d", "cifra"],
    params: [
      { key: "value", label: "Cifra", value: "+327%" },
      { key: "label", label: "Qué es", value: "más ventas en 90 días" },
    ],
    sounds: [
      { at: 0.05, name: "whoosh", gain: -14 },
      { at: 0.6, name: "pop", gain: -12 },
    ],
    hide_captions: true,
    code: String.raw`${PLACE}
function splitNumber(s) {
  const m = /^([^0-9]*)([0-9][0-9.,]*)(.*)$/.exec(s);
  if (!m) return null;
  const raw = m[2];
  const decimals = /[.,]\d{1,2}$/.test(raw) ? raw.split(/[.,]/).pop().length : 0;
  const n = parseFloat(raw.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? { pre: m[1], n, post: m[3], decimals } : null;
}
function fmt(n, decimals) {
  const fixed = n.toFixed(decimals);
  const [a, b] = fixed.split(".");
  return a.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (b ? "." + b : "");
}

export default {
  params: { value: "+327%", label: "más ventas en 90 días" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const value = String(env.params.value || "");
    const label = String(env.params.label || "");
    const cw = Math.min(W * 0.78, 820 * u);
    const ch = cw * 0.62;
    const cy = placeY(env, ch);
    const x = (W - cw) / 2;
    const y = cy - ch / 2;
    const inP = env.progress(t, 0, 0.9);
    const out = ease.inCubic(env.progress(t, env.duration - 0.35, 0.35));
    const ry = env.spring(t, { from: -88, to: 0, stiffness: 120, damping: 13 }) + Math.sin(t * 1.3) * 3 * (1 - out) + out * 70;
    const rx = (1 - ease.outCubic(inP)) * 18 + Math.cos(t * 1.1) * 2;

    // La tarjeta se dibuja plana en una capa y después se gira.
    const card = env.layer();
    card.save();
    card.beginPath();
    card.roundRect(x, y, cw, ch, 44 * u);
    card.clip();
    card.filter = "blur(30px) brightness(0.55)";
    card.drawVideo();
    card.filter = "none";
    const bg = card.createLinearGradient(x, y, x + cw, y + ch);
    bg.addColorStop(0, env.rgba(env.brand.surface, 0.78));
    bg.addColorStop(1, env.rgba(env.brand.bg, 0.9));
    card.fillStyle = bg;
    card.fillRect(x, y, cw, ch);
    // Brillo que cruza.
    const sp = env.progress(t, 0.7, 0.8);
    if (sp > 0 && sp < 1) {
      const sx = x - cw * 0.4 + sp * cw * 1.8;
      const sh = card.createLinearGradient(sx - 120 * u, y, sx + 120 * u, y + ch);
      sh.addColorStop(0, "rgba(255,255,255,0)");
      sh.addColorStop(0.5, "rgba(255,255,255,0.22)");
      sh.addColorStop(1, "rgba(255,255,255,0)");
      card.fillStyle = sh;
      card.fillRect(x, y, cw, ch);
    }
    card.restore();
    card.strokeStyle = env.rgba(env.brand.accent, 0.9);
    card.lineWidth = 3 * u;
    card.beginPath();
    card.roundRect(x + 1.5 * u, y + 1.5 * u, cw - 3 * u, ch - 3 * u, 43 * u);
    card.stroke();

    // La cifra cuenta hasta su valor.
    const parts = splitNumber(value);
    const cp = ease.outExpo(env.progress(t, 0.25, 1.1));
    const shown = parts ? parts.pre + fmt(parts.n * cp, parts.decimals) + parts.post : value;
    card.textAlign = "center";
    card.textBaseline = "middle";
    const size = env.fit(card, value + "0", (s) => env.font(900, s, env.brand.display), cw * 0.84, 230 * u, 60 * u);
    card.font = env.font(900, size, env.brand.display);
    card.shadowColor = env.rgba(env.brand.accent, 0.55);
    card.shadowBlur = 40 * u;
    card.fillStyle = "#ffffff";
    card.fillText(shown, W / 2, y + ch * 0.44);
    card.shadowBlur = 0;
    card.font = env.font(600, 40 * u, env.fonts.sans);
    card.fillStyle = env.brand.muted;
    card.fillText(label, W / 2, y + ch * 0.78, cw * 0.86);

    ctx.save();
    ctx.globalAlpha = (1 - out) * Math.min(1, inP * 3);
    // Sombra en el piso.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(30px)";
    ctx.beginPath();
    ctx.ellipse(W / 2, y + ch + 40 * u, cw * 0.4 * Math.max(0.2, Math.cos((ry * Math.PI) / 180)), 26 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";
    env.card3d(ctx, card, { x: x - 20 * u, y: y - 20 * u, w: cw + 40 * u, h: ch + 40 * u, sx: x - 20 * u, sy: y - 20 * u, sw: cw + 40 * u, sh: ch + 40 * u, rx, ry, fov: 1500 * u, strips: 32 });
    ctx.restore();
  },
};
`,
  },
  {
    key: "underline_draw",
    name: "Frase con subrayado que se dibuja",
    use: "Una frase importante: aparece palabra por palabra al decirla y la palabra clave se subraya con un trazo a mano.",
    tags: ["subrayado", "texto-por-palabra"],
    params: [
      { key: "line", label: "Frase", value: "Nadie te enseña esto" },
      { key: "key", label: "Palabra subrayada", value: "esto" },
    ],
    sounds: [{ at: 0.9, name: "swipe", gain: -16 }],
    hide_captions: true,
    code: String.raw`${PLACE}
export default {
  params: { line: "Nadie te enseña esto", key: "esto" },
  render(ctx, t, env) {
    const { W, u, ease } = env;
    const words = String(env.params.line || "").split(/\s+/).filter(Boolean).slice(0, 10);
    const key = String(env.params.key || "").toLowerCase();
    const out = ease.inCubic(env.progress(t, env.duration - 0.3, 0.3));
    ctx.font = env.font(800, 100, env.brand.display);
    const size = env.fit(ctx, words.join(" "), (s) => env.font(800, s, env.brand.display), W * 0.86 * 2.2, 150 * u, 84 * u);
    ctx.font = env.font(800, size, env.brand.display);
    const lines = env.wrap(ctx, words.join(" "), W * 0.84, 3);
    const lh = size * 1.12;
    const y0 = placeY(env, lh * lines.length) - (lh * (lines.length - 1)) / 2;
    ctx.textBaseline = "middle";
    let wi = 0;
    let keyBox = null;
    // Cada palabra entra cuando se dice (o en orden, si no se encuentra).
    let cursor = 0;
    lines.forEach((line, li) => {
      const lw = ctx.measureText(line).width;
      let x = (W - lw) / 2;
      for (const w of line.split(" ")) {
        const said = env.timeOf(w, cursor);
        const at = said != null ? said : 0.12 + wi * 0.12;
        if (said != null) cursor = said;
        const p = ease.outBack(env.progress(t, at - 0.06, 0.32));
        const ww = ctx.measureText(w).width;
        const y = y0 + li * lh;
        ctx.save();
        ctx.globalAlpha = Math.min(1, env.progress(t, at - 0.06, 0.15)) * (1 - out);
        ctx.translate(x + ww / 2, y + (1 - p) * 40 * u);
        const isKey = key && w.toLowerCase().replace(/[^a-záéíóúñü0-9]/g, "") === key.replace(/[^a-záéíóúñü0-9]/g, "");
        ctx.fillStyle = isKey ? env.brand.accent : "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 18 * u;
        ctx.fillText(w, -ww / 2, 0);
        ctx.restore();
        if (isKey) keyBox = { x, y, w: ww, at };
        x += ww + ctx.measureText(" ").width;
        wi++;
      }
    });
    if (keyBox) {
      // Trazo a mano: una curva con dos ondas, que se dibuja de izquierda a derecha.
      const p = ease.inOutCubic(env.progress(t, keyBox.at + 0.12, 0.45));
      if (p > 0) {
        const r = env.rng(env.seed);
        const x0 = keyBox.x - 10 * u;
        const x1 = keyBox.x + keyBox.w + 14 * u;
        const yb = keyBox.y + size * 0.52;
        const len = x1 - x0;
        ctx.save();
        ctx.globalAlpha = 1 - out;
        ctx.strokeStyle = env.brand.accent;
        ctx.lineWidth = 11 * u;
        ctx.lineCap = "round";
        ctx.setLineDash([len * 1.3, len * 1.3]);
        ctx.lineDashOffset = len * 1.3 * (1 - p);
        ctx.beginPath();
        ctx.moveTo(x0, yb + (r() - 0.5) * 6 * u);
        ctx.bezierCurveTo(x0 + len * 0.3, yb + 14 * u, x0 + len * 0.6, yb - 10 * u, x1, yb + 4 * u);
        ctx.stroke();
        ctx.restore();
      }
    }
  },
};
`,
  },
  {
    key: "text_behind",
    name: "Palabra gigante detrás de la persona",
    use: "Una idea fuerte: una palabra enorme aparece DETRÁS de la persona (recorte), con un leve paneo.",
    tags: ["detras-de-la-persona", "titular-gigante"],
    params: [{ key: "word", label: "Palabra", value: "ENFOQUE" }],
    sounds: [{ at: 0.02, name: "boom", gain: -16 }],
    hide_captions: false,
    code: String.raw`export default {
  params: { word: "ENFOQUE" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const word = String(env.params.word || "").toUpperCase().slice(0, 12);
    const inP = ease.outExpo(env.progress(t, 0, 0.7));
    const out = ease.inCubic(env.progress(t, env.duration - 0.35, 0.35));
    ctx.font = env.font(400, 100, env.fonts.cut);
    const size = env.fit(ctx, word, (s) => env.font(400, s, env.fonts.cut), W * 0.96, (env.vertical ? 520 : 600) * u, 120 * u);
    // Con recorte va a la altura de la cabeza (la persona la tapa en parte); sin recorte, arriba de la cara.
    const y = env.hasMask ? env.face.cy - size * 0.05 : Math.max(size * 0.55, env.safe.y - size * 0.45);
    ctx.save();
    ctx.globalAlpha = (1 - out) * Math.min(1, inP * 1.4);
    ctx.translate(W / 2 + (1 - inP) * W * 0.12 - t * 18 * u, y);
    const k = 1.18 - 0.18 * inP + out * 0.08;
    ctx.scale(k, k);
    ctx.font = env.font(400, size, env.fonts.cut);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, env.mix("#ffffff", env.brand.accent, 0.55));
    ctx.fillStyle = g;
    ctx.globalAlpha *= env.hasMask ? 1 : 0.85;
    ctx.fillText(word, 0, 0);
    ctx.restore();
    // La persona encima de la palabra (con un borde de luz suave).
    if (env.hasMask) {
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - out);
      ctx.filter = "blur(10px)";
      ctx.drawImage(env.silhouette(env.brand.accent, 6), 0, 0, W, H);
      ctx.restore();
      ctx.drawPerson();
    }
  },
};
`,
  },
  {
    key: "counter_up",
    name: "Contador que sube",
    use: "Una cantidad que crece (seguidores, dinero, días): un contador grande tipo odómetro con un anillo de progreso.",
    tags: ["contador", "cifra"],
    params: [
      { key: "target", label: "Número final", value: "10000" },
      { key: "suffix", label: "Después del número", value: " seguidores" },
      { key: "prefix", label: "Antes del número", value: "" },
    ],
    sounds: [
      { at: 0.1, name: "riser", gain: -18 },
      { at: 1.3, name: "ding", gain: -14 },
    ],
    hide_captions: true,
    code: String.raw`${PLACE}
function digitsOf(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export default {
  params: { target: "10000", suffix: " seguidores", prefix: "" },
  render(ctx, t, env) {
    const { W, u, ease } = env;
    const target = Math.max(0, parseFloat(String(env.params.target || "0").replace(/[^0-9.]/g, "")) || 0);
    const pre = String(env.params.prefix || "");
    const suf = String(env.params.suffix || "");
    const dur = Math.min(1.3, env.duration * 0.6);
    const p = ease.outQuart(env.progress(t, 0.15, dur));
    const out = ease.inCubic(env.progress(t, env.duration - 0.3, 0.3));
    const done = env.progress(t, 0.15 + dur, 0.35);
    const finalText = digitsOf(target);
    ctx.font = env.font(900, 100, env.brand.display);
    const unitW = (ctx.measureText("0").width * finalText.replace(/,/g, "").length + ctx.measureText(",").width * (finalText.split(",").length - 1)) / 100;
    let size = Math.min(200 * u, (W * 0.62) / Math.max(2.2, unitW));
    let ring = Math.max(size * 1.05, (unitW * size) / 2 + 60 * u);
    const spot = env.freeY(ring * 2.15);
    // Si no entra entero en el espacio libre, se achica (nunca tapa la cara).
    const fit = Math.min(1, spot.room / (ring * 2.15));
    size *= fit;
    ring *= fit;
    const cy = env.freeY(ring * 2.15).y;
    ctx.save();
    ctx.globalAlpha = (1 - out) * Math.min(1, t * 5);
    // Fondo circular con el anillo.
    ctx.fillStyle = env.rgba(env.brand.bg, 0.78);
    ctx.beginPath();
    ctx.arc(W / 2, cy, ring * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 16 * u;
    ctx.lineCap = "round";
    ctx.strokeStyle = env.rgba(env.brand.ink, 0.12);
    ctx.beginPath();
    ctx.arc(W / 2, cy, ring * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = env.brand.accent;
    ctx.shadowColor = env.rgba(env.brand.accent, 0.8);
    ctx.shadowBlur = 24 * u;
    ctx.beginPath();
    ctx.arc(W / 2, cy, ring * 0.92, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Odómetro: cada dígito rueda hasta su lugar.
    const cur = target * p;
    ctx.font = env.font(900, size, env.brand.display);
    ctx.textBaseline = "middle";
    const cellW = ctx.measureText("0").width;
    const commaW = ctx.measureText(",").width;
    const totalW = [...finalText].reduce((a, c) => a + (c === "," ? commaW : cellW), 0);
    let x = W / 2 - totalW / 2;
    const pop = 1 + 0.08 * Math.sin(Math.PI * Math.min(1, done * 2)) * (done < 0.5 ? 1 : 0);
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(pop, pop);
    ctx.translate(-W / 2, -cy);
    ctx.beginPath();
    ctx.rect(x - 10 * u, cy - size * 0.5, totalW + 20 * u, size * 1.0);
    ctx.clip();
    ctx.textAlign = "center";
    const digitCount = finalText.replace(/,/g, "").length;
    let di = 0;
    for (let i = 0; i < finalText.length; i++) {
      const w = finalText[i] === "," ? commaW : cellW;
      ctx.fillStyle = "#ffffff";
      if (finalText[i] === ",") {
        if (cur >= Math.pow(10, digitCount - di)) ctx.fillText(",", x + w / 2, cy);
        x += w;
        continue;
      }
      // Odómetro: la cifra de las unidades rueda siempre; las demás, solo cuando la de abajo pasa por el 9.
      const place = digitCount - 1 - di;
      di++;
      const pv = Math.pow(10, place);
      if (place > 0 && cur < pv) {
        x += w;
        continue;
      }
      const d = Math.floor(cur / pv) % 10;
      const frac = p >= 1 ? 0 : place === 0 ? cur % 1 : cur % pv > pv - 1 ? cur % 1 : 0;
      const e = ease.inOutSine(frac);
      ctx.fillText(String(d), x + w / 2, cy - e * size);
      ctx.fillText(String((d + 1) % 10), x + w / 2, cy + size - e * size);
      x += w;
    }
    ctx.restore();
    // Prefijo y sufijo.
    ctx.textAlign = "center";
    ctx.font = env.font(700, 40 * u, env.fonts.sans);
    ctx.fillStyle = env.brand.accent;
    ctx.fillText((pre ? pre + " " : "") + suf.trim(), W / 2, cy + size * 0.5 + (ring - size * 0.5) * 0.5);
    ctx.restore();
    // Destello al llegar.
    if (done > 0 && done < 1) {
      for (const s of env.particles({ seed: 3, count: 26, t: done * 0.9, x: W / 2, y: cy - ring * 0.6, spread: Math.PI * 1.4, speed: 1300 * u, gravity: 1600 * u, life: 0.9, size: 9 * u })) {
        ctx.globalAlpha = s.alpha * (1 - out);
        ctx.fillStyle = s.i % 3 ? env.brand.accent : "#ffffff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  },
};
`,
  },
  {
    key: "list_reveal",
    name: "Lista que aparece al nombrar cada ítem",
    use: "Una enumeración (pasos, errores, herramientas): cada ítem entra justo cuando se nombra, con un check que se dibuja.",
    tags: ["lista", "check"],
    params: [
      { key: "title", label: "Título", value: "3 errores que te frenan" },
      { key: "item1", label: "Ítem 1", value: "Publicar sin gancho" },
      { key: "item2", label: "Ítem 2", value: "No tener un llamado" },
      { key: "item3", label: "Ítem 3", value: "Editar sin ritmo" },
    ],
    sounds: [{ at: 0.05, name: "swipe_up", gain: -16 }],
    hide_captions: true,
    code: String.raw`function firstKey(s) {
  const ws = String(s).toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  return ws[0] || String(s).split(/\s+/)[0] || "";
}

export default {
  params: { title: "3 errores que te frenan", item1: "Publicar sin gancho", item2: "No tener un llamado", item3: "Editar sin ritmo" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const items = [env.params.item1, env.params.item2, env.params.item3, env.params.item4].map((s) => String(s || "").trim()).filter(Boolean);
    const out = ease.inCubic(env.progress(t, env.duration - 0.35, 0.35));
    const pw = Math.min(W * 0.84, 900 * u);
    const rowH = 104 * u;
    const ph = 130 * u + rowH * items.length;
    const px = (W - pw) / 2;
    const below = env.safe.y + env.safe.h + 30 * u;
    const py = below + ph < (env.captions.visible ? env.captions.y : H * 0.92) ? below : Math.max(40 * u, (H - ph) / 2);
    const inP = env.spring(t, { stiffness: 200, damping: 20 });
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.translate(0, (1 - inP) * 120 * u + out * 60 * u);
    // Panel de vidrio.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 36 * u);
    ctx.clip();
    ctx.filter = "blur(28px) brightness(0.5)";
    ctx.drawVideo();
    ctx.filter = "none";
    ctx.fillStyle = env.rgba(env.brand.surface, 0.62);
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    ctx.strokeStyle = env.rgba(env.brand.accent, 0.45);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 36 * u);
    ctx.stroke();
    ctx.font = env.font(800, 46 * u, env.brand.display);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(String(env.params.title || ""), px + 40 * u, py + 64 * u, pw - 80 * u);
    let from = 0;
    items.forEach((item, i) => {
      const said = env.timeOf(firstKey(item), from);
      const at = said != null ? said : 0.5 + i * Math.max(0.35, (env.duration - 1.2) / Math.max(1, items.length));
      if (said != null) from = said + 0.05;
      const p = ease.outCubic(env.progress(t, at - 0.08, 0.38));
      const y = py + 130 * u + rowH * i + rowH / 2;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate((1 - p) * 60 * u, 0);
      // Casilla y check que se dibuja.
      const bx = px + 40 * u;
      ctx.fillStyle = env.rgba(env.brand.accent, 0.18 + 0.82 * env.progress(t, at, 0.2));
      ctx.beginPath();
      ctx.roundRect(bx, y - 26 * u, 52 * u, 52 * u, 14 * u);
      ctx.fill();
      const cp = ease.outCubic(env.progress(t, at + 0.05, 0.3));
      if (cp > 0) {
        ctx.strokeStyle = env.brand.accentText;
        ctx.lineWidth = 7 * u;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const len = 70 * u;
        ctx.setLineDash([len, len]);
        ctx.lineDashOffset = len * (1 - cp);
        ctx.beginPath();
        ctx.moveTo(bx + 13 * u, y + 1 * u);
        ctx.lineTo(bx + 23 * u, y + 11 * u);
        ctx.lineTo(bx + 40 * u, y - 10 * u);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = env.font(600, 42 * u, env.fonts.sans);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(item, bx + 80 * u, y + 2 * u, pw - 160 * u);
      ctx.restore();
    });
    ctx.restore();
  },
};
`,
  },
  {
    key: "zoom_motion_blur",
    name: "Zoom de golpe con desenfoque de movimiento",
    use: "Énfasis o giro de la historia: zoom rápido a la cara con desenfoque radial, destello y una palabra que golpea.",
    tags: ["zoom-golpe", "desenfoque"],
    params: [{ key: "word", label: "Palabra", value: "¿EN SERIO?" }],
    sounds: [{ at: 0.0, name: "punch", gain: -12 }],
    hide_captions: false,
    code: String.raw`export default {
  params: { word: "¿EN SERIO?" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const cx = env.face.cx;
    const cy = env.face.cy;
    // Golpe de zoom (0–0,22 s), se sostiene con un leve temblor y vuelve al final.
    const hitP = ease.outExpo(env.progress(t, 0, 0.22));
    const back = ease.inOutCubic(env.progress(t, env.duration - 0.4, 0.4));
    const scale = 1 + 0.42 * hitP * (1 - back);
    const shake = (1 - env.progress(t, 0.2, 0.6)) * 10 * u;
    const sx = env.noise(t * 18, 1, env.seed) * shake;
    const sy = env.noise(t * 18, 7, env.seed) * shake;
    const blur = Math.max(0, 1 - env.progress(t, 0.02, 0.26)) + Math.max(0, env.progress(t, env.duration - 0.4, 0.3) - 0.2) * (1 - env.progress(t, env.duration - 0.1, 0.1));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    if (blur > 0.02) env.zoomBlur(ctx, env.video, { cx, cy, scale: 1, amount: 0.12 * blur, samples: 9 });
    else ctx.drawVideo();
    ctx.restore();
    // Viñeta para concentrar la mirada.
    const v = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0," + (0.55 * hitP * (1 - back)).toFixed(3) + ")");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    // Destello del golpe.
    const flash = 1 - env.progress(t, 0, 0.14);
    if (flash > 0) {
      ctx.fillStyle = "rgba(255,255,255," + (flash * 0.45).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    // La palabra golpea arriba de la cabeza.
    const wp = env.spring(Math.max(0, t - 0.08), { stiffness: 320, damping: 15 });
    const word = String(env.params.word || "");
    if (word) {
      const top = Math.max(110 * u, env.safe.y - 70 * u);
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 8) * (1 - back);
      ctx.translate(W / 2, top);
      ctx.rotate(-0.06);
      ctx.scale(0.4 + 0.6 * wp, 0.4 + 0.6 * wp);
      ctx.font = env.font(900, 104 * u, env.brand.display);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(word).width;
      ctx.fillStyle = env.brand.accent;
      ctx.beginPath();
      ctx.roundRect(-tw / 2 - 30 * u, -70 * u, tw + 60 * u, 140 * u, 20 * u);
      ctx.fill();
      ctx.fillStyle = env.brand.accentText;
      ctx.fillText(word, 0, 6 * u);
      ctx.restore();
    }
  },
};
`,
  },
  {
    key: "split_mockup",
    name: "Pantalla dividida con teléfono",
    use: "Cuando habla de una app, un mensaje o un resultado en pantalla: la persona arriba y un teléfono con la interfaz abajo (en 16:9, al costado).",
    tags: ["pantalla-dividida", "mockup"],
    params: [
      { key: "app", label: "Nombre de la app", value: "Mensajes" },
      { key: "msg1", label: "Mensaje 1", value: "¿Cuánto cuesta tu programa?" },
      { key: "msg2", label: "Mensaje 2", value: "Quiero empezar hoy" },
      { key: "msg3", label: "Mensaje 3", value: "¡Ya pagué!" },
    ],
    sounds: [
      { at: 0.05, name: "swipe", gain: -16 },
      { at: 0.7, name: "notification", gain: -16 },
    ],
    hide_captions: true,
    code: String.raw`export default {
  params: { app: "Mensajes", msg1: "¿Cuánto cuesta tu programa?", msg2: "Quiero empezar hoy", msg3: "¡Ya pagué!" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    const inP = ease.inOutCubic(env.progress(t, 0, 0.55));
    const out = ease.inOutCubic(env.progress(t, env.duration - 0.45, 0.45));
    const k = inP * (1 - out);
    const v = env.vertical;
    // El video se corre a su mitad (arriba o a la izquierda), centrado en la cara.
    const split = v ? H * (1 - 0.5 * k) : W * (1 - 0.5 * k);
    ctx.fillStyle = env.brand.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    if (v) ctx.rect(0, 0, W, split);
    else ctx.rect(0, 0, split, H);
    ctx.clip();
    const shift = v ? Math.max(-(env.face.cy - split / 2), -H * 0.25) * k : -(env.face.cx - split / 2) * k;
    if (v) ctx.drawVideo(0, shift * 0.6, W, H);
    else ctx.drawVideo(shift * 0.6, 0, W, H);
    ctx.restore();
    // Línea de la marca en el corte.
    ctx.fillStyle = env.brand.accent;
    if (v) ctx.fillRect(0, split - 3 * u, W, 6 * u);
    else ctx.fillRect(split - 3 * u, 0, 6 * u, H);
    // Teléfono.
    const areaX = v ? 0 : split;
    const areaY = v ? split : 0;
    const areaW = v ? W : W - split;
    const areaH = v ? H - split : H;
    if (k < 0.05) return;
    const pw = v ? W * 0.6 : Math.min(areaW * 0.62, areaH * 0.5);
    const ph = pw * 2.05;
    const px = areaX + areaW / 2 - pw / 2;
    const py = areaY + (v ? 60 * u : (areaH - ph) / 2) + (1 - k) * 200 * u;
    ctx.save();
    ctx.beginPath();
    if (v) ctx.rect(0, split, W, H - split);
    else ctx.rect(split, 0, W - split, H);
    ctx.clip();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 50 * u;
    ctx.fillStyle = "#0b0f1a";
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 64 * u);
    ctx.fill();
    ctx.shadowBlur = 0;
    const sx = px + 16 * u;
    const sy = py + 16 * u;
    const sw = pw - 32 * u;
    const sh = ph - 32 * u;
    ctx.fillStyle = "#f4f6fb";
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 50 * u);
    ctx.fill();
    ctx.fillStyle = "#0b0f1a";
    ctx.beginPath();
    ctx.roundRect(px + pw / 2 - 60 * u, sy + 14 * u, 120 * u, 30 * u, 15 * u);
    ctx.fill();
    ctx.fillStyle = "#1b2233";
    const ks = pw / (540 * u);
    ctx.font = env.font(700, 32 * u * ks, env.fonts.sans);
    ctx.textAlign = "center";
    ctx.fillText(String(env.params.app || ""), px + pw / 2, sy + 88 * u * ks);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(sx, sy + 110 * u, sw, 2 * u);
    // Mensajes que llegan uno por uno.
    const msgs = [env.params.msg1, env.params.msg2, env.params.msg3].map((s) => String(s || "")).filter(Boolean);
    ctx.textAlign = "left";
    ctx.font = env.font(500, 30 * u * ks, env.fonts.sans);
    let y = sy + 150 * u * ks;
    msgs.forEach((m, i) => {
      const at = 0.55 + i * Math.max(0.4, (env.duration - 1.4) / Math.max(1, msgs.length));
      const p = env.spring(Math.max(0, t - at), { stiffness: 260, damping: 18 });
      if (t < at) return;
      const lines = env.wrap(ctx, m, sw * 0.62, 3);
      const bh = (26 + lines.length * 40) * u * ks;
      const bw = Math.min(sw * 0.78, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 44 * u * ks);
      const mine = i % 2 === 1;
      const bx = mine ? sx + sw - bw - 22 * u : sx + 22 * u;
      ctx.save();
      ctx.translate(bx + (mine ? bw : 0), y + bh / 2);
      ctx.scale(p, p);
      ctx.translate(-(bx + (mine ? bw : 0)), -(y + bh / 2));
      ctx.fillStyle = mine ? env.brand.accent : "#e3e7f0";
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, bh, 28 * u);
      ctx.fill();
      ctx.fillStyle = mine ? env.brand.accentText : "#1b2233";
      lines.forEach((l, li) => ctx.fillText(l, bx + 22 * u * ks, y + (46 + li * 40) * u * ks));
      ctx.restore();
      y += bh + 18 * u * ks;
    });
    ctx.restore();
  },
};
`,
  },
  {
    key: "image_focus",
    name: "Imagen con foco, contorno y flecha",
    use: "Mostrar algo con una imagen generada (mapa, objeto, lugar): paneo y zoom hasta la zona, el resto se apaga y desenfoca, la zona se remarca y una flecha con etiqueta la señala.",
    tags: ["imagen-ia", "foco", "flecha"],
    params: [{ key: "label", label: "Etiqueta", value: "El mejor país del mundo" }],
    sounds: [
      { at: 0.0, name: "whoosh_soft", gain: -16 },
      { at: 1.25, name: "pop", gain: -12 },
    ],
    hide_captions: true,
    code: String.raw`// Zona de la imagen (0…1) que eligió Claude mirando la imagen generada.
const FOCUS = { x: 0.47, y: 0.36, w: 0.07, h: 0.08 };

export default {
  background: "none",
  params: { label: "El mejor país del mundo" },
  render(ctx, t, env) {
    const { W, H, u, ease } = env;
    // La imagen generada; sin ella (no hay generador conectado), el mismo movimiento sobre el video (foco en la cara).
    const img = env.assets.find((a) => a.kind === "image");
    const src = img || env.video;
    const iw = img ? img.width : W;
    const ih = img ? img.height : H;
    const F = img ? FOCUS : { x: env.face.x / W, y: env.face.y / H, w: env.face.w / W, h: env.face.h / H };
    // Encuadre: de la imagen entera (cubriendo el cuadro) a la zona, centrada un poco arriba.
    const cover = Math.max(W / iw, H / ih);
    const zoomTo = Math.min(4.2, (Math.min(W, H) * 0.42) / (Math.max(F.w * iw, F.h * ih) * cover));
    const p = ease.inOutCubic(env.progress(t, 0.15, 1.1));
    const out = ease.inCubic(env.progress(t, env.duration - 0.35, 0.35));
    const z = cover * env.lerp(1, zoomTo, p);
    const fx = (F.x + F.w / 2) * iw;
    const fy = (F.y + F.h / 2) * ih;
    const tx = env.lerp(W / 2 - (iw / 2) * z, W / 2 - fx * z, p);
    const ty = env.lerp(H / 2 - (ih / 2) * z, H * 0.44 - fy * z, p);
    const drawImg = (c) => c.drawImage(src, tx, ty, iw * z, ih * z);
    // Fondo desenfocado y apagado; la zona, nítida.
    const fxp = ease.outCubic(env.progress(t, 0.9, 0.5));
    const zx = tx + F.x * iw * z;
    const zy = ty + F.y * ih * z;
    const zw = F.w * iw * z;
    const zh = F.h * ih * z;
    ctx.save();
    ctx.filter = fxp > 0.01 ? "blur(" + (fxp * 10).toFixed(1) + "px) brightness(" + (1 - fxp * 0.5).toFixed(3) + ")" : "none";
    drawImg(ctx);
    ctx.restore();
    if (fxp > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(zx + zw / 2, zy + zh / 2, zw * 0.62, zh * 0.62, 0, 0, Math.PI * 2);
      ctx.clip();
      drawImg(ctx);
      ctx.restore();
      // Contorno que se dibuja.
      const cp = ease.inOutCubic(env.progress(t, 1.0, 0.5));
      const r = Math.max(zw, zh) * 0.66;
      ctx.save();
      ctx.strokeStyle = env.brand.accent;
      ctx.lineWidth = 8 * u;
      ctx.shadowColor = env.rgba(env.brand.accent, 0.9);
      ctx.shadowBlur = 22 * u;
      ctx.beginPath();
      ctx.ellipse(zx + zw / 2, zy + zh / 2, zw * 0.62 + 8 * u, zh * 0.62 + 8 * u, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cp);
      ctx.stroke();
      ctx.restore();
      // Flecha curva que llega desde abajo, con la etiqueta.
      const ap = ease.inOutCubic(env.progress(t, 1.25, 0.55));
      if (ap > 0) {
        const ex = zx + zw / 2;
        const ey = zy + zh / 2 + r + 18 * u;
        const sx0 = W * 0.5 + (ex > W / 2 ? -1 : 1) * W * 0.18;
        const sy0 = Math.min(H * 0.8, ey + 380 * u);
        const c1x = sx0;
        const c1y = (sy0 + ey) / 2;
        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 9 * u;
        ctx.lineCap = "round";
        const len = Math.hypot(ex - sx0, ey - sy0) * 1.3;
        ctx.setLineDash([len, len]);
        ctx.lineDashOffset = len * (1 - ap);
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.quadraticCurveTo(c1x, c1y, ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        if (ap > 0.92) {
          const a = Math.atan2(ey - c1y, ex - c1x);
          ctx.translate(ex, ey);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(6 * u, 0);
          ctx.lineTo(-34 * u, -22 * u);
          ctx.moveTo(6 * u, 0);
          ctx.lineTo(-34 * u, 22 * u);
          ctx.stroke();
        }
        ctx.restore();
        const lp = env.spring(Math.max(0, t - 1.5), { stiffness: 240, damping: 17 });
        if (t > 1.5) {
          const label = String(env.params.label || "");
          ctx.save();
          ctx.font = env.font(800, 52 * u, env.brand.display);
          const lw = Math.min(W * 0.86, ctx.measureText(label).width + 60 * u);
          const lx = env.clamp(sx0 - lw / 2, 30 * u, W - lw - 30 * u);
          const ly = sy0 + 30 * u;
          ctx.translate(lx + lw / 2, ly + 50 * u);
          ctx.scale(lp, lp);
          ctx.translate(-(lx + lw / 2), -(ly + 50 * u));
          ctx.fillStyle = env.brand.accent;
          ctx.beginPath();
          ctx.roundRect(lx, ly, lw, 100 * u, 24 * u);
          ctx.fill();
          ctx.fillStyle = env.brand.accentText;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, lx + lw / 2, ly + 53 * u, lw - 40 * u);
          ctx.restore();
        }
      }
    }
    if (out > 0) {
      ctx.fillStyle = env.rgba("#000000", out);
      ctx.globalAlpha = 1;
      ctx.drawVideo();
      ctx.globalAlpha = 1 - out;
      drawImg(ctx);
      ctx.globalAlpha = 1;
    }
  },
};
`,
  },
];

export const sampleByKey = (key: string) => COMPOS_SAMPLES.find((s) => s.key === key) ?? null;
