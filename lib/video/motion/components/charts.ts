/**
 * Gráficos de datos: embudo que se llena, barras que suben y línea que se dibuja. Las cifras siempre las escribe
 * quien arma la escena (salen de lo que se dice en el video): el componente no inventa datos.
 */
import { z } from "zod";
import { countUp, draw, fadeIn, fadeUp, fill, pop, pulse, wipe } from "../animate";
import { body, col, counter, counterWidth, display, ellipse, fit, inkOn, mix, path, rect, rgba, textNode, type Kit } from "../kit";
import type { Node } from "../nodes";
import { smoothThrough } from "../path";
import { cx, defineComponent, fitToRegion, req, stack, str, textShadow, type Block } from "./shared";

const titleOf = (k: Kit, title: string, w: number): Block | null => {
  if (!title) return null;
  const f = fit(k, title, display(k, 800, -0.025), { max: 66 * k.s, min: 38 * k.s, maxW: w, maxLines: 2, leading: 1.1 });
  return { h: f.height, make: (y) => [fadeUp(textNode(k, f, cx(k) - w / 2, y, w, { align: "center", color: col(k, "text"), on: k.ground, label: "el título", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: 0, dist: 28 * k.s })] };
};

/** Formatea un número para mostrar (es-419: 12,345 · 2.5). */
function fmtNum(v: number): string {
  const r = Math.round(v * 10) / 10;
  const [i, d] = String(Math.abs(r)).split(".");
  return `${r < 0 ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${d ? `.${d}` : ""}`;
}

/** Polígono con esquinas redondeadas (radio r) como `d`. */
function roundedPolygon(pts: [number, number][], r: number): string {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]];
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(v1[0]!, v1[1]!);
    const l2 = Math.hypot(v2[0]!, v2[1]!);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = [p1[0] + (v1[0]! / l1) * rr, p1[1] + (v1[1]! / l1) * rr];
    const b = [p1[0] + (v2[0]! / l2) * rr, p1[1] + (v2[1]! / l2) * rr];
    d += `${i === 0 ? "M" : "L"}${a[0]} ${a[1]}Q${p1[0]} ${p1[1]} ${b[0]} ${b[1]}`;
  }
  return `${d}Z`;
}

// ─── Embudo ───────────────────────────────────────────────────────────────

export const funnel = defineComponent({
  label: "Embudo",
  hint: "De 2 a 5 niveles que se llenan de arriba abajo (Seguidores → Conversaciones → Clientes), con cifra opcional.",
  props: z.object({
    title: str(48).default(""),
    levels: z.array(z.object({ label: req(24), value: str(10).default("") })).min(2).max(5),
  }),
  example: { title: "", levels: [{ label: "Seguidores", value: "10K" }, { label: "Conversaciones", value: "300" }, { label: "Llamadas", value: "40" }, { label: "Clientes", value: "12" }] },
  texts: (p) => [p.title, ...p.levels.flatMap((l) => [l.label, l.value])],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const n = p.levels.length;
      const w = Math.min(k.region.w, (k.vertical ? 900 : 1000) * k.s);
      const hasValues = p.levels.some((l) => l.value);
      const levelH = (hasValues ? 172 : 128) * k.s;
      const gap = 14 * k.s;
      const bottomW = w * 0.4;
      const x = cx(k);
      const blocks: Block[] = [];
      const tb = titleOf(k, p.title, w);
      if (tb) blocks.push(tb);
      const flowAt = 0.4;
      const each = Math.max(0.22, Math.min(0.42, (k.duration * 0.45) / n));
      blocks.push({
        h: n * levelH + (n - 1) * gap,
        gap: 44 * k.s,
        make: (y) => {
          const out: Node[] = [];
          const widthAt = (yy: number) => w - (w - bottomW) * ((yy - y) / (n * levelH + (n - 1) * gap));
          p.levels.forEach((lv, i) => {
            const top = y + i * (levelH + gap);
            const bot = top + levelH;
            const wt = widthAt(top);
            const wb = widthAt(bot);
            const pts: [number, number][] = [
              [x - wt / 2, top],
              [x + wt / 2, top],
              [x + wb / 2, bot],
              [x - wb / 2, bot],
            ];
            const d = roundedPolygon(pts, 22 * k.s);
            const t = n === 1 ? 1 : i / (n - 1);
            const color = mix(mix(k.theme.surface, k.theme.accent, 0.45), k.theme.accent, t);
            const shell = path(d, { fill: rgba(k.theme.text, k.theme.dark ? 0.06 : 0.05), stroke: { color: rgba(k.theme.text, k.theme.dark ? 0.14 : 0.12), width: Math.max(1, 1.5 * k.u) }, role: "card", label: `el nivel ${i + 1}` });
            const liquid = path(d, { fill: { kind: "linear", x0: 0, y0: top, x1: 0, y1: bot, stops: [[0, mix(color, "#ffffff", 0.12)], [1, color]] }, role: "card", overlap: true, ...(i === n - 1 ? { shadow: { color: rgba(k.theme.accent, 0.5), blur: 50 * k.u, y: 14 * k.u } } : {}) });
            const at = flowAt + i * each;
            out.push(fadeUp(shell, { at: 0.05 + i * 0.07, dist: 24 * k.s }), wipe(liquid, { at, dur: each * 1.05, dir: "down", ease: "easeInOut" }));
            const ink = inkOn(k, color);
            const inner = Math.min(wt, wb) - 60 * k.s;
            if (lv.value) {
              const vSize = 64 * k.s;
              const lf = fit(k, lv.label, body(k, 700, 0.0), { max: 32 * k.s, min: 22 * k.s, maxW: inner, maxLines: 1, leading: 1.2 });
              const blockH = vSize + 8 * k.s + lf.height;
              const vy = top + (levelH - blockH) / 2;
              let vs = vSize;
              while (counterWidth(k, lv.value, vs, display(k, 900, -0.03)) > inner && vs > 30 * k.s) vs *= 0.94;
              const num = counter(k, lv.value, { x, top: vy, size: vs, font: display(k, 900, -0.03), color: ink, on: color, overlap: true, label: `la cifra del nivel ${i + 1}` });
              out.push(countUp(fadeUp(num, { at: at + each * 0.55, dist: 16 * k.s }), { at: at + each * 0.55, dur: 0.7 }));
              out.push(fadeUp(textNode(k, lf, x - inner / 2, vy + vSize + 8 * k.s, inner, { align: "center", color: ink, on: color, overlap: true, label: `el nivel ${i + 1}` }), { at: at + each * 0.65, dist: 16 * k.s }));
            } else {
              const lf = fit(k, lv.label, display(k, 800, -0.02), { max: 50 * k.s, min: 26 * k.s, maxW: inner, maxLines: 1, leading: 1.2 });
              out.push(fadeUp(textNode(k, lf, x - inner / 2, top + (levelH - lf.height) / 2, inner, { align: "center", color: ink, on: color, overlap: true, label: `el nivel ${i + 1}` }), { at: at + each * 0.55, dist: 16 * k.s }));
            }
          });
          return out;
        },
      });
      return stack(k, blocks);
    }),
});

// ─── Barras ───────────────────────────────────────────────────────────────

export const barChart = defineComponent({
  label: "Barras",
  hint: "De 2 a 6 barras que suben con su cifra contando; una queda destacada (por defecto la última).",
  props: z.object({
    title: str(48).default(""),
    bars: z.array(z.object({ label: str(14).default(""), value: z.number().min(0).max(1e9) })).min(2).max(6),
    prefix: str(4).default(""),
    suffix: str(6).default(""),
    highlight: z.number().int().min(-1).max(5).default(-1),
  }),
  example: { title: "Clientes por mes", bars: [{ label: "Ene", value: 2 }, { label: "Feb", value: 3 }, { label: "Mar", value: 5 }, { label: "Abr", value: 10 }], prefix: "", suffix: "", highlight: -1 },
  texts: (p) => [p.title, ...p.bars.flatMap((b) => [b.label, `${p.prefix}${fmtNum(b.value)}${p.suffix}`])],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const n = p.bars.length;
      const w = Math.min(k.region.w * (k.vertical ? 0.86 : 1), (k.vertical ? 900 : 1300) * k.s);
      const x0 = cx(k) - w / 2;
      const chartH = Math.min((k.vertical ? 620 : 470) * k.s, k.region.h * 0.62);
      const gapRatio = 0.34;
      const barW = Math.min(170 * k.s, w / (n + (n - 1) * gapRatio));
      const gap = n > 1 ? (w - n * barW) / (n - 1) : 0;
      const max = Math.max(...p.bars.map((b) => b.value), 1e-9);
      const hi = p.highlight >= 0 && p.highlight < n ? p.highlight : n - 1;
      const valueSize = Math.min(54 * k.s, barW * 0.5);
      const labelF = body(k, 600, 0);
      const labelH = p.bars.some((b) => b.label) ? 34 * k.s * 1.2 : 0;
      const blocks: Block[] = [];
      const tb = titleOf(k, p.title, w);
      if (tb) blocks.push(tb);
      const each = Math.max(0.1, Math.min(0.22, (k.duration * 0.3) / n));
      blocks.push({
        h: valueSize * 1.3 + chartH + 20 * k.s + labelH,
        gap: 40 * k.s,
        make: (y) => {
          const out: Node[] = [];
          const base = y + valueSize * 1.3 + chartH;
          // Guías horizontales suaves y el eje.
          for (let g = 1; g <= 3; g++) {
            const gy = base - (chartH * g) / 3;
            out.push(fadeIn(path(`M${x0} ${gy}L${x0 + w} ${gy}`, { stroke: { color: rgba(k.theme.text, 0.07), width: Math.max(1, 1.5 * k.u), dash: [8 * k.s, 10 * k.s] }, overlap: true }), { at: 0.1 + g * 0.05 }));
          }
          out.push(draw(path(`M${x0 - 10 * k.s} ${base}L${x0 + w + 10 * k.s} ${base}`, { stroke: { color: rgba(k.theme.text, 0.35), width: Math.max(2, 3 * k.s), cap: "round" }, overlap: true }), { at: 0, dur: 0.5, ease: "easeOutExpo" }));
          p.bars.forEach((b, i) => {
            const bx = x0 + i * (barW + gap);
            const h = Math.max(6 * k.s, (chartH * b.value) / max);
            const strong = i === hi;
            const at = 0.3 + i * each;
            const bar = rect({
              x: bx,
              y: base - h,
              w: barW,
              h,
              r: Math.min(18 * k.s, barW / 3),
              fill: strong
                ? { kind: "linear", x0: 0, y0: base - h, x1: 0, y1: base, stops: [[0, mix(k.theme.accent, "#ffffff", 0.18)], [1, k.theme.accent]] }
                : { kind: "linear", x0: 0, y0: base - h, x1: 0, y1: base, stops: [[0, rgba(k.theme.accent, 0.42)], [1, rgba(k.theme.accent, 0.16)]] },
              grow: "up",
              role: "shape",
              overlap: true,
              label: `la barra ${i + 1}`,
              ...(strong ? { shadow: { color: rgba(k.theme.accent, 0.55), blur: 46 * k.u, y: 0 } } : {}),
            });
            out.push(fill(bar, { at, dur: 0.9, ease: "backSoft" }));
            const val = `${p.prefix}${fmtNum(b.value)}${p.suffix}`;
            let vs = valueSize;
            while (counterWidth(k, val, vs, display(k, 800, -0.02)) > barW + gap * 0.8 && vs > 18 * k.s) vs *= 0.93;
            const num = counter(k, val, { x: bx + barW / 2, top: base - h - vs * 1.22, size: vs, font: display(k, 800, -0.02), color: strong ? col(k, "text") : col(k, "muted"), affixColor: strong ? col(k, "accent") : col(k, "muted"), on: k.ground, label: `la cifra de la barra ${i + 1}` });
            // La cifra sube junto con la barra.
            num.tracks.y = [{ t: at, v: h }, { t: at + 0.9, v: 0, ease: "backSoft" }];
            out.push(countUp(fadeIn(num, { at: at + 0.05, dur: 0.3 }), { at, dur: 0.9, ease: "easeOutCubic" }));
            if (b.label) {
              const lf = fit(k, b.label, labelF, { max: 32 * k.s, min: 20 * k.s, maxW: barW + gap * 0.8, maxLines: 1, leading: 1.2 });
              out.push(fadeUp(textNode(k, lf, bx + barW / 2 - (barW + gap) / 2, base + 20 * k.s, barW + gap, { align: "center", color: strong ? col(k, "text") : col(k, "muted"), on: k.ground }), { at: at, dist: 14 * k.s }));
            }
          });
          return out;
        },
      });
      return stack(k, blocks);
    }),
});

// ─── Línea ────────────────────────────────────────────────────────────────

export const lineChart = defineComponent({
  label: "Línea",
  hint: "Una curva que se dibuja (crecimiento) con el último punto destacado y su cifra.",
  props: z.object({
    title: str(48).default(""),
    points: z.array(z.number()).min(3).max(12),
    value: str(12).default(""),
    startLabel: str(16).default(""),
    endLabel: str(16).default(""),
  }),
  example: { title: "Seguidores", points: [1, 1.2, 1.1, 1.8, 2.4, 2.2, 3.6, 5, 7.5, 10], value: "10K", startLabel: "Enero", endLabel: "Hoy" },
  texts: (p) => [p.title, p.value, p.startLabel, p.endLabel],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const w = Math.min(k.region.w * (k.vertical ? 0.86 : 1), (k.vertical ? 900 : 1300) * k.s);
      const x0 = cx(k) - w / 2;
      const chartH = Math.min((k.vertical ? 560 : 440) * k.s, k.region.h * 0.6);
      const tagH = p.value ? 84 * k.s : 0;
      const labelsH = p.startLabel || p.endLabel ? 50 * k.s : 0;
      const blocks: Block[] = [];
      const tb = titleOf(k, p.title, w);
      if (tb) blocks.push(tb);
      const lineDur = Math.max(0.9, Math.min(1.8, k.duration * 0.45));
      blocks.push({
        h: tagH + 30 * k.s + chartH + labelsH,
        gap: 40 * k.s,
        make: (y) => {
          const out: Node[] = [];
          const top = y + tagH + 30 * k.s;
          const base = top + chartH;
          const min = Math.min(...p.points);
          const max = Math.max(...p.points);
          const span = max - min || 1;
          const padR = p.value ? 30 * k.s : 0;
          const pts = p.points.map((v, i) => [x0 + ((w - padR) * i) / (p.points.length - 1), base - chartH * 0.06 - ((v - min) / span) * chartH * 0.88]);
          for (let g = 0; g <= 3; g++) {
            const gy = base - (chartH * g) / 3;
            out.push(fadeIn(path(`M${x0} ${gy}L${x0 + w} ${gy}`, { stroke: { color: rgba(k.theme.text, g === 0 ? 0.22 : 0.07), width: Math.max(1, (g === 0 ? 2 : 1.5) * k.u), ...(g ? { dash: [8 * k.s, 10 * k.s] } : {}) }, overlap: true }), { at: 0.05 * g }));
          }
          const d = `M${pts[0]![0]} ${pts[0]![1]}${smoothThrough(pts)}`;
          const last = pts[pts.length - 1]!;
          const area = path(`${d}L${last[0]} ${base}L${pts[0]![0]} ${base}Z`, { fill: { kind: "linear", x0: 0, y0: top, x1: 0, y1: base, stops: [[0, rgba(k.theme.accent, 0.34)], [1, rgba(k.theme.accent, 0)]] }, overlap: true, role: "decor" });
          out.push(wipe(area, { at: 0.25, dur: lineDur, dir: "right", ease: "easeInOut" }));
          const line = path(d, { stroke: { color: { kind: "linear", x0, y0: 0, x1: x0 + w, y1: 0, stops: [[0, k.theme.accent2], [1, k.theme.accent]] }, width: Math.max(4, 9 * k.s), cap: "round", join: "round" }, overlap: true, shadow: { color: rgba(k.theme.accent, 0.5), blur: 24 * k.u, y: 6 * k.u } });
          out.push(draw(line, { at: 0.25, dur: lineDur, ease: "easeInOut" }));
          const end = 0.25 + lineDur;
          const dotD = 30 * k.s;
          out.push(pop(ellipse({ cx: last[0]!, cy: last[1]!, rx: dotD / 2, fill: k.theme.accentText, stroke: { color: k.theme.accent, width: 7 * k.s }, overlap: true, role: "decor" }), { at: end - 0.05, from: 0.2, bounce: 0.5 }));
          const halo = ellipse({ cx: last[0]!, cy: last[1]!, rx: dotD * 1.1, fill: rgba(k.theme.accent, 0.25), overlap: true, role: "decor" });
          out.push(pulse(fadeIn(halo, { at: end }), { at: end, period: 1, amount: 0.35, count: 3 }));
          if (p.value) {
            const font = display(k, 800, -0.02);
            const vs = 46 * k.s;
            const tw = counterWidth(k, p.value, vs, font) + 48 * k.s;
            const th = 72 * k.s;
            const tx = Math.min(x0 + w - tw, Math.max(x0, last[0]! - tw / 2));
            const ty = Math.max(y, last[1]! - dotD - th - 18 * k.s);
            const pill = rect({ x: tx, y: ty, w: tw, h: th, r: th / 2, fill: k.theme.accent, shadow: { color: rgba(k.theme.accent, 0.5), blur: 30 * k.u, y: 8 * k.u }, role: "card", overlap: true });
            const num = counter(k, p.value, { x: tx + tw / 2, top: ty + (th - vs) / 2, size: vs, font, color: k.theme.accentText, affixColor: k.theme.accentText, on: k.theme.accent, overlap: true, label: "la cifra final" });
            pill.pivot = [tx + tw / 2, ty + th];
            num.pivot = [tx + tw / 2, ty + th];
            out.push(pop(pill, { at: end + 0.05, from: 0.4, bounce: 0.4 }), countUp(pop(num, { at: end + 0.05, from: 0.4, bounce: 0.4 }), { at: end, dur: 0.6 }));
          }
          const lf = body(k, 600, 0);
          if (p.startLabel) {
            const f = fit(k, p.startLabel, lf, { max: 30 * k.s, min: 20 * k.s, maxW: w / 2, maxLines: 1, leading: 1.2 });
            out.push(fadeIn(textNode(k, f, x0, base + 16 * k.s, w / 2, { color: col(k, "muted"), on: k.ground }), { at: 0.2 }));
          }
          if (p.endLabel) {
            const f = fit(k, p.endLabel, lf, { max: 30 * k.s, min: 20 * k.s, maxW: w / 2, maxLines: 1, leading: 1.2 });
            out.push(fadeIn(textNode(k, f, x0 + w / 2, base + 16 * k.s, w / 2, { align: "right", color: col(k, "muted"), on: k.ground }), { at: end }));
          }
          return out;
        },
      });
      return stack(k, blocks);
    }),
});
