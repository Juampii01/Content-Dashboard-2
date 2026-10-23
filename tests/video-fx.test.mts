/**
 * Efectos de firma: ficha, plan (validación), del plan al dibujo, recorte, director (reglas duras, simulador y "Edítalo
 * así") y el motor dibujando los 17 en skia-canvas. Sin base ni red.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { FX_GALLERY_ORDER, FX_INFO, FX_KINDS, fxBudget } from "../lib/video/fx/catalog";
import { compileFx, faceAnchor, framingMap, fxCaptionHides, fxSegments, revealMarks, sourceFramesOf } from "../lib/video/fx/compile";
import { demoSpec } from "../lib/video/fx/demo";
import { effectsFromWire, fxLimits, parseFxRequest, simulateEffects } from "../lib/video/fx/director";
import { FX_MASK_VERSION, fxMaskKey, maskChunksFor, maskTileAt } from "../lib/video/fx/masks";
import { clampFx, cleanFx, defaultFx, fxIssues, FX_FACTORY, readFxSettings, strongWords, type FxItem } from "../lib/video/fx/schema";
import { digitalZoomScale, FxRenderer, WORKER_FONTS, type FxCtx } from "../lib/video/fx";
import { planSchemaFor } from "../lib/video/plan";
import { buildTimeline } from "../lib/video/timeline";
import type { EditPlan, Word } from "../lib/video/types";

const TEXT =
  "Hoy te muestro cómo crecer tu cuenta en treinta días. Primero define tu cliente ideal. Segundo publica todos los días. Tercero mide lo que funciona. Así pasé de mil a diez mil seguidores. Comenta la palabra SISTEMA.";
const words: Word[] = (() => {
  let t = 0.3;
  return TEXT.split(" ").map((text, id) => {
    const w = { id, text, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3) };
    t += 0.4 + (text.endsWith(".") ? 0.2 : 0);
    return w;
  });
})();
const duration = words.at(-1)!.end + 0.5;
const plan = { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "caja", emphasis_words: [] } } as unknown as EditPlan;
const timeline = buildTimeline(words, plan, duration);
const brand = { accent: "#2b8cff", bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accentText: "#ffffff", font: "inter" as const };
const item = (over: Partial<FxItem>): FxItem => ({ id: "e1", kind: "checklist", from_word: 10, to_word: 25, ...over });

describe("ficha de los efectos", () => {
  test("son 17, todos en la galería, con textos y duraciones coherentes", () => {
    assert.equal(FX_KINDS.length, 17);
    assert.deepEqual([...FX_GALLERY_ORDER].sort(), [...FX_KINDS].sort());
    for (const k of FX_KINDS) {
      const i = FX_INFO[k];
      assert.ok(i.duration.min < i.duration.max, k);
      assert.ok(i.label && i.description && i.when, k);
    }
    // Los que ponen cosas detrás de la persona necesitan el recorte.
    for (const k of ["cover_story", "glass_type", "headline_wall", "paper_cut", "doodle_boil", "frame_break", "couch_wall", "vertigo", "green_screen", "orbit"] as const) assert.ok(FX_INFO[k].mask, k);
    assert.ok(!FX_INFO.digital_zoom.mask && !FX_INFO.checklist.mask && !FX_INFO.chart_grow.mask);
  });

  test("frecuencia: cuántos por video", () => {
    assert.equal(fxBudget("ninguno", 60), 0);
    assert.equal(fxBudget("pocos", 20), 1);
    assert.equal(fxBudget("normal", 60), 3);
    assert.equal(fxBudget("muchos", 60), 5);
    assert.ok(fxBudget("pocos", 600) <= 2);
  });

  test("Mi marca: lo guardado mal vuelve a los de fábrica", () => {
    assert.deepEqual(readFxSettings(null), FX_FACTORY);
    assert.deepEqual(readFxSettings({ allowed: ["cover_story", "cover_story"], frequency: "pocos" }), { allowed: ["cover_story"], frequency: "pocos" });
    assert.deepEqual(readFxSettings({ allowed: ["no-existe"], frequency: "pocos" }), FX_FACTORY);
  });
});

describe("efectos en el plan", () => {
  test("textos por defecto a partir de lo que se dice", () => {
    const spoken = words.slice(10, 26);
    const d = defaultFx("checklist", spoken);
    assert.equal(d.items!.length, 3);
    assert.ok(d.items!.every((s) => s.length <= FX_INFO.checklist.items!.max));
    assert.ok(defaultFx("cover_story", words.slice(0, 10)).text!.length <= 12);
    assert.equal(defaultFx("digital_zoom", words.slice(0, 10)).words!.length, 3);
    assert.ok(strongWords(words.slice(30, 40), 2).every((id) => id >= 30 && id < 40));
  });

  test("clampFx recorta textos y palabras fuera del tramo", () => {
    const e = clampFx({ id: "x", kind: "digital_zoom", from_word: 5, to_word: 9, words: [1, 6, 8, 20], text: "no lleva" });
    assert.deepEqual(e.words, [6, 8]);
    assert.equal(e.text, undefined);
    const c = clampFx({ id: "y", kind: "glass_type", from_word: 0, to_word: 3, text: "UNA PALABRA LARGUÍSIMA" });
    assert.equal(c.text!.length, FX_INFO.glass_type.text!.max);
  });

  test("validación: superpuestos, fuera de rango y pisando un b-roll", () => {
    assert.deepEqual(fxIssues([item({})], words.length), []);
    assert.ok(fxIssues([item({}), item({ id: "e2", from_word: 20, to_word: 30 })], words.length).some((m) => m.includes("superpuestos")));
    assert.ok(fxIssues([item({ to_word: 999 })], words.length).some((m) => m.includes("fuera de rango")));
    assert.ok(fxIssues([item({})], words.length, [{ from_word: 12, to_word: 14 }]).some((m) => m.includes("b-roll")));
    const clean = cleanFx([item({}), item({ id: "e2", from_word: 20, to_word: 30 }), { kind: "nada" }, item({ id: "e3", from_word: 30, to_word: 33 })], words.length, [{ from_word: 31, to_word: 32 }]);
    assert.deepEqual(clean.map((e) => e.id), ["e1"]);
  });

  test("el esquema del plan acepta efectos válidos y rechaza los que pisan un b-roll", () => {
    const base = { version: 2, format: "9:16", segments: [], order: [], removals: [], proposed_removals: [], hook_candidates: [], selected_hook: null, captions: { preset: "caja", emphasis_words: [] }, corrections: {}, overlays: [], broll: [], audio: { music_asset_id: null, music_db: -16, target_lufs: -14 }, framing: { mode: "center", offset_x: 0 }, off_script: [], summary: "", warning: "", planned_by: "ai" };
    assert.ok(planSchemaFor(words.length).safeParse({ ...base, effects: [item({})] }).success);
    assert.ok(!planSchemaFor(words.length).safeParse({ ...base, effects: [item({ kind: "nada" as never })] }).success);
  });
});

describe("del plan al dibujo", () => {
  test("tramos: dentro del video, sin pisarse, con su duración mínima y máxima", () => {
    const segs = fxSegments(timeline, [item({ kind: "cover_story", from_word: 0, to_word: 1 }), item({ id: "e2", kind: "zoom_cut", from_word: 10, to_word: 30 })]);
    assert.equal(segs.length, 2);
    assert.ok(segs[0]!.end - segs[0]!.start >= FX_INFO.cover_story.duration.min - 0.05);
    assert.ok(segs[1]!.end - segs[1]!.start <= FX_INFO.zoom_cut.duration.max + 0.05);
    for (const s of segs) assert.ok(Math.abs(s.start * 30 - Math.round(s.start * 30)) < 0.05, "en la rejilla de cuadros");
    assert.deepEqual(fxCaptionHides(segs).length, 1, "la portada lleva sus textos; el corte con zoom no oculta subtítulos");
  });

  test("las tareas del checklist se tildan cuando se dicen", () => {
    const seg = fxSegments(timeline, [item({ items: ["Define tu cliente ideal", "Publica todos los días", "Mide lo que funciona"] })])[0]!;
    const spec = compileFx({ segment: seg, timeline, format: "9:16", brand, face: { x: 400, y: 600, w: 280, h: 330 }, thumbs: 0 });
    const said = (w: string) => spec.words.find((x) => x.text.toLowerCase().startsWith(w))!.t0;
    assert.equal(spec.marks[0], said("define"));
    assert.equal(spec.marks[1], said("publica"));
    assert.equal(spec.marks[2], said("mide"));
    assert.deepEqual(revealMarks(["nada que ver", "tampoco"], spec.words, 4).length, 2);
  });

  test("zoom digital: 1,3 en la primera palabra fuerte, 1,6 en la segunda y 1,0 al terminar la frase", () => {
    const w = [
      { t0: 0, t1: 0.3, text: "Hoy", stop: false, strong: false },
      { t0: 0.4, t1: 0.7, text: "crecer", stop: false, strong: true },
      { t0: 0.8, t1: 1.1, text: "treinta", stop: false, strong: true },
      { t0: 1.2, t1: 1.5, text: "días.", stop: true, strong: false },
      { t0: 1.7, t1: 2, text: "Mil", stop: false, strong: true },
    ];
    assert.equal(digitalZoomScale(w, 0.2), 1);
    assert.equal(digitalZoomScale(w, 0.5), 1.3);
    assert.equal(digitalZoomScale(w, 0.9), 1.6);
    assert.equal(digitalZoomScale(w, 1.6), 1);
    assert.equal(digitalZoomScale(w, 1.8), 1.3);
  });

  test("encuadre y cara: el mismo recorte que el render", () => {
    const m = framingMap(1920, 1080, "9:16", 0);
    assert.equal(m.sw, 608);
    assert.equal(m.sx, (1920 - 608) / 2);
    const face = faceAnchor([{ t: 1, face: { x: 0.45, y: 0.2, w: 0.1, h: 0.2 } }], [{ start: 0, end: 3 }], 1920, 1080, "9:16", 0);
    assert.ok(Math.abs(face.x - (0.45 * 1920 - m.sx) * (1080 / 608)) < 0.2);
    // Sin caras medidas: un lugar razonable (arriba, al centro).
    const none = faceAnchor([], [], 1080, 1920, "9:16", 0);
    assert.ok(none.y < 1920 * 0.4 && none.x > 200);
  });

  test("recorte: misma clave que el worker y bloques por segundo del original", () => {
    const py = readFileSync(new URL("../worker/video/fx_mask.py", import.meta.url), "utf8");
    assert.ok(py.includes(`MASK_VERSION = "${FX_MASK_VERSION}"`), "la versión de la máscara coincide con el worker");
    assert.equal(fxMaskKey(1080, 1920, "9:16", 0.3), `9x16-op000-${FX_MASK_VERSION}`);
    assert.equal(fxMaskKey(1920, 1080, "9:16", -0.354), `9x16-om035-${FX_MASK_VERSION}`);
    assert.match(fxMaskKey(1920, 1080, "9:16", 1), /^[a-z0-9-]+$/);
    const chunks = maskChunksFor({ effects: [item({ kind: "cover_story", from_word: 0, to_word: 6 }), item({ id: "z", kind: "checklist", from_word: 30, to_word: 40 })] }, timeline);
    assert.ok(chunks.length >= 2 && chunks[0] === 0, "solo los efectos con recorte");
    assert.ok(chunks.every((k) => k < 4));
    assert.deepEqual(maskTileAt(1.05, 10), { chunk: 1, index: 1 });
    assert.equal(sourceFramesOf(timeline, 0, 30).length, 30);
  });
});

describe("director", () => {
  const limits = fxLimits({ allowed: [...FX_KINDS], frequency: "normal" }, 60);
  const base = { words, limits, broll: [], forbidden: [], removed: new Set<number>() };
  const wire = (over: object) => ({ from_word: 0, to_word: 6, kind: "cover_story" as const, text: "CRECER", items: ["La guía", "para crecer"], why: "Abre fuerte.", ...over });

  test("arma los efectos con los textos de Claude", () => {
    const { items } = effectsFromWire([wire({})], base);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.text, "CRECER");
    assert.equal(items[0]!.source, "director");
    assert.ok(items[0]!.kicker, "fecha y número por defecto");
  });

  test("reglas duras: permitidos, b-roll, lo importante, la cara, la separación y la cantidad", () => {
    assert.equal(effectsFromWire([wire({})], { ...base, limits: { ...limits, allowed: ["checklist"] } }).items.length, 0);
    assert.equal(effectsFromWire([wire({})], { ...base, broll: [{ from_word: 3, to_word: 5 }] }).items.length, 0);
    assert.equal(effectsFromWire([wire({})], { ...base, forbidden: [{ from: 2, to: 3, label: "el producto" }] }).items.length, 0);
    assert.equal(effectsFromWire([wire({})], { ...base, faceWords: new Set([0, 1]) }).items.length, 0, "detrás tuyo, sin cara a cámara: no");
    assert.equal(effectsFromWire([wire({ kind: "digital_zoom", items: ["crecer"] })], { ...base, faceWords: new Set([0, 1]) }).items.length, 1, "sin recorte, la cara no hace falta");
    const two = effectsFromWire([wire({}), wire({ kind: "checklist", from_word: 8, to_word: 12 })], { ...base, limits: { ...limits, minGap: 30 } });
    assert.equal(two.items.length, 1, "separación mínima");
    const many = effectsFromWire(
      Array.from({ length: 6 }, (_, k) => wire({ kind: "digital_zoom", from_word: k * 7, to_word: k * 7 + 5, items: [] })),
      { ...base, limits: { ...limits, max: 2, minGap: 0 } },
    );
    assert.equal(many.items.length, 2, "cantidad máxima");
    assert.ok(many.items.every((e) => (e.words ?? []).length > 0), "palabras fuertes elegidas solas");
  });

  test("al corregir, un efecto en el mismo lugar conserva lo que cambió la persona", () => {
    const mine: FxItem = { id: "mio", kind: "cover_story", from_word: 0, to_word: 6, text: "MI TEXTO", source: "user" };
    const { items } = effectsFromWire([wire({})], { ...base, base: [mine] });
    assert.equal(items[0]!.id, "mio");
    assert.equal(items[0]!.text, "MI TEXTO");
  });

  test("«Edítalo así»: «ponle el efecto revista al principio»", () => {
    assert.deepEqual(parseFxRequest("ponle el efecto revista al principio"), { kind: "cover_story", where: "start" });
    assert.deepEqual(parseFxRequest("quita los efectos"), { none: true });
    assert.equal(parseFxRequest("más dinámico"), null);
    const fx = simulateEffects({ words, limits: { ...limits, allowed: ["cover_story", "checklist"] }, removed: new Set(), taken: [], instruction: "Ponle el efecto revista al principio" });
    assert.equal(fx[0]!.kind, "cover_story");
    assert.equal(fx[0]!.from_word, 0);
    assert.equal(simulateEffects({ words, limits, removed: new Set(), taken: [], instruction: "sin efectos" }).length, 0);
  });

  test("simulador: portada al abrir y checklist cuando enumera pasos", () => {
    const fx = simulateEffects({ words, limits: { ...limits, minGap: 0 }, removed: new Set(), taken: [] });
    assert.equal(fx[0]!.kind, "cover_story");
    assert.ok(fx.some((e) => e.kind === "checklist"));
    assert.ok(fx.length <= limits.max);
  });
});

describe("motor de efectos (skia-canvas, como en el worker)", () => {
  const require = createRequire(new URL("../worker/motion/package.json", import.meta.url));
  let skia: { Canvas: new (w: number, h: number) => { width: number; height: number; getContext(t: "2d"): unknown } } | null = null;
  try {
    skia = require("skia-canvas");
  } catch {
    skia = null;
  }

  test("dibuja los 17 sin errores y cada uno cambia el cuadro", { skip: skia ? false : "sin skia-canvas (cd worker/motion && npm ci)" }, () => {
    const { Canvas } = skia!;
    const scale = 0.2;
    const host = {
      makeCanvas: (w: number, h: number) => {
        const canvas = new Canvas(w, h);
        return { canvas, ctx: canvas.getContext("2d") as FxCtx };
      },
      fonts: WORKER_FONTS,
    };
    const renderer = new FxRenderer(host);
    // Un cuadro liso y una máscara en el centro (la "persona").
    const frame = new Canvas(1080, 1920);
    const fctx = frame.getContext("2d") as FxCtx;
    fctx.fillStyle = "#806040";
    fctx.fillRect(0, 0, 1080, 1920);
    const mask = new Canvas(540, 960);
    const mctx = mask.getContext("2d") as FxCtx;
    mctx.fillStyle = "#ffffff";
    mctx.fillRect(170, 250, 200, 710);
    for (const kind of FX_KINDS) {
      const spec = demoSpec(kind, brand);
      const out = new Canvas(Math.round(1080 * scale), Math.round(1920 * scale));
      const ctx = out.getContext("2d") as FxCtx & { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
      const t = kind === "zoom_cut" ? spec.duration / 2 : Math.min(spec.duration - 0.3, 2.2);
      renderer.render(ctx, spec, t, { frame, mask, images: {} }, scale);
      const data = ctx.getImageData(0, 0, out.width, out.height).data;
      let changed = 0;
      for (let i = 0; i < data.length; i += 4 * 37) if (Math.abs(data[i]! - 0x80) > 12 || Math.abs(data[i + 2]! - 0x40) > 12) changed++;
      assert.ok(changed > 3, `${kind}: el efecto no dibujó nada`);
    }
  });
});
