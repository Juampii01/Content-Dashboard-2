/**
 * Pruebas del Estudio de edición sin base ni navegador: imán a palabras, límites al arrastrar, marcas de corte,
 * tramo libre en el cabezal y textos del director sin ids internos.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildTimeline } from "../lib/video/timeline";
import { clampDrag, cutMarks, fitSpan, snapToWords, spanAround, splitSpan } from "../lib/video/studio";
import { humanize } from "../lib/video/human-text";
import { fxSegments } from "../lib/video/fx/compile";
import type { Word } from "../lib/video/types";

/** Palabras de 0,3 s con 0,05 s entre ellas; un punto cierra frase. */
function speak(text: string): Word[] {
  let t = 0.5;
  return text.split(" ").map((w, id) => {
    const word = { id, text: w, start: t, end: t + 0.3 };
    t += 0.35;
    return word;
  });
}

const words = speak("Uno dos tres cuatro. Cinco seis siete ocho. Nueve diez once doce. Trece catorce quince dieciséis.");
const plan = (removed: number[] = [], hook: { from_word: number; to_word: number } | null = null) => ({
  removals: removed.map((id) => ({ from_word: id, to_word: id, reason: "manual" as const, confidence: 1, source: "user" as const })),
  hook_candidates: hook ? [{ ...hook, score: 1, why: "" }] : [],
  selected_hook: hook ? 0 : null,
  corrections: {},
  captions: { preset: "clasico" as const, emphasis_words: [] },
});

describe("imán a palabras", () => {
  const tl = buildTimeline(words, plan(), 7);
  test("el inicio va al comienzo de palabra más cercano y el final al final más cercano", () => {
    const w = tl.words;
    const span = snapToWords(tl, w[2]!.start + 0.04, w[5]!.end - 0.03);
    assert.ok(span);
    assert.equal(span.from, 2);
    assert.equal(span.to, 5);
  });
  test("al menos una palabra", () => {
    const w = tl.words;
    const span = snapToWords(tl, w[4]!.start + 0.1, w[4]!.start + 0.12);
    assert.ok(span);
    assert.equal(span.from, span.to);
  });
  test("no cruza el gancho que pasó al principio", () => {
    const hooked = buildTimeline(words, plan([], { from_word: 8, to_word: 11 }), 7);
    // Del gancho (al principio) hasta el cuerpo: se corta donde cambia el orden.
    const span = snapToWords(hooked, 0, hooked.words[6]!.end);
    assert.ok(span);
    assert.equal(span.from, 8);
    assert.equal(span.to, 11);
  });
});

describe("arrastrar bloques", () => {
  test("mover no pasa por encima de los vecinos", () => {
    const r = clampDrag({ mode: "move", start: 2, end: 3, delta: 5, duration: 10, obstacles: [{ start: 4, end: 5 }] });
    assert.deepEqual(r, { start: 3, end: 4 });
  });
  test("estirar respeta la duración máxima y mínima", () => {
    assert.equal(clampDrag({ mode: "end", start: 2, end: 3, delta: 10, duration: 20, obstacles: [], max: 4 }).end, 6);
    assert.equal(clampDrag({ mode: "start", start: 2, end: 3, delta: 2, duration: 20, obstacles: [], min: 0.5 }).start, 2.5);
  });
  test("dividir deja la palabra del cabezal en la segunda parte", () => {
    assert.deepEqual(splitSpan({ from: 3, to: 9 }, 6), [
      { from: 3, to: 5 },
      { from: 6, to: 9 },
    ]);
    assert.equal(splitSpan({ from: 3, to: 9 }, 3), null);
  });
});

describe("marcas de corte y tramo en el cabezal", () => {
  test("cada corte dice qué palabras se sacaron", () => {
    const tl = buildTimeline(words, plan([5, 6]), 7);
    const marks = cutMarks(tl, new Set([5, 6]));
    const cut = marks.find((m) => m.kind === "corte");
    assert.ok(cut);
    assert.deepEqual(cut.removed, { from: 5, to: 6 });
  });
  test("el tramo en el cabezal cierra en un final de frase", () => {
    const tl = buildTimeline(words, plan(), 7);
    const span = spanAround(tl, tl.words[4]!.start, 2);
    assert.ok(span);
    assert.equal(span.from, 4);
    assert.equal(span.to, 7);
  });
  test("el tramo libre se acorta antes del próximo bloque", () => {
    const tl = buildTimeline(words, plan(), 7);
    const span = fitSpan(tl, tl.words[4]!.start, 3, 0.5, [{ from_word: 7, to_word: 9 }]);
    assert.ok(span);
    assert.equal(span.from, 4);
    assert.equal(span.to, 6);
    assert.equal(fitSpan(tl, tl.words[8]!.start, 3, 0.5, [{ from_word: 7, to_word: 9 }]), null);
  });
});

describe("efectos sobre el gancho", () => {
  test("un efecto en el gancho (que va al principio) no se pierde", () => {
    const tl = buildTimeline(words, plan([], { from_word: 8, to_word: 11 }), 7);
    const segs = fxSegments(tl, [
      { id: "a", kind: "glass_type", from_word: 0, to_word: 3, text: "UNO" },
      { id: "b", kind: "glass_type", from_word: 8, to_word: 11, text: "NUEVE" },
    ]);
    assert.deepEqual(segs.map((s) => s.id).sort(), ["a", "b"]);
    assert.equal(segs.find((s) => s.id === "b")!.start, 0);
  });
});

describe("textos del director para personas", () => {
  const ctx = { words, broll: [{ from_word: 4, to_word: 7, choice: { source: "graphic" } }] };
  test("rangos de ids a frases citadas", () => {
    const out = humanize("Puse un zoom de 4 a 7 para el énfasis.", ctx);
    assert.match(out, /zoom en «Cinco seis siete ocho»/);
    assert.doesNotMatch(out, /\b4\b|\b7\b/);
  });
  test("B1, F2, ritmo fast y nombres de efectos", () => {
    assert.match(humanize("Moví el b-roll de B1.", ctx), /el gráfico de «Cinco/);
    assert.match(humanize("Ritmo fast con cover_story.", ctx), /Ritmo rápido con «Portada de revista»/);
    assert.match(humanize("F2 queda fuera.", ctx), /La frase «Cinco seis siete ocho»/);
  });
  test("etiquetas internas fuera", () => {
    assert.equal(humanize("Ritmo: cambio de encuadre.", ctx), "Cambio de encuadre.");
    assert.equal(humanize("De 2 a 3 segundos de pausa.", ctx), "De 2 a 3 segundos de pausa.");
  });
});
