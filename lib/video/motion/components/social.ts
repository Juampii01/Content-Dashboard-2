/**
 * Componentes de "momento": notificación de mensaje (app de chat genérica, sin logos de terceros) e ícono
 * protagonista con un estallido.
 */
import { z } from "zod";
import { draw, fadeIn, fadeUp, pop, typewriter } from "../animate";
import { iconNameSchema } from "../icons";
import { body, cardShadow, col, display, ellipse, fit, icon, iconTile, mix, path, rect, rgba, textNode } from "../kit";
import type { Node } from "../nodes";
import { cx, defineComponent, fitToRegion, req, stack, str, textShadow, type Block } from "./shared";

// ─── Notificación de mensaje ──────────────────────────────────────────────

export const dmNotification = defineComponent({
  label: "Notificación de mensaje",
  hint: "Una notificación de mensaje directo que cae con rebote, muestra \"escribiendo…\" y después el mensaje.",
  props: z.object({
    name: req(28),
    message: req(90),
    app: str(18).default("Mensajes"),
    time: str(12).default("ahora"),
    typing: z.boolean().default(true),
    /** Notificaciones apiladas detrás (0 a 2): da sensación de "llegan muchos". */
    stack: z.number().int().min(0).max(2).default(1),
  }),
  example: { name: "Laura Gómez", message: "¡Hola! Quiero info del programa", app: "Mensajes", time: "ahora", typing: true, stack: 1 },
  texts: (p) => [p.name, p.message, p.app, p.time],
  cueTexts: (p) => [p.message],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const th = k.theme;
      const w = Math.min(k.region.w, (k.vertical ? 920 : 1000) * k.s);
      const x0 = cx(k) - w / 2;
      const pad = 34 * k.s;
      const appIcon = 54 * k.s;
      const avatar = 104 * k.s;
      const gapX = 28 * k.s;
      const textW = w - 2 * pad - avatar - gapX;
      const nameF = fit(k, p.name, display(k, 700, -0.015), { max: 42 * k.s, min: 30 * k.s, maxW: textW, maxLines: 1, leading: 1.2 });
      const msgF = fit(k, p.message, body(k, 500, -0.005), { max: 40 * k.s, min: 28 * k.s, maxW: textW, maxLines: 3, leading: 1.28 });
      const headH = appIcon;
      const bodyH = Math.max(avatar, nameF.height + 6 * k.s + Math.max(msgF.height, 56 * k.s));
      const h = pad + headH + 26 * k.s + bodyH + pad;
      const surface = th.dark ? mix(th.surface, th.text, 0.06) : "#ffffff";
      const ink = th.dark ? th.text : "#111111";
      const sub = th.dark ? th.muted : "#6b6b6b";
      const land = 0.12;
      const typeEnd = p.typing ? land + 1.05 : land + 0.35;
      const blocks: Block[] = [
        {
          h: h + p.stack * 22 * k.s,
          make: (y) => {
            const out: Node[] = [];
            // Tarjetas apiladas detrás (más chicas y apagadas).
            for (let j = p.stack; j >= 1; j--) {
              const sw = w * (1 - j * 0.05);
              const b = rect({ x: cx(k) - sw / 2, y: y + j * 22 * k.s, w: sw, h, r: 44 * k.s, fill: mix(surface, th.bg, 0.25 + j * 0.2), role: "card", overlap: true, shadow: cardShadow(k, 0.7) });
              out.push(fadeUp(b, { at: 0, dist: -120 * k.s, dur: 0.55 }));
            }
            const card = rect({ x: x0, y, w, h, r: 44 * k.s, fill: { kind: "linear", x0: 0, y0: y, x1: 0, y1: y + h, stops: [[0, rgba(surface, 0.98)], [1, rgba(mix(surface, th.bg, 0.06), 0.98)]] }, stroke: { color: rgba(th.dark ? "#ffffff" : "#000000", th.dark ? 0.12 : 0.06), width: Math.max(1, 1.5 * k.u) }, shadow: cardShadow(k, 1.2), role: "card", label: "la notificación" });
            const parts: Node[] = [];
            // Encabezado: ícono de la app (genérico), nombre de la app y hora.
            const ai = iconTile(k, "message-circle", x0 + pad + appIcon / 2, y + pad + appIcon / 2, appIcon, { variant: "accent", r: appIcon * 0.26 });
            const appF = fit(k, p.app.toLocaleUpperCase("es"), { family: k.families.body, weight: 700, tracking: 0.08 }, { max: 26 * k.s, min: 20 * k.s, maxW: w * 0.5, maxLines: 1, leading: 1.2 });
            const timeF = fit(k, p.time, body(k, 500), { max: 26 * k.s, min: 20 * k.s, maxW: w * 0.3, maxLines: 1, leading: 1.2 });
            parts.push(ai, textNode(k, appF, x0 + pad + appIcon + 18 * k.s, y + pad + (appIcon - appF.height) / 2, appF.widths[0]!, { color: sub, on: surface }));
            parts.push(textNode(k, timeF, x0 + w - pad - timeF.widths[0]!, y + pad + (appIcon - timeF.height) / 2, timeF.widths[0]!, { color: sub, on: surface }));
            // Cuerpo: avatar con iniciales, nombre y mensaje.
            const by = y + pad + headH + 26 * k.s;
            const acx = x0 + pad + avatar / 2;
            const acy = by + avatar / 2;
            const av = ellipse({ cx: acx, cy: acy, rx: avatar / 2, fill: { kind: "linear", x0: acx - avatar / 2, y0: acy - avatar / 2, x1: acx + avatar / 2, y1: acy + avatar / 2, stops: [[0, th.accent2], [1, th.accent]] }, role: "decor" });
            const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toLocaleUpperCase("es")).join("");
            const iniF = fit(k, initials || "?", display(k, 800, 0), { max: avatar * 0.38, min: 16 * k.s, maxW: avatar * 0.8, maxLines: 1, leading: 1 });
            const ini = textNode(k, iniF, acx - iniF.widths[0]! / 2, acy - iniF.height / 2, iniF.widths[0]!, { color: th.accentText, on: th.accent, overlap: true });
            const tx = x0 + pad + avatar + gapX;
            const nameN = textNode(k, nameF, tx, by, textW, { color: ink, on: surface, label: "el nombre" });
            const msgY = by + nameF.height + 6 * k.s;
            const msgN = textNode(k, msgF, tx, msgY, textW, { color: rgba(ink, 0.86), on: surface, label: "el mensaje" });
            // Punto de "no leído" sobre el avatar.
            const dot = ellipse({ cx: acx + avatar * 0.36, cy: acy - avatar * 0.36, rx: 13 * k.s, fill: th.negative, stroke: { color: surface, width: 5 * k.s }, role: "decor", overlap: true });
            parts.push(av, ini, nameN);
            out.push(card);
            // Entrada: cae desde arriba con rebote; el contenido llega un instante después.
            fadeUp(card, { at: 0, dist: -170 * k.s, dur: 0.75, ease: { type: "spring", bounce: 0.38 } });
            parts.forEach((n, i) => out.push(fadeUp(n, { at: land + 0.04 * i, dist: -150 * k.s, dur: 0.75, ease: { type: "spring", bounce: 0.38 } })));
            out.push(pop(dot, { at: land + 0.5, from: 0, bounce: 0.6 }));
            if (p.typing) {
              // "Escribiendo…": tres puntos que saltan en una burbuja.
              const bw = 120 * k.s;
              const bh = 56 * k.s;
              const bub = rect({ x: tx, y: msgY, w: bw, h: bh, r: bh / 2, fill: rgba(ink, th.dark ? 0.1 : 0.07), role: "decor", overlap: true });
              bub.tracks.opacity = [{ t: land + 0.2, v: 0 }, { t: land + 0.35, v: 1 }, { t: typeEnd - 0.1, v: 1 }, { t: typeEnd, v: 0 }];
              out.push(bub);
              for (let i = 0; i < 3; i++) {
                const d = ellipse({ cx: tx + bw * (0.3 + i * 0.2), cy: msgY + bh / 2, rx: 7 * k.s, fill: rgba(ink, 0.55), role: "decor", overlap: true });
                d.tracks.opacity = bub.tracks.opacity;
                const keys = [{ t: land + 0.2, v: 0 }];
                for (let c = 0; c < 3; c++) {
                  const t0 = land + 0.3 + c * 0.3 + i * 0.09;
                  keys.push({ t: t0, v: 0 }, { t: t0 + 0.12, v: -10 * k.s }, { t: t0 + 0.26, v: 0 });
                }
                d.tracks.y = keys.map((kk) => ({ ...kk, ease: "easeInOutSine" as const }));
                out.push(d);
              }
            }
            out.push(typewriter(msgN, { at: typeEnd, chars: p.message.length, dur: Math.max(0.35, Math.min(1.1, p.message.length / 45)) }));
            return out;
          },
        },
      ];
      return stack(k, blocks);
    }),
});

// ─── Ícono protagonista ───────────────────────────────────────────────────

export const iconBurst = defineComponent({
  label: "Ícono con estallido",
  hint: "Un ícono grande que se dibuja con un estallido de anillos, y un título corto debajo.",
  props: z.object({ icon: iconNameSchema, title: req(40), caption: str(70).default("") }),
  example: { icon: "rocket", title: "Lanza en 7 días", caption: "Sin esperar a tenerlo perfecto" },
  texts: (p) => [p.title, p.caption],
  cueTexts: (p) => [p.title],
  build: (p, k0) =>
    fitToRegion(k0, (k) => {
      const x = cx(k);
      const d = (k.vertical ? 300 : 260) * k.s;
      const titleF = fit(k, p.title, display(k, 800, -0.025), { max: 92 * k.s, min: 44 * k.s, maxW: k.region.w, maxLines: 2, leading: 1.08 });
      const capF = p.caption ? fit(k, p.caption, body(k, 600), { max: 46 * k.s, min: 28 * k.s, maxW: Math.min(k.region.w, 820 * k.s), maxLines: 2, leading: 1.22 }) : null;
      const blocks: Block[] = [
        {
          h: d,
          make: (y) => {
            const cy = y + d / 2;
            const out: Node[] = [];
            const th = k.theme;
            // Anillos que se expanden y se apagan.
            for (let i = 0; i < 3; i++) {
              const ring = ellipse({ cx: x, cy, rx: d / 2, stroke: { color: rgba(th.accent, 0.6), width: Math.max(1.5, 3 * k.s) }, role: "decor", overlap: true });
              const at = 0.3 + i * 0.16;
              ring.tracks.scale = [{ t: at, v: 1 }, { t: at + 1.1, v: 1.9 + i * 0.25, ease: "easeOutCubic" }];
              ring.tracks.opacity = [{ t: at, v: 0 }, { t: at + 0.05, v: 0.9 - i * 0.2 }, { t: at + 1.1, v: 0, ease: "easeOutCubic" }];
              out.push(ring);
            }
            // Chispas que salen disparadas.
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2 + 0.3;
              const r1 = d * 0.62;
              const r2 = d * (0.8 + (i % 3) * 0.08);
              const sp = path(`M${x + Math.cos(a) * r1} ${cy + Math.sin(a) * r1}L${x + Math.cos(a) * r2} ${cy + Math.sin(a) * r2}`, { stroke: { color: i % 2 ? th.accent2 : th.accent, width: Math.max(2, 5 * k.s), cap: "round" }, overlap: true });
              const at = 0.32 + (i % 3) * 0.03;
              draw(sp, { at, dur: 0.35, ease: "easeOutCubic" });
              sp.tracks.opacity = [{ t: at, v: 0 }, { t: at + 0.05, v: 1 }, { t: at + 0.45, v: 1 }, { t: at + 0.8, v: 0, ease: "easeInCubic" }];
              const dx = Math.cos(a) * d * 0.12;
              const dy = Math.sin(a) * d * 0.12;
              sp.tracks.x = [{ t: at, v: 0 }, { t: at + 0.8, v: dx, ease: "easeOutCubic" }];
              sp.tracks.y = [{ t: at, v: 0 }, { t: at + 0.8, v: dy, ease: "easeOutCubic" }];
              out.push(sp);
            }
            const glow = ellipse({ cx: x, cy, rx: d * 1.05, fill: { kind: "radial", cx: x, cy, r: d * 1.05, stops: [[0, rgba(th.accent, 0.4)], [1, rgba(th.accent, 0)]] }, role: "decor", overlap: true });
            out.push(fadeIn(glow, { at: 0.1, dur: 0.8 }));
            const disc = ellipse({ cx: x, cy, rx: d / 2, fill: { kind: "linear", x0: x - d / 2, y0: cy - d / 2, x1: x + d / 2, y1: cy + d / 2, stops: [[0, mix(th.accent, "#ffffff", 0.2)], [1, th.accent]] }, stroke: { color: rgba("#ffffff", 0.25), width: Math.max(1, 2 * k.u) }, shadow: { color: rgba(th.accent, 0.55), blur: 60 * k.u, y: 14 * k.u }, role: "decor" });
            out.push(pop(disc, { at: 0.05, from: 0.3, bounce: 0.45, dur: 0.7 }));
            out.push(draw(icon(k, p.icon, x, cy, d * 0.5, { color: th.accentText, weight: 1.8, overlap: true }), { at: 0.35, dur: 0.75 }));
            return out;
          },
        },
        { h: titleF.height, gap: d * 0.42, make: (y) => [fadeUp(textNode(k, titleF, k.region.x, y, k.region.w, { align: "center", color: col(k, "text"), on: k.ground, label: "el título", ...(textShadow(k) ? { shadow: textShadow(k)! } : {}) }), { at: 0.45, dist: 30 * k.s })] },
      ];
      if (capF) blocks.push({ h: capF.height, gap: 22 * k.s, make: (y) => [fadeUp(textNode(k, capF, k.region.x, y, k.region.w, { align: "center", color: col(k, k.mode === "overlay" ? "text" : "muted"), on: k.ground }), { at: 0.6, dist: 24 * k.s })] });
      return stack(k, blocks);
    }),
});
