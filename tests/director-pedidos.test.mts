/**
 * Pruebas de "Edítalo así" en partes (lib/video/director/request.ts y reference.ts), sin base ni red:
 * - el pedido se parte bien (también con links pegados);
 * - cada pedido típico se cumple de punta a punta con el simulador y la cadena determinista del servicio (armado,
 *   gráficos, ritmo, candados, ajustes y piso del pedido), y el cumplimiento dice qué se hizo y qué no;
 * - lo que antes se perdía (efecto que Mi marca no tenía, zooms que volvía a poner el ritmo, subtítulos, música…);
 * - la referencia: texto para el director, lo que se copia sin IA y el cable del worker;
 * - los esquemas que van a la API siguen chicos y los ajustes van y vuelven sin perderse.
 *   pnpm test:director
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { criticEditWireSchema, directorApiSchema, directorFromApi, directorToApi, type DirectorWire } from "../lib/ai/prompts/director";
import { detectCandidates } from "../lib/video/candidates";
import { planFromDirector } from "../lib/video/director/assemble";
import { planEdit } from "../lib/video/director/cost";
import { diffPlans } from "../lib/video/director/diff";
import { enforceLocks, parseLocks } from "../lib/video/director/locks";
import { mapFromMeasures } from "../lib/video/director/map";
import { protectedZones } from "../lib/video/director/protect";
import { referenceFromPayload, referencePayloadSchema, referenceSettings, referenceSummary, referenceText, type DirectorReference } from "../lib/video/director/reference";
import {
  applyRequest,
  checkCompliance,
  complianceSummary,
  findLinks,
  mergeCompliance,
  missingOf,
  parseRequest,
  planBaseline,
  requestOverrides,
  requestText,
  trimToSeconds,
  type ParsedRequest,
} from "../lib/video/director/request";
import { simulateDirector, simulateRequestCheck } from "../lib/video/director/simulate";
import { EMPTY_BRIEF } from "../lib/video/director/types";
import { fxLimits } from "../lib/video/fx/director";
import { brandGraphicLook } from "../lib/video/graphics";
import { resolveScenes } from "../lib/video/motion-build";
import { brollGraphicOption, motionTheme } from "../lib/video/motion-graphics";
import { planSchemaFor } from "../lib/video/plan";
import { DENSITY_TARGETS, fillRhythm, syncGraphics } from "../lib/video/rhythm";
import { styleMetricsSchema } from "../lib/video/style";
import { buildTimeline } from "../lib/video/timeline";
import type { EditPlan, Word } from "../lib/video/types";

function speak(text: string, wordSec = 0.32, gap = 0.05): Word[] {
  const words: Word[] = [];
  let t = 0.3;
  for (const token of text.split(" ")) {
    if (token === "|") {
      t += 0.7;
      continue;
    }
    words.push({ id: words.length, text: token, start: +t.toFixed(3), end: +(t + wordSec).toFixed(3) });
    t += wordSec + gap;
  }
  return words;
}

// Un video educativo de ~50 s: gancho con cifra, lista de errores, un dato de crecimiento, contraste y CTA.
const TEXT = [
  "¿Sabías que el noventa por ciento de los creadores pierde seguidores por esto?",
  "|",
  "Hoy te explico los tres errores que te frenan.",
  "|",
  "Eh, bueno, este, el primero.",
  "|",
  "Creando contenido que no vende, invirtiendo en anuncios sin estrategia y publicando sin constancia.",
  "|",
  "El primero es no tener un gancho claro en los primeros tres segundos.",
  "|",
  "La gente decide en ese momento si se queda o se va.",
  "|",
  "El segundo es hablar de ti y no de lo que necesita tu cliente.",
  "|",
  "Nadie quiere tu historia si no le resuelve algo.",
  "|",
  "El tercero es no pedir nada al final.",
  "|",
  "Pasamos de doscientos a cinco mil seguidores en tres meses así.",
  "|",
  "No es suerte, es método.",
  "|",
  "Y lo mejor es que cualquiera lo puede aplicar desde hoy mismo en su cuenta.",
  "|",
  "Comenta MÉTODO y te mando la guía gratis.",
].join(" ");
const words = speak(TEXT);
const duration = words.at(-1)!.end + 0.5;
const map = mapFromMeasures(null, words);
const brief = { ...EMPTY_BRIEF, goal: "educar" as const };
const look = brandGraphicLook(null);
const candidates = detectCandidates(words);
const density = "reels" as const;
const target = DENSITY_TARGETS[density];
// Mi marca: sin la portada de revista entre los permitidos (así se ve que el pedido manda).
const myFx = fxLimits({ allowed: ["digital_zoom", "checklist", "chart_grow", "glass_type"], frequency: "normal" }, duration * 0.85);
const baseFx = { ...myFx, max: Math.max(1, Math.round(myFx.max * target.fxFactor)), minGap: Math.max(2, myFx.minGap / target.fxFactor) };
const baseLimits = { count: Math.max(1, Math.floor((duration * 0.85) / target.brollEvery)), minSeconds: 1.5, maxSeconds: 6, graphics: true, stock: true };

/** La cadena determinista de `direct()` con el simulador en lugar de Claude (lo mismo que corre con AI_FAKE=1). */
async function pipeline(instruction: string | null, base: EditPlan | null, opts: { musicTrack?: string | null } = {}) {
  const parsed: ParsedRequest | null = instruction ? parseRequest(instruction) : null;
  const o = requestOverrides(parsed);
  const limits = { ...baseLimits, count: o.noBroll && o.noGraphics ? 0 : baseLimits.count + o.brollExtra, graphics: !o.noGraphics, stock: !o.noBroll };
  const asked = o.fx.map((f) => f.kind);
  const fx = o.noFx ? { ...baseFx, allowed: [], max: 0 } : asked.length ? { ...baseFx, allowed: [...new Set([...baseFx.allowed, ...asked])], max: baseFx.max + asked.length, minGap: Math.min(baseFx.minGap, 3) } : baseFx;
  const locks = instruction ? { ...parseLocks(instruction), parsed } : null;
  const w = simulateDirector({ words, duration, format: "9:16", candidates, map, brief, broll: limits, mustKeep: [], preset: "caja", base, issues: [], instruction, fx, request: parsed });
  const out = planFromDirector(w, { words, duration, format: "9:16", preset: "caja", corrections: {}, offScript: [], candidates, map, mustKeep: [], protect: [], style: null, broll: limits, base, fx: { limits: fx, faceWords: null, keepUser: !o.noFx }, density: o.density ?? density });
  let plan = out.plan;
  const graphics = out.pending.filter((p) => p.scene);
  const outcomes = await resolveScenes(graphics.map((p) => ({ ai: p.scene, spoken: p.spoken, look, format: "9:16" as const, duration: 3 })), { retries: 0, retry: null });
  outcomes.forEach((oc, i) => {
    if (oc.scene) {
      const option = brollGraphicOption(oc.scene);
      graphics[i]!.item.choice = option;
      graphics[i]!.item.options = [option];
    }
  });
  for (const p of out.pending) {
    const item = plan.broll.find((b) => b.id === p.item.id);
    if (item && !item.choice) item.choice = { source: "pexels", id: "1", duration: 8, width: 1080, height: 1920 };
  }
  plan = { ...plan, broll: plan.broll.filter((b) => b.choice) };
  const zones = protectedZones(map, words);
  plan = syncGraphics(plan, words, zones.zones);
  plan = fillRhythm(plan, { words, duration, density: o.density ?? density, format: "9:16", forbidden: zones.zones, theme: motionTheme(look), fxAllowed: fx.max > 0 ? fx.allowed : [], faceWords: null, candidates, mustKeep: [] }).plan;
  plan = enforceLocks(plan, base, locks, zones.zones).plan;
  const applied = applyRequest(plan, parsed, { ai: w.settings ?? null, reference: null, words, duration, forbidden: zones.zones, mustKeep: [], faceWords: null, candidates, musicTrack: opts.musicTrack ?? null, base });
  plan = applied.plan;
  const compliance = parsed && base ? checkCompliance(parsed, { before: planBaseline(base, words, duration), after: plan, words, duration, answers: w.answers, failed: applied.failed }) : [];
  return { plan, parsed, compliance, wire: w, applied };
}

const first = (await pipeline(null, null)).plan;
const at = (plan: EditPlan, id: number) => buildTimeline(words, plan, duration).words.find((w) => w.id === id)?.start ?? -1;

describe("el pedido en partes", () => {
  test("cada cosa que pide es una parte, con su tipo", () => {
    const p = parseRequest("Más gráficos en la segunda mitad, quita todos los zooms y que los subtítulos sean más grandes y arriba");
    assert.deepEqual(
      p.items.map((i) => i.kind),
      ["graficos_mas", "zooms_fuera", "subtitulos_tamano", "subtitulos_posicion"],
    );
    assert.equal(p.items[0]!.region, "segunda_mitad");
    assert.equal(p.items[3]!.position, "arriba");
    assert.deepEqual(p.items.map((i) => i.n), [1, 2, 3, 4]);
  });

  test("pedidos típicos", () => {
    const kind = (t: string) => parseRequest(t).items.map((i) => i.kind);
    assert.deepEqual(kind("más dinámico"), ["ritmo"]);
    assert.deepEqual(kind("versión de 30 s"), ["duracion"]);
    assert.equal(parseRequest("versión de 30 s").items[0]!.seconds, 30);
    assert.deepEqual(kind("corta todo lo que sobra"), ["recortar"]);
    assert.deepEqual(kind("pon un efecto de portada al principio"), ["efecto"]);
    assert.equal(parseRequest("pon un efecto de portada al principio").items[0]!.where, "start");
    assert.deepEqual(kind("quita todos los zooms"), ["zooms_fuera"]);
    assert.deepEqual(kind("ponle un zoom digital en la cifra"), ["efecto"], "el zoom digital es un efecto, no un zoom de cámara");
    assert.deepEqual(kind("sin música"), ["musica"]);
    assert.equal(parseRequest("sin música").items[0]!.on, false);
    assert.deepEqual(kind("pásalo a horizontal para YouTube"), ["formato"]);
    assert.deepEqual(kind("que se sienta más premium"), ["otro"]);
    assert.deepEqual(kind("no cortes la parte del precio"), ["conservar"]);
  });

  test("links pegados en el texto: solo Instagram, TikTok o YouTube, sin la puntuación del final", () => {
    assert.deepEqual(findLinks("como este video: https://www.instagram.com/reel/abc123/."), ["https://www.instagram.com/reel/abc123/"]);
    assert.deepEqual(findLinks("mira https://youtu.be/xyz, y https://ejemplo.com/video"), ["https://youtu.be/xyz"]);
    const p = parseRequest("edítalo como este video: https://www.tiktok.com/@a/video/1");
    assert.deepEqual(p.links, ["https://www.tiktok.com/@a/video/1"]);
    assert.deepEqual(p.items.map((i) => i.kind), ["referencia"]);
  });

  test("el pedido manda sobre los topes: b-roll de más, efecto aunque Mi marca no lo tenga, densidad", () => {
    const o = requestOverrides(parseRequest("más gráficos, pon la portada de revista al principio y modo editor de reels"));
    assert.ok(o.brollExtra > 0);
    assert.deepEqual(o.fx, [{ kind: "cover_story", where: "start" }]);
    assert.equal(o.density, "reels");
    const text = requestText(parseRequest("quita todos los zooms"), { limits: "TOPES…", focus: ["Parte 1: quedan 2 zooms."] });
    assert.ok(text.includes("EL PEDIDO MANDA SOBRE LOS TOPES"));
    assert.ok(text.includes("EN LA VUELTA ANTERIOR NO SE CUMPLIÓ"));
  });
});

describe("pedidos típicos de punta a punta (simulador + cadena del servicio)", () => {
  test("«más dinámico»: pausas al mínimo", async () => {
    const r = await pipeline("más dinámico", first);
    assert.ok((r.plan.pacing?.long_pause ?? 1) <= 0.3);
    assert.equal(r.compliance[0]!.status, "hecho");
  });

  test("«más gráficos en la segunda mitad»: hay más ahí y no se pierden los de la primera", async () => {
    const r = await pipeline("más gráficos en la segunda mitad", first);
    const tl = buildTimeline(words, r.plan, duration);
    const half = tl.duration / 2;
    const second = (p: EditPlan) => [...p.broll, ...(p.effects ?? [])].filter((b) => at(p, b.from_word) >= half).length;
    assert.ok(second(r.plan) > second(first), `${second(first)} → ${second(r.plan)}`);
    const firstHalf = (p: EditPlan) => [...p.broll, ...(p.effects ?? [])].filter((b) => at(p, b.from_word) >= 0 && at(p, b.from_word) < half).length;
    assert.ok(firstHalf(r.plan) >= firstHalf(first) - 1, `la primera mitad no se vacía: ${firstHalf(first)} → ${firstHalf(r.plan)}`);
    assert.notEqual(r.compliance[0]!.status, "no");
  });

  test("«versión de 30 s»: queda cerca de 30 s", async () => {
    const r = await pipeline("versión de 30 s", first);
    const d = buildTimeline(words, r.plan, duration).duration;
    assert.ok(d <= 34, `quedó en ${d}`);
    assert.equal(r.compliance[0]!.status, "hecho");
    assert.ok(planSchemaFor(words.length).safeParse(r.plan).success);
  });

  test("piso de duración sin IA: saca frases enteras del medio, nunca la primera ni la última", () => {
    const t = trimToSeconds(first, words, duration, 25, []);
    assert.ok(t.cut > 0);
    const tl = buildTimeline(words, t.plan, duration);
    assert.ok(tl.duration <= 25 * 1.1 + 4, `quedó en ${tl.duration}`);
    assert.ok(tl.words.some((w) => w.id === words.length - 1), "la CTA queda");
  });

  test("«pon un efecto de portada al principio»: entra aunque Mi marca no la tenga", async () => {
    const r = await pipeline("pon un efecto de portada al principio", first);
    const cover = (r.plan.effects ?? []).find((e) => e.kind === "cover_story");
    assert.ok(cover, "hay portada");
    assert.ok(at(r.plan, cover.from_word) <= 3, "al principio");
    assert.equal(r.compliance[0]!.status, "hecho");
    assert.ok(diffPlans(first, r.plan, words, duration).some((c) => c.includes("Portada de revista")));
  });

  test("«que los subtítulos sean más grandes»: más grandes y lo dice", async () => {
    const r = await pipeline("que los subtítulos sean más grandes", first);
    assert.ok((r.plan.captions.transform?.scale ?? 1) > 1.2);
    assert.equal(r.compliance[0]!.status, "hecho");
    assert.ok(diffPlans(first, r.plan, words, duration).some((c) => c.startsWith("Subtítulos más grandes")));
  });

  test("subtítulos clásicos: pasan a Caja para poder agrandarlos y se explica", () => {
    const plan = { ...first, captions: { ...first.captions, preset: "clasico" as const } };
    const r = applyRequest(plan, parseRequest("subtítulos más grandes"), { ai: null, reference: null, words, duration, forbidden: [], mustKeep: [], faceWords: null, candidates: [], musicTrack: null });
    assert.equal(r.plan.captions.preset, "caja");
    assert.ok(r.notes.some((n) => n.includes("Caja")));
  });

  test("«quita todos los zooms»: el ritmo no los vuelve a poner", async () => {
    assert.ok((first.zoom_moments?.length ?? 0) > 0, "la base tiene zooms");
    const r = await pipeline("quita todos los zooms", first);
    assert.equal(r.plan.zoom_moments?.length ?? 0, 0);
    assert.equal(r.compliance[0]!.status, "hecho");
    // Y un arreglo posterior (candados) tampoco.
    const locks = { ...parseLocks("quita todos los zooms"), parsed: r.parsed };
    assert.equal(enforceLocks({ ...r.plan, zoom_moments: [{ from_word: 3, to_word: 4, scale: 1.2, why: "Ritmo: x" }] }, r.plan, locks).plan.zoom_moments, undefined);
  });

  test("«corta todo lo que sobra»: si no queda nada que cortar, lo dice", async () => {
    const r = await pipeline("corta todo lo que sobra", first);
    const c = r.compliance[0]!;
    assert.ok(c.status === "hecho" || (c.status === "no" && c.detail.length > 10), `${c.status}: ${c.detail}`);
  });

  test("«ponle música»: sin pistas en la biblioteca lo dice; con una, la pone", async () => {
    const none = await pipeline("ponle música y efectos de sonido marcados", first);
    assert.equal(none.compliance[0]!.status, "no");
    assert.ok(none.compliance[0]!.detail.includes("Biblioteca"));
    assert.equal(none.compliance[1]!.status, "hecho");
    assert.equal(none.plan.audio.sfx, "strong");
    const withTrack = await pipeline("ponle música", first, { musicTrack: "00000000-0000-4000-8000-000000000001" });
    assert.equal(withTrack.plan.audio.music_asset_id, "00000000-0000-4000-8000-000000000001");
    assert.equal(withTrack.compliance[0]!.status, "hecho");
  });

  test("«pásalo a horizontal»: cambia el formato y el plan sigue válido", async () => {
    const r = await pipeline("pásalo a horizontal", first);
    assert.equal(r.plan.format, "16:9");
    assert.ok(planSchemaFor(words.length).safeParse(r.plan).success);
  });

  test("varias cosas a la vez: cada parte con su estado y un resumen", async () => {
    const r = await pipeline("quita todos los zooms, subtítulos más grandes y algo que se sienta más premium", first);
    assert.equal(r.compliance.length, 3);
    assert.deepEqual(r.compliance.slice(0, 2).map((c) => c.status), ["hecho", "hecho"]);
    assert.equal(r.compliance[2]!.by, "ai", "lo que no se mide lo responde el director");
    assert.match(complianceSummary(r.compliance), /de 3|las 3/);
  });

  test("«como este video» sin referencia: no se inventa, se dice", async () => {
    const r = await pipeline("como este video: https://www.instagram.com/reel/abc123/", first);
    assert.equal(r.compliance[0]!.status, "no");
  });
});

describe("cumplimiento y otra vuelta", () => {
  test("lo que no se cumplió y se puede arreglar va a la siguiente vuelta; lo imposible no", () => {
    const parsed = parseRequest("quita todos los zooms, ponle música");
    const items = checkCompliance(parsed, { before: planBaseline(first, words, duration), after: first, words, duration, failed: ["No tienes música lista en la biblioteca: sube una pista en Biblioteca → Música y vuelve a pedirlo."] });
    assert.equal(items[0]!.status, "no");
    assert.ok(items[0]!.fixable);
    assert.equal(items[1]!.fixable, false);
    assert.equal(missingOf(items).length, 1);
    assert.ok(missingOf(items)[0]!.startsWith("Parte 1"));
  });

  test("si el director dice por qué no se pudo, ese porqué es el que ve la persona", () => {
    const parsed = parseRequest("versión de 10 s");
    const items = checkCompliance(parsed, { before: planBaseline(first, words, duration), after: first, words, duration, answers: [{ item: 1, status: "no", note: "Con 10 s se pierde la explicación de los tres errores." }] });
    assert.equal(items[0]!.detail, "Con 10 s se pierde la explicación de los tres errores.");
    assert.equal(items[0]!.fixable, false);
  });

  test("el crítico con los cuadros puede bajar un «hecho» que no se nota, y confirmar lo que no se mide", () => {
    const parsed = parseRequest("subtítulos más grandes, que se sienta más premium");
    const after = { ...first, captions: { ...first.captions, transform: { x: 0, y: 0, scale: 1.02 } } };
    const rules = checkCompliance(parsed, { before: planBaseline(first, words, duration), after, words, duration });
    assert.equal(rules[0]!.status, "hecho");
    assert.equal(rules[1]!.status, "revisar");
    const merged = mergeCompliance(rules, [
      { item: 1, status: "parcial", note: "En los cuadros casi no se nota: agrándalos más." },
      { item: 2, status: "hecho", note: "Colores sobrios y gráficos limpios." },
    ]);
    assert.equal(merged[0]!.status, "parcial");
    assert.ok(merged[0]!.fixable);
    assert.equal(merged[1]!.status, "hecho");
    assert.deepEqual(simulateRequestCheck(parsed, rules).map((a) => a.status), ["hecho", "hecho"]);
  });
});

describe("referencia de edición", () => {
  const metrics = styleMetricsSchema.parse({
    version: 1,
    duration: 24,
    analyzedSeconds: 24,
    width: 1080,
    height: 1920,
    aspect: "9:16",
    cuts: { count: 12, perMinute: 30, avgShot: 2, medianShot: 2, times: [2, 4, 6] },
    zooms: { punchIns: 4, smooth: 1, perMinute: 12.5, avgScale: 1.18, events: [] },
    faces: { detected: true, ratio: 0.7 },
    broll: { reliable: true, ratio: 0.3, perMinute: 7.5, avgDuration: 1.8, shots: [] },
    captions: { detected: true, position: 0.3, size: 0.06, uppercase: true, wordsPerBlock: 2, textColor: "#FFFFFF", highlightColor: "#FFD84D", box: false, boxColor: null, outline: true, samples: 30 },
    speech: { detected: true, words: 70, wps: 3.2, hookSeconds: 2.5, pauseMedian: 0.1, pauseP90: 0.25, longPausesPerMinute: 0 },
    audio: { lufs: -12, music: true, musicDb: -20 },
  });
  const ref: DirectorReference = { id: "rabc123", source: { kind: "link", url: "https://www.instagram.com/reel/abc/" }, status: "ready", metrics, moments: [{ t: 0.4, frame: 1, cut: false, face: true, text: "3 ERRORES", said: "tres errores que" }], transcript: "tres errores que te frenan", sheets: [], at: "" };

  test("el director la lee: medidas, momento a momento y que imite la edición, no el contenido", () => {
    const text = referenceText(ref);
    assert.ok(text.includes("NUNCA su contenido"));
    assert.ok(text.includes("30,0 por minuto"));
    assert.ok(text.includes("R#1"));
    assert.ok(text.includes("CÓMO IMITARLA"));
    assert.match(referenceSummary(metrics), /30 cortes por minuto/);
  });

  test("lo que se copia sin IA: densidad, ritmo y subtítulos (estilo, lugar y tamaño)", () => {
    const r = referenceSettings(metrics, "9:16", "caja");
    assert.equal(r.density, "reels");
    assert.equal(r.pace, "fast");
    assert.equal(r.settings.captions?.position, "arriba");
    assert.equal(r.settings.captions?.preset, "palabra");
    assert.ok((r.settings.captions?.scale ?? 0) > 0.6);
    // Aplicado al plan: los subtítulos quedan en la parte de arriba.
    const out = applyRequest(first, parseRequest("como este video"), { ai: null, reference: r.settings, words, duration, forbidden: [], mustKeep: [], faceWords: null, candidates: [], musicTrack: null });
    assert.equal(out.plan.captions.preset, "palabra");
    assert.ok((out.plan.captions.transform?.y ?? 0) < -0.2);
  });

  test("el cable del worker: lo que no se pudo bajar queda como error claro", () => {
    const failed = referencePayloadSchema.parse({ id: "rabc123", ok: false, error: "No pudimos bajar ese link. Descarga el video y súbelo." });
    const saved = referenceFromPayload({ ...ref, status: "pending" }, failed);
    assert.equal(saved.status, "failed");
    assert.ok(saved.error?.includes("súbelo"));
    const ok = referenceFromPayload({ ...ref, status: "pending" }, referencePayloadSchema.parse({ id: "rabc123", ok: true, metrics, moments: ref.moments, transcript: "hola", sheets: [{ key: "editor/x/referencia/hoja-01.jpg", width: 1296, height: 1218, frames: [1, 2] }] }));
    assert.equal(ok.status, "ready");
    assert.equal(ok.metrics?.cuts.perMinute, 30);
    const parsed = parseRequest("como esta referencia");
    const items = checkCompliance(parsed, { before: planBaseline(first, words, duration), after: first, words, duration, reference: { ok: false, error: saved.error } });
    assert.equal(items[0]!.status, "no");
    assert.ok(items[0]!.detail.includes("súbelo"));
  });
});

describe("costo de un pedido y formato que va a la API", () => {
  test("Opus con el máximo razonamiento si alcanza; baja solo si no", () => {
    const input = { words: 160, sheets: 4, sheet: { width: 1296, height: 1218 }, broll: 8 };
    const rich = planEdit({ ...input, remaining: 4 });
    assert.deepEqual(rich.director, { model: "deep", effort: "xhigh" });
    assert.ok(rich.critic);
    assert.ok(rich.extraRounds >= 1);
    assert.equal(rich.degraded.length, 0);
    const poor = planEdit({ ...input, remaining: 0.15 });
    assert.notEqual(poor.director.effort, "xhigh");
    assert.ok(poor.degraded.length > 0);
    const withRef = planEdit({ ...input, refSheets: 2, remaining: 4 });
    assert.ok(withRef.estimate.first > rich.estimate.first, "la referencia cuesta más (imágenes)");
  });

  test("los esquemas siguen chicos", () => {
    for (const [name, sch] of [["director", directorApiSchema], ["crítico de pedidos", criticEditWireSchema]] as const) {
      const size = JSON.stringify(zodOutputFormat(sch as never).schema).length;
      assert.ok(size < 3500, `${name}: ${size} caracteres`);
    }
  });

  test("los ajustes y las respuestas van y vuelven sin perderse", () => {
    const wire: DirectorWire = {
      summary: "s",
      warning: "",
      pace: "fast",
      cuts: [],
      hooks: [],
      moves: [],
      emphasis_words: [],
      zooms: [],
      broll: [],
      caption_hide: [],
      effects: [],
      variants: [],
      changes: [],
      settings: { captions: { scale: 1.3, position: "arriba", preset: "hormozi" }, audio: { music: true, louder: true, sfx: "strong", studio: "soft" }, density: "reels", zooms: "off", look: [{ target: "graficos", from: 3, to: 9, size: 1.2, animIn: "pop" }] },
      answers: [{ item: 1, status: "hecho", note: "Listo." }],
    };
    const back = directorFromApi(directorToApi(wire));
    assert.deepEqual(back.settings, wire.settings);
    assert.deepEqual(back.answers, wire.answers);
  });
});
