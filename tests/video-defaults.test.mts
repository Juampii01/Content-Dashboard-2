/**
 * "Hazlo por mí" y valores por defecto del editor, sin base ni red.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reviewFromPlan } from "../lib/video/auto-review";
import { editorDefaultsSchema, FACTORY_DEFAULTS, legacyCaption, readEditorDefaults, storedEditorDefaults, summarizeDefaults } from "../lib/video/defaults";
import { assemblePlan, planSchemaFor } from "../lib/video/plan";
import type { Word } from "../lib/video/types";

describe("valores por defecto del editor", () => {
  test("sin nada guardado: los de fábrica (Caja, Sutil, Suave, con b-roll, 9:16)", () => {
    assert.deepEqual(readEditorDefaults(null), FACTORY_DEFAULTS);
    assert.deepEqual(readEditorDefaults({ editorDefaults: null, subtitlePreset: null }), FACTORY_DEFAULTS);
  });

  test("subtitle_preset de antes sigue valiendo (texto u objeto)", () => {
    assert.equal(readEditorDefaults({ subtitlePreset: "hormozi" }).captions, "hormozi");
    assert.equal(readEditorDefaults({ subtitlePreset: { preset: "minimal" } }).captions, "minimal");
    // "Del estilo" necesita un video de referencia: no sirve de valor por defecto.
    assert.equal(legacyCaption("estilo"), null);
    assert.equal(readEditorDefaults({ subtitlePreset: "estilo" }).captions, "caja");
  });

  test("editor_defaults manda; lo que falta o no es válido queda de fábrica", () => {
    const d = readEditorDefaults({
      subtitlePreset: "pop",
      editorDefaults: { captions: "karaoke", sfx: "strong", studio: "fuerte", music: { trackId: "no-es-un-uuid", db: -12 }, format: "16:9" },
    });
    assert.equal(d.captions, "karaoke");
    assert.equal(d.sfx, "strong");
    assert.equal(d.studio, "soft"); // "fuerte" no es válido
    assert.deepEqual(d.music, FACTORY_DEFAULTS.music); // el id no es un uuid
    assert.equal(d.format, "16:9");
    assert.equal(d.broll, "auto");
  });

  test("al guardar, subtitle_preset queda en sincronía y lo guardado se vuelve a leer igual", () => {
    const d = { ...FACTORY_DEFAULTS, captions: "resaltador" as const, emoji: true, music: { trackId: "44444444-4444-4444-8444-444444444444", db: -20 } };
    assert.ok(editorDefaultsSchema.safeParse(d).success);
    const stored = storedEditorDefaults(d);
    assert.deepEqual(stored.subtitlePreset, { preset: "resaltador" });
    assert.deepEqual(readEditorDefaults(stored), d);
  });

  test("resumen legible", () => {
    const text = summarizeDefaults({ ...FACTORY_DEFAULTS, emoji: true, music: { trackId: "44444444-4444-4444-8444-444444444444", db: -16 } }, "Lo-fi");
    assert.match(text, /subtítulos Caja con emojis/);
    assert.match(text, /audio de estudio Suave/);
    assert.match(text, /efectos Sutil/);
    assert.match(text, /música «Lo-fi»/);
    assert.match(summarizeDefaults({ ...FACTORY_DEFAULTS, broll: "off", sfx: "off" }, null), /sin b-roll.*sin efectos.*sin música/);
  });
});

function speak(text: string): Word[] {
  let t = 0.4;
  return text.split(" ").map((w, id) => {
    const word = { id, text: w, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3) };
    t += 0.38;
    return word;
  });
}

describe("Hazlo por mí: la revisión sale del plan", () => {
  const words = speak("Esto es el gancho del video que dura un rato. Eh eh bueno. Este es el cuerpo con la idea principal. Y esto es el cierre con la llamada.");
  const plan = assemblePlan({ ai: null, candidates: [], words, duration: 20, format: "9:16", preset: "hormozi", corrections: { "2": "él" }, offScript: [] });
  const withAudio = { ...plan, removals: [{ from_word: 10, to_word: 12, reason: "filler" as const, confidence: 0.9, source: "auto" as const }], audio: { ...plan.audio, sfx: "strong" as const, studio: "soft" as const, music_asset_id: "44444444-4444-4444-8444-444444444444", music_db: -18 }, captions: { ...plan.captions, emoji: true } };

  test("cortes, subtítulos, sonido y música tal cual", () => {
    const r = reviewFromPlan(withAudio, { keepHook: true });
    assert.deepEqual(r.removed, [10, 11, 12]);
    assert.equal(r.preset, "hormozi");
    assert.equal(r.emoji, true);
    assert.equal(r.sfx, "strong");
    assert.equal(r.studio, "soft");
    assert.deepEqual(r.music, { trackId: "44444444-4444-4444-8444-444444444444", db: -18 });
    assert.deepEqual(r.corrections, { "2": "él" });
    assert.equal(r.selectedHook, withAudio.selected_hook);
    assert.ok(planSchemaFor(words.length).safeParse(withAudio).success);
  });

  test("un clip no mueve otra frase al inicio", () => {
    assert.equal(reviewFromPlan({ ...withAudio, selected_hook: 0 }, { keepHook: false }).selectedHook, null);
  });
});
