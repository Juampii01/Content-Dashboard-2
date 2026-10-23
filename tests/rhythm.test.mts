/**
 * Pruebas del ritmo y la sincronía con la voz, sin base ni red:
 * - cues por palabra: inferencia difusa (sin tildes, números en palabras, en orden) y resolución a segundos del video
 *   final con cortes, pausas recortadas y el gancho movido al principio;
 * - el motor usa los cues (cada ítem entra en su palabra) y no comprime lo sincronizado;
 * - puntaje de ritmo y relleno de ritmo (huecos, lo prohibido, sin repetir, apertura, muletillas).
 *   pnpm test:director
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brollSegments, directorZooms } from "../lib/video/effects";
import { compileScene } from "../lib/video/motion/compile";
import { approxMeasure } from "../lib/video/motion/validate";
import { sceneSchema, type MotionScene } from "../lib/video/motion/schema";
import { SAMPLE_THEMES } from "../lib/video/motion/theme";
import { walk, type Node } from "../lib/video/motion/nodes";
import { brollGraphicOption } from "../lib/video/motion-graphics";
import { cueToken, fillCueTimes, inferCueWords, tokenSimilarity, withCueWords } from "../lib/video/motion-cues";
import { DENSITY_TARGETS, clausesOf, densityFor, fillRhythm, planRhythm, rhythmScore, RHYTHM_TAG } from "../lib/video/rhythm";
import { buildTimeline } from "../lib/video/timeline";
import { planSchemaFor } from "../lib/video/plan";
import type { BrollItem, EditPlan, Word } from "../lib/video/types";

const THEME = SAMPLE_THEMES.maestria!.theme;

/** Palabras con duración fija; "|" agrega una pausa de 0,6 s. */
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


function basePlan(words: Word[], extra: Partial<EditPlan> = {}): EditPlan {
  return {
    version: 2,
    format: "9:16",
    segments: [],
    order: [],
    removals: [],
    proposed_removals: [],
    hook_candidates: [],
    selected_hook: null,
    captions: { preset: "caja", emphasis_words: [] },
    corrections: {},
    overlays: [],
    broll: [],
    audio: { music_asset_id: null, music_db: -16, target_lufs: -14, sfx: "subtle", studio: "soft" },
    framing: { mode: "center", offset_x: 0 },
    off_script: [],
    summary: "",
    warning: "",
    planned_by: "ai",
    ...extra,
  };
}

function listScene(items: string[], duration = 6): MotionScene {
  return sceneSchema.parse({ v: 2, duration, format: "9:16", mode: "full", position: "top", theme: THEME, layers: [{ type: "component", component: "list", props: { title: "", items } }] });
}

// La lista de FM ADS 2: tres errores dichos uno después del otro.
const FM = speak(
  "Si sos coach y no conseguís clientes calificados, | seguro estás creando contenido que no vende, | invirtiendo en anuncios que no traen resultados | y llenando tu agenda de gente que no compra. | Nosotros pasamos de dos a diez clientes por mes. | No es más contenido, es un sistema. | Entra a mi perfil y seguime.",
);
const idOf = (text: string, from = 0) => FM.findIndex((w, i) => i >= from && w.text.toLowerCase().startsWith(text));

describe("cues por palabra", () => {
  test("normaliza sin tildes y con números dichos en palabras", () => {
    assert.equal(cueToken("Conseguís,"), "conseguis");
    assert.equal(cueToken("diez"), "10");
    assert.equal(cueToken("40%"), "40");
    assert.ok(tokenSimilarity("anuncios", "anuncio") >= 0.75);
    assert.ok(tokenSimilarity("llena", "llenando") >= 0.75);
    assert.equal(tokenSimilarity("contenido", "agenda"), 0);
  });

  test("infiere en qué palabra se dice cada ítem (difuso y en orden)", () => {
    const spoken = FM.map((w) => ({ id: w.id, text: w.text }));
    const ids = inferCueWords(["Contenido que no vende", "Anuncios sin resultados", "Agenda llena de curiosos"], spoken);
    assert.equal(ids[0], idOf("contenido"));
    assert.equal(ids[1], idOf("anuncios"));
    // "Agenda llena" se dice como "llenando tu agenda": entra cuando empieza a decirlo.
    assert.equal(ids[2], idOf("llenando"));
    // Un ítem que no se dice queda sin palabra (no se inventa).
    assert.equal(inferCueWords(["Contenido", "Cohetes espaciales", "Agenda"], spoken)[1], -1);
    // Cifras dichas en palabras.
    const nums = inferCueWords(["2", "10"], spoken);
    assert.equal(nums[0], idOf("dos"));
    assert.equal(nums[1], idOf("diez"));
  });

  test("los segundos que no se saben se reparten entre los vecinos", () => {
    assert.deepEqual(fillCueTimes([1, null, 3], 6), [1, 2, 3]);
    const spread = fillCueTimes([null, null, null], 6)!;
    assert.ok(spread[0]! < spread[1]! && spread[1]! < spread[2]!);
    assert.equal(fillCueTimes([null], 4), null);
  });

  test("resuelve a segundos del video final con cortes y el gancho movido al principio", () => {
    const from = idOf("seguro");
    const to = idOf("compra.");
    // Corte de "| seguro estás" (2 palabras) y gancho = la frase de los clientes, que pasa al principio.
    const hookFrom = idOf("nosotros");
    const hookTo = idOf("mes.");
    const plan = basePlan(FM, {
      removals: [{ from_word: from, to_word: from + 1, reason: "filler", confidence: 1, source: "user" }],
      hook_candidates: [{ from_word: hookFrom, to_word: hookTo, score: 0.9, why: "" }],
      selected_hook: 0,
    });
    const tl = buildTimeline(FM, plan, 40);
    const scene = withCueWords(listScene(["Contenido que no vende", "Anuncios sin resultados", "Agenda llena"]), FM.slice(from, to + 1));
    const item: BrollItem = { id: "b1", from_word: from + 2, to_word: to, query_en: "", keywords: [], choice: brollGraphicOption(scene), options: [] };
    const [seg] = brollSegments(tl, [item]);
    assert.ok(seg);
    const g = seg.option.graphic as MotionScene;
    const layer = g.layers[0]!;
    assert.equal(layer.type, "component");
    const cues = layer.type === "component" ? layer.cues! : [];
    const at = (id: number) => tl.words.find((w) => w.id === id)!.start - seg.start;
    // Cada ítem en el segundo exacto en que se dice su primera palabra en el video final (± 1 ms).
    for (const [i, word] of (["contenido", "anuncios", "llenando"] as const).entries()) assert.ok(Math.abs(cues[i]! - at(idOf(word))) < 0.002, `${word}: ${cues[i]} vs ${at(idOf(word))}`);
    // El gancho movido quedó antes: el segmento empieza después de él.
    assert.ok(seg.start > tl.words.find((w) => w.id === hookTo)!.end);
    // El gráfico dura hasta que se dijo el último ítem (y un respiro para leerlo).
    assert.ok(seg.end - seg.start >= cues[2]! + 1.3);
  });

  test("el motor anima cada ítem en su segundo y no comprime lo sincronizado", () => {
    const cues = [0.5, 2.4, 4.6];
    const scene = sceneSchema.parse({ ...listScene(["Contenido que no vende", "Anuncios sin resultados", "Agenda llena"], 5.6), layers: [{ type: "component", component: "list", props: { items: ["Contenido que no vende", "Anuncios sin resultados", "Agenda llena"] }, cues }] });
    const compiled = compileScene(scene, { width: 1080, height: 1920, measure: approxMeasure });
    assert.equal(compiled.timeScale, 1);
    const starts: number[] = [];
    walk(compiled.nodes, (n: Node) => {
      if (n.label?.startsWith("el punto") && n.kind === "rect") starts.push(n.tracks.opacity?.[0]?.t ?? -1);
    });
    assert.equal(starts.length, 3);
    starts.forEach((s, i) => assert.ok(Math.abs(s - (cues[i]! - 0.12)) < 0.01, `ítem ${i + 1} entra en ${s}`));
  });
});

describe("puntaje de ritmo", () => {
  const words = speak(Array.from({ length: 60 }, (_, i) => (i % 8 === 7 ? "palabra." : "palabra")).join(" "));
  test("un video sin nada en pantalla tiene un hueco largo y puntaje bajo", () => {
    const tl = buildTimeline(words, basePlan(words), 30);
    const s = rhythmScore({ timeline: tl, broll: [], zooms: [], effects: [], density: "reels" });
    assert.equal(s.coverage, 0);
    assert.ok(s.longestGap.seconds > 15);
    assert.ok(s.score < 40);
    assert.ok(s.gaps.length >= 1);
  });
  test("zooms cada 2,5 s suben el puntaje y achican el hueco", () => {
    const tl = buildTimeline(words, basePlan(words), 30);
    const zooms = Array.from({ length: 8 }, (_, i) => ({ start: 1 + i * 2.6, end: 2.8 + i * 2.6, scale: i % 2 ? 1.3 : 1.15 }));
    const s = rhythmScore({ timeline: tl, broll: [], zooms, effects: [], density: "reels" });
    assert.ok(s.longestGap.seconds <= 3.5, String(s.longestGap.seconds));
    assert.ok(s.changesPer10 >= 5);
    assert.ok(s.coverage > 0.5);
  });
});

describe("relleno de ritmo", () => {
  const words = FM;
  const duration = words.at(-1)!.end + 0.5;

  test("rellena huecos con punch-ins alternados y gráficos sincronizados (Editor de reels)", () => {
    const plan = basePlan(words);
    const { plan: next, added } = fillRhythm(plan, { words, duration, density: "reels", format: "9:16", forbidden: [], theme: THEME, fxAllowed: [] });
    assert.ok(planSchemaFor(words.length).safeParse(next).success, JSON.stringify(planSchemaFor(words.length).safeParse(next).error?.issues?.[0]));
    const score = planRhythm(next, words, duration, "reels");
    assert.ok(score.longestGap.seconds <= DENSITY_TARGETS.reels.changeEvery + 1, `hueco de ${score.longestGap.seconds} s`);
    assert.ok(added.some((a) => a.kind === "zoom"));
    assert.ok(added.every((a) => a.why.startsWith(RHYTHM_TAG)));
    // Escalas alternadas: nunca dos zooms seguidos iguales.
    const z = next.zoom_moments ?? [];
    for (let i = 1; i < z.length; i++) assert.notEqual(z[i]!.scale, z[i - 1]!.scale);
    // Gráficos agregados: sincronizados (con palabras) y nunca dos iguales seguidos.
    const comps = next.broll.map((b) => ((b.choice?.graphic as MotionScene).layers[0] as { component: string }).component);
    for (let i = 1; i < comps.length; i++) assert.notEqual(comps[i], comps[i - 1]);
    for (const b of next.broll) assert.ok(((b.choice?.graphic as MotionScene).layers[0] as { cue_words?: number[] }).cue_words?.some((id) => id >= 0));
    // Pausas al mínimo.
    assert.equal(next.pacing?.long_pause, 0.3);
    // Palabras clave resaltadas.
    assert.ok(next.captions.emphasis_words.length >= 4);
  });

  test("no tapa lo prohibido", () => {
    const forbidden = [{ from: 0, to: words.length - 1, label: "el producto" }];
    const { plan: next } = fillRhythm(basePlan(words), { words, duration, density: "reels", format: "9:16", forbidden, theme: THEME, fxAllowed: ["cover_story"] });
    assert.equal(next.broll.length, 0);
    assert.equal((next.effects ?? []).length, 0);
  });

  test("abre con un efecto de firma y saca las muletillas del detector", () => {
    const { plan: next, added } = fillRhythm(basePlan(words), {
      words,
      duration,
      density: "reels",
      format: "9:16",
      forbidden: [],
      theme: THEME,
      fxAllowed: ["cover_story", "digital_zoom"],
      candidates: [{ kind: "filler", from_word: 5, to_word: 5, confidence: 0.7 }],
    });
    assert.equal(next.effects?.[0]?.kind, "cover_story");
    assert.equal(next.effects?.[0]?.from_word, 0);
    assert.ok(next.removals.some((r) => r.from_word === 5));
    assert.ok(added.some((a) => a.kind === "corte"));
  });

  test("Sobria casi no agrega nada y cambiar la densidad reemplaza lo agregado", () => {
    const reels = fillRhythm(basePlan(words), { words, duration, density: "reels", format: "9:16", forbidden: [], theme: THEME }).plan;
    const sober = fillRhythm(reels, { words, duration, density: "sobria", format: "9:16", forbidden: [], theme: THEME, replace: true }).plan;
    assert.equal(sober.broll.length, 0);
    assert.ok((sober.zoom_moments ?? []).length < (reels.zoom_moments ?? []).length);
    assert.equal(sober.rhythm?.density, "sobria");
  });

  test("densidad por formato", () => {
    assert.equal(densityFor("auto", "9:16"), "reels");
    assert.equal(densityFor("auto", "16:9"), "normal");
    assert.equal(densityFor("sobria", "9:16"), "sobria");
  });

  test("frases cortas del video final", () => {
    const tl = buildTimeline(words, basePlan(words), duration);
    const cl = clausesOf(tl.words, words);
    assert.ok(cl.length >= 7);
    assert.ok(cl.every((c) => c.end - c.start <= 3.6));
  });

  test("dos punch-ins seguidos con distinta escala van pegados (cambio de encuadre)", () => {
    const tl = buildTimeline(words, basePlan(words), duration);
    const zooms = directorZooms(tl, [
      { from_word: 0, to_word: 4, scale: 1.15, why: "" },
      { from_word: 5, to_word: 9, scale: 1.3, why: "" },
    ]);
    assert.equal(zooms.length, 2);
    assert.ok(zooms[1]!.start - zooms[0]!.end < 0.01);
  });
});
