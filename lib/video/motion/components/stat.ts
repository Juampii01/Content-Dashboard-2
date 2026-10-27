/**
 * Cifras: número grande que cuenta (statCard), de X a Y con flecha (beforeAfter) y progreso en anillo o barra.
 */
import { z } from "zod";
import { countUp, draw, fadeIn, fadeUp, fill, pop, wipe } from "../animate";
import { iconNameSchema } from "../icons";
import { arrow, body, col, counter, counterWidth, display, ellipse, eyebrow, fit, iconTile, rect, rgba, textNode } from "../kit";
import type { Node } from "../nodes";
import { cueAt, cued, cx, defineComponent, fitToRegion, stack, str, textShadow, type Block } from "./shared";

const value = z.string().trim().min(1).max(12).regex(/\d/, "La cifra tiene que tener un número.");

// ─── Número grande ────────────────────────────────────────────────────────

export const statCard = defineComponent({
  label: "Número que cuenta",
  hint: "Una cifra grande que cuenta hasta su valor (x2, +40%, 10K, 6/10), con una frase debajo.",
  props: z.object({
    value,
    label: str(60).default(""),
    eyebrow: str(32).default(""),
    icon: iconNameSchema.optional(),
  }),
  example: { value: "+40%", label: "más citas agendadas en un mes", eyebrow: "Resultado" },
  texts: (p) => [p.value, p.label, p.eyebrow],
  cueTexts: (p) => [p.value],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const big = display(k, 900, -0.045);
      // Con la voz: la cifra empieza a contar un poco antes de que se diga y llega a su valor justo al decirla.
      const countAt = cued(k) ? cueAt(k, 0, 0.1, 0.55) : 0.1;
      const countDur = cued(k) ? Math.max(0.5, cueAt(k, 0, 0, -0.2) - countAt) : Math.min(1.3, Math.max(0.7, k.duration * 0.4));
      const maxSize = (k.vertical ? 340 : 300) * k.s;
      let size = maxSize;
      while (size > 90 * k.s && counterWidth(k, p.value, size, big) > k.region.w * 0.94) size *= 0.95;
      const label = p.label ? fit(k, p.label, body(k, 600, -0.01), { max: 56 * k.s, min: 34 * k.s, maxW: Math.min(k.region.w, 860 * k.s), maxLines: 2, leading: 1.22 }) : null;
      const blocks: Block[] = [];
      const x = cx(k);
      if (p.icon)
        blocks.push({ h: 128 * k.s, make: (y: number) => [pop(iconTile(k, p.icon!, x, y + 64 * k.s, 128 * k.s), { at: 0, from: 0.4 })] });
      if (p.eyebrow) {
        const e = eyebrow(k, p.eyebrow, x, 0, { align: "center" });
        blocks.push({ h: e.h, gap: 44 * k.s, make: (y: number) => eyebrow(k, p.eyebrow, x, y, { align: "center" }).nodes.map((n) => fadeUp(n, { at: 0.05, dist: 20 * k.s })) });
      }
      const numH = size * 1.0;
      blocks.push({
        h: numH,
        gap: 18 * k.s,
        make: (y: number) => {
          const out: Node[] = [];
          if (k.mode === "full") {
            const gw = Math.min(k.W, counterWidth(k, p.value, size, big) * 1.25 + 260 * k.s);
            out.push(
              fadeIn(
                ellipse({ cx: x, cy: y + numH * 0.52, rx: gw / 2, ry: size * 0.95, fill: { kind: "radial", cx: x, cy: y + numH * 0.52, r: gw / 2, sy: (size * 0.95) / (gw / 2), stops: [[0, rgba(k.theme.accent, 0.32)], [0.5, rgba(k.theme.accent, 0.1)], [1, rgba(k.theme.accent, 0)]] }, role: "decor", overlap: true }),
                { at: 0, dur: 0.9 },
              ),
            );
          }
          const n = counter(k, p.value, { x, top: y, size, font: big, color: col(k, "text"), affixColor: col(k, "accent"), on: k.ground, label: "la cifra", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) });
          out.push(countUp(pop(n, { at: Math.max(0, countAt - 0.04), dur: 0.75, from: 0.72, bounce: 0.25 }), { at: countAt, dur: countDur }));
          return out;
        },
      });
      const barW = Math.min(220 * k.s, k.region.w * 0.3);
      const barH = Math.max(4, 10 * k.s);
      blocks.push({ h: barH, gap: 30 * k.s, make: (y: number) => [wipe(rect({ x: x - barW / 2, y, w: barW, h: barH, r: barH / 2, fill: { kind: "linear", x0: x - barW / 2, y0: 0, x1: x + barW / 2, y1: 0, stops: [[0, k.theme.accent], [1, k.theme.accent2]] }, role: "decor" }), { at: countAt + 0.45, dur: 0.6, dir: "center" })] });
      if (label)
        blocks.push({
          h: label.height,
          gap: 40 * k.s,
          make: (y: number) => [fadeUp(textNode(k, label, k.region.x, y, k.region.w, { align: "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground, label: "la frase de la cifra", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: countAt + 0.32, dist: 28 * k.s })],
        });
      return stack(k, blocks);
    }),
});

// ─── De X a Y ─────────────────────────────────────────────────────────────

export const beforeAfter = defineComponent({
  label: "De X a Y",
  hint: "Un cambio numérico: el valor de antes, una flecha que se dibuja y el de después contando (de 2 a 10 clientes).",
  props: z.object({
    from: value,
    to: value,
    fromLabel: str(18).default("Antes"),
    toLabel: str(18).default("Después"),
    label: str(60).default(""),
  }),
  example: { from: "2", to: "10", fromLabel: "Antes", toLabel: "Ahora", label: "clientes nuevos por mes" },
  texts: (p) => [p.from, p.to, p.fromLabel, p.toLabel, p.label],
  cueTexts: (p) => [p.from, p.to],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const x = cx(k);
      // Con la voz: la cifra de antes aparece al decirla y la de después cuenta hasta su valor cuando se dice.
      const fromAt = cueAt(k, 0, 0.05);
      const toAt = cued(k) ? Math.max(fromAt + 0.35, cueAt(k, 1, 0.45, 0.5)) : 0.45;
      const toDur = cued(k) ? Math.max(0.45, cueAt(k, 1, 0, -0.2) - toAt) : 0.9;
      const big = display(k, 900, -0.045);
      const label = p.label ? fit(k, p.label, body(k, 600), { max: 52 * k.s, min: 32 * k.s, maxW: Math.min(k.region.w, 860 * k.s), maxLines: 2, leading: 1.22 }) : null;
      const gap = (k.vertical ? 64 : 90) * k.s;
      const arrowW = (k.vertical ? 130 : 180) * k.s;
      let toSize = (k.vertical ? 280 : 260) * k.s;
      let fromSize = toSize * 0.55;
      const widthAt = () => counterWidth(k, p.from, fromSize, big) + counterWidth(k, p.to, toSize, big) + arrowW + 2 * gap;
      while (widthAt() > k.region.w && toSize > 80 * k.s) {
        toSize *= 0.95;
        fromSize *= 0.95;
      }
      const fromW = counterWidth(k, p.from, fromSize, big);
      const toW = counterWidth(k, p.to, toSize, big);
      const total = fromW + arrowW + toW + 2 * gap;
      const left = x - total / 2;
      const tagF = fit(k, p.fromLabel, { family: k.families.body, weight: 700, tracking: 0.14, uppercase: true }, { max: 28 * k.s, min: 20 * k.s, maxW: Math.max(fromW, 200 * k.s), maxLines: 1, balance: false, leading: 1.2 });
      const tagT = fit(k, p.toLabel, { family: k.families.body, weight: 700, tracking: 0.14, uppercase: true }, { max: 28 * k.s, min: 20 * k.s, maxW: Math.max(toW, 200 * k.s), maxLines: 1, balance: false, leading: 1.2 });
      const rowH = toSize * 1.0;
      const blocks: Block[] = [
        {
          h: tagT.height + 20 * k.s + rowH,
          make: (y: number) => {
            const base = y + tagT.height + 20 * k.s;
            const fromCx = left + fromW / 2;
            const toCx = left + fromW + 2 * gap + arrowW + toW / 2;
            const fromTop = base + (rowH - fromSize) * 0.62;
            const out: Node[] = [];
            out.push(fadeUp(textNode(k, tagF, fromCx - 300 * k.s, fromTop - tagF.height - 14 * k.s, 600 * k.s, { align: "center", color: col(k, "muted"), on: k.ground }), { at: Math.max(0, fromAt - 0.05), dist: 16 * k.s }));
            out.push(fadeUp(counter(k, p.from, { x: fromCx, top: fromTop, size: fromSize, font: big, color: col(k, "muted"), on: k.ground, label: "la cifra de antes" }), { at: fromAt, dist: 30 * k.s }));
            const ay = base + rowH * 0.52;
            out.push(draw(arrow(k, left + fromW + gap, ay, left + fromW + gap + arrowW, ay, { width: 8 * k.s, bend: -0.12 }), { at: Math.max(fromAt + 0.17, toAt - 0.25), dur: 0.5 }));
            if (k.mode === "full")
              out.push(fadeIn(ellipse({ cx: toCx, cy: base + rowH * 0.5, rx: toW * 0.9 + 80 * k.s, ry: toSize * 0.9, fill: { kind: "radial", cx: toCx, cy: base + rowH * 0.5, r: toW * 0.9 + 80 * k.s, sy: (toSize * 0.9) / (toW * 0.9 + 80 * k.s), stops: [[0, rgba(k.theme.accent, 0.3)], [1, rgba(k.theme.accent, 0)]] }, role: "decor", overlap: true }), { at: toAt - 0.05, dur: 0.8 }));
            out.push(fadeUp(textNode(k, tagT, toCx - 300 * k.s, y, 600 * k.s, { align: "center", color: col(k, "accent"), on: k.ground }), { at: toAt, dist: 16 * k.s }));
            out.push(countUp(pop(counter(k, p.to, { x: toCx, top: base, size: toSize, font: big, color: col(k, "text"), affixColor: col(k, "accent"), on: k.ground, label: "la cifra de después", from: Number(p.from.replace(/[^\d.]/g, "")) || 0, ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: toAt - 0.03, from: 0.7, dur: 0.7 }), { at: toAt, dur: toDur }));
            return out;
          },
        },
      ];
      if (label) blocks.push({ h: label.height, gap: 48 * k.s, make: (y: number) => [fadeUp(textNode(k, label, k.region.x, y, k.region.w, { align: "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: toAt + 0.25, dist: 24 * k.s })] });
      const out = stack(k, blocks);
      return { ...out, width: total };
    }),
});

// ─── Progreso ─────────────────────────────────────────────────────────────

export const progress = defineComponent({
  label: "Progreso",
  hint: "Un porcentaje que se llena (anillo o barra) y cuenta: 80% de tus ventas, 3 de cada 10.",
  props: z.object({
    value: z.number().min(0).max(100),
    style: z.enum(["ring", "bar"]).default("ring"),
    label: str(60).default(""),
    eyebrow: str(32).default(""),
  }),
  example: { value: 80, style: "ring", label: "de las ventas llegan por mensaje directo", eyebrow: "Dato" },
  texts: (p) => [`${p.value}%`, p.label, p.eyebrow],
  cueTexts: (p) => [`${p.value}%`],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const x = cx(k);
      // Con la voz: se llena y cuenta hasta llegar al porcentaje justo cuando se dice.
      const fillAt = cued(k) ? cueAt(k, 0, 0.25, 0.7) : 0.25;
      const fillDur = cued(k) ? Math.max(0.5, cueAt(k, 0, 0, -0.2) - fillAt) : 1.2;
      const pct = Math.round(p.value * 10) / 10;
      const text = `${String(pct).replace(".", ",")}%`;
      const label = p.label ? fit(k, p.label, body(k, 600), { max: 52 * k.s, min: 32 * k.s, maxW: Math.min(k.region.w, 820 * k.s), maxLines: 2, leading: 1.22 }) : null;
      const blocks: Block[] = [];
      if (p.eyebrow) {
        const e = eyebrow(k, p.eyebrow, x, 0, { align: "center" });
        blocks.push({ h: e.h, gap: 0, make: (y: number) => eyebrow(k, p.eyebrow, x, y, { align: "center" }).nodes.map((n) => fadeUp(n, { at: 0, dist: 20 * k.s })) });
      }
      if (p.style === "ring") {
        const d = Math.min(k.region.w * 0.78, (k.vertical ? 560 : 440) * k.s);
        const r = d / 2;
        const lw = d * 0.085;
        blocks.push({
          h: d,
          gap: 44 * k.s,
          make: (y: number) => {
            const cy = y + r;
            const ringR = r - lw / 2;
            const track = ellipse({ cx: x, cy, rx: ringR, stroke: { color: rgba(k.theme.text, k.theme.dark ? 0.1 : 0.12), width: lw }, role: "decor" });
            const glow = ellipse({ cx: x, cy, rx: r * 1.25, fill: { kind: "radial", cx: x, cy, r: r * 1.25, stops: [[0, rgba(k.theme.accent, 0)], [0.62, rgba(k.theme.accent, 0.18)], [1, rgba(k.theme.accent, 0)]] }, role: "decor", overlap: true });
            const arc = ellipse({ cx: x, cy, rx: ringR, stroke: { color: { kind: "linear", x0: x - r, y0: cy - r, x1: x + r, y1: cy + r, stops: [[0, k.theme.accent2], [1, k.theme.accent]] }, width: lw, cap: "round" }, arc: { start: 0, sweep: (360 * Math.max(0.5, pct)) / 100 }, role: "decor", overlap: true });
            const numSize = d * 0.3;
            const num = counter(k, text, { x, top: cy - numSize * 0.52, size: numSize, font: display(k, 900, -0.04), color: col(k, "text"), affixColor: col(k, "accent"), on: k.ground, overlap: true, label: "el porcentaje" });
            return [fadeIn(glow, { at: 0.2, dur: 0.9 }), pop(track, { at: 0, from: 0.85, bounce: 0.2 }), fill(arc, { at: fillAt, dur: fillDur, ease: "easeInOutExpo" }), countUp(fadeIn(num, { at: Math.max(0, fillAt - 0.05) }), { at: fillAt, dur: fillDur, ease: "easeInOutExpo" })];
          },
        });
      } else {
        const w = Math.min(k.region.w, 900 * k.s);
        const h = 44 * k.s;
        const numSize = 170 * k.s;
        blocks.push({
          h: numSize + 30 * k.s + h,
          gap: 30 * k.s,
          make: (y: number) => {
            const left = x - w / 2;
            const num = counter(k, text, { x: left, top: y, size: numSize, font: display(k, 900, -0.04), align: "left", color: col(k, "text"), affixColor: col(k, "accent"), on: k.ground, label: "el porcentaje" });
            const by = y + numSize + 30 * k.s;
            const trackN = rect({ x: left, y: by, w, h, r: h / 2, fill: rgba(k.theme.text, k.theme.dark ? 0.1 : 0.1), role: "decor" });
            const bar = rect({ x: left, y: by, w: (w * pct) / 100, h, r: h / 2, fill: { kind: "linear", x0: left, y0: 0, x1: left + w, y1: 0, stops: [[0, k.theme.accent2], [1, k.theme.accent]] }, grow: "right", shadow: { color: rgba(k.theme.accent, 0.5), blur: 30 * k.u }, role: "decor", overlap: true });
            return [countUp(fadeUp(num, { at: Math.max(0, fillAt - 0.2), dist: 24 * k.s }), { at: fillAt, dur: fillDur, ease: "easeInOutExpo" }), fadeIn(trackN, { at: Math.max(0, fillAt - 0.15) }), fill(bar, { at: fillAt, dur: fillDur, ease: "easeInOutExpo" })];
          },
        });
      }
      if (label) blocks.push({ h: label.height, gap: 40 * k.s, make: (y: number) => [fadeUp(textNode(k, label, k.region.x, y, k.region.w, { align: p.style === "bar" ? "center" : "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: 0.5, dist: 24 * k.s })] });
      return stack(k, blocks);
    }),
});
