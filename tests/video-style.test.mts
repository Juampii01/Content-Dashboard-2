/**
 * Pruebas de "Edita como este" y del b-roll sin base ni red: preset desde lo medido, subtítulos del estilo,
 * pausas, zooms, tramos de b-roll, créditos, lectura de Pexels y búsqueda en la biblioteca.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { libraryScore, mapPexelsVideo, mapPixabayVideo, type PexelsVideo, type PixabayVideo } from "../lib/video/broll-options";
import { blockText, captionBlocks, hideDuring } from "../lib/video/captions";
import { brollCredits, brollSegments, computeZooms, cutTimes } from "../lib/video/effects";
import { planSchemaFor } from "../lib/video/plan";
import { describeMetrics, describePreset, presetFromMetrics, stylePresetSchema, styleMetricsSchema, type StyleMetrics } from "../lib/video/style";
import { brollTask } from "../lib/ai/prompts/editor";
import { buildTimeline, outputRange } from "../lib/video/timeline";
import type { BrollItem, EditPlan, TimedWord, Word } from "../lib/video/types";

/** Lo que mide el worker en la referencia sintética (worker/scripts/make_style_reference.py). */
const metrics: StyleMetrics = styleMetricsSchema.parse({
  version: 1,
  duration: 16,
  analyzedSeconds: 16,
  width: 1080,
  height: 1920,
  aspect: "9:16",
  cuts: { count: 7, perMinute: 26.2, avgShot: 2, medianShot: 2, times: [2, 4, 6, 8, 10, 12, 14] },
  zooms: { punchIns: 1, smooth: 1, perMinute: 7.5, avgScale: 1.224, events: [] },
  faces: { detected: true, ratio: 0.625, center: { x: 0.45, y: 0.27 }, size: 0.1 },
  broll: { ratio: 0.375, perMinute: 11.2, avgDuration: 2, shots: [], reliable: true },
  captions: { detected: true, position: 0.78, size: 0.0336, uppercase: true, wordsPerBlock: 3, textColor: "#F8E20A", highlightColor: null, box: false, boxColor: null, outline: true, samples: 13 },
  speech: { detected: true, words: 34, wps: 2.34, hookSeconds: 3.02, firstWordAt: 0.35, pauseMedian: 0.034, pauseP90: 0.474, longPausesPerMinute: 4, maxPause: 0.61 },
  audio: { lufs: -22.8, music: true, musicDb: -11.9 },
});

function speak(text: string, wordSec = 0.3, gap = 0.05): Word[] {
  const words: Word[] = [];
  let t = 0.5;
  for (const token of text.split(" ")) {
    if (token === "|") { t += 0.6; continue; }
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

describe("preset de estilo", () => {
  test("del estilo medido al preset: ritmo alto, zooms, subtítulos amarillos y b-roll", () => {
    const p = presetFromMetrics(metrics);
    assert.equal(stylePresetSchema.safeParse(p).success, true);
    assert.equal(p.pacing.aggressiveness, "alta");
    assert.ok(p.pacing.longPause >= 0.5 && p.pacing.longPause <= 0.7, `pausa ${p.pacing.longPause}`);
    assert.equal(p.hook.targetSeconds, 3);
    assert.equal(p.zoom.enabled, true);
    assert.equal(p.zoom.everySeconds, 8);
    assert.equal(p.zoom.mode, "mixed");
    assert.ok(p.zoom.scale > 1.15 && p.zoom.scale <= 1.25);
    assert.deepEqual(p.captions && { color: p.captions.textColor, pos: p.captions.position, upper: p.captions.uppercase, words: p.captions.wordsPerBlock }, { color: "#F8E20A", pos: 0.78, upper: true, words: 3 });
    assert.equal(p.broll.enabled, true);
    assert.equal(p.broll.everySeconds, 5.4);
    assert.equal(p.broll.durationSeconds, 2);
    assert.equal(p.audio.targetLufs, -16);
    assert.ok(describePreset(p).includes("Subtítulos copiados"));
  });

  test("sin subtítulos, sin habla y sin cara: valores sensatos y avisos claros", () => {
    const m = styleMetricsSchema.parse({
      ...metrics,
      cuts: { count: 1, perMinute: 2, avgShot: 30, medianShot: 30 },
      zooms: { punchIns: 0, smooth: 0, perMinute: 0, avgScale: 1 },
      faces: { detected: false, ratio: 0 },
      broll: { ratio: 0, perMinute: 0, avgDuration: 0, reliable: false },
      captions: { detected: false },
      speech: { detected: false, words: 0 },
      audio: { lufs: null, music: false, musicDb: null },
    });
    const p = presetFromMetrics(m);
    assert.equal(p.captions, null);
    assert.equal(p.zoom.enabled, false);
    assert.equal(p.broll.enabled, false);
    assert.equal(p.pacing.aggressiveness, "suave");
    assert.equal(p.audio.targetLufs, -14);
    const facts = describeMetrics(m);
    assert.match(facts.captions[0]!.value, /no encontramos subtítulos/);
    assert.match(facts.visual[1]!.value, /no se pudo medir/);
  });

  test("métricas con valores imposibles no pasan", () => {
    assert.equal(styleMetricsSchema.safeParse({ ...metrics, captions: { ...metrics.captions, textColor: "amarillo" } }).success, false);
    assert.equal(styleMetricsSchema.safeParse({ ...metrics, version: 2 }).success, false);
  });
});

describe("subtítulos del estilo", () => {
  const timed = (texts: string[]): TimedWord[] => texts.map((text, i) => ({ id: i, text, start: i * 0.3, end: i * 0.3 + 0.25, emphasis: false, stop: false }));

  test("palabras por bloque y mayúsculas del estilo", () => {
    const words = timed("una dos tres cuatro cinco seis siete".split(" "));
    const two = captionBlocks(words, "estilo", { wordsPerBlock: 2 });
    assert.deepEqual(two.map((b) => b.words.length), [2, 2, 2, 1]);
    const four = captionBlocks(words, "estilo", { wordsPerBlock: 4 });
    assert.equal(four[0]!.words.length, 4);
    assert.equal(blockText(two[0]!, "estilo", { uppercase: true }), "UNA DOS");
    assert.equal(blockText(two[0]!, "estilo", { uppercase: false }), "una dos");
  });
});

describe("pausas, zooms y b-roll sobre el timeline", () => {
  const words = speak("Hoy te cuento algo. | Contestan el teléfono y dan el precio. | Esto es lo que funciona de verdad. | Comenta LLAMADA y te lo mando.");

  test("la tolerancia de silencios del estilo cambia dónde se corta", () => {
    // Pausas de 0,4 s entre palabras: sin estilo (0,5 s) quedan; con un estilo rápido (0,3 s) se recortan.
    const slow = speak("uno dos tres cuatro cinco seis", 0.3, 0.4);
    const loose = buildTimeline(slow, basePlan(), 30);
    const tight = buildTimeline(slow, basePlan({ pacing: { long_pause: 0.3 } }), 30);
    assert.equal(loose.clips.length, 1);
    assert.ok(tight.clips.length > loose.clips.length, `${tight.clips.length} vs ${loose.clips.length}`);
    assert.ok(tight.duration < loose.duration);
  });

  test("tramo de salida de un rango de palabras (y null si todo se cortó)", () => {
    const tl = buildTimeline(words, basePlan({ removals: [{ from_word: 0, to_word: 3, reason: "manual", confidence: 1, source: "user" }] }), 30);
    const r = outputRange(tl, 4, 6)!;
    assert.ok(r.start >= 0 && r.end > r.start);
    assert.equal(outputRange(tl, 0, 3), null);
  });

  test("zooms con la separación del estilo, en cortes y frases, nunca encima del b-roll", () => {
    const tl = buildTimeline(words, basePlan({ pacing: { long_pause: 0.3 } }), 30);
    const cuts = cutTimes(tl);
    assert.ok(cuts.length >= 3);
    const avoid = [{ start: cuts[1]! - 0.2, end: cuts[1]! + 1.5 }];
    const zooms = computeZooms(tl, { enabled: true, everySeconds: 2, scale: 1.15, mode: "punch" }, { avoid });
    assert.ok(zooms.length >= 2, JSON.stringify(zooms));
    for (const [i, z] of zooms.entries()) {
      assert.ok(z.start >= 0.6 && z.end <= tl.duration && z.end > z.start);
      assert.ok(!(z.start >= avoid[0]!.start - 0.15 && z.start <= avoid[0]!.end + 0.15), "zoom encima del b-roll");
      if (i > 0) assert.ok(z.start - zooms[i - 1]!.start >= 1.7 - 1e-9);
      assert.equal(z.ramp, 0);
    }
    assert.deepEqual(computeZooms(tl, { enabled: false, everySeconds: 2, scale: 1.1, mode: "punch" }), []);
    const smooth = computeZooms(tl, { enabled: true, everySeconds: 2, scale: 1.25, mode: "smooth" });
    assert.ok(smooth.every((z) => z.ramp > 0 && z.scale <= 1.15));
  });

  const pexels = { source: "pexels" as const, id: "1", duration: 10, width: 1080, height: 1920, file: "https://videos.pexels.com/a.mp4", credit: { name: "Ana", url: "https://www.pexels.com/@ana", page: "https://www.pexels.com/video/1/" } };
  const item = (id: string, from: number, to: number, choice: BrollItem["choice"] = pexels): BrollItem => ({ id, from_word: from, to_word: to, query_en: "phone", keywords: [], choice, options: [] });

  test("tramos de b-roll: sin clip no se renderiza, sobre palabras cortadas desaparece, cortos se estiran", () => {
    const tl = buildTimeline(words, basePlan({ removals: [{ from_word: 13, to_word: 15, reason: "manual", confidence: 1, source: "user" }] }), 30);
    const segs = brollSegments(tl, [item("a", 4, 7), item("b", 9, 9), item("c", 13, 15), item("d", 16, 18, null)]);
    assert.deepEqual(segs.map((s) => s.id), ["a", "b"]);
    assert.ok(segs[1]!.end - segs[1]!.start >= 0.8);
    assert.ok(segs[0]!.end <= segs[1]!.start + 1e-9);
  });

  test("créditos de Pexels sin repetir y sin los clips propios", () => {
    const tl = buildTimeline(words, basePlan(), 30);
    const lib = { source: "library" as const, id: "x", duration: 4, width: 1080, height: 1920, key: "editor/biblioteca/x/clip.mp4", title: "Mi oficina" };
    const credits = brollCredits(brollSegments(tl, [item("a", 4, 6), item("b", 8, 10), item("c", 12, 14, lib)]));
    assert.match(credits, /^Videos de stock de Pexels/);
    assert.equal(credits.match(/Video de Ana en Pexels/g)?.length, 1);
    assert.doesNotMatch(credits, /oficina/);
    assert.equal(brollCredits([]), "");
  });

  test("el plan valida el b-roll: ids (superpuestos valen: van en capas)", () => {
    const ok = basePlan({ broll: [item("a", 2, 4), item("b", 6, 8)] });
    assert.equal(planSchemaFor(words.length).safeParse(ok).success, true);
    const layered = basePlan({ broll: [item("a", 2, 6), { ...item("b", 5, 8), layer: 1 }] });
    assert.equal(planSchemaFor(words.length).safeParse(layered).success, true);
    const out = basePlan({ broll: [item("a", 2, 99)] });
    assert.equal(planSchemaFor(words.length).safeParse(out).success, false);
  });

  test("la tarea de b-roll lleva cantidad, duración, prohibidos y frases", () => {
    const task = brollTask({ words, count: 2, minSeconds: 1.5, maxSeconds: 3, forbidden: [{ from: 0, to: 3, label: "gancho" }], format: "9:16", library: "C1 «Recepción» (video 8.0 s, vertical): recepcionista atendiendo el teléfono" });
    assert.match(task, /CANTIDAD: 2/);
    assert.match(task, /DURACIÓN: 1\.5–3\.0 s/);
    assert.match(task, /PROHIBIDO \[0–3\]: gancho/);
    assert.match(task, /^F2 \[4–/m);
    assert.match(task, /teléfono/);
  });
});

describe("fuentes de b-roll", () => {
  const video: PexelsVideo = {
    id: 857195,
    width: 1080,
    height: 1920,
    url: "https://www.pexels.com/video/recepcionista-857195/",
    image: "https://images.pexels.com/videos/857195/pictures/preview-0.jpg",
    duration: 12,
    user: { name: "Ana Pérez", url: "https://www.pexels.com/@ana" },
    video_files: [
      { quality: "sd", file_type: "video/mp4", width: 360, height: 640, link: "https://videos.pexels.com/video-files/857195/sd.mp4" },
      { quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/video-files/857195/hd.mp4" },
      { quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "https://videos.pexels.com/video-files/857195/uhd.mp4" },
      { quality: "hls", file_type: "video/hls", width: 1080, height: 1920, link: "https://videos.pexels.com/video-files/857195/x.m3u8" },
    ],
  };

  test("Pexels: archivo de 1080 para el render, liviano para la vista previa y atribución", () => {
    const o = mapPexelsVideo(video, "9:16")!;
    assert.equal(o.file, "https://videos.pexels.com/video-files/857195/hd.mp4");
    assert.equal(o.preview, "https://videos.pexels.com/video-files/857195/sd.mp4");
    assert.deepEqual(o.credit, { name: "Ana Pérez", url: "https://www.pexels.com/@ana", page: video.url });
    assert.equal(mapPexelsVideo({ ...video, video_files: [] }, "9:16"), null);
    assert.equal(mapPexelsVideo({ ...video, width: 3000, height: 1000 }, "9:16"), null); // panorama
  });

  test("Pixabay: archivo de 1080 para el render, liviano para la vista previa, orientación y crédito", () => {
    const pv: PixabayVideo = {
      id: 125,
      pageURL: "https://pixabay.com/videos/id-125/",
      duration: 9,
      user: "Coverr-Free-Footage",
      user_id: 1281706,
      videos: {
        large: { url: "https://cdn.pixabay.com/video/125/large.mp4", width: 2160, height: 3840, thumbnail: "https://cdn.pixabay.com/video/125/large.jpg" },
        medium: { url: "https://cdn.pixabay.com/video/125/medium.mp4", width: 1080, height: 1920, thumbnail: "https://cdn.pixabay.com/video/125/medium.jpg" },
        small: { url: "https://cdn.pixabay.com/video/125/small.mp4", width: 720, height: 1280, thumbnail: null },
        tiny: { url: "https://cdn.pixabay.com/video/125/tiny.mp4", width: 360, height: 640 },
      },
    };
    const o = mapPixabayVideo(pv, "9:16")!;
    assert.equal(o.source, "pixabay");
    assert.equal(o.file, "https://cdn.pixabay.com/video/125/medium.mp4");
    assert.equal(o.preview, "https://cdn.pixabay.com/video/125/tiny.mp4");
    assert.equal(o.credit?.page, pv.pageURL);
    assert.equal(o.credit?.url, "https://pixabay.com/users/1281706/");
    assert.equal(mapPixabayVideo(pv, "16:9"), null); // vertical no sirve para horizontal
    assert.equal(mapPixabayVideo({ ...pv, videos: {} }, "9:16"), null);
  });

  test("créditos: un bloque por banco de stock", () => {
    const px = { source: "pixabay" as const, id: "9", duration: 5, width: 1080, height: 1920, file: "https://cdn.pixabay.com/a.mp4", credit: { name: "Luis", url: "https://pixabay.com/users/1/", page: "https://pixabay.com/videos/id-9/" } };
    const credits = brollCredits([{ start: 0, end: 2, option: px }, { start: 3, end: 5, option: { source: "pexels", id: "1", duration: 10, width: 1080, height: 1920, file: "https://videos.pexels.com/a.mp4", credit: { name: "Ana", url: "https://www.pexels.com/@ana", page: "https://www.pexels.com/video/1/" } } }] as never);
    assert.match(credits, /^Videos de stock de Pixabay/);
    assert.match(credits, /Video de Luis en Pixabay/);
    assert.match(credits, /Videos de stock de Pexels/);
  });

  test("biblioteca: etiquetas valen más que el título y no importan las tildes", () => {
    const clip = { title: "Recepción de la clínica", tags: ["teléfono", "recepción"] };
    assert.ok(libraryScore(clip, ["telefono"]) >= 2);
    assert.ok(libraryScore(clip, ["clínica"]) === 1);
    assert.equal(libraryScore(clip, ["playa"]), 0);
    assert.ok(libraryScore(clip, ["telefonos", "recepcion"]) >= 4);
  });
});

describe("subtítulos durante gráficos", () => {
  test("se ocultan las palabras dentro del gráfico y el bloque se parte", () => {
    const w = (text: string, start: number, end: number) => ({ text, start, end }) as never;
    const blocks = [{ start: 0, end: 1.5, words: [w("a", 0, 0.4), w("b", 0.5, 0.9), w("c", 1, 1.5)] }];
    const out = hideDuring(blocks as never, [{ start: 0.45, end: 0.95 }]);
    assert.deepEqual(
      out.map((b) => b.words.map((x) => (x as { text: string }).text)),
      [["a"], ["c"]],
    );
    assert.equal(hideDuring(blocks as never, []).length, 1);
  });
});
