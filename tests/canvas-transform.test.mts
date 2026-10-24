/**
 * Lienzo de la revisión: transformación y animación de entrada/salida de gráficos, efectos y subtítulos. Forma y
 * limpieza, cálculos compartidos, y los motores (skia-canvas, como en el worker) dibujando con y sin lugar. Además
 * revisa que el fixture del worker (worker/tests/fixtures/canvas-place.json) esté al día, así la vista previa y el
 * render no se separan. Sin base ni red.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { brollEditSchema, brollRenderEdit, graphicAlpha, isDefaultEdit, resolveEdit } from "../lib/video/broll-edit";
import { captionLook, captionTracks } from "../lib/video/caption-styles";
import { captionAnchor, cleanCaptionPlacement, placeCaptionBlocks } from "../lib/video/canvas/captions";
import { ANIM_KINDS, animFades, animState, cleanAnim, cleanPlace, cleanTransform, DEFAULT_ANIM, rampAlpha, snapBox, transformedBox, type Anim } from "../lib/video/canvas/transform";
import { FX_MOVABLE, type FxKind } from "../lib/video/fx/catalog";
import { compileFx } from "../lib/video/fx/compile";
import { demoSpec } from "../lib/video/fx/demo";
import { FxRenderer } from "../lib/video/fx/engine";
import { clampFx, fxItemSchema } from "../lib/video/fx/schema";
import { graphicWithPlace } from "../lib/video/motion-graphics";
import { compileScene, measureWith, placedContentBox, renderFrame, toMotionScene, type MotionCanvas } from "../lib/video/motion";
import { canvasDump } from "../lib/video/canvas/dump";
import type { CaptionBlock } from "../lib/video/types";

const THEME = { bg: "#030A22", surface: "#07163F", text: "#DCE7F7", muted: "#A7B9D4", accent: "#0070F8", accentText: "#FFFFFF" };
const V1 = { v: 1, template: "number", value: "3x", label: "más ventas", mode: "overlay", position: "top", theme: THEME, font: "montserrat" } as const;
const BRAND = { accent: "#0070F8", bg: "#030A22", surface: "#07163F", text: "#DCE7F7", muted: "#A7B9D4", accentText: "#FFFFFF", font: "montserrat" as const };

describe("forma y limpieza", () => {
  test("sin cambios no se guarda nada (los planes de antes quedan iguales)", () => {
    assert.equal(cleanTransform({ x: 0, y: 0, scale: 1 }), undefined);
    assert.equal(cleanTransform(null), undefined);
    assert.equal(cleanAnim(DEFAULT_ANIM), undefined);
    assert.equal(cleanAnim({}), undefined);
    assert.equal(cleanPlace({ transform: { x: 0, y: 0, scale: 1 }, anim: DEFAULT_ANIM }), undefined);
    // Un b-roll sin los campos nuevos sigue siendo la edición de siempre.
    assert.ok(isDefaultEdit(resolveEdit({})));
    assert.ok(isDefaultEdit(resolveEdit(undefined)));
  });

  test("límites: corrimiento ±50 %, tamaño 0,4–2,5, rotación ±45° y solo donde aplica", () => {
    assert.deepEqual(cleanTransform({ x: 3, y: -2, scale: 9, rotation: 200 }), { x: 0.5, y: -0.5, scale: 2.5, rotation: 45 });
    assert.deepEqual(cleanTransform({ x: 0.1, y: 0, scale: 0.1 }), { x: 0.1, y: 0, scale: 0.4 });
    assert.deepEqual(cleanTransform({ x: 0.1, y: 0, scale: 1, rotation: 10 }, { rotation: false }), { x: 0.1, y: 0, scale: 1 });
    assert.equal(cleanTransform({ x: "a", y: Number.NaN, scale: 1 }), undefined);
    assert.ok(!brollEditSchema.safeParse({ transform: { x: 2 } }).success);
    assert.ok(!brollEditSchema.safeParse({ anim: { in: "girar" } }).success);
    assert.deepEqual(brollEditSchema.parse({ anim: { in: "pop" } }).anim, { in: "pop", out: "aparecer", inDur: 0.2, outDur: 0.2 });
  });

  test("efectos: solo los movibles guardan lugar; clampFx lo limpia", () => {
    const base = { id: "e1", from_word: 0, to_word: 3 };
    const moved = clampFx(fxItemSchema.parse({ ...base, kind: "checklist", items: ["a", "b"], text: "x", transform: { x: 0.1, y: 0.2, scale: 1.2, rotation: 5 }, anim: { in: "pop", out: "ninguna", inDur: 0.3, outDur: 0.2 } }));
    assert.deepEqual(moved.transform, { x: 0.1, y: 0.2, scale: 1.2, rotation: 5 });
    assert.equal(moved.anim?.in, "pop");
    const chart = clampFx(fxItemSchema.parse({ ...base, kind: "chart_grow", transform: { x: 0.1, y: 0, scale: 1, rotation: 5 } }));
    assert.deepEqual(chart.transform, { x: 0.1, y: 0, scale: 1 }, "el gráfico de la semana no gira");
    const fixed = clampFx(fxItemSchema.parse({ ...base, kind: "vertigo", transform: { x: 0.1, y: 0, scale: 1 } }));
    assert.equal(fixed.transform, undefined, "un efecto de cámara no se mueve");
    // Los cuatro de firma y las tarjetas, textos y llamadas de atención de la biblioteca ampliada.
    for (const k of ["chart_grow", "checklist", "cover_story", "iphone", "lower_third", "quote_card", "arrow_draw", "typewriter"]) assert.ok(k in FX_MOVABLE, k);
    for (const k of ["vignette", "shake", "phone_frame", "text_behind", "zoom_cut", "digital_zoom"]) assert.ok(!(k in FX_MOVABLE), k);
  });

  test("subtítulos: global y por línea, sin rotación, ids válidos", () => {
    const p = cleanCaptionPlacement({ transform: { x: 0, y: -0.2, scale: 1.3, rotation: 9 }, lines: { "4": { x: 0, y: 0.1, scale: 1 }, "999": { x: 0, y: 0.1, scale: 1 }, "7": { x: 0, y: 0, scale: 1 }, abc: { x: 0, y: 0.1, scale: 1 } } }, 20);
    assert.deepEqual(p.transform, { x: 0, y: -0.2, scale: 1.3 });
    // La línea 7 "como siempre" se guarda igual: con un global, así no se mueve con los demás.
    assert.deepEqual(p.lines, { "4": { x: 0, y: 0.1, scale: 1 }, "7": { x: 0, y: 0, scale: 1 } });
    assert.deepEqual(cleanCaptionPlacement({ lines: { "7": { x: 0, y: 0, scale: 1 } } }, 20), {});
  });
});

describe("cálculos compartidos", () => {
  const dur = 3;
  test("cada animación: arranca donde dice y termina asentada", () => {
    const at = (kind: Anim["in"], t: number) => animState({ in: kind, out: kind, inDur: 0.4, outDur: 0.4 }, t, dur);
    for (const k of ANIM_KINDS) assert.deepEqual(at(k, 1.5), { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 }, `${k} en el medio`);
    assert.equal(at("aparecer", 0).alpha, 0);
    assert.equal(at("aparecer", 0.2).alpha, 0.5);
    assert.ok(at("deslizar_arriba", 0.05).dy > 0.03, "entra desde abajo");
    assert.ok(at("deslizar_arriba", dur - 0.05).dy < -0.03, "sale hacia arriba");
    assert.ok(at("deslizar_lado", 0.05).dx < -0.04, "entra desde la izquierda");
    assert.ok(at("deslizar_lado", dur - 0.05).dx > 0.04, "sale hacia la derecha");
    assert.ok(at("pop", 0.02).scale < 0.7 && at("pop", 0.25).scale > 1, "crece y se pasa un poco");
    assert.equal(at("escribir", 0.2).reveal, 0.5);
    assert.equal(at("escribir", 0.2).alpha, 1, "escribir no se funde");
    assert.deepEqual(at("ninguna", 0), { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 });
  });

  test("en un tramo corto, la entrada y la salida no se pisan", () => {
    const f = animFades({ in: "aparecer", out: "aparecer", inDur: 2, outDur: 2 }, 1);
    assert.equal(f.fadeIn, 0.45);
    assert.ok(f.fadeIn + f.fadeOut <= 1);
  });

  test("la opacidad del gráfico en la vista previa es la rampa que va al worker", () => {
    const anim: Anim = { in: "deslizar_arriba", out: "pop", inDur: 0.5, outDur: 0.4 };
    const edit = resolveEdit({ anim });
    const r = brollRenderEdit({ edit, format: "9:16", duration: dur, clipWidth: 0, clipHeight: 0, accent: "#0070F8", ground: "#030A22", graphic: { mode: "overlay" } });
    assert.equal(r.fadeIn, 0.3);
    assert.equal(r.fadeOut, 0.16);
    for (let t = 0; t <= dur; t += 0.05) assert.equal(graphicAlpha(edit, t, dur), rampAlpha(r.fadeIn!, r.fadeOut!, t, dur));
    // Sin animación propia, el fundido de siempre (sin campos nuevos para el worker).
    const old = brollRenderEdit({ edit: resolveEdit({}), format: "9:16", duration: dur, clipWidth: 0, clipHeight: 0, accent: "#0070F8", ground: "#030A22", graphic: { mode: "overlay" } });
    assert.equal(old.fade, 0.2);
    assert.equal("fadeIn" in old, false);
  });

  test("caja transformada e imán de guías", () => {
    const b = transformedBox({ x: 100, y: 200, w: 400, h: 100 }, { x: 0.1, y: -0.05, scale: 1.5, rotation: 10 }, 1080, 1920);
    assert.deepEqual(b, { cx: 300 + 108, cy: 250 - 96, w: 600, h: 150, rotation: 10 });
    const s = snapBox({ cx: 0.505, cy: 0.3, w: 0.4, h: 0.1 }, "9:16");
    assert.ok(Math.abs(s.dx + 0.005) < 1e-9 && s.guides.some((g) => g.axis === "x" && g.kind === "center"));
    const edge = snapBox({ cx: 0.27, cy: 0.5, w: 0.4, h: 0.1 }, "9:16");
    assert.ok(Math.abs(0.27 + edge.dx - 0.2 - 0.065) < 1e-9, "el borde izquierdo se imanta al margen seguro");
    assert.deepEqual(snapBox({ cx: 0.3, cy: 0.3, w: 0.1, h: 0.1 }, "9:16").guides, []);
  });

  test("subtítulos: el bloque lleva su lugar (línea antes que global) y el anclaje lo aplica", () => {
    const words = [0, 1, 2, 3, 4, 5].map((id) => ({ id, text: `p${id}`, start: id * 0.4, end: id * 0.4 + 0.3, emphasis: false, stop: false }));
    const blocks: CaptionBlock[] = [{ start: 0, end: 1.1, words: words.slice(0, 3) }, { start: 1.2, end: 2.3, words: words.slice(3) }];
    const placed = placeCaptionBlocks(blocks, { transform: { x: 0, y: -0.2, scale: 1.2 }, lines: { "3": { x: 0.1, y: 0, scale: 1 } } });
    assert.deepEqual(placed[0]!.place, { x: 0, y: -0.2, scale: 1.2 });
    assert.deepEqual(placed[1]!.place, { x: 0.1, y: 0, scale: 1 });
    assert.equal(placeCaptionBlocks(blocks, {}), blocks);
    const look = captionLook("hormozi", { format: "9:16", accent: "#0070F8" });
    const laid = captionTracks(look, placed[0]!, "9:16", "#0070F8");
    assert.deepEqual(laid.place, placed[0]!.place, "las pistas que van al worker llevan el lugar");
    const a = captionAnchor(look, laid.place, 1080, 1920);
    const b = captionAnchor(look, null, 1080, 1920);
    assert.ok(Math.abs(a.cy - (b.cy - 0.2 * 1920)) < 1e-9);
    assert.ok(Math.abs(a.em - b.em * 1.2) < 1e-9);
    assert.equal(captionAnchor(look, { x: 0, y: 0, scale: 2.5 }, 1080, 1920).maxW, 1080 * 0.96);
  });

  test("el fixture del worker está al día (node --import tsx scripts/canvas-dump.mts)", () => {
    const current = JSON.parse(readFileSync(new URL("../worker/tests/fixtures/canvas-place.json", import.meta.url), "utf8"));
    assert.deepEqual(current, JSON.parse(JSON.stringify(canvasDump())));
  });
});

// ─── Motores dibujando (skia-canvas, como en el worker) ─────────────────────

const require = createRequire(new URL("../worker/motion/package.json", import.meta.url));
type SkiaCanvas = { width: number; height: number; getContext(t: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } & Record<string, unknown> };
let skia: { Canvas: new (w: number, h: number) => SkiaCanvas; Image: new () => { src: unknown } } | null = null;
try {
  skia = require("skia-canvas");
} catch {
  skia = null;
}
const skip = skia ? false : "sin skia-canvas (cd worker/motion && npm ci)";

/** Caja de lo dibujado (alfa > 40) y su centro de masa, en píxeles del lienzo. */
function inked(data: Uint8ClampedArray, w: number, h: number, alphaOnly = true) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const v = alphaOnly ? data[i + 3]! : Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      if (v < 40) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      sx += x; sy += y; n++;
    }
  return { x0, y0, x1, y1, cx: n ? sx / n : 0, cy: n ? sy / n : 0, n };
}

describe("motor de gráficos con lugar", () => {
  const W = 540, H = 960;
  /** Solo el contenido: sin el velo del modo "sobre tu video". */
  function draw(place: { transform?: unknown; anim?: unknown } | null, t: number) {
    const g = graphicWithPlace({ ...V1 } as never, place);
    const scene = toMotionScene(g, { duration: 3, format: "9:16" })!;
    const c = new skia!.Canvas(W, H);
    const ctx = c.getContext("2d") as unknown as MotionCanvas & { scale(a: number, b: number): void };
    ctx.scale(0.5, 0.5);
    const compiled = compileScene(scene, { width: 1080, height: 1920, measure: measureWith(ctx) });
    renderFrame(ctx, compiled, t, { pixelScale: 0.5, backdrop: false });
    return { ink: inked(c.getContext("2d").getImageData(0, 0, W, H).data, W, H), compiled };
  }

  test("un v1 y una escena llevan el lugar hasta el motor", { skip }, () => {
    const g = graphicWithPlace({ ...V1 } as never, { transform: { x: 0.1, y: 0, scale: 1 } });
    assert.deepEqual(toMotionScene(g, { duration: 3, format: "9:16" })!.place, { transform: { x: 0.1, y: 0, scale: 1 } });
    assert.equal(toMotionScene(graphicWithPlace({ ...V1 } as never, {}), { duration: 3, format: "9:16" })!.place, undefined);
  });

  test("mover y agrandar: lo dibujado se corre y crece lo mismo que la caja del lienzo", { skip }, () => {
    const base = draw(null, 1.5);
    const moved = draw({ transform: { x: 0.2, y: 0.15, scale: 1 } }, 1.5);
    assert.ok(Math.abs(moved.ink.cx - base.ink.cx - 0.2 * W) < 3, `x: ${moved.ink.cx - base.ink.cx}`);
    assert.ok(Math.abs(moved.ink.cy - base.ink.cy - 0.15 * H) < 3, `y: ${moved.ink.cy - base.ink.cy}`);
    const big = draw({ transform: { x: 0, y: 0, scale: 1.5 } }, 1.5);
    const ratio = (big.ink.x1 - big.ink.x0) / (base.ink.x1 - base.ink.x0);
    assert.ok(Math.abs(ratio - 1.5) < 0.06, `escala ${ratio}`);
    // La caja que muestra el lienzo es la del contenido con la misma transformación.
    const box = placedContentBox(moved.compiled);
    const b0 = placedContentBox(base.compiled);
    assert.equal(Math.round(box.cx - b0.cx), Math.round(0.2 * 1080));
    assert.ok(base.ink.x0 * 2 >= b0.cx - b0.w / 2 - 40 && base.ink.x1 * 2 <= b0.cx + b0.w / 2 + 40, "la caja abarca lo dibujado");
  });

  test("cada animación de entrada se dibuja como dice", { skip }, () => {
    // Contra "sin animación" en el mismo instante (el componente tiene además su propia entrada).
    const at = (kind: Anim["in"], t: number) => draw({ anim: { in: kind, out: "aparecer", inDur: 0.4, outDur: 0.2 } }, t).ink;
    const t = 0.12;
    const still = at("ninguna", t);
    assert.ok(still.n > 0);
    assert.ok(at("deslizar_arriba", t).cy - still.cy > 0.015 * H, "más abajo al entrar");
    assert.ok(still.cx - at("deslizar_lado", t).cx > 0.02 * W, "más a la izquierda al entrar");
    const pop = at("pop", 0.03);
    const still0 = at("ninguna", 0.03);
    assert.ok(pop.x1 - pop.x0 < (still0.x1 - still0.x0) * 0.85, "más chico al entrar");
    const settled = at("ninguna", 1.5);
    const typing = at("escribir", 0.2);
    assert.ok(typing.x1 < settled.x0 + (settled.x1 - settled.x0) * 0.62 && typing.n > 0, "solo la mitad izquierda");
    // La opacidad no la aplica el motor (la compone ffmpeg): en la entrada de "aparecer" se dibuja igual que sin animación.
    assert.deepEqual(at("aparecer", t), still);
  });
});

describe("motor de efectos con lugar", () => {
  const S = 0.5;
  function render(kind: FxKind, place: { transform?: unknown; anim?: unknown } | null, t: number) {
    const spec0 = demoSpec(kind, BRAND);
    const spec = place
      ? compileFx({
          segment: { id: spec0.id, start: 0, end: spec0.duration, item: { id: spec0.id, kind, from_word: 0, to_word: 3, text: spec0.text, items: spec0.items, kicker: spec0.kicker, ...(place as object) } },
          timeline: { words: [], duration: spec0.duration, clips: [{ startFrame: 0, endFrame: Math.round(spec0.duration * 30), role: "body", firstWord: 0, lastWord: 0 }] },
          format: "9:16",
          brand: BRAND,
          face: spec0.face,
          thumbs: 0,
        })
      : spec0;
    const host = { makeCanvas: (w: number, h: number) => { const c = new skia!.Canvas(w, h); return { canvas: c, ctx: c.getContext("2d") as never }; }, fonts: { sans: "Inter", display: "Montserrat", serif: "Inter", mono: "Inter", hand: "Inter", cut: "Inter" } };
    const c = new skia!.Canvas(540, 960);
    // Sin cuadro de video: lo dibujado es solo el efecto sobre un fondo liso.
    const out = new FxRenderer(host).render(c.getContext("2d") as never, spec, t, { frame: null, mask: null }, S);
    return { out, spec, data: c.getContext("2d").getImageData(0, 0, 540, 960).data };
  }

  test("los movibles informan su caja y se corren con el lugar", { skip }, () => {
    for (const kind of Object.keys(FX_MOVABLE) as FxKind[]) {
      // La lupa y el foco dibujan el video (sin cuadro aquí, casi nada): se prueban aparte por su caja.
      if (kind === "spotlight" || kind === "magnifier") continue;
      const t = kind === "cover_story" ? 1.5 : Math.min(1.8, demoSpec(kind, BRAND).duration - 0.4);
      const a = render(kind, null, t);
      const b = render(kind, { transform: { x: 0.1, y: 0.1, scale: 1 } }, t);
      assert.ok(a.out.movable && a.out.movable.w > 50, `${kind}: caja`);
      assert.deepEqual(b.spec.place, { transform: { x: 0.1, y: 0.1, scale: 1 } });
      const ia = inked(a.data, 540, 960, false);
      const ib = inked(b.data, 540, 960, false);
      // El fondo liso (#0b1020) queda por debajo del umbral: se mide lo que dibuja el efecto.
      // (En la portada solo se mueve el titular: el centro de todo lo dibujado se corre menos.)
      const k = kind === "cover_story" ? 0.015 : 0.05;
      assert.ok(ib.cx - ia.cx > k * 540 && ib.cy - ia.cy > k * 960, `${kind}: ${ib.cx - ia.cx}, ${ib.cy - ia.cy}`);
      assert.deepEqual(b.out.movable, a.out.movable, "la caja de diseño es la misma; la transformación va aparte");
    }
  });

  test("sin lugar, el efecto no cambia; con animación, la tarjeta entra con ella", { skip }, () => {
    const a = render("checklist", null, 1.8);
    const b = render("checklist", { anim: { in: "ninguna", out: "ninguna", inDur: 0.2, outDur: 0.2 } }, 1.8);
    assert.deepEqual([...a.data], [...b.data], "a mitad del efecto, sin movimiento, igual");
    const popIn = inked(render("checklist", { anim: { in: "pop", out: "aparecer", inDur: 0.6, outDur: 0.2 } }, 0.08).data, 540, 960, false);
    const plain = inked(render("checklist", null, 0.08).data, 540, 960, false);
    assert.ok(popIn.x1 - popIn.x0 < plain.x1 - plain.x0, "con pop, más chica al entrar");
  });
});
