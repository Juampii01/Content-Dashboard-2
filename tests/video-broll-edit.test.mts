/**
 * Edición del b-roll en la revisión: esquema (con y sin los campos nuevos), valores por defecto, geometría de cada
 * ubicación, recorte del encuadre, matriz de color, tiempos y lo que se manda al worker.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  brollAlpha,
  brollEditSchema,
  brollGeometry,
  brollRenderEdit,
  DEFAULT_EDIT,
  entranceScale,
  frameCrop,
  graphicSideGeometry,
  isDefaultEdit,
  lookMatrix,
  matchingPreset,
  presetLook,
  resolveEdit,
  svgMatrixValues,
} from "../lib/video/broll-edit";
import { brollSegments } from "../lib/video/effects";
import { brollItemSchema, planSchema } from "../lib/video/plan";
import { buildTimeline } from "../lib/video/timeline";
import type { BrollItem, EditPlan, Word } from "../lib/video/types";

const words: Word[] = Array.from({ length: 40 }, (_, i) => ({ id: i, text: `palabra${i}`, start: 0.5 + i * 0.4, end: 0.8 + i * 0.4 }));
const option = { source: "pexels" as const, id: "1", duration: 6, width: 1920, height: 1080, file: "https://videos.pexels.com/a.mp4" };
const item = (over: Partial<BrollItem> = {}): BrollItem => ({ id: "b1", from_word: 10, to_word: 15, query_en: "office", keywords: [], choice: option, options: [option], ...over });

describe("esquema de la edición", () => {
  test("un b-roll guardado antes (sin edit) sigue siendo válido y se ve como siempre", () => {
    const parsed = brollItemSchema.parse(item());
    assert.equal(parsed.edit, undefined);
    assert.deepEqual(resolveEdit(parsed.edit), DEFAULT_EDIT);
    assert.equal(DEFAULT_EDIT.layout, "full");
    assert.equal(DEFAULT_EDIT.transition, "fade");
    assert.deepEqual(DEFAULT_EDIT.frame, { x: 0, y: 0, zoom: 1 });
    assert.ok(isDefaultEdit(resolveEdit(undefined)));
  });

  test("una edición parcial se completa con los valores por defecto", () => {
    const parsed = brollItemSchema.parse(item({ edit: { layout: "card", frame: { x: 0.4 }, look: { filter: "bw" } } }));
    assert.equal(parsed.edit?.layout, "card");
    assert.deepEqual(parsed.edit?.frame, { x: 0.4, y: 0, zoom: 1 });
    assert.equal(parsed.edit?.look.opacity, 1);
    assert.equal(parsed.edit?.card_position, "top-right");
    assert.equal(parsed.edit?.start_delta, 0);
  });

  test("los valores fuera de rango se rechazan y resolveEdit cae en lo de siempre", () => {
    assert.equal(brollEditSchema.safeParse({ frame: { zoom: 5 } }).success, false);
    assert.equal(brollEditSchema.safeParse({ layout: "mosaico" }).success, false);
    assert.equal(brollEditSchema.safeParse({ look: { opacity: 0 } }).success, false);
    assert.deepEqual(resolveEdit({ start_delta: 99 } as never), DEFAULT_EDIT);
  });

  test("el plan completo acepta b-roll con y sin edición", () => {
    const plan: EditPlan = {
      version: 2, format: "9:16", segments: [], order: [], removals: [], proposed_removals: [], hook_candidates: [], selected_hook: null,
      captions: { preset: "clasico", emphasis_words: [] }, corrections: {}, overlays: [], audio: { music_asset_id: null, music_db: -22, target_lufs: -14 },
      framing: { mode: "center", offset_x: 0 }, off_script: [], summary: "", warning: "", planned_by: "ai",
      broll: [item(), item({ id: "b2", from_word: 20, to_word: 25, edit: { layout: "split", split_clip: "bottom", transition: "zoom" } })],
    };
    const parsed = planSchema.parse(plan);
    assert.equal(parsed.broll[0]!.edit, undefined);
    assert.equal(parsed.broll[1]!.edit?.split_ratio, 0.5);
  });
});

describe("geometría", () => {
  test("pantalla completa: todo el cuadro, sin persona", () => {
    const g = brollGeometry(DEFAULT_EDIT, "9:16", 16 / 9);
    assert.deepEqual(g.clip, { x: 0, y: 0, w: 1080, h: 1920 });
    assert.equal(g.person, null);
  });

  test("pantalla dividida: el clip arriba y la persona abajo, encuadrada en la cara", () => {
    const g = brollGeometry(resolveEdit({ layout: "split" }), "9:16", 16 / 9, 0.42);
    assert.deepEqual(g.clip, { x: 0, y: 0, w: 1080, h: 960 });
    assert.deepEqual(g.person, { from: { x: 0, y: 326, w: 1080, h: 960 }, to: { x: 0, y: 960, w: 1080, h: 960 } });
    const down = brollGeometry(resolveEdit({ layout: "split", split_clip: "bottom", split_ratio: 0.4 }), "9:16", 1, 0.42);
    assert.deepEqual(down.clip, { x: 0, y: 1152, w: 1080, h: 768 });
    assert.deepEqual(down.person?.to, { x: 0, y: 0, w: 1080, h: 1152 });
  });

  test("a un lado en 16:9; en vertical pasa a pantalla dividida", () => {
    const g = brollGeometry(resolveEdit({ layout: "side", side_clip: "right", split_ratio: 0.4 }), "16:9", 9 / 16);
    assert.deepEqual(g.clip, { x: 1152, y: 0, w: 768, h: 1080 });
    assert.deepEqual(g.person, { from: { x: 384, y: 0, w: 1152, h: 1080 }, to: { x: 0, y: 0, w: 1152, h: 1080 } });
    const v = brollGeometry(resolveEdit({ layout: "side", side_clip: "right" }), "9:16", 1);
    assert.equal(v.layout, "split");
    assert.equal(v.clip.y, 960);
  });

  test("tarjeta: forma según el clip, dentro de los márgenes y con medidas pares", () => {
    const h = brollGeometry(resolveEdit({ layout: "card" }), "9:16", 16 / 9);
    assert.deepEqual(h.clip, { x: 422, y: 154, w: 594, h: 334 });
    assert.ok(h.card && h.card.radius === 36);
    const v = brollGeometry(resolveEdit({ layout: "card", card_position: "bottom-left", card_size: 0.85 }), "9:16", 9 / 16);
    assert.equal(v.clip.w / v.clip.h > 0.79 && v.clip.w / v.clip.h < 0.81, true); // vertical 4:5
    assert.ok(v.clip.y + v.clip.h <= 1920 * 0.8 + 1);
    const big = brollGeometry(resolveEdit({ layout: "card", card_shape: "vertical", card_size: 0.85 }), "16:9", 1);
    assert.ok(big.clip.h <= 1080 * (0.93 - 0.07) + 1, "la tarjeta vertical en 16:9 se achica para entrar");
    for (const g of [h, v, big]) for (const n of Object.values(g.clip)) assert.equal(n % 2, 0);
  });

  test("gráfico a un lado (16:9): la persona en la mitad opuesta", () => {
    assert.deepEqual(graphicSideGeometry("16:9", "overlay", "left"), { from: { x: 480, y: 0, w: 960, h: 1080 }, to: { x: 960, y: 0, w: 960, h: 1080 } });
    assert.equal(graphicSideGeometry("9:16", "overlay", "left"), null);
    assert.equal(graphicSideGeometry("16:9", "full", "left"), null);
    assert.equal(graphicSideGeometry("16:9", "overlay", "top"), null);
  });

  test("encuadre: el mismo recorte que el worker (worker/tests/test_broll_edit.py)", () => {
    const c = frameCrop(1920, 1080, 1080, 1920, DEFAULT_EDIT.frame);
    assert.equal(Math.round(c.sw), 3413);
    assert.equal(c.sh, 1920);
    assert.equal(Math.round(c.cx), 1167);
    assert.equal(frameCrop(1920, 1080, 1080, 1920, { x: -1, y: 0, zoom: 1 }).cx, 0);
    const z = frameCrop(1920, 1080, 1080, 960, { x: 0.5, y: 1, zoom: 1.5 });
    assert.equal(Math.round(z.sw), 2560);
    assert.equal(Math.round(z.cy), 1440 - 960);
  });
});

describe("color", () => {
  test("look neutro: sin matriz (no se toca el color)", () => {
    assert.equal(lookMatrix(DEFAULT_EDIT.look, "#0070f8"), null);
    assert.equal(lookMatrix({ ...DEFAULT_EDIT.look, filter: "bw", strength: 0 }, "#0070f8"), null);
  });

  test("blanco y negro: las tres filas son la luminancia", () => {
    const m = lookMatrix({ ...DEFAULT_EDIT.look, filter: "bw" }, "#0070f8")!;
    assert.deepEqual(m.slice(0, 4), m.slice(4, 8));
    assert.ok(Math.abs(m[0] + m[1] + m[2] - 1) < 1e-4);
  });

  test("duotono de la marca: el negro va al acento oscuro y el blanco al acento claro", () => {
    const m = lookMatrix({ ...DEFAULT_EDIT.look, filter: "duotone" }, "#0070f8")!;
    // Mismos números que usa el test de la LUT del worker.
    assert.deepEqual(m, [0.08921, 0.3001, 0.0303, 0, 0.12839, 0.43192, 0.0436, 0.07059, 0.17592, 0.59179, 0.05974, 0.15686]);
    const white = [0, 1, 2].map((r) => m[r * 4]! + m[r * 4 + 1]! + m[r * 4 + 2]! + m[r * 4 + 3]!);
    assert.ok(white[2]! > white[0]!, "las luces quedan azules");
  });

  test("brillo, contraste y saturación se componen en orden", () => {
    const m = lookMatrix({ ...DEFAULT_EDIT.look, brightness: 0.1, contrast: 0.2 }, "#000000")!;
    // c' = (c - 0,5)·1,2 + 0,5 + 0,1
    assert.ok(Math.abs(m[0] - 1.2) < 1e-6 && Math.abs(m[3] - 0) < 1e-6);
    const gray = lookMatrix({ ...DEFAULT_EDIT.look, saturation: -1 }, "#000000")!;
    assert.ok(Math.abs(gray[0] - 0.2126) < 1e-4 && Math.abs(gray[1] - 0.7152) < 1e-4);
    assert.equal(svgMatrixValues(gray).split(" ").length, 20);
  });

  test("presets: aplicar uno y reconocerlo", () => {
    assert.equal(matchingPreset(presetLook("bn")), "bn");
    assert.equal(matchingPreset(presetLook("marca")), "marca");
    assert.equal(matchingPreset({ ...presetLook("bn"), contrast: 0.3 }), null);
  });
});

describe("tiempo", () => {
  const timeline = buildTimeline(words, { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] } }, 20);

  test("sin edición, el tramo es el de las palabras", () => {
    const [seg] = brollSegments(timeline, [item()]);
    const base = brollSegments(timeline, [item({ edit: { start_delta: 0, end_delta: 0 } })])[0]!;
    assert.deepEqual([seg!.start, seg!.end], [base.start, base.end]);
    assert.equal(seg!.edit.layout, "full");
  });

  test("entrada y salida se corren, sin salirse del video ni pisar el anterior", () => {
    const [base] = brollSegments(timeline, [item()]);
    const [moved] = brollSegments(timeline, [item({ edit: { start_delta: -0.5, end_delta: 1 } })]);
    assert.ok(Math.abs(moved!.start - (base!.start - 0.5)) < 1e-3 && Math.abs(moved!.end - (base!.end + 1)) < 1e-3);
    const two = brollSegments(timeline, [item(), item({ id: "b2", from_word: 16, to_word: 20, edit: { start_delta: -2 } })]);
    assert.equal(two[1]!.start, two[0]!.end);
    const [edge] = brollSegments(timeline, [item({ from_word: 0, to_word: 3, edit: { start_delta: -3 } })]);
    assert.equal(edge!.start, 0);
  });

  test("fundidos y zoom de entrada", () => {
    assert.equal(brollAlpha({ transition: "fade" }, 0, 3), 0);
    assert.equal(brollAlpha({ transition: "fade" }, 0.1, 3), 0.5);
    assert.equal(brollAlpha({ transition: "cut", look: { opacity: 0.7 } }, 0, 3), 0.7);
    assert.equal(brollAlpha({ transition: "fade", look: { opacity: 0.5 } }, 1.5, 3), 0.5);
    assert.ok(Math.abs(entranceScale("zoom", 0) - 1.15) < 1e-9);
    assert.equal(entranceScale("zoom", 0.5), 1);
    assert.equal(entranceScale("fade", 0), 1);
  });
});

describe("al worker", () => {
  test("clip en tarjeta con look y zoom de entrada", () => {
    const edit = resolveEdit({ layout: "card", look: { filter: "bw", opacity: 0.8 }, transition: "zoom", clip_start: 1.5 });
    const r = brollRenderEdit({ edit, format: "9:16", duration: 3, clipWidth: 1920, clipHeight: 1080, accent: "#0070f8", ground: "#030a22" });
    assert.equal(r.layout, "card");
    assert.deepEqual(r.box, { x: 422, y: 154, w: 594, h: 334 });
    assert.ok(r.color && r.card);
    assert.equal(r.opacity, 0.8);
    assert.equal(r.fade, 0.12);
    assert.equal(r.clipStart, 1.5);
    assert.deepEqual(r.zoom, { from: 1.15, seconds: 0.5 });
  });

  test("sin edición: pantalla completa, sin color y con el fundido de siempre", () => {
    const r = brollRenderEdit({ edit: DEFAULT_EDIT, format: "16:9", duration: 3, clipWidth: 0, clipHeight: 0, accent: "#0070f8", ground: "#030a22" });
    assert.deepEqual(r.box, { x: 0, y: 0, w: 1920, h: 1080 });
    assert.equal(r.color, null);
    assert.equal(r.person, null);
    assert.equal(r.fade, 0.2);
    assert.equal(r.zoom, null);
  });

  test("gráfico: solo el tiempo; a un lado en 16:9 mueve a la persona", () => {
    const edit = resolveEdit({ layout: "card", transition: "zoom", look: { filter: "bw" } });
    const r = brollRenderEdit({ edit, format: "16:9", duration: 3, clipWidth: 0, clipHeight: 0, accent: "#0070f8", ground: "#030a22", graphic: { mode: "overlay", position: "right" } });
    assert.equal(r.layout, "full");
    assert.equal(r.color, null);
    assert.equal(r.transition, "fade");
    assert.deepEqual(r.person?.to, { x: 0, y: 0, w: 960, h: 1080 });
  });
});
