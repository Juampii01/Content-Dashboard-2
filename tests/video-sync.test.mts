/**
 * Vista previa y render con el mismo mapeo de tramos.
 *
 * - El caso de la prueba de sincronía del worker (worker/tests/fixtures/sync-plan.json) está al día con el código.
 * - Para estados del Estudio al azar (cortes, gancho, bloques movidos, ritmo), el timeline que arma el servidor al
 *   exportar (applyReview + buildTimeline) es exactamente el de la vista previa (el de components/editor/studio).
 * - Si el plan guardado cambió por detrás (otro gancho en la lista, otros bloques movidos), `previewMismatch` lo
 *   detecta y no se exporta un video distinto del que se vio.
 * - buildTimeline nunca pierde ni repite una palabra que queda.
 *
 * Correr: node --import tsx --test tests/video-sync.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { initialStudioState, studioTimelineInput, toReview, withPause, type StudioState } from "../components/editor/studio/use-studio-state";
import { applyReview, previewMismatch } from "../lib/video/review";
import { buildTimeline, longPauses } from "../lib/video/timeline";
import type { EditPlan, Word } from "../lib/video/types";
import { SYNC_DURATION, syncFixture, syncPlan, syncRenderInput, syncWords } from "./video-sync-case";

test("el caso de la prueba de sincronía del worker está al día (node --import tsx scripts/make-sync-fixture.mts)", () => {
  const saved = JSON.parse(readFileSync(new URL("../worker/tests/fixtures/sync-plan.json", import.meta.url), "utf-8"));
  assert.deepEqual(saved, JSON.parse(JSON.stringify(syncFixture())));
});

test("el caso arranca con el gancho y tiene pausas acortadas y un bloque movido", () => {
  const { input } = syncRenderInput();
  assert.equal(input.clips[0]!.role, "hook");
  assert.ok(input.clips.length >= 10, "pausas acortadas: muchos tramos");
  const starts = input.clips.slice(1).map((c) => c.start);
  assert.ok(starts.some((s, i) => i > 0 && s < starts[i - 1]!), "un bloque movido: un tramo vuelve atrás en el original");
  assert.equal(input.effects.length, 6);
});

/** El timeline de la vista previa, como lo arma components/editor/studio/studio.tsx. */
function previewTimeline(words: Word[], plan: EditPlan, s: StudioState, duration: number) {
  return buildTimeline(words, studioTimelineInput(plan, s), duration);
}

function previewOf(plan: EditPlan, s: StudioState, timeline: ReturnType<typeof buildTimeline>) {
  const hook = s.selectedHook != null ? plan.hook_candidates[s.selectedHook] : undefined;
  return { clips: timeline.clips.map((c) => [c.startFrame, c.endFrame] as [number, number]), hook: hook ? { from_word: hook.from_word, to_word: hook.to_word } : null };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("la vista previa del Estudio y el render arman los mismos tramos", () => {
  const words = syncWords();
  const base = syncPlan();
  const r = rng(7);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  for (let k = 0; k < 300; k++) {
    const plan: EditPlan = {
      ...base,
      hook_candidates: [base.hook_candidates[0]!, { from_word: 178, to_word: 188, score: 0.7, why: "otro" }, { from_word: 0, to_word: 9, score: 0.5, why: "apertura" }],
      moves: r() < 0.5 ? [] : [{ from_word: 150, to_word: 165, after_word: r() < 0.5 ? 200 : -1, why: "prueba" }],
    };
    const s0 = initialStudioState(plan, words.length);
    const removed = new Set(s0.removed);
    for (let j = 0; j < ri(0, 6); j++) {
      const a = ri(0, words.length - 1);
      for (let id = a; id <= Math.min(words.length - 1, a + ri(0, 8)); id++) removed.add(id);
    }
    const s: StudioState = {
      ...s0,
      removed: [...removed].sort((a, b) => a - b),
      selectedHook: [null, 0, 1, 2][ri(0, 3)]!,
      moves: r() < 0.3 ? [] : s0.moves,
      pacing: { long_pause: [0.3, 0.35, 0.5, 0.8][ri(0, 3)]! },
      rhythmTouched: true,
    };
    // Pausas que se dejan completas (algunas, todas o ninguna), como las deja la persona en el Estudio.
    const mode = ri(0, 3);
    if (mode === 3) s.pauses = { keep: [], all: true };
    else if (mode > 0) {
      const list = longPauses(words, { removals: plan.removals, pacing: s.pacing }).map((p) => p.word);
      s.pauses = { keep: list.filter(() => r() < 0.4), all: false };
    }
    const preview = previewTimeline(words, plan, s, SYNC_DURATION);
    const review = { ...toReview(s, { plan, hasStyle: false, trackIds: [] }), preview: previewOf(plan, s, preview) };
    const next = applyReview(plan, review, words, SYNC_DURATION, "9:16");
    const render = buildTimeline(words, next, SYNC_DURATION);
    assert.deepEqual(
      render.clips.map((c) => [c.startFrame, c.endFrame, c.role]),
      preview.clips.map((c) => [c.startFrame, c.endFrame, c.role]),
      `estado ${k}: gancho ${s.selectedHook}, ${s.removed.length} palabras cortadas, movidos ${JSON.stringify(s.moves)}`,
    );
    assert.equal(previewMismatch(review.preview, next, render), null);
  }
});

test("si el plan guardado cambió por detrás, no se exporta otro video del que se vio", () => {
  const words = syncWords();
  const plan = syncPlan();
  const s = initialStudioState(plan, words.length);
  const preview = previewTimeline(words, plan, s, SYNC_DURATION);
  const review = { ...toReview(s, { plan, hasStyle: false, trackIds: [] }), preview: previewOf(plan, s, preview) };

  // Otra lista de ganchos en la base (una versión del director): el mismo número elige otro gancho.
  const stale: EditPlan = { ...plan, hook_candidates: [{ from_word: 0, to_word: 9, score: 0.9, why: "apertura" }, plan.hook_candidates[0]!] };
  const next = applyReview(stale, review, words, SYNC_DURATION, "9:16");
  const msg = previewMismatch(review.preview, next, buildTimeline(words, next, SYNC_DURATION));
  assert.match(msg ?? "", /gancho/);

  // Los bloques movidos ya no están en la base: los tramos salen en otro orden.
  const noMoves: EditPlan = { ...plan, moves: [] };
  const next2 = applyReview(noMoves, review, words, SYNC_DURATION, "9:16");
  assert.match(previewMismatch(review.preview, next2, buildTimeline(words, next2, SYNC_DURATION)) ?? "", /tramos/);
});

test("buildTimeline no pierde ni repite palabras que quedan (gancho, bloques movidos, pausas)", () => {
  const r = rng(11);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  for (let k = 0; k < 3000; k++) {
    const n = ri(30, 120);
    const words: Word[] = [];
    let t = 0.2;
    for (let i = 0; i < n; i++) {
      const d = 0.12 + r() * 0.3;
      words.push({ id: i, text: r() < 0.15 ? "fin." : "w", start: round3(t), end: round3(t + d) });
      t += d + (r() < 0.1 ? 0.3 + r() * 1.2 : r() * 0.1);
    }
    const removals = Array.from({ length: ri(0, 4) }, () => {
      const a = ri(0, n - 1);
      return { from_word: a, to_word: Math.min(n - 1, a + ri(0, 5)), reason: "manual" as const, confidence: 1, source: "user" as const };
    });
    const hf = ri(0, n - 10);
    const moves = Array.from({ length: ri(0, 2) }, () => {
      const a = ri(0, n - 6);
      return { from_word: a, to_word: a + ri(1, 5), after_word: r() < 0.4 ? -1 : ri(0, n - 1), why: "" };
    });
    const plan = { removals, hook_candidates: [{ from_word: hf, to_word: hf + ri(3, 9), score: 1, why: "" }], selected_hook: r() < 0.8 ? 0 : null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] }, pacing: { long_pause: 0.2 + r() }, moves } as unknown as EditPlan;
    const tl = buildTimeline(words, plan, t + 0.5);
    const cut = new Set<number>();
    for (const x of removals) for (let i = x.from_word; i <= x.to_word; i++) cut.add(i);
    const seen = new Map<number, number>();
    for (const w of tl.words) seen.set(w.id, (seen.get(w.id) ?? 0) + 1);
    const missing = words.filter((w) => !cut.has(w.id) && !seen.has(w.id)).map((w) => w.id);
    const twice = [...seen].filter(([, c]) => c > 1).map(([id]) => id);
    assert.deepEqual([missing, twice], [[], []], `caso ${k}`);
    if (plan.selected_hook === 0 && tl.clips.some((c) => c.role === "hook")) assert.equal(tl.clips[0]!.role, "hook", `caso ${k}: el gancho va primero`);
  }
});

const round3 = (n: number) => Math.round(n * 1000) / 1000;

test("las pausas que dejas completas salen completas en la vista previa y en el render", () => {
  const words = syncWords();
  const plan = syncPlan();
  const s0 = initialStudioState(plan, words.length);
  const pauses = longPauses(words, studioTimelineInput(plan, s0));
  const trimmed = pauses.filter((p) => p.trimmed);
  assert.ok(trimmed.length >= 3, "el caso tiene pausas acortadas");
  const before = previewTimeline(words, plan, s0, SYNC_DURATION);

  // Una pausa completa: un tramo menos y el video dura lo que duraba la pausa de más.
  const one = withPause(s0, trimmed[0]!.word, true);
  const t1 = previewTimeline(words, plan, one, SYNC_DURATION);
  assert.ok(t1.clips.length < before.clips.length);
  assert.ok(t1.duration > before.duration + trimmed[0]!.gap - 0.5);
  assert.equal(longPauses(words, studioTimelineInput(plan, one)).find((p) => p.word === trimmed[0]!.word)?.trimmed, false);

  // "Sin recortes automáticos": ninguna pausa acortada ni palabra cortada; el video dura como el original (sin el gancho movido).
  const all: StudioState = { ...s0, removed: [], pauses: { keep: [], all: true }, selectedHook: null, moves: [] };
  const tAll = previewTimeline(words, { ...plan, moves: [] }, all, SYNC_DURATION);
  assert.equal(tAll.clips.length, 1, "un solo tramo: el video como se grabó");
  assert.equal(longPauses(words, studioTimelineInput(plan, all)).filter((p) => p.trimmed).length, 0);

  // Volver a acortar una con "todas" puesto: las demás siguen completas.
  const back = withPause(all, trimmed[1]!.word, false, pauses.map((p) => p.word));
  assert.equal(back.pauses.all, false);
  assert.ok(!back.pauses.keep.includes(trimmed[1]!.word));
  assert.ok(back.pauses.keep.includes(trimmed[0]!.word));

  // Lo mismo en el render (applyReview) y se guarda en el plan.
  for (const st of [one, all, back]) {
    const p = st === all ? { ...plan, moves: [] } : plan;
    const preview = previewTimeline(words, p, st, SYNC_DURATION);
    const review = { ...toReview(st, { plan: p, hasStyle: false, trackIds: [] }), preview: previewOf(p, st, preview) };
    const next = applyReview(p, review, words, SYNC_DURATION, "9:16");
    const render = buildTimeline(words, next, SYNC_DURATION);
    assert.equal(previewMismatch(review.preview, next, render), null);
    // Al volver a abrir el Estudio con el plan guardado, las pausas siguen igual.
    assert.deepEqual(initialStudioState(next, words.length).pauses, { keep: [...st.pauses.keep].filter((id) => id > 0).sort((a, b) => a - b), all: st.pauses.all });
  }
});
