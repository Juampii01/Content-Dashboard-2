/**
 * Componentes de texto: frase fuerte palabra por palabra (quote) y palabra clave con marcador (keyword).
 */
import { z } from "zod";
import { draw, fadeIn, fadeUp, pop, wipe, zoomIn } from "../animate";
import { body, brushUnderline, col, display, eyebrow, fit, rect, rgba, textNode, type Fit, type Kit } from "../kit";
import type { Node, TextNode } from "../nodes";
import { matchWords, placeLines, placeWords } from "../text";
import { cueAt, cued, cx, defineComponent, fitToRegion, req, stack, str, textShadow, type Block } from "./shared";

/** Una palabra suelta como nodo de texto (para animar palabra por palabra). */
function wordNode(f: Fit, text: string, x: number, baseline: number, w: number, top: number, color: string, on: string, k: Kit): TextNode {
  const sh = textShadow(k);
  return {
    kind: "text",
    lines: [{ text, x, baseline, w }],
    font: f.font,
    size: f.size,
    tracking: f.tracking,
    color,
    lineHeight: f.lineHeight,
    tracks: {},
    box: { x, y: top, w, h: f.lineHeight },
    role: "text",
    on,
    label: "la frase",
    ...(sh ? { shadow: sh } : {}),
  };
}

/** Marcador detrás de un tramo de palabras y el mismo texto encima con el color del acento (se barren juntos). */
function markerRun(k: Kit, f: Fit, run: { x0: number; x1: number; baseline: number; text: string }, at: number): Node[] {
  const padX = f.size * 0.14;
  const h = f.size * 1.02;
  const top = run.baseline - f.size * 0.35 - h / 2;
  const box = { x: run.x0 - padX, y: top, w: run.x1 - run.x0 + 2 * padX, h };
  const bg = rect({ ...box, r: f.size * 0.14, fill: { kind: "linear", x0: box.x, y0: 0, x1: box.x + box.w, y1: 0, stops: [[0, k.theme.accent], [1, k.theme.accent]] }, role: "decor", overlap: true });
  const txt = wordNode(f, run.text, run.x0, run.baseline, run.x1 - run.x0, top, k.theme.accentText, k.theme.accent, k);
  txt.overlap = true;
  delete txt.shadow;
  return [wipe(bg, { at, dur: 0.45 }), wipe(txt, { at, dur: 0.45 })].map((n) => {
    n.box = box;
    return n;
  });
}

export const quote = defineComponent({
  label: "Frase fuerte",
  hint: "Tu frase en grande, palabra por palabra, con una parte resaltada con marcador.",
  props: z.object({ text: req(120), highlight: str(48).default(""), author: str(40).default("") }),
  example: { text: "El problema no es el anuncio, es lo que pasa después del clic", highlight: "después del clic", author: "" },
  texts: (p) => [p.text, p.highlight, p.author],
  /** Palabra por palabra: cada una aparece cuando se dice. */
  cueTexts: (p) => p.text.split(/\s+/).filter(Boolean),
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const x0 = k.region.x;
      const w = k.region.w;
      const font = display(k, 800, -0.025);
      const f = fit(k, p.text, font, { max: (k.vertical ? 104 : 92) * k.s, min: 46 * k.s, maxW: w, maxLines: 5, leading: 1.13 });
      const qm = 190 * k.s;
      const author = p.author ? fit(k, `— ${p.author}`, body(k, 600), { max: 36 * k.s, min: 26 * k.s, maxW: w, maxLines: 1 }) : null;
      const blocks: Block[] = [
        {
          h: qm * 0.5,
          make: (y) => {
            const qf = fit(k, "“", display(k, 900, 0), { max: qm, min: qm, maxW: qm * 2, maxLines: 1, balance: false, leading: 1 });
            const t = textNode(k, qf, cx(k) - qf.widths[0]! / 2, y - qm * 0.06, qf.widths[0]!, { color: col(k, "accent"), role: "decor", overlap: true });
            t.role = "decor";
            return [pop(t, { at: 0, from: 0.4, bounce: 0.4 })];
          },
        },
        {
          h: f.height,
          gap: 20 * k.s,
          make: (y) => {
            const lines = placeLines(f, x0, y, w, "center");
            const words = placeWords(k.measure, f, lines);
            const marked = matchWords(
              words.map((x) => x.text),
              p.highlight,
            );
            const step = Math.max(0.045, Math.min(0.13, (k.duration * 0.38) / Math.max(1, words.length)));
            const wordAt = (i: number) => cueAt(k, i, 0.15 + i * step, 0.08);
            const out: Node[] = words.map((wd, i) => fadeUp(wordNode(f, wd.text, wd.x, wd.baseline, wd.w, wd.top, col(k, "text"), k.ground, k), { at: wordAt(i), dur: cued(k) ? 0.35 : 0.5, dist: 26 * k.s }));
            // Tramos resaltados: el marcador barre cuando terminó de entrar su última palabra.
            const runs: { x0: number; x1: number; baseline: number; text: string; last: number }[] = [];
            for (const wd of words) {
              if (!marked.has(wd.index)) continue;
              const prev = runs[runs.length - 1];
              if (prev && prev.last === wd.index - 1 && prev.baseline === wd.baseline) {
                prev.x1 = wd.x + wd.w;
                prev.text += ` ${wd.text}`;
                prev.last = wd.index;
              } else runs.push({ x0: wd.x, x1: wd.x + wd.w, baseline: wd.baseline, text: wd.text, last: wd.index });
            }
            // Con la voz, cada tramo resaltado se marca cuando se dice su última palabra.
            const markAt = 0.15 + (words.length - 1) * step + 0.3;
            runs.forEach((r, i) => out.push(...markerRun(k, f, r, cued(k) ? wordAt(r.last) + 0.2 : markAt + i * 0.22)));
            return out;
          },
        },
      ];
      if (author) blocks.push({ h: author.height, gap: 40 * k.s, make: (y) => [fadeUp(textNode(k, author, x0, y, w, { align: "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: 0.6, dist: 20 * k.s })] });
      return stack(k, blocks);
    }),
});

export const keyword = defineComponent({
  label: "Palabra clave",
  hint: "Una idea en grande (1 a 3 palabras), con marcador o subrayado de pincel.",
  props: z.object({ text: req(28), label: str(48).default(""), emphasis: z.enum(["marker", "underline"]).default("marker") }),
  example: { text: "Seguimiento", label: "La clave", emphasis: "marker" },
  texts: (p) => [p.text, p.label],
  cueTexts: (p) => [p.text],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const font = display(k, 900, -0.035);
      const f = fit(k, p.text, font, { max: (k.vertical ? 230 : 210) * k.s, min: 80 * k.s, maxW: k.region.w * 0.88, maxLines: 2, leading: 1.08 });
      const blocks: Block[] = [];
      const x = cx(k);
      if (p.label) {
        const e = eyebrow(k, p.label, x, 0, { align: "center" });
        blocks.push({ h: e.h, make: (y) => eyebrow(k, p.label, x, y, { align: "center" }).nodes.map((n) => fadeUp(n, { at: 0, dist: 18 * k.s })) });
      }
      blocks.push({
        h: f.height + (p.emphasis === "underline" ? f.size * 0.2 : 0),
        gap: 46 * k.s,
        make: (y) => {
          const lines = placeLines(f, k.region.x, y, k.region.w, "center");
          const out: Node[] = [];
          const main = textNode(k, f, k.region.x, y, k.region.w, { align: "center", color: col(k, "text"), on: k.ground, label: "la palabra clave", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) });
          // Con la voz: la palabra entra un poco antes de decirla y el marcador la barre cuando suena.
          out.push(zoomIn(main, { at: cued(k) ? cueAt(k, 0, 0.05, 0.4) : 0.05, dur: 0.75, from: 1.16 }));
          lines.forEach((l, i) => {
            const at = cued(k) ? cueAt(k, 0, 0, 0) + i * 0.16 : 0.5 + i * 0.16;
            if (p.emphasis === "underline") {
              out.push(draw(brushUnderline(k, l.x - f.size * 0.04, l.x + l.w + f.size * 0.04, l.baseline + f.size * 0.17, { width: Math.max(6, f.size * 0.085) }), { at, dur: 0.55 }));
            } else out.push(...markerRun(k, f, { x0: l.x, x1: l.x + l.w, baseline: l.baseline, text: l.text }, at));
          });
          if (k.mode === "full")
            out.unshift(fadeIn(rect({ x: k.region.x, y: y - f.size * 0.4, w: k.region.w, h: f.height + f.size * 0.8, r: 0, fill: { kind: "radial", cx: x, cy: y + f.height / 2, r: k.region.w * 0.6, stops: [[0, rgba(k.theme.accent, 0.18)], [1, rgba(k.theme.accent, 0)]] }, role: "decor", overlap: true }), { at: 0, dur: 0.8 }));
          return out;
        },
      });
      return stack(k, blocks);
    }),
});
