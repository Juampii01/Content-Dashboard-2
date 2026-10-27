/** Mover partes del video a mano (lib/video/sequence.ts) y que el timeline salga en ese orden. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { movePart, normalizeSequence, validSequence } from "../lib/video/sequence";
import { buildTimeline } from "../lib/video/timeline";
import type { Word } from "../lib/video/types";

const words: Word[] = Array.from({ length: 12 }, (_, i) => ({ id: i, text: `p${i}`, start: i, end: i + 0.8 }));
const base: Parameters<typeof buildTimeline>[1] = { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] } };
const order = (seq: { from_word: number; to_word: number }[] | null) => buildTimeline(words, { ...base, ...(seq ? { sequence: seq } : {}) }, 12).words.map((w) => w.id);

describe("orden a mano", () => {
  test("mover una parte después la pasa del otro lado de la vecina", () => {
    const r = movePart({ wordCount: 12, sequence: null, splits: [4, 8], removed: new Set(), part: { from: 4, to: 7 }, dir: 1 });
    assert.ok(r.ok);
    assert.deepEqual(order(r.ok ? r.sequence : null), [0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7]);
  });

  test("mover antes la primera parte avisa; volver al lugar deja el orden de la grabación", () => {
    const first = movePart({ wordCount: 12, sequence: null, splits: [4], removed: new Set(), part: { from: 0, to: 3 }, dir: -1 });
    assert.equal(first.ok, false);
    const a = movePart({ wordCount: 12, sequence: null, splits: [4], removed: new Set(), part: { from: 4, to: 11 }, dir: -1 });
    assert.ok(a.ok && a.sequence);
    const b = movePart({ wordCount: 12, sequence: a.ok ? a.sequence : null, splits: [4], removed: new Set(), part: { from: 4, to: 11 }, dir: 1 });
    assert.ok(b.ok);
    assert.equal(b.ok && b.sequence, null);
  });

  test("las partes cortadas enteras se saltean", () => {
    const r = movePart({ wordCount: 12, sequence: null, splits: [4, 8], removed: new Set([4, 5, 6, 7]), part: { from: 8, to: 11 }, dir: -1 });
    assert.ok(r.ok);
    assert.deepEqual(order(r.ok ? r.sequence : null).slice(0, 4), [8, 9, 10, 11]);
  });

  test("un orden que no cubre todo el video no se usa", () => {
    assert.equal(validSequence(12, [{ from_word: 0, to_word: 5 }]), null);
    assert.equal(validSequence(12, [{ from_word: 0, to_word: 6 }, { from_word: 6, to_word: 11 }]), null);
    assert.deepEqual(order([{ from_word: 0, to_word: 5 }]), words.map((w) => w.id));
    assert.equal(normalizeSequence(12, [[0, 5], [6, 11]]), null);
  });
});
