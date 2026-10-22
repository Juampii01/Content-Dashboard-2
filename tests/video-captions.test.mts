/**
 * Pruebas de la galería de subtítulos animados (lib/video/caption-styles.ts) y de los efectos de sonido
 * (lib/video/sfx.ts), sin base ni red. Incluye la compatibilidad con planes viejos.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CAPTION_STYLE_KEYS, CAPTION_STYLES, captionLook, captionTracks, colorAt, emojiFor, EMOJI_NAMES, lineBreaks, textOn, valueAt } from "../lib/video/caption-styles";
import { blockText, CAPTION_PICKER_ORDER, CAPTION_PRESETS, captionBlocks } from "../lib/video/captions";
import { planSchemaFor } from "../lib/video/plan";
import { hookEnd, MUSIC_DB, musicLabel, SFX_FILES, sfxCues, sfxLevel } from "../lib/video/sfx";
import { CAPTION_PRESET_KEYS, FPS, type EditPlan, type TimedWord } from "../lib/video/types";
import { existsSync } from "node:fs";

function timed(text: string, emphasis: string[] = []): TimedWord[] {
  let t = 0.3;
  return text.split(" ").map((w, i) => {
    const d = 0.18 + w.length * 0.035;
    const word = { id: i, text: w, start: +t.toFixed(3), end: +(t + d).toFixed(3), emphasis: emphasis.includes(w), stop: /\.$/.test(w) };
    t += d + 0.06;
    return word;
  });
}

const WORDS = timed("Hoy te muestro cómo ganar más dinero con tus videos sin gastar en anuncios.", ["dinero", "videos"]);

describe("galería de subtítulos", () => {
  test("todas las claves están en los presets, en el selector y en el plan", () => {
    for (const k of CAPTION_STYLE_KEYS) {
      assert.ok(CAPTION_PRESET_KEYS.includes(k));
      assert.ok(CAPTION_PICKER_ORDER.includes(k));
      assert.equal(CAPTION_PRESETS[k].label, CAPTION_STYLES[k].label);
    }
    assert.deepEqual([...CAPTION_PICKER_ORDER].sort(), [...CAPTION_PRESET_KEYS].sort());
  });

  test("cada estilo corta los bloques con sus límites y nunca pierde palabras", () => {
    for (const k of CAPTION_STYLE_KEYS) {
      const blocks = captionBlocks(WORDS, k);
      assert.equal(blocks.flatMap((b) => b.words).length, WORDS.length, k);
      for (const b of blocks) {
        assert.ok(b.words.length <= CAPTION_STYLES[k].words, `${k}: ${b.words.length} palabras`);
        assert.ok(b.end > b.start);
      }
    }
    assert.ok(captionBlocks(WORDS, "palabra").every((b) => b.words.length === 1));
  });

  test("mayúsculas y minúsculas según el estilo", () => {
    const [b] = captionBlocks(WORDS, "hormozi");
    assert.equal(blockText(b!, "hormozi"), "HOY TE MUESTRO");
    assert.equal(blockText(captionBlocks(WORDS, "minimal")[0]!, "minimal"), blockText(captionBlocks(WORDS, "minimal")[0]!, "minimal").toLowerCase());
  });

  test("las pistas tienen claves ordenadas dentro del bloque y valores válidos", () => {
    for (const format of ["9:16", "16:9"] as const) {
      for (const k of CAPTION_STYLE_KEYS) {
        const look = captionLook(k, { format, accent: "#0070F8", brandFont: "inter", emoji: true });
        for (const block of captionBlocks(WORDS, k)) {
          const laid = captionTracks(look, block, format, "#0070F8");
          assert.ok(laid.lines >= 1 && laid.lines <= 2);
          for (const w of laid.words) {
            for (const keys of [w.alpha, w.scale, w.box?.alpha, w.box?.scale, w.marker?.grow, w.emoji?.alpha].filter(Boolean)) {
              for (let i = 0; i < keys!.length; i++) {
                assert.ok(keys![i]!.t >= laid.start && keys![i]!.t <= laid.end, `${k} fuera del bloque`);
                if (i) assert.ok(keys![i]!.t >= keys![i - 1]!.t);
              }
            }
            assert.ok(w.alpha.every((a) => a.v >= 0 && a.v <= 1));
            assert.ok(w.color.every((c) => /^#[0-9A-F]{6}$/.test(c.c)));
          }
          // Un emoji por bloque como máximo, solo en el primer renglón y con imagen.
          const emojis = laid.words.filter((w) => w.emoji);
          assert.ok(emojis.length <= 1);
          for (const e of emojis) {
            assert.equal(e.line, 0);
            assert.ok(existsSync(`public/emoji/${e.emoji!.name}.png`) && existsSync(`worker/assets/emoji/${e.emoji!.name}.png`));
          }
        }
      }
    }
  });

  test("la marca manda: fuente de títulos y acento (con texto legible encima)", () => {
    assert.equal(captionLook("caja", { format: "9:16", accent: "#0070f8", brandFont: "inter" }).font.family, "Inter");
    assert.equal(captionLook("hormozi", { format: "9:16", accent: "#0070f8", brandFont: "inter" }).font.family, "Montserrat");
    assert.equal(captionLook("caja", { format: "9:16", accent: "#0070f8" }).box?.color, "#0070F8");
    assert.equal(captionLook("caja", { format: "9:16", accent: "rojo" }).box?.color, "#FFD84D");
    assert.equal(textOn("#FFD84D"), "#0B1020");
    assert.equal(textOn("#0070F8"), "#FFFFFF");
  });

  test("posición segura de Reels: entre el 60 % y el 70 % del alto en vertical", () => {
    for (const k of CAPTION_STYLE_KEYS) {
      const y = captionLook(k, { format: "9:16", accent: "#0070F8" }).y;
      assert.ok(y >= 0.6 && y <= 0.7, `${k}: ${y}`);
    }
  });

  test("palabra activa: la caja salta de palabra en palabra", () => {
    const look = captionLook("caja", { format: "9:16", accent: "#0070F8" });
    const block = captionBlocks(WORDS, "caja")[0]!;
    const laid = captionTracks(look, block, "9:16", "#0070F8");
    const mid = (i: number) => (block.words[i]!.start + block.words[i]!.end) / 2;
    for (let i = 0; i < block.words.length; i++) {
      const on = laid.words.map((w) => valueAt(w.box!.alpha, mid(i)));
      assert.deepEqual(on.map((v) => Math.round(v)), block.words.map((_, j) => (j === i ? 1 : 0)), `palabra ${i}`);
    }
  });

  test("karaoke: las palabras se pintan y quedan pintadas", () => {
    const look = captionLook("karaoke", { format: "9:16", accent: "#0070F8" });
    const block = captionBlocks(WORDS, "karaoke")[1]!;
    const laid = captionTracks(look, block, "9:16", "#0070F8");
    const last = laid.words.length - 1;
    assert.equal(colorAt(laid.words[last]!.color, block.words[last]!.start + 0.1), "#0070F8");
    assert.ok(valueAt(laid.words[0]!.alpha, block.end - 0.01) > 0.99);
    assert.ok(valueAt(laid.words[last]!.alpha, block.start + 0.1) < 0.5);
  });

  test("renglones parejos y emojis por raíz", () => {
    assert.deepEqual(lineBreaks(["HOY", "TE", "MUESTRO"], 13), [0, 0, 1]);
    assert.deepEqual(lineBreaks(["corto"], 5), [0]);
    assert.equal(emojiFor("Dinero,"), "dinero");
    assert.equal(emojiFor("CLIENTES"), "carrito");
    assert.equal(emojiFor("mesa"), null);
    assert.ok(EMOJI_NAMES.every((n) => existsSync(`public/emoji/${n}.png`)));
  });

  test("planes viejos: sin emoji, sin efectos y con los presets de antes siguen siendo válidos", () => {
    const old: EditPlan = {
      version: 2, format: "9:16", segments: [], order: [], removals: [], proposed_removals: [], hook_candidates: [], selected_hook: null,
      captions: { preset: "pop", emphasis_words: [] }, corrections: {}, overlays: [], broll: [],
      audio: { music_asset_id: null, music_db: -22, target_lufs: -14 }, framing: { mode: "center", offset_x: 0 }, off_script: [],
      summary: "", warning: "", planned_by: "auto",
    };
    assert.ok(planSchemaFor(10).safeParse(old).success);
    assert.equal(sfxLevel(old.audio.sfx), "off");
    const next = { ...old, captions: { ...old.captions, preset: "resaltador" as const, emoji: true }, audio: { ...old.audio, sfx: "strong" as const } };
    assert.ok(planSchemaFor(10).safeParse(next).success);
    assert.ok(!planSchemaFor(10).safeParse({ ...old, audio: { ...old.audio, sfx: "fuerte" } }).success);
  });
});

describe("efectos de sonido", () => {
  const broll = [
    { start: 2, end: 4 },
    { start: 2.2, end: 6 },
    { start: 9, end: 11 },
  ];

  test("sin efectos no hay nada; sutil solo whoosh", () => {
    assert.deepEqual(sfxCues({ level: "off", duration: 20, broll }), []);
    const cues = sfxCues({ level: "subtle", duration: 20, broll, hookEnd: 3, emojiTimes: [5] });
    assert.ok(cues.every((c) => c.name === "whoosh"));
    // El punto fuerte cae en el corte; un b-roll que entra 0,2 s después de otro no suena dos veces.
    assert.deepEqual(cues.map((c) => +(c.at + SFX_FILES.whoosh.hit).toFixed(3)), [2, 9]);
  });

  test("marcado: riser que termina en el fin del gancho y pop en los emojis que no chocan", () => {
    const cues = sfxCues({ level: "strong", duration: 20, broll, hookEnd: 3.4, emojiTimes: [2.1, 7.5] });
    const riser = cues.find((c) => c.name === "riser")!;
    assert.equal(+(riser.at + SFX_FILES.riser.duration).toFixed(3), 3.4);
    assert.deepEqual(cues.filter((c) => c.name === "pop").map((c) => c.at), [7.5]);
    assert.ok(cues.every((c, i) => i === 0 || c.at >= cues[i - 1]!.at));
    // Más fuerte que en "Sutil", pero siempre bajo cero.
    const whoosh = cues.find((c) => c.name === "whoosh")!;
    assert.ok(whoosh.gain > sfxCues({ level: "subtle", duration: 20, broll })[0]!.gain && whoosh.gain < 0);
  });

  test("nada antes de 0 ni después del final", () => {
    const cues = sfxCues({ level: "strong", duration: 5, broll: [{ start: 0, end: 1 }, { start: 4.95, end: 5 }], hookEnd: 0.4 });
    assert.ok(cues.every((c) => c.at >= 0 && c.at < 5));
    assert.ok(!cues.some((c) => c.name === "riser"), "un gancho de 0,4 s no lleva riser");
  });

  test("fin del gancho desde los tramos", () => {
    const clip = (role: "hook" | "body", frames: number) => ({ startFrame: 0, endFrame: frames, role, firstWord: 0, lastWord: 0 });
    assert.equal(hookEnd({ clips: [clip("hook", 3 * FPS), clip("body", 90)] }), 3);
    assert.equal(hookEnd({ clips: [clip("body", 90)] }), null);
    assert.equal(hookEnd({ clips: [clip("hook", 90)] }), null);
  });

  test("volumen de la música", () => {
    assert.ok(MUSIC_DB.min < MUSIC_DB.default && MUSIC_DB.default < MUSIC_DB.max && MUSIC_DB.max < 0);
    assert.equal(musicLabel(MUSIC_DB.min), "Muy baja");
    assert.equal(musicLabel(MUSIC_DB.max), "Alta");
    assert.ok(["wav"].every(() => existsSync("public/sfx/whoosh.wav") && existsSync("worker/assets/sfx/riser.wav")));
  });
});
