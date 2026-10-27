/**
 * El Estudio sin bloqueos: lo que se superpone va en capas (lo nuevo encima, nada se recorta ni se quita) y
 * transiciones en cualquier punto (ancladas a una palabra + desfase), iguales en la vista previa y en el render.
 *   node --import tsx --test tests/video-libre.test.mts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { initialStudioState, studioTimelineInput, toReview } from "../components/editor/studio/use-studio-state";
import { applyReview } from "../lib/video/review";
import { replacedLabel } from "../lib/video/studio";
import { laneLayout, restack, stackSort } from "../lib/video/layers";
import { brollSegments, directorZooms } from "../lib/video/effects";
import { fxSegments } from "../lib/video/fx/compile";
import { buildTimeline } from "../lib/video/timeline";
import { cleanTransitions, compileTransition, cutPoints, freeAnchor, transitionCenter, transitionSegments, type TransitionItem } from "../lib/video/fx/transitions";
import { transitionsFromWire } from "../lib/video/fx/director";
import { syncPlan, syncRenderInput, syncWords, SYNC_DURATION } from "./video-sync-case";
import type { Word } from "../lib/video/types";

function speak(text: string): Word[] {
  let t = 0.5;
  return text.split(" ").map((w, id) => {
    const word = { id, text: w, start: t, end: t + 0.3 };
    t += 0.35;
    return word;
  });
}
const words = speak("Uno dos tres cuatro. Cinco seis siete ocho. Nueve diez once doce. Trece catorce quince dieciséis.");
const plan = (removed: number[] = []) => ({
  removals: removed.map((id) => ({ from_word: id, to_word: id, reason: "manual" as const, confidence: 1, source: "user" as const })),
  hook_candidates: [],
  selected_hook: null,
  corrections: {},
  captions: { preset: "clasico" as const, emphasis_words: [] },
});

describe("capas: lo nuevo convive con lo que había y se dibuja encima", () => {
  test("orden de dibujo: por capa; con la misma capa, b-roll < efecto < transición y después por inicio", () => {
    const order = stackSort([
      { key: "f:a", kind: "fx", layer: 1, start: 2 },
      { key: "b:g", kind: "broll", layer: 2, start: 1 },
      { key: "t:x", kind: "transition", start: 0 },
      { key: "b:h", kind: "broll", start: 3 },
    ]);
    assert.deepEqual(order.map((x) => x.key), ["b:h", "t:x", "f:a", "b:g"]);
  });
  test("carriles: arriba lo que se dibuja encima; lo que no se superpone queda en el de arriba", () => {
    const { lanes, count } = laneLayout([
      { key: "a", start: 0, end: 4, z: 0 },
      { key: "b", start: 1, end: 2, z: 2 },
      { key: "c", start: 1.5, end: 3, z: 1 },
      { key: "d", start: 5, end: 6, z: 0 },
    ]);
    assert.equal(count, 3);
    assert.deepEqual([lanes.get("b"), lanes.get("c"), lanes.get("a"), lanes.get("d")], [0, 1, 2, 0]);
  });
  test("cambiar de carril cambia el orden de capas (enteros desde 0)", () => {
    const items = [
      { key: "b:g", kind: "broll" as const, start: 0 },
      { key: "f:a", kind: "fx" as const, layer: 1, start: 1 },
      { key: "f:b", kind: "fx" as const, layer: 2, start: 1.5 },
    ];
    const down = restack(items, "f:b", null);
    assert.deepEqual([down.get("f:b"), down.get("b:g"), down.get("f:a")], [0, 1, 2]);
    const mid = restack(items, "b:g", "f:a");
    assert.deepEqual([mid.get("f:a"), mid.get("b:g"), mid.get("f:b")], [0, 1, 2]);
  });
  const tl = buildTimeline(words, plan(), 7);
  test("efectos y b-roll superpuestos no se recortan entre sí y llevan su capa", () => {
    const fx = fxSegments(tl, [
      { id: "e1", kind: "glitch", from_word: 0, to_word: 6 },
      { id: "e2", kind: "glitch", from_word: 3, to_word: 6, layer: 3 },
    ]);
    assert.equal(fx.length, 2);
    assert.ok(fx[1]!.start < fx[0]!.end, "el segundo empieza encima del primero");
    assert.equal(fx[1]!.layer, 3);
  });
  test("zooms superpuestos: manda el de capa más alta y el de abajo sigue antes y después", () => {
    const zs = directorZooms(tl, [
      { from_word: 2, to_word: 9, scale: 1.1, why: "abajo" },
      { from_word: 4, to_word: 5, scale: 1.3, why: "arriba", layer: 1 },
    ]);
    const t = tl.words.find((w) => w.id === 4)!.start + 0.1;
    const now = zs.find((z) => t >= z.start && t < z.end);
    assert.equal(now?.scale, 1.3);
    assert.ok(zs.some((z) => z.scale === 1.1 && z.end <= now!.start + 1e-6), "el de abajo antes");
    assert.ok(zs.some((z) => z.scale === 1.1 && z.start >= now!.end - 1e-6), "y después");
    for (let i = 1; i < zs.length; i++) assert.ok(zs[i]!.start >= zs[i - 1]!.end - 1e-6, "sin superponerse en la salida");
    // Con el de abajo en una capa más alta, manda ese durante todo su tramo.
    const flip = directorZooms(tl, [
      { from_word: 2, to_word: 9, scale: 1.1, why: "abajo", layer: 2 },
      { from_word: 4, to_word: 5, scale: 1.3, why: "arriba", layer: 1 },
    ]);
    assert.ok(!flip.some((z) => z.scale === 1.3));
  });
  test("la revisión guarda las capas y el render las manda en el mismo orden que la vista previa", () => {
    const ws = syncWords();
    const base = syncPlan();
    const s0 = initialStudioState(base, ws.length);
    const [b0] = s0.broll.filter((b) => b.choice);
    assert.ok(b0);
    // Un efecto encima del b-roll y otro debajo, todo superpuesto.
    const s = {
      ...s0,
      effects: [
        ...s0.effects,
        { id: "encima", kind: "glitch" as const, from_word: b0.from_word, to_word: b0.to_word, layer: 5, source: "user" as const },
        { id: "debajo", kind: "glitch" as const, from_word: b0.from_word, to_word: b0.to_word, source: "user" as const },
      ],
      broll: s0.broll.map((b) => (b.id === b0.id ? { ...b, layer: 2 } : b)),
    };
    const next = applyReview(base, toReview(s, { plan: base, hasStyle: false, trackIds: [] }), ws, SYNC_DURATION, "9:16");
    assert.equal(next.effects?.find((e) => e.id === "encima")?.layer, 5);
    assert.equal(next.broll.find((b) => b.id === b0.id)?.layer, 2);
    assert.equal(initialStudioState(next, ws.length).effects.find((e) => e.id === "encima")?.layer, 5);
    const { input } = syncRenderInput(ws, next);
    const zB = (input.broll as { start: number; z: number }[]).find((b) => Math.abs(b.start - brollSegments(buildTimeline(ws, next, SYNC_DURATION), next.broll).find((x) => x.id === b0.id)!.start) < 1e-6)!.z;
    const zFx = (id: string) => (input.effects as { spec: { id: string }; z: number }[]).find((e) => e.spec.id === id)!.z;
    assert.ok(zFx("debajo") < zB && zB < zFx("encima"), `debajo ${zFx("debajo")} < b-roll ${zB} < encima ${zFx("encima")}`);
  });
  test("el aviso nombra lo que quedó debajo", () => {
    assert.equal(replacedLabel(["Barrido"]), "«Barrido»");
    assert.equal(replacedLabel(["Barrido", "B-roll", "B-roll"]), "«Barrido» y «B-roll»");
    assert.equal(replacedLabel(["A", "B", "C", "D"]), "«A», «B» y 2 más");
  });
});

describe("transiciones en cualquier punto", () => {
  const tl = buildTimeline(words, plan([7]), 7);
  test("una libre va centrada en su palabra más el desfase, sin corte", () => {
    const w = tl.words.find((x) => x.id === 2)!;
    const item: TransitionItem = { id: "t1", kind: "tr_flash", at_word: 2, offset: 0.1 };
    assert.equal(transitionCenter(tl, item), w.start + 0.1);
    const [seg] = transitionSegments(tl, [item]);
    assert.ok(seg);
    assert.ok(Math.abs(seg.cut - (w.start + 0.1)) < 0.001);
    assert.ok(Math.abs((seg.start + seg.end) / 2 - seg.cut) < 0.04, "centrada en el instante");
    const spec = compileTransition({ segment: seg, format: "9:16", brand: { accent: "#0070f8", bg: "#030a22", surface: "#07163f", text: "#fff", muted: "#aaa", accentText: "#fff", font: "Inter" } as never, face: { x: 0, y: 0, w: 1, h: 1 } as never });
    assert.equal(spec.kind, "tr_flash");
    assert.ok(Math.abs((spec.cut ?? -1) - (seg.cut - seg.start)) < 0.001);
  });
  test("el ancla sobrevive a los cortes: si su palabra se corta, va a la siguiente que queda", () => {
    const item: TransitionItem = { id: "t1", kind: "tr_whip", at_word: 4, offset: 0 };
    const cut = buildTimeline(words, plan([4]), 7);
    const next = cut.words.find((x) => x.id === 5)!;
    assert.equal(transitionCenter(cut, item), next.start);
    // Las de corte siguen como antes: si el corte desaparece, no se dibujan.
    const onCut: TransitionItem = { id: "t2", kind: "tr_whip", at_word: 8 };
    assert.ok(cutPoints(tl).some((c) => c.word === 8));
    assert.equal(transitionSegments(buildTimeline(words, plan(), 7), [onCut]).length, 0);
  });
  test("el ancla se arma desde un segundo del video final", () => {
    const w = tl.words[5]!;
    assert.deepEqual(freeAnchor(tl, w.start + 0.05), { at_word: w.id, offset: 0.05 });
  });
  test("cleanTransitions deja las libres (sin repetir id) y una por corte", () => {
    const raw = [
      { id: "a", kind: "tr_flash", at_word: 2, offset: 0.12345 },
      { id: "a", kind: "tr_glitch", at_word: 3, offset: 0 },
      { id: "b", kind: "tr_whip", at_word: 8 },
      { id: "c", kind: "tr_blur", at_word: 8 },
      { id: "d", kind: "tr_blur", at_word: 3 },
    ];
    const out = cleanTransitions(raw, tl);
    assert.deepEqual(out.map((t) => [t.id, t.at_word, t.offset]), [["a", 2, 0.123], ["b", 8, undefined]]);
  });
  test("se guardan con la revisión y el render las dibuja donde las veía la vista previa", () => {
    const ws = syncWords();
    const base = syncPlan();
    const s0 = initialStudioState(base, ws.length);
    const preview = buildTimeline(ws, studioTimelineInput(base, s0), SYNC_DURATION);
    const mid = preview.words[Math.floor(preview.words.length / 2)]!;
    const s = { ...s0, broll: [], effects: [], transitions: [...s0.transitions, { id: "libre1", kind: "tr_glitch" as const, at_word: mid.id, offset: 0.2, source: "user" as const }] };
    const shown = transitionSegments(preview, s.transitions);
    const next = applyReview({ ...base, broll: [], effects: [] }, toReview(s, { plan: base, hasStyle: false, trackIds: [] }), ws, SYNC_DURATION, "9:16");
    assert.ok(next.transitions?.some((t) => t.id === "libre1" && t.offset === 0.2));
    const render = transitionSegments(buildTimeline(ws, next, SYNC_DURATION), next.transitions ?? []);
    assert.deepEqual(render.map((t) => [t.id, t.start, t.end]), shown.map((t) => [t.id, t.start, t.end]));
  });
  test("el director puede ponerlas fuera de un corte (en el inicio de la palabra)", () => {
    const r = transitionsFromWire([{ at_word: 2, kind: "tr_flash", why: "cambio de idea" }, { at_word: 8, kind: "tr_whip", why: "corte" }], { timeline: tl, limits: { transitions: 4 } as never, blocked: [] });
    const free = r.items.find((t) => t.at_word === 2);
    assert.equal(free?.offset, 0);
    assert.equal(r.items.find((t) => t.at_word === 8)?.offset, undefined);
  });
});
