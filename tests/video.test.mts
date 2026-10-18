/**
 * Pruebas del Editor de video sin base ni red: candidatos a cortar, timeline, subtítulos, guion y plan.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectCandidates } from "../lib/video/candidates";
import { buildTimeline, outputToSource, sourceToOutput } from "../lib/video/timeline";
import { captionBlocks, toSrt } from "../lib/video/captions";
import { alignScript } from "../lib/video/script-align";
import { assemblePlan, normalizeRemovals, planIssues, planSchemaFor, rangesFromIds } from "../lib/video/plan";
import { planTask } from "../lib/ai/prompts/editor";
import type { EditPlan, Word } from "../lib/video/types";

/** Arma palabras con duración fija y pausas donde la frase tiene "|" (0.6 s) o "||" (1.4 s). */
function speak(text: string, wordSec = 0.3, gap = 0.05): Word[] {
  const words: Word[] = [];
  let t = 0.5;
  for (const token of text.split(" ")) {
    if (token === "|") { t += 0.6; continue; }
    if (token === "||") { t += 1.4; continue; }
    words.push({ id: words.length, text: token, start: +t.toFixed(3), end: +(t + wordSec).toFixed(3) });
    t += wordSec + gap;
  }
  return words;
}

const basePlan = (over: Partial<EditPlan> = {}): EditPlan => ({
  version: 2, format: "9:16", segments: [], order: [], removals: [], proposed_removals: [], hook_candidates: [], selected_hook: null,
  captions: { preset: "clasico", emphasis_words: [] }, corrections: {}, overlays: [], broll: [],
  audio: { music_asset_id: null, music_db: -22, target_lufs: -14 }, framing: { mode: "center", offset_x: 0 }, off_script: [],
  summary: "", warning: "", planned_by: "auto", ...over,
});

describe("candidatos", () => {
  test("toma repetida: descarta la primera toma completa", () => {
    const w = speak("Hoy te voy a contar el error | no perdón | Hoy te voy a contar el error que cometen todos.");
    const c = detectCandidates(w).filter((x) => x.kind === "retake");
    assert.equal(c.length, 1);
    assert.equal(c[0]!.from_word, 0);
    assert.equal(w[c[0]!.to_word + 1]!.text, "Hoy");
    assert.ok(c[0]!.confidence >= 0.8, `confianza ${c[0]!.confidence}`);
  });

  test("tres tomas: gana la última", () => {
    const w = speak("La clave es esta | La clave es esta | La clave es esta: escuchar primero.");
    const c = detectCandidates(w).filter((x) => x.kind === "retake");
    assert.equal(c.length, 2);
    assert.deepEqual([c[0]!.from_word, c[1]!.from_word], [0, 4]);
    assert.equal(c[1]!.to_word, 7);
  });

  test("no marca frases que solo comparten palabras vacías", () => {
    const w = speak("y en el centro de la ciudad hay un parque y en el centro de la plaza hay una fuente");
    // "y en el centro de la" se repite: es una repetición real de 6 palabras, pero la confianza baja si no hay pausa.
    const c = detectCandidates(w).filter((x) => x.kind === "retake");
    for (const r of c) assert.ok(r.confidence < 0.8);
  });

  test("ventana de 30 s", () => {
    const filler = Array.from({ length: 100 }, (_, i) => `palabra${i}`).join(" ");
    const w = speak(`esto es importante ${filler} esto es importante`);
    assert.equal(detectCandidates(w).filter((x) => x.kind === "retake").length, 0);
  });

  test("arranque en falso exacto y con palabra cortada", () => {
    const a = detectCandidates(speak("Esto es | Esto es lo que funciona."));
    assert.ok(a.some((c) => c.kind === "false_start" && c.from_word === 0 && c.to_word === 1));
    const b = detectCandidates(speak("Te voy a con | contarte algo."));
    assert.ok(b.some((c) => c.kind === "false_start" && c.to_word === 3), JSON.stringify(b));
  });

  test("muletillas: puras siempre, ambiguas solo entre pausas", () => {
    const c = detectCandidates(speak("Mira eh esto funciona | bueno | y este método es bueno."));
    const fillers = c.filter((x) => x.kind === "filler").map((x) => x.from_word);
    assert.deepEqual(fillers, [1, 4]);
  });

  test("silencios largos informativos", () => {
    const c = detectCandidates(speak("Primera idea. || Segunda idea."));
    const s = c.find((x) => x.kind === "silence");
    assert.ok(s && s.end - s.start >= 1.3);
  });

  test("el guion refuerza la toma repetida", () => {
    const w = speak("lo que nadie te dice | lo que nadie te dice sobre vender");
    const sin = detectCandidates(w).find((x) => x.kind === "retake")!;
    const con = detectCandidates(w, { script: "Lo que nadie te dice sobre vender." }).find((x) => x.kind === "retake")!;
    assert.ok(con.confidence > sin.confidence);
  });
});

describe("timeline", () => {
  const words = speak("Uno dos tres | cuatro cinco || seis siete ocho nueve diez");

  test("sin cortes conserva las pausas cortas y recorta las largas", () => {
    const t = buildTimeline(words, basePlan(), 10);
    // La pausa de 0.6 s y la de 1.4 s superan 0.5 s: tres tramos.
    assert.equal(t.clips.length, 3);
    const original = words.at(-1)!.end - words[0]!.start;
    assert.ok(t.duration < original, `${t.duration} < ${original}`);
    assert.equal(t.words.length, words.length);
  });

  test("tramos en la rejilla de cuadros y sin superposición", () => {
    const t = buildTimeline(words, basePlan({ removals: [{ from_word: 3, to_word: 3, reason: "manual", confidence: 1, source: "user" }] }), 10);
    for (const [i, c] of t.clips.entries()) {
      assert.ok(Number.isInteger(c.startFrame) && Number.isInteger(c.endFrame));
      assert.ok(c.endFrame > c.startFrame);
      if (i > 0 && t.clips[i - 1]!.role === c.role) assert.ok(c.startFrame >= t.clips[i - 1]!.endFrame);
    }
    assert.ok(!t.words.some((w) => w.id === 3));
  });

  test("el gancho pasa al principio y sale de su lugar", () => {
    const plan = basePlan({ hook_candidates: [{ from_word: 5, to_word: 7, score: 0.9, why: "" }], selected_hook: 0 });
    const t = buildTimeline(words, plan, 10);
    assert.equal(t.clips[0]!.role, "hook");
    assert.deepEqual(t.words.slice(0, 3).map((w) => w.id), [5, 6, 7]);
    assert.equal(t.words.filter((w) => w.id === 6).length, 1);
    // Tiempos crecientes en el video final.
    for (let i = 1; i < t.words.length; i++) assert.ok(t.words[i]!.start >= t.words[i - 1]!.start);
  });

  test("un gancho que ya abre el video no se mueve", () => {
    const plan = basePlan({ hook_candidates: [{ from_word: 0, to_word: 2, score: 0.9, why: "" }], selected_hook: 0 });
    const t = buildTimeline(words, plan, 10);
    assert.ok(t.clips.every((c) => c.role === "body"));
  });

  test("ida y vuelta entre tiempos del original y del final", () => {
    const t = buildTimeline(words, basePlan(), 10);
    const mid = (t.clips[1]!.startFrame + 5) / 30;
    const out = sourceToOutput(t.clips, mid)!;
    assert.equal(out.clipIndex, 1);
    assert.ok(Math.abs(outputToSource(t.clips, out.out).source - mid) < 1e-6);
  });

  test("las correcciones cambian el texto de los subtítulos", () => {
    const t = buildTimeline(words, basePlan({ corrections: { "0": "1" } }), 10);
    assert.equal(t.words[0]!.text, "1");
  });
});

describe("subtítulos", () => {
  const t = buildTimeline(speak("Hoy te cuento tres errores. El primero es grave y el segundo peor."), basePlan(), 20);

  test("clásico: hasta 3 palabras y corta en fin de frase", () => {
    const blocks = captionBlocks(t.words, "clasico");
    assert.ok(blocks.every((b) => b.words.length <= 3));
    const i = blocks.findIndex((b) => b.words.some((w) => w.text === "errores"));
    assert.equal(blocks[i]!.words.at(-1)!.text, "errores");
    for (let k = 1; k < blocks.length; k++) assert.ok(blocks[k]!.start >= blocks[k - 1]!.end - 1e-9);
  });

  test("pop: 1 o 2 palabras", () => {
    assert.ok(captionBlocks(t.words, "pop").every((b) => b.words.length <= 2));
  });

  test("SRT con formato válido", () => {
    const srt = toSrt(t.words);
    assert.match(srt, /^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\nHoy te cuento\n/);
  });
});

describe("guion", () => {
  test("corrige la escritura y marca lo que está fuera del guion", () => {
    const w = speak("hoy hablamos de ia en la clinica y de paso saludo a mi mama que me mira");
    const a = alignScript(w, "Hoy hablamos de IA en la clínica.");
    assert.equal(a.corrections["3"], "IA");
    assert.equal(a.corrections["6"], "clínica");
    assert.ok(a.offScript.includes(10));
    assert.ok(!a.offScript.includes(2));
  });
});

describe("plan v2", () => {
  const words = speak("Hoy te voy a contar | Hoy te voy a contar tres errores que cometen todos. eh | El primero es no preguntar. El segundo es hablar del precio. ¿Sabes cuál es el tercero?");
  const candidates = detectCandidates(words);

  test("se arma sin IA con ganchos de 3 a 8 s y valida", () => {
    const plan = assemblePlan({ ai: null, candidates, words, duration: 20, format: "9:16", preset: "clasico", corrections: {}, offScript: [] });
    assert.equal(plan.planned_by, "auto");
    assert.ok(plan.removals.some((r) => r.reason === "retake"));
    assert.ok(plan.removals.some((r) => r.reason === "filler"));
    assert.ok(plan.hook_candidates.length >= 1 && plan.hook_candidates.length <= 3);
    for (const h of plan.hook_candidates) {
      const d = words[h.to_word]!.end - words[h.from_word]!.start;
      assert.ok(d >= 2.5 && d <= 8.5, `gancho de ${d} s`);
    }
    assert.deepEqual(planIssues(plan, words.length), []);
    assert.ok(planSchemaFor(words.length).safeParse(plan).success);
    assert.ok(plan.segments.length > 0 && plan.order.length === plan.segments.length);
  });

  test("descarta ids inexistentes y ganchos inválidos de la IA", () => {
    const plan = assemblePlan({
      ai: {
        decisions: [{ candidate: "C99", cut: true, confidence: 1 }],
        extra_removals: [{ from_word: 500, to_word: 600, reason: "off_topic", confidence: 1, note: "" }],
        hook_candidates: [{ from_word: 0, to_word: 1, score: 1, why: "muy corto" }],
        emphasis_words: [9999, 12],
        summary: "ok",
        warning: "",
      },
      candidates, words, duration: 20, format: "9:16", preset: "pop", corrections: {}, offScript: [],
    });
    assert.ok(plan.removals.every((r) => r.to_word < words.length));
    assert.ok(!plan.hook_candidates.some((h) => h.to_word === 1));
    assert.deepEqual(plan.captions.emphasis_words, [12]);
  });

  test("une cortes superpuestos y detecta los inválidos", () => {
    const merged = normalizeRemovals([
      { from_word: 2, to_word: 5, reason: "filler", confidence: 0.5, source: "auto" },
      { from_word: 4, to_word: 8, reason: "retake", confidence: 0.9, source: "auto" },
      { from_word: 9, to_word: 9, reason: "manual", confidence: 1, source: "user" },
    ], 20);
    assert.deepEqual(merged.map((r) => [r.from_word, r.to_word, r.reason]), [[2, 9, "manual"]]);
    const bad = basePlan({ removals: [{ from_word: 0, to_word: 3, reason: "manual", confidence: 1, source: "user" }, { from_word: 2, to_word: 40, reason: "manual", confidence: 1, source: "user" }] });
    assert.equal(planIssues(bad, 10).length, 2);
    assert.equal(planSchemaFor(10).safeParse(bad).success, false);
  });

  test("rangos desde ids conservan el motivo original", () => {
    const r = rangesFromIds([3, 4, 5, 9], [{ from_word: 3, to_word: 6, reason: "retake", confidence: 0.9, source: "auto" }]);
    assert.deepEqual(r.map((x) => [x.from_word, x.to_word, x.reason]), [[3, 5, "retake"], [9, 9, "manual"]]);
  });

  test("la tarea para Claude lleva frases, candidatos e ids", () => {
    const task = planTask({ words, candidates, duration: 20, format: "9:16", script: null, scriptCoverage: null });
    assert.match(task, /^F1 \[0–/m);
    assert.match(task, /^C1 toma repetida \[0–4\]/m);
    assert.match(task, /0:Hoy 1:te/);
  });
});
