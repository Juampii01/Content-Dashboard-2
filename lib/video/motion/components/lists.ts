/**
 * Componentes de secuencia: lista, checklist, pasos con flechas y línea de tiempo.
 */
import { z } from "zod";
import { draw, fadeIn, fadeUp, pop, pulse, slide } from "../animate";
import { iconNameSchema, type IconName } from "../icons";
import { arrow, body, card, cardGround, checkPath, col, display, ellipse, fit, iconTile, inkOn, mix, numberBadge, path, rect, rgba, textNode, type Kit } from "../kit";
import type { Node } from "../nodes";
import { cx, defineComponent, fitToRegion, req, stack, str, textShadow, type Block } from "./shared";

/** Título de los componentes de secuencia: display, alineado a la izquierda. */
function titleBlock(k: Kit, title: string, x: number, w: number, align: "left" | "center" = "left"): Block | null {
  if (!title) return null;
  const f = fit(k, title, display(k, 800, -0.025), { max: 70 * k.s, min: 40 * k.s, maxW: w, maxLines: 2, leading: 1.1 });
  return { h: f.height, make: (y) => [fadeUp(textNode(k, f, x, y, w, { align, color: col(k, "text"), on: k.ground, label: "el título", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: 0, dist: 30 * k.s })] };
}

const contentW = (k: Kit) => Math.min(k.region.w, (k.vertical ? 920 : 1180) * k.s);

// ─── Lista ────────────────────────────────────────────────────────────────

export const list = defineComponent({
  label: "Lista",
  hint: "De 2 a 5 puntos cortos que entran en cascada, con número o ícono.",
  props: z.object({
    title: str(56).default(""),
    items: z.array(req(56)).min(2).max(5),
    marker: z.enum(["number", "icon"]).default("number"),
    icons: z.array(iconNameSchema).max(5).default([]),
  }),
  example: { title: "Lo que revisa un buen anuncio", items: ["Un gancho en 3 segundos", "Una oferta clara y concreta", "Una sola llamada a la acción", "Seguimiento el mismo día"], marker: "number", icons: [] },
  texts: (p) => [p.title, ...p.items],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const w = contentW(k);
      const x0 = cx(k) - w / 2;
      const pad = 30 * k.s;
      const badge = 76 * k.s;
      const gap = 30 * k.s;
      const textW = w - 2 * pad - badge - gap;
      const font = body(k, 700, -0.012);
      const sizes = p.items.map((it) => fit(k, it, font, { max: 52 * k.s, min: 30 * k.s, maxW: textW, maxLines: 2, leading: 1.2 }).size);
      const size = Math.min(...sizes);
      const fits = p.items.map((it) => fit(k, it, font, { max: size, min: size, maxW: textW, maxLines: 2, leading: 1.2 }));
      const rowGap = 20 * k.s;
      const { each } = { each: Math.max(0.12, Math.min(0.3, (k.duration * 0.42) / p.items.length)) };
      const blocks: Block[] = [];
      const tb = titleBlock(k, p.title, x0, w);
      if (tb) blocks.push(tb);
      p.items.forEach((_, i) => {
        const f = fits[i]!;
        const h = Math.max(badge, f.height) + 2 * pad;
        blocks.push({
          h,
          gap: i === 0 ? (tb ? 44 * k.s : 0) : rowGap,
          make: (y) => {
            const at = 0.2 + i * each;
            const c = card(k, { x: x0, y, w, h }, { r: 30 * k.s, label: `el punto ${i + 1}` });
            const iconName = (p.icons[i] ?? null) as IconName | null;
            const bx = x0 + pad + badge / 2;
            const by = y + h / 2;
            const b = p.marker === "icon" && iconName ? iconTile(k, iconName, bx, by, badge, { variant: "accent" }) : numberBadge(k, String(i + 1), bx, by, badge);
            const t = textNode(k, f, x0 + pad + badge + gap, y + (h - f.height) / 2, textW, { color: col(k, "text"), on: cardGround(k), label: `el punto ${i + 1}` });
            return [slide(c, { at, dist: 60 * k.s, dir: "right" }), slide(t, { at: at + 0.04, dist: 60 * k.s, dir: "right" }), pop(b, { at: at + 0.12, from: 0.3, bounce: 0.45 })];
          },
        });
      });
      return stack(k, blocks);
    }),
});

// ─── Checklist ────────────────────────────────────────────────────────────

export const checklist = defineComponent({
  label: "Checklist",
  hint: "De 2 a 5 cosas que se tildan una por una (lo que tienes que hacer o ya hiciste).",
  props: z.object({ title: str(56).default(""), items: z.array(req(56)).min(2).max(5) }),
  example: { title: "Antes de publicar", items: ["Gancho en el primer segundo", "Subtítulos grandes", "Una sola idea", "Llamada a la acción"] },
  texts: (p) => [p.title, ...p.items],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const w = contentW(k);
      const x0 = cx(k) - w / 2;
      const box = 70 * k.s;
      const gap = 34 * k.s;
      const textW = w - box - gap;
      const font = body(k, 700, -0.012);
      const size = Math.min(...p.items.map((it) => fit(k, it, font, { max: 54 * k.s, min: 30 * k.s, maxW: textW, maxLines: 2, leading: 1.2 }).size));
      const fits = p.items.map((it) => fit(k, it, font, { max: size, min: size, maxW: textW, maxLines: 2, leading: 1.2 }));
      const rowPad = 26 * k.s;
      const blocks: Block[] = [];
      const tb = titleBlock(k, p.title, x0, w);
      if (tb) blocks.push(tb);
      const enter = 0.15;
      const checkStart = enter + p.items.length * 0.08 + 0.2;
      const each = Math.max(0.2, Math.min(0.42, (k.duration * 0.5) / p.items.length));
      p.items.forEach((_, i) => {
        const f = fits[i]!;
        const h = Math.max(box, f.height) + 2 * rowPad;
        blocks.push({
          h,
          gap: i === 0 && tb ? 30 * k.s : 0,
          make: (y) => {
            const appear = enter + i * 0.08;
            const checkAt = checkStart + i * each;
            const by = y + h / 2;
            const bx = x0 + box / 2;
            const out: Node[] = [];
            if (i < p.items.length - 1) out.push(draw(path(`M${x0} ${y + h}L${x0 + w} ${y + h}`, { stroke: { color: rgba(k.theme.text, k.theme.dark ? 0.12 : 0.14), width: Math.max(1, 1.5 * k.u) }, overlap: true }), { at: appear, dur: 0.6, ease: "easeOutExpo" }));
            const outline = rect({ x: x0, y: by - box / 2, w: box, h: box, r: box * 0.28, stroke: { color: rgba(k.theme.text, 0.28), width: Math.max(2, 3 * k.s) }, role: "decor" });
            const filled = rect({ x: x0, y: by - box / 2, w: box, h: box, r: box * 0.28, fill: { kind: "linear", x0, y0: by - box / 2, x1: x0 + box, y1: by + box / 2, stops: [[0, mix(k.theme.accent, "#ffffff", 0.15)], [1, k.theme.accent]] }, shadow: { color: rgba(k.theme.accent, 0.5), blur: 26 * k.u, y: 6 * k.u }, role: "decor", overlap: true });
            const tick = checkPath(k, bx, by, box * 0.95, { color: k.theme.accentText, width: box * 0.11 });
            const t = textNode(k, f, x0 + box + gap, y + (h - f.height) / 2, textW, { color: col(k, "text"), on: k.ground, label: `el punto ${i + 1}`, ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) });
            out.push(fadeUp(outline, { at: appear, dist: 20 * k.s }), pop(filled, { at: checkAt, from: 0.5, dur: 0.45, bounce: 0.4 }), draw(tick, { at: checkAt + 0.1, dur: 0.32, ease: "easeOutCubic" }), fadeUp(t, { at: appear + 0.05, dist: 20 * k.s }));
            // El texto se apaga un poco antes de tildarse y vuelve a su color al tildarse.
            t.tracks.opacity = [
              { t: appear + 0.05, v: 0 },
              { t: appear + 0.35, v: 0.55, ease: "easeOutCubic" },
              { t: checkAt + 0.05, v: 0.55 },
              { t: checkAt + 0.3, v: 1, ease: "easeOutCubic" },
            ];
            return out;
          },
        });
      });
      return stack(k, blocks);
    }),
});

// ─── Pasos ────────────────────────────────────────────────────────────────

export const steps = defineComponent({
  label: "Pasos",
  hint: "Un flujo de 2 a 4 pasos (A → B → C) con flechas que se dibujan; el último queda destacado.",
  props: z.object({ title: str(48).default(""), steps: z.array(req(30)).min(2).max(4), icons: z.array(iconNameSchema).max(4).default([]) }),
  example: { title: "El sistema", steps: ["Anuncio", "Conversación", "Llamada", "Cliente"], icons: ["megaphone", "message-circle", "phone", "handshake"] },
  texts: (p) => [p.title, ...p.steps],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const n = p.steps.length;
      const horizontal = !k.vertical;
      const x = cx(k);
      const pad = 36 * k.s;
      const conn = (horizontal ? 90 : 64) * k.s;
      const nodeW = horizontal ? (k.region.w - conn * (n - 1)) / n : Math.min(k.region.w, 760 * k.s);
      const hasIcons = p.icons.length > 0;
      const iconS = 96 * k.s;
      const font = display(k, 800, -0.02);
      const size = Math.min(...p.steps.map((s) => fit(k, s, font, { max: 62 * k.s, min: 30 * k.s, maxW: nodeW - 2 * pad - (horizontal || !hasIcons ? 0 : iconS + 26 * k.s), maxLines: 2, leading: 1.12 }).size));
      const innerW = nodeW - 2 * pad - (horizontal || !hasIcons ? 0 : iconS + 26 * k.s);
      const fits = p.steps.map((s) => fit(k, s, font, { max: size, min: size, maxW: innerW, maxLines: 2, leading: 1.12 }));
      const numSize = 27 * k.s;
      const textH = Math.max(...fits.map((f) => f.height));
      const nodeH = horizontal ? pad + (hasIcons ? iconS + 24 * k.s : 0) + numSize * 1.4 + 12 * k.s + textH + pad : Math.max(hasIcons ? iconS : 0, numSize * 1.4 + 10 * k.s + textH) + 2 * pad;
      const each = Math.max(0.28, Math.min(0.6, (k.duration * 0.5) / n));
      const blocks: Block[] = [];
      const tb = titleBlock(k, p.title, k.region.x, k.region.w, "center");
      if (tb) blocks.push(tb);
      blocks.push({
        h: horizontal ? nodeH : n * nodeH + (n - 1) * conn,
        gap: 46 * k.s,
        make: (y) => {
          const out: Node[] = [];
          for (let i = 0; i < n; i++) {
            const last = i === n - 1;
            const bx = horizontal ? k.region.x + i * (nodeW + conn) : x - nodeW / 2;
            const by = horizontal ? y : y + i * (nodeH + conn);
            const at = 0.15 + i * each;
            const variant = last ? "accent" : "surface";
            const ground = cardGround(k, variant);
            const ink = inkOn(k, ground);
            const c = card(k, { x: bx, y: by, w: nodeW, h: nodeH }, { variant, r: 30 * k.s, label: `el paso ${i + 1}` });
            const parts: Node[] = [];
            let tx = bx + pad;
            let ty = by + pad;
            if (hasIcons && p.icons[i]) {
              if (horizontal) {
                parts.push(iconTile(k, p.icons[i]!, bx + pad + iconS / 2, by + pad + iconS / 2, iconS, { variant: last ? "outline" : "soft", ...(last ? { ink } : {}) }));
                ty += iconS + 24 * k.s;
              } else {
                parts.push(iconTile(k, p.icons[i]!, bx + pad + iconS / 2, by + nodeH / 2, iconS, { variant: last ? "outline" : "soft", ...(last ? { ink } : {}) }));
                tx += iconS + 26 * k.s;
              }
            }
            if (!horizontal) ty = by + (nodeH - (numSize * 1.4 + 10 * k.s + fits[i]!.height)) / 2;
            const num = fit(k, `PASO ${i + 1}`, { family: k.families.body, weight: 700, tracking: 0.16 }, { max: numSize, min: numSize, maxW: innerW, maxLines: 1, balance: false, leading: 1.4 });
            parts.push(textNode(k, num, tx, ty, innerW, { color: last ? rgba(ink, 0.75) : col(k, "accent"), on: ground }));
            parts.push(textNode(k, fits[i]!, tx, ty + numSize * 1.4 + (horizontal ? 12 : 10) * k.s, innerW, { color: ink, on: ground, label: `el paso ${i + 1}` }));
            out.push(pop(c, { at, from: 0.88, dur: 0.6, bounce: 0.2 }));
            parts.forEach((pn, j) => out.push(fadeUp(pn, { at: at + 0.08 + j * 0.05, dist: 18 * k.s })));
            if (!last) {
              const g = 14 * k.s;
              const a = horizontal
                ? arrow(k, bx + nodeW + g, by + nodeH / 2, bx + nodeW + conn - g, by + nodeH / 2, { width: 6 * k.s })
                : arrow(k, x, by + nodeH + g, x, by + nodeH + conn - g, { width: 6 * k.s });
              out.push(draw(a, { at: at + each * 0.55, dur: each * 0.6, ease: "easeInOut" }));
            }
          }
          return out;
        },
      });
      return stack(k, blocks);
    }),
});

// ─── Línea de tiempo ──────────────────────────────────────────────────────

export const timeline = defineComponent({
  label: "Línea de tiempo",
  hint: "De 2 a 5 hitos que aparecen sobre una línea que se dibuja (mes 1, mes 3, hoy).",
  props: z.object({
    title: str(48).default(""),
    items: z.array(z.object({ label: req(22), caption: str(44).default("") })).min(2).max(5),
  }),
  example: { title: "Mi primer año", items: [{ label: "Mes 1", caption: "500 seguidores" }, { label: "Mes 4", caption: "Primer cliente" }, { label: "Mes 8", caption: "Equipo de 3" }, { label: "Hoy", caption: "Agenda llena" }] },
  texts: (p) => [p.title, ...p.items.flatMap((i) => [i.label, i.caption])],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const n = p.items.length;
      const horizontal = !k.vertical;
      const w = contentW(k);
      const x0 = cx(k) - w / 2;
      const dot = 30 * k.s;
      const lw = Math.max(3, 5 * k.s);
      const lblFont = display(k, 800, -0.02);
      const capFont = body(k, 600);
      const blocks: Block[] = [];
      const tb = titleBlock(k, p.title, horizontal ? k.region.x : x0, horizontal ? k.region.w : w, horizontal ? "center" : "left");
      if (tb) blocks.push(tb);
      const lineDur = Math.max(0.8, Math.min(1.8, k.duration * 0.5));
      const lineAt = 0.2;
      if (!horizontal) {
        const textX = x0 + dot + 44 * k.s;
        const textW = w - (textX - x0);
        const lbls = p.items.map((it) => fit(k, it.label, lblFont, { max: 56 * k.s, min: 32 * k.s, maxW: textW, maxLines: 1, leading: 1.1 }));
        const caps = p.items.map((it) => (it.caption ? fit(k, it.caption, capFont, { max: 40 * k.s, min: 26 * k.s, maxW: textW, maxLines: 2, leading: 1.22 }) : null));
        const rowH = Math.max(...p.items.map((_, i) => lbls[i]!.height + (caps[i] ? caps[i]!.height + 6 * k.s : 0)));
        const gapY = 46 * k.s;
        const total = n * rowH + (n - 1) * gapY;
        blocks.push({
          h: total,
          gap: 50 * k.s,
          make: (y) => {
            const out: Node[] = [];
            const lx = x0 + dot / 2;
            const yFirst = y + lbls[0]!.height / 2;
            const yLast = y + (n - 1) * (rowH + gapY) + lbls[n - 1]!.height / 2;
            out.push(fadeIn(path(`M${lx} ${yFirst}L${lx} ${yLast}`, { stroke: { color: rgba(k.theme.text, 0.14), width: lw, cap: "round" }, overlap: true }), { at: 0.05 }));
            const line = path(`M${lx} ${yFirst}L${lx} ${yLast}`, { stroke: { color: { kind: "linear", x0: 0, y0: yFirst, x1: 0, y1: yLast, stops: [[0, k.theme.accent2], [1, k.theme.accent]] }, width: lw, cap: "round" }, overlap: true });
            out.push(draw(line, { at: lineAt, dur: lineDur, ease: "easeInOut" }));
            p.items.forEach((it, i) => {
              const ry = y + i * (rowH + gapY);
              const cy = ry + lbls[i]!.height / 2;
              const reach = lineAt + lineDur * (n === 1 ? 0 : i / (n - 1)) * 0.92;
              out.push(...timelineDot(k, lx, cy, dot, i === n - 1, reach));
              out.push(fadeUp(textNode(k, lbls[i]!, textX, ry, textW, { color: i === n - 1 ? col(k, "accent") : col(k, "text"), on: k.ground, label: `el hito ${i + 1}`, ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: reach + 0.05, dist: 20 * k.s }));
              if (caps[i]) out.push(fadeUp(textNode(k, caps[i]!, textX, ry + lbls[i]!.height + 6 * k.s, textW, { color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: reach + 0.12, dist: 20 * k.s }));
            });
            return out;
          },
        });
      } else {
        const colW = k.region.w / n;
        const textW = colW - 24 * k.s;
        const lbls = p.items.map((it) => fit(k, it.label, lblFont, { max: 52 * k.s, min: 30 * k.s, maxW: textW, maxLines: 1, leading: 1.1 }));
        const caps = p.items.map((it) => (it.caption ? fit(k, it.caption, capFont, { max: 36 * k.s, min: 24 * k.s, maxW: textW, maxLines: 2, leading: 1.22 }) : null));
        const textH = Math.max(...p.items.map((_, i) => lbls[i]!.height + (caps[i] ? caps[i]!.height + 6 * k.s : 0)));
        blocks.push({
          h: dot + 36 * k.s + textH,
          gap: 50 * k.s,
          make: (y) => {
            const out: Node[] = [];
            const cy = y + dot / 2;
            const xs = p.items.map((_, i) => k.region.x + colW * (i + 0.5));
            out.push(fadeIn(path(`M${xs[0]} ${cy}L${xs[n - 1]} ${cy}`, { stroke: { color: rgba(k.theme.text, 0.14), width: lw, cap: "round" }, overlap: true }), { at: 0.05 }));
            out.push(draw(path(`M${xs[0]} ${cy}L${xs[n - 1]} ${cy}`, { stroke: { color: { kind: "linear", x0: xs[0]!, y0: 0, x1: xs[n - 1]!, y1: 0, stops: [[0, k.theme.accent2], [1, k.theme.accent]] }, width: lw, cap: "round" }, overlap: true }), { at: lineAt, dur: lineDur, ease: "easeInOut" }));
            p.items.forEach((_, i) => {
              const reach = lineAt + lineDur * (i / Math.max(1, n - 1)) * 0.92;
              out.push(...timelineDot(k, xs[i]!, cy, dot, i === n - 1, reach));
              const ty = y + dot + 36 * k.s;
              out.push(fadeUp(textNode(k, lbls[i]!, xs[i]! - textW / 2, ty, textW, { align: "center", color: i === n - 1 ? col(k, "accent") : col(k, "text"), on: k.ground, label: `el hito ${i + 1}` }), { at: reach + 0.05, dist: 18 * k.s }));
              if (caps[i]) out.push(fadeUp(textNode(k, caps[i]!, xs[i]! - textW / 2, ty + lbls[i]!.height + 6 * k.s, textW, { align: "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: reach + 0.12, dist: 18 * k.s }));
            });
            return out;
          },
        });
      }
      return stack(k, blocks);
    }),
});

/** Punto de un hito: anillo que aparece cuando la línea llega; el último, lleno y con un pulso. */
function timelineDot(k: Kit, x: number, y: number, d: number, last: boolean, at: number): Node[] {
  const out: Node[] = [];
  const ring = ellipse({ cx: x, cy: y, rx: d / 2, fill: last ? k.theme.accent : k.theme.bg, stroke: { color: k.theme.accent, width: Math.max(2, 4 * k.s) }, role: "decor", overlap: true, ...(last ? { shadow: { color: rgba(k.theme.accent, 0.6), blur: 24 * k.u } } : {}) });
  out.push(pop(ring, { at, from: 0.2, bounce: 0.5, dur: 0.5 }));
  if (last) {
    const halo = ellipse({ cx: x, cy: y, rx: d, stroke: { color: rgba(k.theme.accent, 0.5), width: Math.max(1, 2 * k.s) }, role: "decor", overlap: true });
    fadeIn(halo, { at: at + 0.2 });
    pulse(halo, { at: at + 0.2, period: 1.1, amount: 0.25, count: 3 });
    out.push(halo);
  }
  return out;
}

