/**
 * "Copia este reel" sin base ni red: frases con tiempos, armado del análisis (tramos corregidos, tiempos medidos,
 * textos sin citas), control de copia (ninguna frase de más de 6 palabras seguidas del original) y las respuestas
 * simuladas de la IA de punta a punta.
 *   pnpm test:copia
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scriptSchema, type GeneratedScript } from "../lib/ai/prompts/guiones";
import { analysisTask, copyScriptTask } from "../lib/ai/prompts/copia";
import { fakeResponse } from "../lib/ai/fake";
import { MAX_SHARED_WORDS, redactShared, sharedRuns, sharedRunsIn, tokens } from "../lib/scripts/overlap";
import { analysisBrief, buildAnalysis, orderHooksByScore, metricsSummary, scriptTexts, sentencesFromWords, structureSchema, targetWords, transcriptLines, type StructureAi, type TimedWord } from "../lib/scripts/reel-copy";
import { styleMetricsSchema } from "../lib/video/style";

/** Las frases del video sintético de worker/scripts/make_style_reference.py. */
const PHRASES = [
  "Hoy te muestro cómo editar como un profesional.",
  "Primero cortas cada pausa larga.",
  "Después agregas zooms en los momentos clave.",
  "Y al final subtítulos grandes y amarillos.",
  "Comenta ESTILO y te mando la guía.",
];

function speak(phrases: string[], wordSec = 0.32, gap = 0.04, pause = 0.6): TimedWord[] {
  const words: TimedWord[] = [];
  let t = 0.3;
  for (const p of phrases) {
    for (const w of p.split(" ")) {
      words.push({ text: w, start: +t.toFixed(3), end: +(t + wordSec).toFixed(3) });
      t += wordSec + gap;
    }
    t += pause;
  }
  return words;
}

const metrics = styleMetricsSchema.parse({
  version: 1,
  duration: 16,
  analyzedSeconds: 16,
  width: 1080,
  height: 1920,
  aspect: "9:16",
  cuts: { count: 7, perMinute: 26.2, avgShot: 2, medianShot: 2 },
  zooms: { punchIns: 1, smooth: 1, perMinute: 7.5, avgScale: 1.22 },
  faces: { detected: true, ratio: 0.62 },
  broll: { ratio: 0.37, perMinute: 11.2, avgDuration: 2, reliable: true },
  captions: { detected: true, position: 0.78, size: 0.033, uppercase: true, wordsPerBlock: 3, textColor: "#F8E20A", highlightColor: null, box: false, boxColor: null, outline: true, samples: 13 },
  speech: { detected: true, words: 34, wps: 2.34, hookSeconds: 3.02 },
  audio: { lufs: -22.8, music: true, musicDb: -11.9 },
});

const words = speak(PHRASES);
const sentences = sentencesFromWords(words);
const transcript = sentences.map((s) => s.text).join(" ");

describe("frases con tiempos", () => {
  test("corta en punto final y en pausas, con los tiempos de sus palabras", () => {
    assert.equal(sentences.length, PHRASES.length);
    assert.deepEqual(
      sentences.map((s) => s.text),
      PHRASES,
    );
    assert.equal(sentences[0]!.start, 0.3);
    assert.ok(sentences[1]!.start > sentences[0]!.end);
    assert.equal(sentences.reduce((n, s) => n + s.words, 0), words.length);
  });

  test("una frase muy larga sin puntos se parte a las 16 palabras", () => {
    const long = sentencesFromWords(speak([Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ")], 0.2, 0.01, 0));
    assert.deepEqual(
      long.map((s) => s.words),
      [16, 16, 8],
    );
  });

  test("las líneas para la IA llevan número y tiempos", () => {
    const lines = transcriptLines(sentences).split("\n");
    assert.match(lines[0]!, /^S1 \[0\.3–[\d.]+ s\] Hoy te muestro/);
    assert.equal(lines.length, 5);
    assert.ok(transcriptLines(sentences, 60).split("\n").length < 5, "respeta el tope de caracteres");
  });

  test("el largo de la versión nueva sigue al original", () => {
    assert.deepEqual(targetWords(100), { min: 85, max: 115 });
    assert.equal(targetWords(5).min, 30);
    assert.ok(targetWords(2000).max <= 460);
  });
});

describe("armado del análisis", () => {
  const ai: StructureAi = {
    originalTopic: "cómo editar videos cortos",
    hook: { from: 1, to: 1, type: "curiosidad", mechanism: "Promete un resultado profesional sin explicar todavía cómo." },
    beats: [
      { from: 2, to: 2, purpose: "Primer paso", technique: "lista numerada" },
      { from: 3, to: 4, purpose: "Pasos finales", technique: "acciones concretas" },
    ],
    cta: { from: 5, to: 5, kind: "comentar", description: "Pide una palabra en los comentarios a cambio de una guía." },
    whyItWorks: ["Promesa clara en 3 segundos.", "Pasos cortos con verbo al inicio."],
  };

  test("respuesta correcta: tiempos medidos de las frases, sin correcciones", () => {
    const a = buildAnalysis(ai, sentences, metrics, transcript);
    assert.equal(a.fixes, 0);
    assert.equal(a.hook.start, sentences[0]!.start);
    assert.equal(a.hook.end, sentences[0]!.end);
    assert.equal(a.hook.seconds, Math.round((sentences[0]!.end - sentences[0]!.start) * 10) / 10);
    assert.deepEqual(
      a.beats.map((b) => [b.from, b.to]),
      [
        [2, 2],
        [3, 4],
      ],
    );
    assert.equal(a.cta?.from, 5);
    assert.equal(a.cta?.end, sentences[4]!.end);
    assert.equal(a.originalWords, words.length);
    assert.equal(a.wordsPerSecond, 2.34);
    assert.equal(a.cutsPerMinute, 26.2);
  });

  test("tramos mal marcados: se ordenan, no se pisan y cubren del gancho al CTA", () => {
    const messy: StructureAi = {
      ...ai,
      hook: { ...ai.hook, from: 2, to: 9 },
      beats: [
        { from: 4, to: 3, purpose: "B", technique: "t" },
        { from: 1, to: 2, purpose: "A", technique: "t" },
      ],
      cta: { from: 99, to: 99, kind: "comentar", description: "d" },
    };
    const a = buildAnalysis(messy, sentences, metrics, transcript);
    assert.ok(a.fixes > 0);
    assert.equal(a.hook.from, 1);
    assert.ok(a.hook.to < (a.cta?.from ?? 99));
    let cursor = a.hook.to + 1;
    for (const b of a.beats) {
      assert.equal(b.from, cursor, "cada beat empieza donde terminó el anterior");
      assert.ok(b.to >= b.from);
      cursor = b.to + 1;
    }
    assert.equal(cursor, a.cta!.from, "los beats llegan hasta el CTA");
    assert.equal(a.cta!.to, 5);
  });

  test("sin CTA: el cuerpo llega hasta la última frase", () => {
    const a = buildAnalysis({ ...ai, cta: { from: 0, to: 0, kind: "ninguno", description: "" } }, sentences, metrics, transcript);
    assert.equal(a.cta, null);
    assert.equal(a.beats.at(-1)!.to, 5);
  });

  test("sin beats: se arma uno con todo el cuerpo", () => {
    const a = buildAnalysis({ ...ai, beats: [] }, sentences, metrics, transcript);
    assert.equal(a.beats.length, 1);
    assert.deepEqual([a.beats[0]!.from, a.beats[0]!.to], [2, 4]);
  });

  test("lo que la IA cita del original se tapa en el análisis", () => {
    const quoting = { ...ai, hook: { ...ai.hook, mechanism: 'Arranca con "Hoy te muestro cómo editar como un profesional" y promete.' } };
    const a = buildAnalysis(quoting, sentences, metrics, transcript);
    assert.equal(sharedRuns(a.hook.mechanism, transcript).length, 0);
    assert.match(a.hook.mechanism, /…/);
    assert.match(a.hook.mechanism, /Arranca con/);
  });

  test("el brief para escribir no lleva ninguna frase del original", () => {
    const brief = analysisBrief(buildAnalysis(ai, sentences, metrics, transcript));
    assert.match(brief, /GANCHO \([\d.]+ s, tipo curiosidad\)/);
    assert.match(brief, /BEAT 2/);
    assert.equal(sharedRuns(brief, transcript, 3).length, 0, "ni siquiera 4 palabras seguidas");
  });
});

describe("ganchos por puntaje", () => {
  test("el de mejor puntaje queda primero; empates y sin puntaje respetan el orden de la IA", () => {
    assert.deepEqual(orderHooksByScore(["a", "b", "c", "d"], [60, 90, null, 90]), ["b", "d", "a", "c"]);
    assert.deepEqual(orderHooksByScore(["a", "b"], [null, null]), ["a", "b"]);
  });
});

describe("control de copia", () => {
  test("normaliza tildes, mayúsculas y signos", () => {
    assert.deepEqual(tokens("¡Comenta ESTILO, y te mando la guía!"), ["comenta", "estilo", "y", "te", "mando", "la", "guia"]);
  });

  test("6 palabras seguidas se permiten; 7 no", () => {
    assert.equal(MAX_SHARED_WORDS, 6);
    assert.deepEqual(sharedRuns("Para empezar, primero cortas cada pausa larga y listo", transcript), []); // "primero cortas cada pausa larga" = 5
    assert.deepEqual(sharedRuns("Mira: hoy te muestro cómo editar como yo", transcript), []); // 6 palabras seguidas
    assert.deepEqual(sharedRuns("Mira: hoy te muestro cómo editar como un experto", transcript), ["hoy te muestro como editar como un"]);
  });

  test("devuelve el tramo completo aunque cambien comas o mayúsculas", () => {
    const runs = sharedRuns("COMENTA estilo, ¡y te mando la guía completa!", transcript);
    assert.deepEqual(runs, ["comenta estilo y te mando la guia"]);
  });

  test("detecta un guion que copia el original y deja pasar uno propio", () => {
    const copied = { ...ownScript(), beats: [{ purpose: "p", spoken: "Después agregas zooms en los momentos clave del video.", onScreenText: "", broll: "", seconds: 4 }] };
    assert.ok(sharedRunsIn(scriptTexts(copied), transcript).length > 0);
    assert.deepEqual(sharedRunsIn(scriptTexts(ownScript()), transcript), []);
  });

  test("también lo detecta entre bloques (lo hablado de corrido)", () => {
    const split = { ...ownScript(), hooks: [{ text: "Hoy te muestro cómo", type: "lista" as const, score: 7, why: "" }, ...ownScript().hooks.slice(1)], beats: [{ purpose: "p", spoken: "editar como un profesional.", onScreenText: "", broll: "", seconds: 3 }] };
    assert.ok(sharedRunsIn(scriptTexts(split), transcript).length > 0);
  });

  test("redactShared no toca un texto propio", () => {
    assert.equal(redactShared("Una explicación con palabras propias del análisis.", transcript), "Una explicación con palabras propias del análisis.");
  });
});

function ownScript(): GeneratedScript {
  return scriptSchema.parse(fakeResponse("copia.guion", copyScriptTask({ brief: "BEAT 1 (3 s): Paso. Recurso: lista.", topic: "vender por mensaje directo", originalTopic: "edición", objective: "ventas", format: "REEL", words: { min: 30, max: 50 } })));
}

describe("de punta a punta con la IA simulada", () => {
  test("análisis → brief → guion nuevo sin frases del original", () => {
    const task = analysisTask({ platform: "Instagram", transcript: transcriptLines(sentences), metrics: metricsSummary(metrics) });
    assert.match(task, /S5 \[/);
    const structure = structureSchema.parse(fakeResponse("copia.analisis", task));
    const analysis = buildAnalysis(structure, sentences, metrics, transcript);
    assert.equal(analysis.fixes, 0, "la respuesta simulada marca bien los tramos");
    assert.equal(analysis.cta?.kind, "comentar");
    assert.ok(analysis.beats.length >= 1 && analysis.beats.length <= 3);

    const scriptTask = copyScriptTask({ brief: analysisBrief(analysis), topic: "conseguir clientes por WhatsApp", originalTopic: analysis.originalTopic, objective: "seguidores", format: "REEL", words: targetWords(analysis.originalWords) });
    assert.doesNotMatch(scriptTask, /Hoy te muestro|cortas cada pausa|subtítulos grandes/, "la tarea de escritura no ve la transcripción");
    const script = scriptSchema.parse(fakeResponse("copia.guion", scriptTask));
    assert.equal(script.beats.length, analysis.beats.length, "un beat por cada beat del original");
    assert.match(script.hooks[0]!.text, /WhatsApp/);
    assert.deepEqual(sharedRunsIn(scriptTexts(script), transcript), []);
  });
});
