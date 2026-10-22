/**
 * Comparación: mito/realidad o antes/después. La primera tarjeta queda apagada y se tacha; la segunda entra
 * después, destacada con el acento.
 */
import { z } from "zod";
import { draw, fadeUp, pop, strike } from "../animate";
import { card, cardGround, checkPath, col, crossPath, display, ellipse, eyebrowFont, fit, icon, inkOn, rgba, textNode } from "../kit";
import type { Node } from "../nodes";
import { defineComponent, fitToRegion, req, stack, type Block } from "./shared";

const side = z.object({ label: req(18), text: req(64) });

export const comparison = defineComponent({
  label: "Comparación",
  hint: "Dos tarjetas: lo que se cree (o antes) se tacha y aparece lo que funciona (o después).",
  props: z.object({ left: side, right: side }),
  example: { left: { label: "Mito", text: "Necesitas más seguidores para vender" }, right: { label: "Realidad", text: "Necesitas un sistema que convierta" } },
  texts: (p) => [p.left.label, p.left.text, p.right.label, p.right.text],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const horizontal = !k.vertical;
      const gap = (horizontal ? 110 : 76) * k.s;
      const cardW = horizontal ? (k.region.w - gap) / 2 : Math.min(k.region.w, 900 * k.s);
      const pad = 40 * k.s;
      const font = display(k, 800, -0.02);
      const maxW = cardW - 2 * pad;
      const size = Math.min(...[p.left.text, p.right.text].map((t) => fit(k, t, font, { max: 58 * k.s, min: 32 * k.s, maxW, maxLines: 3, leading: 1.15 }).size));
      const lf = fit(k, p.left.text, font, { max: size, min: size, maxW, maxLines: 3, leading: 1.15 });
      const rf = fit(k, p.right.text, font, { max: size, min: size, maxW, maxLines: 3, leading: 1.15 });
      const chip = 56 * k.s;
      const head = chip;
      const textGap = 26 * k.s;
      const cardH = pad + head + textGap + Math.max(lf.height, rf.height) + pad;
      const second = Math.max(0.55, Math.min(1.1, k.duration * 0.3));
      const x0 = horizontal ? k.region.x : k.region.x + (k.region.w - cardW) / 2;
      const make = (y: number): Node[] => {
        const out: Node[] = [];
        const boxes = horizontal
          ? [{ x: x0, y }, { x: x0 + cardW + gap, y }]
          : [{ x: x0, y }, { x: x0, y: y + cardH + gap }];
        const parts = [
          { s: p.left, f: lf, variant: "muted" as const, at: 0.05, good: false },
          { s: p.right, f: rf, variant: "accent" as const, at: second, good: true },
        ];
        parts.forEach(({ s, f, variant, at, good }, i) => {
          const b = boxes[i]!;
          const ground = cardGround(k, variant);
          const ink = inkOn(k, ground);
          const c = card(k, { ...b, w: cardW, h: cardH }, { variant, r: 34 * k.s, label: good ? "la tarjeta de la derecha" : "la tarjeta de la izquierda" });
          // Ficha redonda con cruz o tilde y la etiqueta en mayúsculas.
          const cxh = b.x + pad + chip / 2;
          const cyh = b.y + pad + chip / 2;
          const chipBg = ellipse({ cx: cxh, cy: cyh, rx: chip / 2, fill: good ? rgba(k.theme.accentText, 0.18) : rgba(k.theme.negative, 0.18), role: "decor" });
          const mark = good ? checkPath(k, cxh, cyh, chip * 0.95, { color: ink, width: chip * 0.1 }) : crossPath(k, cxh, cyh, chip, { color: k.theme.negative, width: chip * 0.09 });
          const lbl = fit(k, s.label, eyebrowFont(k), { max: 28 * k.s, min: 20 * k.s, maxW: maxW - chip - 20 * k.s, maxLines: 1, balance: false, leading: 1.2 });
          const lblN = textNode(k, lbl, cxh + chip / 2 + 20 * k.s, cyh - lbl.height / 2, lbl.widths[0]!, { color: good ? ink : col(k, "muted"), on: ground });
          const text = textNode(k, f, b.x + pad, b.y + pad + head + textGap, maxW, {
            color: good ? ink : rgba(k.theme.text, 0.62),
            on: ground,
            label: good ? "el texto de la derecha" : "el texto de la izquierda",
            ...(good ? {} : { strikeAll: { color: rgba(k.theme.negative, 0.9) } }),
          });
          out.push(fadeUp(c, { at, dist: 40 * k.s, dur: 0.65 }), fadeUp(chipBg, { at: at + 0.08, dist: 30 * k.s }), draw(mark, { at: at + 0.25, dur: 0.35 }), fadeUp(lblN, { at: at + 0.1, dist: 30 * k.s }), fadeUp(text, { at: at + 0.14, dist: 30 * k.s }));
          if (!good) strike(text, { at: second + 0.45, dur: 0.5 });
        });
        // Conector entre las dos tarjetas.
        const d = 84 * k.s;
        const ccx = horizontal ? x0 + cardW + gap / 2 : x0 + cardW / 2;
        const ccy = horizontal ? y + cardH / 2 : y + cardH + gap / 2;
        const ring = ellipse({ cx: ccx, cy: ccy, rx: d / 2, fill: k.mode === "overlay" ? k.theme.surface : k.theme.bg, stroke: { color: rgba(k.theme.accent, 0.8), width: Math.max(2, 3 * k.s) }, role: "decor", overlap: true });
        const ic = icon(k, horizontal ? "arrow-right" : "arrow-down", ccx, ccy, d * 0.48, { color: k.theme.accent, weight: 2.4, overlap: true });
        out.push(pop(ring, { at: second - 0.15, from: 0.3, bounce: 0.45 }), draw(ic, { at: second - 0.05, dur: 0.35 }));
        return out;
      };
      const blocks: Block[] = [{ h: horizontal ? cardH : 2 * cardH + gap, make }];
      return stack(k, blocks);
    }),
});
