/**
 * El Estudio sin bloqueos: reemplazar lo que hay debajo (gana lo nuevo) y transiciones en cualquier punto (ancladas a
 * una palabra + desfase), iguales en la vista previa y en el render (applyReview limpia lo mismo que se ve).
 *   node --import tsx --test tests/video-libre.test.mts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { initialStudioState, studioTimelineInput, toReview } from "../components/editor/studio/use-studio-state";
import { applyReview } from "../lib/video/review";
import { carveSpan, replacedLabel } from "../lib/video/studio";
import { buildTimeline } from "../lib/video/timeline";
import { cleanTransitions, compileTransition, cutPoints, freeAnchor, transitionCenter, transitionSegments, type TransitionItem } from "../lib/video/fx/transitions";
import { transitionsFromWire } from "../lib/video/fx/director";
import { syncPlan, syncWords, SYNC_DURATION } from "./video-sync-case";
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

describe("lo nuevo reemplaza lo que hay debajo", () => {
  const items = [
    { id: "a", from_word: 0, to_word: 3 },
    { id: "b", from_word: 5, to_word: 12 },
    { id: "c", from_word: 14, to_word: 15 },
  ];
  test("lo de adentro se quita, lo que pisa se recorta y lo que cruza se parte en dos", () => {
    const r = carveSpan(items, { from: 2, to: 8 }, { reshape: (it, from, to, side) => ({ ...it, id: side === "right" ? `${it.id}2` : it.id, from_word: from, to_word: to }) });
    assert.deepEqual(r.items, [
      { id: "a", from_word: 0, to_word: 1 },
      { id: "b2", from_word: 9, to_word: 12 },
      { id: "c", from_word: 14, to_word: 15 },
    ]);
    assert.deepEqual(r.replaced.map((x) => x.id), ["a", "b"]);
    const inside = carveSpan(items, { from: 6, to: 9 }, { reshape: (it, from, to, side) => ({ ...it, id: `${it.id}-${side}`, from_word: from, to_word: to }) });
    assert.deepEqual(inside.items.map((x) => [x.id, x.from_word, x.to_word]), [["a", 0, 3], ["b-left", 5, 5], ["b-right", 10, 12], ["c", 14, 15]]);
  });
  test("los pedazos que no valen (muy cortos) se quitan y lo que se mueve no se toca", () => {
    const r = carveSpan(items, { from: 1, to: 14 }, { skip: (x) => x.id === "c", valid: (x) => x.to_word - x.from_word >= 1 });
    assert.deepEqual(r.items.map((x) => x.id), ["c"]);
    assert.deepEqual(r.replaced.map((x) => x.id), ["a", "b"]);
  });
  test("el aviso nombra lo reemplazado", () => {
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
