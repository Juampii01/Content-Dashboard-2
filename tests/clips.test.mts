/**
 * Pruebas del puntaje de "Clips desde un video largo" sin base ni red: reglas, candidatos, ranking de ganchos,
 * bordes, ventana de ajuste, transcripción del clip y el prompt (con el simulador de IA).
 *   pnpm test:clips
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  analyzeRange,
  classifyHook,
  clipBounds,
  finalScore,
  generateCandidates,
  previewWindow,
  rankingBonus,
  ruleParts,
  ruleScore,
  scoreRange,
  targetClipCount,
  validRange,
  videoStats,
  RULE_WEIGHTS,
} from "../lib/clips/score";
import { clipsAiSchema, clipsTask } from "../lib/ai/prompts/clips";
import type { Word } from "../lib/video/types";

/** Palabras con duración fija; "|" agrega 0,9 s de pausa y "||" 2 s. */
function speak(text: string, start = 0.5, wordSec = 0.32, gap = 0.06): Word[] {
  const words: Word[] = [];
  let t = start;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token === "|") { t += 0.9; continue; }
    if (token === "||") { t += 2; continue; }
    words.push({ id: words.length, text: token, start: +t.toFixed(3), end: +(t + wordSec).toFixed(3) });
    t += wordSec + gap;
  }
  return words;
}

const reindex = (words: Word[]): Word[] => words.map((w, i) => ({ ...w, id: i }));

/** Un video largo: relleno de charla floja y, en el medio, un momento fuerte con pregunta y cifras. */
function longTalk(): { words: Word[]; strongFrom: number; strongTo: number } {
  const filler = "y bueno entonces eso que te decía | es como que | pasa a veces y bueno | no sé | así es la cosa digamos.";
  const strong =
    "¿Por qué la mayoría de las clínicas pierde pacientes en la primera llamada? Porque dan el precio antes de escuchar. " +
    "Una clínica en Houston cambió solo eso y pasó de 3 a 6 citas de cada 10 llamadas en un mes. " +
    "Lo que funciona es preguntar qué le pasa y desde cuándo, repetir lo que dijo con sus palabras y recién ahí hablar de la solución. " +
    "Haz eso mañana mismo y mide cuántas citas agendas. Esa es la diferencia entre llenar la agenda y vivir esperando.";
  const pieces: string[] = [];
  for (let i = 0; i < 14; i++) pieces.push(filler);
  pieces.push(strong);
  for (let i = 0; i < 14; i++) pieces.push(filler);
  const all = speak(pieces.join(" "));
  const strongWords = strong.split(/\s+/).length;
  const fillerWords = speak(Array(14).fill(filler).join(" ")).length;
  return { words: reindex(all), strongFrom: fillerWords, strongTo: fillerWords + strongWords - 1 };
}

describe("reglas", () => {
  test("los pesos suman 1", () => {
    assert.equal(Math.round(Object.values(RULE_WEIGHTS).reduce((a, b) => a + b, 0) * 1000) / 1000, 1);
  });

  test("tipo de gancho por reglas", () => {
    assert.equal(classifyHook("¿Por qué nadie te contesta?"), "pregunta");
    assert.equal(classifyHook("3 errores que cometen todos"), "lista");
    assert.equal(classifyHook("Pasé de 2 mil a 10 mil al mes"), "resultado");
    assert.equal(classifyHook("Cuando empecé no tenía clientes"), "historia");
    assert.equal(classifyHook("No es que no sepas vender"), "contraste");
    assert.equal(classifyHook("hola a todos"), "otro");
  });

  test("un tramo con gancho, cifras y sin pausas puntúa más que uno flojo con conector y pausas", () => {
    const good = speak("¿Por qué pierdes clientes en la primera llamada? Porque das el precio antes de escuchar. Una clínica pasó de 3 a 6 citas de cada 10 llamadas. Pregunta primero qué le pasa. Haz eso mañana.");
    const bad = speak("y bueno | entonces eso | que te decía || es como que | pasa a veces | y bueno | no sé || así es | digamos que sí | más o menos");
    const stats = { wordsPerSecond: 2.6, duration: 600 };
    const g = ruleParts(analyzeRange(good, 0, good.length - 1), stats);
    const b = ruleParts(analyzeRange(bad, 0, bad.length - 1), stats);
    assert.ok(ruleScore(g) > ruleScore(b) + 0.2, `${ruleScore(g)} vs ${ruleScore(b)}`);
    assert.ok(g.hook > b.hook && g.numbers > b.numbers && g.questions > b.questions && g.pauses > b.pauses);
    const fb = analyzeRange(bad, 0, bad.length - 1);
    assert.equal(fb.startsWithConnector, true);
    assert.ok(fb.longPauses >= 2);
  });

  test("duración: ideal entre 40 y 65 s, baja hacia 30 y 90", () => {
    const stats = { wordsPerSecond: 2.6, duration: 600 };
    const at = (seconds: number) => {
      const n = Math.round(seconds / 0.38);
      const w = speak(Array(n).fill("palabra").join(" "));
      return ruleParts(analyzeRange(w, 0, w.length - 1), stats).duration;
    };
    assert.equal(at(50), 1);
    assert.ok(at(32) < at(45) && at(85) < at(60));
    assert.ok(at(120) <= 0.3);
  });

  test("densidad relativa al propio video", () => {
    const w = speak(Array(120).fill("hola").join(" "));
    const f = analyzeRange(w, 0, w.length - 1);
    assert.ok(ruleParts(f, { wordsPerSecond: f.wordsPerSecond * 0.7, duration: 1 }).density > ruleParts(f, { wordsPerSecond: f.wordsPerSecond * 1.3, duration: 1 }).density);
    assert.ok(Math.abs(videoStats(w).wordsPerSecond - f.wordsPerSecond) < 0.1);
  });
});

describe("ranking de ganchos y puntaje final", () => {
  const ranking = [
    { type: "pregunta" as const, medianScore: 1.8, count: 6 },
    { type: "historia" as const, medianScore: 0.6, count: 4 },
    { type: "lista" as const, medianScore: 2.5, count: 2 }, // menos de 3 piezas: no cuenta
  ];

  test("el tipo de gancho que mejor le rinde suma puntos; el que peor, resta; sin datos, nada", () => {
    assert.ok(rankingBonus("pregunta", ranking) > 0);
    assert.ok(rankingBonus("historia", ranking) < 0);
    assert.equal(rankingBonus("lista", ranking), 0);
    assert.equal(rankingBonus("curiosidad", ranking), 0);
    assert.equal(rankingBonus("pregunta", []), 0);
    assert.ok(rankingBonus("pregunta", [{ type: "pregunta", medianScore: 9, count: 10 }]) <= 8);
    assert.ok(rankingBonus("pregunta", [{ type: "pregunta", medianScore: 0, count: 10 }]) >= -5);
  });

  test("combina reglas (45 %) y criterio de la IA (55 %), entre 1 y 99", () => {
    assert.equal(finalScore({ rules: 0.6, ai: 80, bonus: 0 }), Math.round(100 * (0.45 * 0.6 + 0.55 * 0.8)));
    assert.equal(finalScore({ rules: 0.6, ai: null, bonus: 0 }), 60);
    assert.equal(finalScore({ rules: 1, ai: 100, bonus: 8 }), 99);
    assert.equal(finalScore({ rules: 0, ai: 0, bonus: -5 }), 1);
    assert.ok(finalScore({ rules: 0.6, ai: 80, bonus: 4 }) > finalScore({ rules: 0.6, ai: 80, bonus: 0 }));
  });

  test("scoreRange deja el detalle para explicar el puntaje", () => {
    const w = speak("¿Sabes por qué tu agenda está vacía? Porque contestas mal el teléfono. Te explico 3 pasos.");
    const { score, detail } = scoreRange(w, 0, w.length - 1, videoStats(w), 70, ranking, "pregunta");
    assert.equal(detail.ai, 70);
    assert.ok(detail.bonus > 0 && detail.rules > 0 && detail.features.questions === 1);
    assert.equal(score, finalScore({ rules: detail.rules / 100, ai: 70, bonus: detail.bonus }));
  });
});

describe("candidatos", () => {
  test("encuentra el momento fuerte y los candidatos no se pisan", () => {
    const { words, strongFrom, strongTo } = longTalk();
    const cands = generateCandidates(words, { limit: 12 });
    assert.ok(cands.length >= 3);
    for (const c of cands) {
      assert.ok(c.end - c.start >= 30 - 1e-6 && c.end - c.start <= 90 + 1e-6);
      assert.ok(c.from <= c.to);
    }
    for (let i = 1; i < cands.length; i++) assert.ok(cands[i]!.start >= cands[i - 1]!.end, "se pisan");
    const best = [...cands].sort((a, b) => b.rule - a.rule)[0]!;
    // El mejor candidato cubre el momento fuerte (empieza en la pregunta o muy cerca).
    assert.ok(best.from <= strongFrom + 3 && best.to >= strongFrom + 20, `${best.from}-${best.to} vs ${strongFrom}-${strongTo}`);
    assert.equal(cands[0]!.id, "C1");
  });

  test("sin suficiente texto no hay candidatos", () => {
    assert.deepEqual(generateCandidates(speak("hola qué tal")), []);
  });

  test("cantidad de clips según la duración", () => {
    assert.equal(targetClipCount(8 * 60), 5);
    assert.equal(targetClipCount(45 * 60), 8);
    assert.equal(targetClipCount(150 * 60), 10);
  });
});

describe("bordes y ajuste", () => {
  const w = speak("Primera frase completa. | Segunda frase del clip. | Tercera frase final.");

  test("margen corto sin tocar las palabras vecinas", () => {
    const { start, end } = clipBounds(w, 3, 6, 100);
    assert.ok(start < w[3]!.start && start > w[2]!.end);
    assert.ok(end > w[6]!.end && end < w[7]!.start);
  });

  test("ventana de ajuste de ±20 s dentro del video", () => {
    assert.deepEqual(previewWindow(10, 50, 300), { windowStart: 0, windowEnd: 70 });
    assert.deepEqual(previewWindow(100, 150, 160), { windowStart: 80, windowEnd: 160 });
  });

  test("validación del rango ajustado a mano", () => {
    const long = speak(Array(200).fill("palabra").join(" "));
    const win = { windowStart: 0, windowEnd: 60 };
    assert.equal(validRange(long, 0, 40, win), null);
    assert.match(validRange(long, 0, 5, win) ?? "", /5 segundos/);
    assert.match(validRange(long, 0, 199, win) ?? "", /20 segundos/);
    assert.match(validRange(long, 10, 5, win) ?? "", /no es válido/);
  });
});

describe("prompt", () => {
  test("lleva los candidatos con ids de palabra, el contexto y el ranking", () => {
    const { words } = longTalk();
    const candidates = generateCandidates(words, { limit: 5 });
    const task = clipsTask({ words, candidates, duration: 600, count: 5, ranking: [{ type: "pregunta", medianScore: 1.8, count: 6 }], title: "Podcast 12" });
    assert.match(task, /### C1 \[\d+–\d+\]/);
    assert.match(task, /CLIP: \d+:/);
    assert.match(task, /pregunta: ×1\.8/);
    assert.match(task, /idealmente 5/);
  });

  test("el esquema acepta una respuesta válida y rechaza un tipo de gancho inventado", () => {
    const ok = { clips: [{ candidate: "C1", from_word: 1, to_word: 90, title: "t", hook_text: "h", reason: "r", hook_type: "pregunta", ai_score: 80 }], note: "" };
    assert.equal(clipsAiSchema.safeParse(ok).success, true);
    assert.equal(clipsAiSchema.safeParse({ ...ok, clips: [{ ...ok.clips[0], hook_type: "viral" }] }).success, false);
  });
});
