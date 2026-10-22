/**
 * Pruebas del director de edición sin base ni red: bloques movidos, armado y validación del plan del director, reglas
 * duras (no tapar lo importante, no cortar lo protegido), verificaciones y arreglos seguros, cuadros clave, tope de
 * costo con degradación, "qué cambió", "Edítalo así" (simulador) y mapa a partir de las medidas.
 *   pnpm test:director
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sentences } from "../lib/ai/prompts/editor";
import type { DirectorWire } from "../lib/ai/prompts/director";
import { costOf, imageTokens } from "../lib/ai/pricing";
import { detectCandidates } from "../lib/video/candidates";
import { directorZooms } from "../lib/video/effects";
import { planSchemaFor } from "../lib/video/plan";
import { bodySequence, buildTimeline, outputRange } from "../lib/video/timeline";
import type { EditPlan, Word } from "../lib/video/types";
import { applyVariant, planFromDirector, type DirectorInput } from "../lib/video/director/assemble";
import { checkPlan, safeFixes } from "../lib/video/director/checks";
import { clampBudget, eyesMaxFrames, planBudget } from "../lib/video/director/cost";
import { diffPlans } from "../lib/video/director/diff";
import { keyFrames } from "../lib/video/director/keyframes";
import { mapFromMeasures, mapFromWire, mustKeepRanges } from "../lib/video/director/map";
import { mapToWire, simulateCritic, simulateDirector } from "../lib/video/director/simulate";
import { effectiveBrief, EMPTY_BRIEF, type Eyes, type EyesSample, type EyesTramo } from "../lib/video/director/types";

/** Palabras con duración fija; "|" agrega una pausa de 0.6 s. */
function speak(text: string, wordSec = 0.3, gap = 0.05): Word[] {
  const words: Word[] = [];
  let t = 0.4;
  for (const token of text.split(" ")) {
    if (token === "|") {
      t += 0.6;
      continue;
    }
    words.push({ id: words.length, text: token, start: +t.toFixed(3), end: +(t + wordSec).toFixed(3) });
    t += wordSec + gap;
  }
  return words;
}

// Un anuncio como el de prueba: gancho, promesa, panel (producto en pantalla), toma mala, punto, retake, CTA.
const AD = [
  "¿Sabías que el ochenta por ciento de los anuncios pierde plata en tres segundos?",
  "|",
  "Hoy te muestro cómo lo arreglamos.",
  "|",
  "Mira, este es el panel: aquí ves cada anuncio con su costo.",
  "|",
  "Y esto, eh, esto no.",
  "|",
  "El panel te dice qué anuncio apagar.",
  "|",
  "Bajamos el costo de cuarenta a doce dólares.",
  "|",
  "Bajamos el costo de cuarenta a doce dólares.",
  "|",
  "Comenta PANEL y te mando el acceso gratis.",
].join(" ");
const words = speak(AD);
const duration = words.at(-1)!.end + 0.5;
const phrases = sentences(words);
const phrase = (i: number) => phrases[i]!;

/** Medidas como las del worker: cara en todo menos el panel (sin cara, con texto) y la toma mala (borrosa). */
function fakeEyes(): Eyes {
  const samples: EyesSample[] = [];
  const tramos: EyesTramo[] = [];
  const kinds = phrases.map((_, i) => (i === 2 ? "panel" : i === 3 ? "blur" : i === 7 ? "cta" : "talk"));
  phrases.forEach((f, i) => {
    const kind = kinds[i];
    const start = i === 0 ? 0 : (phrases[i - 1]!.end + f.start) / 2;
    const end = i === phrases.length - 1 ? duration : (f.end + phrases[i + 1]!.start) / 2;
    const n = samples.length + 1;
    const face = kind === "talk" || kind === "cta" ? { x: 0.3, y: 0.2, w: 0.4, h: 0.25, score: 0.9, frontal: true, yaw: 0 } : null;
    samples.push({ i: n, t: (start + end) / 2, scene: true, face, faces: face ? 1 : 0, sharp: kind === "blur" ? 2 : 500, luma: 0.4, clipped: 0, crushed: 0, backlit: false, shift: 0, text: kind === "panel" ? "PANEL FM ADS" : kind === "cta" ? "COMENTA PANEL" : "", textBand: kind === "panel" ? [0.18, 0.6] : kind === "cta" ? [0.73, 0.8] : null, energy: -20 });
    tramos.push({ id: `T${i + 1}`, start, end, sceneStart: i > 0, samples: [n], faceRatio: face ? 1 : 0, frontalRatio: face ? 1 : 0, face: face ? { x: 0.3, y: 0.2, w: 0.4, h: 0.25 } : null, sharp: kind === "blur" ? 2 : 500, blurry: kind === "blur", luma: 0.4, dark: false, bright: false, backlit: false, motion: 0, shaky: false, text: samples.at(-1)!.text, textBand: samples.at(-1)!.textBand, energy: -20 });
  });
  return { version: 1, duration, width: 1080, height: 1920, scenes: tramos.slice(1).map((t) => t.start), samples, tramos, sheets: [], layout: { tileW: 216, tileH: 384, cols: 6, rows: 3, labelH: 22 }, stats: { frames: samples.length, faceRatio: 0.75, frontalRatio: 1, sharpMedian: 500, scenes: 7, ocr: 8 }, notes: [] };
}

const eyes = fakeEyes();
const map = mapFromMeasures(eyes, words);

const emptyWire = (over: Partial<DirectorWire> = {}): DirectorWire => ({ summary: "", warning: "", pace: "normal", cuts: [], hooks: [], moves: [], emphasis_words: [], zooms: [], broll: [], caption_hide: [], variants: [], changes: [], ...over });
const input = (over: Partial<DirectorInput> = {}): DirectorInput => ({
  words,
  duration,
  format: "9:16",
  preset: "caja",
  corrections: {},
  offScript: [],
  candidates: detectCandidates(words),
  map,
  mustKeep: [],
  style: null,
  broll: { count: 4, minSeconds: 1.5, maxSeconds: 5, graphics: true, stock: true },
  base: null,
  ...over,
});
const graphicWire = { title: "x", mode: "full" as const, position: "top" as const, layers: [{ kind: "component" as const, component: "keyword", spec: '{"at":0,"scale":1,"place":"auto","props":{"text":"Panel","label":"","emphasis":"marker"}}' }] };

describe("mapa a partir de las medidas", () => {
  test("pantalla sin cara = importante; borrosa = toma mala; anuncio con CTA", () => {
    assert.equal(map.kind, "anuncio");
    const panel = map.shots.find((s) => s.important);
    assert.ok(panel, "el panel es importante");
    assert.equal(panel.from, phrase(2).from);
    assert.equal(map.badTakes.length, 1);
    assert.equal(map.badTakes[0]!.kind, "borroso");
    assert.equal(map.badTakes[0]!.from, phrase(3).from);
    assert.ok(map.beats.some((b) => b.role === "cta" && b.from === phrase(7).from));
    assert.ok(map.figures.some((f) => /cuarenta a doce/.test(f)));
    assert.equal(map.onScreenText.length, 2);
  });

  test("la respuesta de la IA en segundos se pasa a palabras y descarta ids inválidos", () => {
    const wire = mapToWire(map);
    wire.beats.push({ from_word: 900, to_word: 901, role: "punto", summary: "inventado" });
    const back = mapFromWire(wire, words, eyes);
    assert.equal(back.shots.find((s) => s.important)?.from, phrase(2).from);
    assert.ok(!back.beats.some((b) => b.from === 900));
    assert.equal(back.by, "ai");
  });

  test("lo que no se puede cortar se busca en las frases", () => {
    const r = mustKeepRanges("la parte del panel de costos", words);
    assert.ok(r.some((x) => x.from === phrase(2).from));
    assert.deepEqual(mustKeepRanges("nada", words), []);
  });

  test("brief efectivo: lo de la persona manda y lo vacío viene de la IA", () => {
    const b = effectiveBrief({ ...EMPTY_BRIEF, cta: "Escríbeme" }, { ...EMPTY_BRIEF, goal: "anuncio", cta: "Comenta" });
    assert.equal(b.cta, "Escríbeme");
    assert.equal(b.goal, "anuncio");
    assert.deepEqual(b.inferred, ["goal"]);
  });
});

describe("bloques movidos", () => {
  test("bodySequence inserta el bloque después de la palabra indicada", () => {
    assert.deepEqual(bodySequence(10, [{ from_word: 6, to_word: 8, after_word: 2, why: "" }]), [
      [0, 2],
      [6, 8],
      [3, 5],
      [9, 9],
    ]);
    assert.deepEqual(bodySequence(10, [{ from_word: 4, to_word: 5, after_word: -1, why: "" }]), [
      [4, 5],
      [0, 3],
      [6, 9],
    ]);
    // Inválidos: se ignoran.
    assert.deepEqual(bodySequence(10, [{ from_word: 4, to_word: 5, after_word: 4, why: "" }]), [[0, 9]]);
  });

  test("el timeline respeta el orden nuevo y la duración no cambia", () => {
    const plan = { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico" as const, emphasis_words: [] } };
    const a = buildTimeline(words, plan, duration);
    const b = buildTimeline(words, { ...plan, moves: [{ from_word: phrase(4).from, to_word: phrase(4).to, after_word: phrase(1).to, why: "" }] }, duration);
    assert.equal(b.words[0]!.id, 0);
    const i = b.words.findIndex((w) => w.id === phrase(4).from);
    assert.equal(b.words[i - 1]!.id, phrase(1).to, "el bloque va justo después de la frase 2");
    assert.ok(Math.abs(a.duration - b.duration) < 0.5);
  });
});

describe("plan del director", () => {
  test("arma un plan válido y respeta las reglas duras", () => {
    const panel = phrase(2);
    const cta = phrase(7);
    const out = planFromDirector(
      emptyWire({
        pace: "fast",
        cuts: [
          { from_word: phrase(3).from, to_word: phrase(3).to, reason: "bad_take", why: "Borrosa." },
          { from_word: cta.from, to_word: cta.to, reason: "off_topic", why: "No" },
        ],
        hooks: [{ from_word: 0, to_word: phrase(0).to, score: 0.9, why: "Pregunta con dato." }],
        broll: [
          { from_word: panel.from, to_word: panel.from + 5, kind: "graphic", query_en: "dashboard", keywords: [], graphic: graphicWire, why: "Tapa el panel" },
          { from_word: phrase(5).from, to_word: phrase(5).to, kind: "graphic", query_en: "chart", keywords: [], graphic: graphicWire, why: "Cifra" },
        ],
        zooms: [{ from_word: phrase(4).from, to_word: phrase(4).from + 2, strength: "marcado", why: "Énfasis" }],
      }),
      input({ protect: [{ from: cta.from, to: cta.to, label: "la llamada a la acción" }] }),
    );
    const plan = out.plan;
    assert.ok(planSchemaFor(words.length).safeParse(plan).success, "el plan pasa el esquema");
    assert.ok(plan.removals.some((r) => r.reason === "bad_take" && r.from_word === phrase(3).from), "corta la toma mala");
    assert.ok(!plan.removals.some((r) => r.from_word <= cta.to && r.to_word >= cta.from), "no corta la CTA protegida");
    assert.equal(plan.broll.length, 1, "descarta el b-roll que tapa el panel");
    assert.equal(plan.broll[0]!.from_word, phrase(5).from);
    assert.ok(out.dropped.some((d) => /tapar/.test(d)));
    assert.equal(plan.pacing?.long_pause, 0.3);
    assert.equal(plan.zoom_moments?.[0]?.scale, 1.15);
    assert.equal(plan.director?.pace, "fast");
    assert.equal(out.pending.length, 1);
  });

  test("lo que el brief pide que quede no se corta nunca", () => {
    const out = planFromDirector(emptyWire({ cuts: [{ from_word: phrase(2).from, to_word: phrase(2).to, reason: "off_topic", why: "" }] }), input({ mustKeep: [{ from: phrase(2).from, to: phrase(2).to }] }));
    assert.equal(out.plan.removals.length, 0);
  });

  test("una toma repetida dentro de lo protegido sí se corta", () => {
    const out = planFromDirector(emptyWire({ cuts: [{ from_word: phrase(5).from, to_word: phrase(5).to, reason: "retake", why: "Gana la última." }] }), input({ protect: [{ from: phrase(5).from, to: phrase(6).to, label: "la prueba" }] }));
    assert.equal(out.plan.removals.length, 1);
  });

  test("los bloques movidos tienen que ser frases completas", () => {
    const bad = planFromDirector(emptyWire({ moves: [{ from_word: phrase(4).from + 1, to_word: phrase(4).to, after_word: phrase(1).to, why: "" }] }), input());
    assert.equal(bad.plan.moves, undefined);
    const ok = planFromDirector(emptyWire({ moves: [{ from_word: phrase(4).from, to_word: phrase(4).to, after_word: phrase(1).to, why: "La prueba antes." }] }), input());
    assert.equal(ok.plan.moves?.length, 1);
  });

  test("versiones: una corta con cortes extra; usarla guarda la anterior", () => {
    const out = planFromDirector(emptyWire({ variants: [{ label: "Versión de 15 s", why: "Corta", hook_from_word: -1, hook_to_word: -1, extra_cuts: [{ from_word: phrase(1).from, to_word: phrase(1).to }, { from_word: phrase(4).from, to_word: phrase(4).to }], keep_broll: true }] }), input());
    assert.equal(out.variants.length, 1);
    const v = out.variants[0]!;
    assert.ok(v.duration < buildTimeline(words, out.plan, duration).duration);
    const { plan, previous } = applyVariant(out.plan, v, words, duration);
    assert.equal(previous.label, "Versión anterior");
    assert.ok(buildTimeline(words, plan, duration).duration < buildTimeline(words, out.plan, duration).duration);
  });
});

describe("verificaciones y arreglos seguros", () => {
  const base = (over: Partial<EditPlan> = {}): EditPlan => planFromDirector(emptyWire(), input()).plan && { ...planFromDirector(emptyWire(), input()).plan, ...over };

  test("encuentra la toma mala, el b-roll sobre el panel, subtítulos sobre texto y un final cortado", () => {
    const plan = base({
      broll: [{ id: "b1", from_word: phrase(2).from, to_word: phrase(2).from + 4, query_en: "", keywords: [], choice: { source: "pexels", id: "1", duration: 5, width: 1080, height: 1920, file: "https://videos.pexels.com/x.mp4" }, options: [] }],
      removals: [{ from_word: phrase(7).from + 3, to_word: phrase(7).to, reason: "off_topic", confidence: 1, source: "ai" }],
    });
    const issues = checkPlan({ plan, words, duration, map, eyes });
    const kinds = new Set(issues.map((i) => i.kind));
    assert.ok(kinds.has("tapa_importante"));
    assert.ok(kinds.has("toma_mala"));
    assert.ok(kinds.has("final_abrupto"));
    const fixed = safeFixes({ plan, words, duration, map, eyes, issues });
    assert.equal(fixed.plan.broll.length, 0);
    assert.ok(fixed.plan.removals.some((r) => r.reason === "bad_take"));
    const after = checkPlan({ plan: fixed.plan, words, duration, map, eyes });
    assert.ok(!after.some((i) => i.kind === "tapa_importante" || i.kind === "toma_mala" || i.kind === "final_abrupto"), JSON.stringify(after));
    assert.ok(fixed.changes.length >= 2);
  });

  test("subtítulos encima de un texto quemado en su franja → se ocultan", () => {
    // El texto de la CTA está en la franja de los subtítulos de "Caja" en un video horizontal (0.80 + 0.13).
    const e2 = fakeEyes();
    e2.tramos[7]!.textBand = [0.6, 0.7];
    const plan = base();
    const issues = checkPlan({ plan, words, duration, map, eyes: e2 });
    assert.ok(issues.some((i) => i.kind === "subtitulo_sobre_texto"));
    const fixed = safeFixes({ plan, words, duration, map, eyes: e2, issues });
    assert.ok(fixed.plan.captions.hide?.length);
    assert.ok(!checkPlan({ plan: fixed.plan, words, duration, map, eyes: e2 }).some((i) => i.kind === "subtitulo_sobre_texto"));
  });

  test("el crítico simulado confirma los problemas en el cuadro más cercano", () => {
    const plan = base();
    const frames = keyFrames({ plan, words, timeline: buildTimeline(words, plan, duration), eyes });
    const c = simulateCritic([{ kind: "salto", severity: "baja", at: frames[2]!.t, note: "", fix: "", by: "reglas" }], frames);
    assert.equal(c.issues[0]!.frame, 3);
    assert.ok(c.score < 96);
  });
});

describe("cuadros clave", () => {
  test("incluye el gancho, cada b-roll, los cortes y el final, con tope", () => {
    const out = planFromDirector(
      emptyWire({ hooks: [{ from_word: phrase(5).from, to_word: phrase(5).to, score: 1, why: "" }], cuts: [{ from_word: phrase(3).from, to_word: phrase(3).to, reason: "bad_take", why: "" }] }),
      input(),
    );
    const plan: EditPlan = { ...out.plan, broll: [{ id: "b1", from_word: phrase(4).from, to_word: phrase(4).to, query_en: "", keywords: [], choice: { source: "pexels", id: "1", duration: 5, width: 1080, height: 1920 }, options: [] }] };
    const tl = buildTimeline(words, plan, duration);
    const frames = keyFrames({ plan, words, timeline: tl, eyes });
    assert.ok(frames[0]!.label.startsWith("Gancho"));
    assert.ok(frames.some((f) => /B-roll B1/.test(f.label)));
    assert.ok(frames.some((f) => /corte/.test(f.label)));
    assert.ok(frames.at(-1)!.label.includes("Final"));
    assert.ok(frames.every((f, i) => i === 0 || f.t > frames[i - 1]!.t));
    assert.ok(keyFrames({ plan, words, timeline: tl, eyes, max: 5 }).length <= 5);
  });

  test("los zooms del director no caen encima de un b-roll", () => {
    const tl = buildTimeline(words, { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] } }, duration);
    const w = phrase(4);
    const r = outputRange(tl, w.from, w.to)!;
    const z = directorZooms(tl, [{ from_word: w.from, to_word: w.from + 2, scale: 1.15, why: "" }], [{ start: r.start - 0.1, end: r.end }]);
    assert.equal(z.length, 0);
    assert.equal(directorZooms(tl, [{ from_word: w.from, to_word: w.from + 2, scale: 1.15, why: "" }]).length, 1);
  });
});

describe("costo y tope", () => {
  test("precios y tokens de imagen", () => {
    assert.equal(costOf("claude-opus-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 4);
    assert.equal(costOf("claude-sonnet-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 10);
    assert.equal(imageTokens(1296, 1218), Math.ceil(1296 / 28) * Math.ceil(1218 / 28));
  });

  const sheet = { width: 1296, height: 1218 };
  test("con USD 5, un video de 1 minuto va completo (Opus, dos vueltas)", () => {
    const p = planBudget({ words: 160, sheets: 4, sheet, broll: 6, capUsd: 5, spentUsd: 0 });
    assert.deepEqual(p.degraded, []);
    assert.equal(p.critic?.rounds, 2);
    assert.equal(p.director.model, "deep");
    assert.ok(p.estimate.total < 5);
  });

  test("con poco tope se degrada en orden y la dirección siempre corre", () => {
    const p = planBudget({ words: 1500, sheets: 14, sheet, broll: 12, capUsd: 1, spentUsd: 0 });
    assert.ok(p.degraded.length > 0);
    assert.equal(p.degraded[0], "La revisión final la hace un modelo más económico.");
    assert.ok(p.director);
    const tiny = planBudget({ words: 1500, sheets: 14, sheet, broll: 12, capUsd: 0.05, spentUsd: 0 });
    assert.equal(tiny.critic, null);
    assert.equal(tiny.final, null);
    assert.equal(tiny.director.model, "main");
  });

  test("tope entre 1 y 15 y cuadros según el tope", () => {
    assert.equal(clampBudget(40), 15);
    assert.equal(clampBudget(0), 5);
    assert.equal(clampBudget(0.2), 1);
    assert.equal(eyesMaxFrames(5), 240);
    assert.equal(eyesMaxFrames(1), 90);
  });
});

describe("Edítalo así (simulador) y qué cambió", () => {
  const brief = { ...EMPTY_BRIEF, goal: "anuncio" as const };
  const sim = (instruction: string | null, base: EditPlan | null = null) =>
    simulateDirector({ words, duration, format: "9:16", candidates: detectCandidates(words), map, brief, broll: { count: 4, minSeconds: 1.5, maxSeconds: 5, graphics: true, stock: true }, mustKeep: [], preset: "caja", base, instruction });

  test("la primera dirección corta la toma mala y la repetida, y no tapa el panel ni la CTA", () => {
    const w = sim(null);
    const out = planFromDirector(w, input());
    assert.ok(out.plan.removals.some((r) => r.reason === "bad_take"));
    assert.ok(out.plan.removals.some((r) => r.reason === "retake"));
    assert.ok(!out.plan.broll.some((b) => b.from_word <= phrase(2).to && b.to_word >= phrase(2).from));
    assert.ok(!out.plan.broll.some((b) => b.to_word >= phrase(7).from));
    assert.deepEqual(checkPlan({ plan: out.plan, words, duration, map, eyes }).filter((i) => i.severity === "alta"), []);
  });

  test("\"no cortes la parte del precio\" protege la frase; \"versión de 15 s\" recorta", () => {
    const before = planFromDirector(sim(null), input()).plan;
    const w = sim("versión de 10 s", before);
    const after = planFromDirector(w, input({ base: before })).plan;
    assert.ok(buildTimeline(words, after, duration).duration < buildTimeline(words, before, duration).duration);
    const changes = diffPlans(before, after, words, duration);
    assert.ok(changes.some((c) => c.startsWith("El video pasó de")), changes.join(" | "));
    const keep = sim("no cortes la parte del panel");
    assert.ok(!keep.cuts.some((c) => c.from_word <= phrase(2).to && c.to_word >= phrase(2).from));
  });

  test("qué cambió: nada → lo dice", () => {
    const p = planFromDirector(sim(null), input()).plan;
    assert.deepEqual(diffPlans(p, p, words, duration), ["No hizo falta cambiar nada."]);
  });
});
