/**
 * Prueba de los cálculos del puntaje antes de publicar (sin base de datos).
 *   pnpm test:score
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bucketOf,
  computeScore,
  contentWords,
  durationBuckets,
  filterPool,
  hookFeatures,
  hookSimilarity,
  hookTypeStats,
  jaccard,
  median,
  quantile,
  ratioToScore,
  scoreFacts,
  topPieces,
  wordCount,
  type HistoryPiece,
  type HookKind,
} from "../lib/scripts/score";

let n = 0;
function piece(hookType: HookKind | null, perf: number, durationSec: number | null, text = "Un texto cualquiera de prueba", extra: Partial<HistoryPiece> = {}): HistoryPiece {
  n++;
  return { id: `p${n}`, platform: "INSTAGRAM", type: "REEL", hookType, text, durationSec, perf, views: 1000 * perf, ...extra };
}

/** Historial típico: los ganchos de resultado y los videos de 15 a 30 s son los que mejor le rinden. */
function history(): HistoryPiece[] {
  return [
    piece("resultado", 2.6, 22, "Pasé de 3 a 9 pacientes por día con este cambio"),
    piece("resultado", 2.2, 25, "Así llené mi agenda en 30 días sin anuncios"),
    piece("resultado", 1.9, 18, "Con 5 llamadas al día cerré 12 clientes"),
    piece("resultado", 1.6, 28, "Este guion me trajo 40 citas nuevas"),
    piece("pregunta", 0.9, 55, "¿Por qué tus pacientes no vuelven?"),
    piece("pregunta", 0.8, 50, "¿Sabes cuánto pierdes por llamada?"),
    piece("pregunta", 0.7, 62, "¿Te pasa que nadie agenda?"),
    piece("pregunta", 1.0, 48, "¿Qué dices cuando preguntan el precio?"),
    piece("historia", 1.2, 35, "Mi primer cliente perdía la mitad de sus llamadas"),
    piece("historia", 1.1, 40, "Ayer una recepcionista me contó esto"),
    piece("historia", 1.0, 38, "Hace un año casi cierro la clínica"),
    piece("lista", 1.3, 26, "3 errores que vacían tu agenda"),
    piece(null, 0.6, 70, "Hola a todos"),
    piece("otro", 0.5, 80, "#clinica #salud"),
    // No entra: es un carrusel.
    piece("resultado", 9, null, "Carrusel que no cuenta", { type: "CAROUSEL" }),
  ];
}

describe("utilidades", () => {
  test("mediana y cuantiles", () => {
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
    assert.equal(quantile([10, 20], 0.5), 15);
  });

  test("escala del puntaje: ×1 = 50, ×2 = 100, ×0.5 = 0, recortada", () => {
    assert.equal(ratioToScore(1), 50);
    assert.equal(ratioToScore(2), 100);
    assert.equal(ratioToScore(0.5), 0);
    assert.equal(ratioToScore(8), 100);
    assert.equal(ratioToScore(0), 0);
    assert.equal(ratioToScore(Number.NaN), 0);
    assert.ok(ratioToScore(1.4) > 70 && ratioToScore(1.4) < 76);
  });

  test("palabras, raíces y rasgos de forma", () => {
    assert.equal(wordCount("  Hola, ¿cómo estás? 3 cosas  "), 5);
    assert.ok(contentWords("Las llamadas de pacientes").has("llamad"));
    assert.ok(!contentWords("de la que con").size);
    assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
    assert.equal(jaccard(new Set(), new Set(["a"])), 0);
    const f = hookFeatures("¿Sabes por qué tus 3 pacientes no vuelven?");
    assert.deepEqual([f.question, f.number, f.secondPerson], [true, true, true]);
    assert.equal(hookFeatures("Mi primer cliente perdía todo").question, false);
  });

  test("parecido: mismo tipo y mismas palabras pesan más que solo la forma", () => {
    const base = { text: "Así llené mi agenda en 30 días", type: "resultado" as const };
    const same = hookSimilarity(base, { text: "Así llené la agenda en 20 días sin anuncios", hookType: "resultado" });
    const typeOnly = hookSimilarity(base, { text: "Gané 10 clientes con un correo", hookType: "resultado" });
    const nothing = hookSimilarity(base, { text: "¿Te pasa que nadie te contesta?", hookType: "pregunta" });
    assert.ok(same > typeOnly, `${same} > ${typeOnly}`);
    assert.ok(typeOnly > nothing, `${typeOnly} > ${nothing}`);
    assert.ok(same <= 1 && nothing >= 0);
  });
});

describe("grupos", () => {
  test("el grupo de un reel no incluye carruseles ni YouTube largo", () => {
    const h = [...history(), piece("resultado", 3, 600, "Video largo", { platform: "YOUTUBE", type: "VIDEO" })];
    assert.equal(filterPool(h, "REEL").length, 14);
    assert.equal(filterPool(h, "YT_LONG").length, 1);
  });

  test("tipos de gancho: solo con 3 o más piezas, de mejor a peor, sin 'otro'", () => {
    const stats = hookTypeStats(filterPool(history(), "REEL"));
    assert.deepEqual(
      stats.map((s) => s.type),
      ["resultado", "historia", "pregunta"],
    );
    assert.equal(stats[0]!.count, 4);
    assert.equal(stats[0]!.median, 2.05);
  });

  test("rangos de duración", () => {
    const buckets = durationBuckets(filterPool(history(), "REEL"), "REEL");
    assert.equal(buckets.length, 6);
    const b15 = bucketOf(buckets, 20);
    assert.equal(b15.label, "15 a 30 s");
    assert.equal(b15.count, 5);
    assert.equal(b15.median, 1.9);
    assert.equal(bucketOf(buckets, 500).label, "más de 90 s");
    assert.equal(bucketOf(buckets, 5).label, "menos de 15 s");
    assert.equal(durationBuckets([], "YT_LONG")[1]!.label, "4 a 8 min");
  });

  test("mejores piezas: 20 % de arriba, mínimo 3", () => {
    const pool = filterPool(history(), "REEL");
    assert.equal(topPieces(pool).length, 3);
    assert.equal(topPieces(pool)[0]!.perf, 2.6);
  });
});

describe("puntaje", () => {
  test("con pocas piezas no inventa un puntaje", () => {
    const r = computeScore(history().slice(0, 5), { hook: "Así llené mi agenda", hookType: "resultado", estimatedSeconds: 25, format: "REEL" });
    assert.equal(r.confidence, "sin-datos");
    assert.equal(r.hook.score, null);
    assert.equal(r.script.score, null);
    assert.equal(r.verdict, null);
    assert.deepEqual(r.suggestions, []);
  });

  test("un gancho de su mejor tipo y con la duración que le rinde puntúa alto", () => {
    const r = computeScore(history(), { hook: "Así llené mi agenda en 30 días con un guion", hookType: "resultado", estimatedSeconds: 24, format: "REEL" });
    assert.equal(r.confidence, "pocos");
    assert.equal(r.hook.typeRank, 1);
    assert.ok(r.hook.score! >= 80, `gancho ${r.hook.score}`);
    assert.ok(r.script.score! >= 80, `guion ${r.script.score}`);
    assert.equal(r.verdict, "arriba");
    assert.ok(r.hook.closeMatches >= 2);
    assert.equal(r.suggestions.length, 0);
    assert.deepEqual(r.script.bestRange, { from: 20, to: 24 });
  });

  test("un gancho de pregunta en un guion largo sugiere cambiar el tipo y recortar", () => {
    const r = computeScore(history(), { hook: "¿Sabes por qué nadie agenda contigo?", hookType: "pregunta", estimatedSeconds: 58, format: "REEL" });
    assert.ok(r.hook.score! < 50, `gancho ${r.hook.score}`);
    // ×0.85 y ×0.9 su mediana: un poco por debajo de lo normal, no un desastre.
    assert.equal(r.verdict, "parecido");
    assert.ok(r.script.score! < 50);
    assert.equal(r.suggestions.length, 2);
    assert.match(r.suggestions[0]!, /pregunta rinden ×0\.9; los de resultado rinden ×2\.1/);
    assert.match(r.suggestions[0]!, /«Pasé de 3 a 9 pacientes/);
    assert.match(r.suggestions[1]!, /dura ≈58 s.*15 a 30 s rinden ×1\.9.*45 a 60 s, ×0\.9.*Recorta unas 78 palabras/);
  });

  test("sin tipo de gancho claro lo dice y propone su mejor tipo", () => {
    const r = computeScore(history(), { hook: "Hola, hoy les cuento algo", hookType: "otro", estimatedSeconds: 22, format: "REEL" });
    assert.match(r.suggestions[0]!, /No se nota un tipo de gancho claro.*resultado rinden ×2\.1/);
  });

  test("un gancho larguísimo pide recortarlo", () => {
    const hook = "Hoy quiero contarte con mucho detalle todo lo que aprendí en estos años trabajando con clínicas pequeñas y medianas de la ciudad";
    const r = computeScore(history(), { hook, hookType: "resultado", estimatedSeconds: 24, format: "REEL" });
    assert.ok(r.suggestions.some((s) => /Tu gancho tiene 22 palabras/.test(s)));
  });

  test("los hechos para la IA solo llevan lo calculado", () => {
    const r = computeScore(history(), { hook: "¿Sabes por qué nadie agenda?", hookType: "pregunta", estimatedSeconds: 58, format: "REEL" });
    const facts = scoreFacts(r, "¿Sabes por qué nadie agenda?");
    assert.match(facts, /Piezas comparadas: 14 \(pocos datos\)/);
    assert.match(facts, /Su mejor tipo de gancho: Resultado \(×2\.1, 4 piezas\)/);
    assert.doesNotMatch(facts, /viral/i);
  });
});
