/**
 * Línea de tiempo profesional del Estudio (etapa 3): mezcla (lib/video/audio-mix.ts), recorte y fundidos de los
 * sonidos (lib/video/sfx.ts), marcadores (lib/video/markers.ts), código de tiempo (lib/video/timecode.ts), forma de
 * onda (lib/video/peaks.ts) y que los planes de antes sigan igual. Sin base ni servidor.
 *   pnpm test:linea
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { audible, cleanMix, duckWindows, fadeGainAt, fitMusicFade, loudnessOf, musicFade, previewBalance, renderMix, voiceDb } from "../lib/video/audio-mix";
import { anchorAt, cleanMarkers, markersForPrompt, placeMarkers } from "../lib/video/markers";
import { bufferPeaks, decodePeaks, plainColumns, sourceTimeAt, voiceLevelAt, waveColumns } from "../lib/video/peaks";
import { assemblePlan, planSchemaFor } from "../lib/video/plan";
import { applyReview } from "../lib/video/review";
import { cleanSoundCues, cueClip, cueSpan, fitCueClip, sfxCues, soundCueTimes } from "../lib/video/sfx";
import { SFX_LIBRARY } from "../lib/video/sfx-library";
import { frameAt, parseTimecode, stepFrame, timecode } from "../lib/video/timecode";
import { buildTimeline } from "../lib/video/timeline";
import { FPS, type EditPlan, type Word } from "../lib/video/types";
import { changedParts, studioVersionLabel } from "../lib/video/version-label";
import { initialStudioState, toReview } from "../components/editor/studio/use-studio-state";
import { toggleMix } from "../components/editor/studio/mixer";

const words: Word[] = Array.from({ length: 20 }, (_, i) => ({ id: i, text: `p${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
const DURATION = 10;
const plan0 = (): EditPlan => assemblePlan({ ai: null, candidates: [], words, duration: DURATION, format: "9:16", preset: "clasico", corrections: {}, offScript: [] });
const review0 = (p: EditPlan) => toReview(initialStudioState(p, words.length), { plan: p, hasStyle: false, trackIds: [] });

describe("mezcla", () => {
  test("silenciar y solo funcionan como en un mezclador", () => {
    assert.equal(audible(null, "voice"), true);
    assert.equal(audible({ mute: ["voice"], solo: [] }, "voice"), false);
    assert.equal(audible({ mute: [], solo: ["music"] }, "voice"), false);
    assert.equal(audible({ mute: [], solo: ["music"] }, "music"), true);
    // Silenciada manda sobre solo.
    assert.equal(audible({ mute: ["music"], solo: ["music"] }, "music"), false);
    assert.deepEqual(toggleMix({ mute: [], solo: ["voice"] }, "music", "solo", true), { mute: [], solo: ["music"] });
    assert.deepEqual(toggleMix({ mute: ["sfx"], solo: [] }, "sfx", "mute"), { mute: [], solo: [] });
  });

  test("lo que va al render: lo silenciado no va, la voz con su volumen y la música con sus fundidos", () => {
    assert.deepEqual(renderMix({}), { voiceDb: 0, music: true, sfx: true, musicFade: { in: 0.8, out: 1.5 } });
    assert.deepEqual(renderMix({ voice_db: -6, mix: { mute: ["sfx"], solo: [] }, music_fade: { in: 2, out: 0 } }), { voiceDb: -6, music: true, sfx: false, musicFade: { in: 2, out: 0 } });
    assert.equal(renderMix({ mix: { mute: [], solo: ["music"] } }).voiceDb, null);
    assert.equal(voiceDb(4), 0, "la voz no se sube");
    assert.equal(voiceDb(-50), -30);
    assert.equal(cleanMix({ mute: [], solo: [] }), null, "sin nada silenciado no se guarda el campo");
    assert.deepEqual(musicFade(undefined), { in: 0.8, out: 1.5 });
  });

  test("fundidos: rampa lineal como el afade del render y se achican si no entran (igual que fit_fades del worker)", () => {
    assert.equal(fadeGainAt(0.4, 0, 10, 0.8, 1.5), 0.5);
    assert.equal(fadeGainAt(5, 0, 10, 0.8, 1.5), 1);
    assert.ok(Math.abs(fadeGainAt(9.25, 0, 10, 0.8, 1.5) - 0.5) < 1e-9);
    assert.deepEqual(fitMusicFade({ in: 8, out: 8 }, 12), { in: 6, out: 6 });
    assert.deepEqual(fitMusicFade({ in: 1, out: 1 }, 12), { in: 1, out: 1 });
  });

  test("balance de la vista previa: misma relación voz-música que el render, sin subir el video por encima de 1", () => {
    // La voz original está 6 dB más baja que el objetivo: se bajan los demás 6 dB (el video no puede pasar de 1).
    const quiet = previewBalance({ target: -14, voiceDb: 0, musicDb: -16, voiceLoudness: -20, musicLoudness: -10 });
    assert.equal(quiet.voice, 0);
    assert.equal(quiet.music, -14 - 16 + 10 - 6);
    assert.equal(quiet.meter, 6);
    // Fuerte: la voz se baja y la música queda en su nivel del render.
    const loud = previewBalance({ target: -14, voiceDb: -3, musicDb: -16, voiceLoudness: -8, musicLoudness: -10 });
    assert.equal(loud.voice, -9);
    assert.equal(loud.music, -20);
    // La diferencia voz-música es la del render (objetivo + volumen de cada una).
    assert.equal(quiet.voice + -20 - (quiet.music + -10), 0 - -16);
  });

  test("ducking: las pausas cortas no dejan volver la música (se unen), como el release del render", () => {
    assert.deepEqual(duckWindows([{ start: 0, end: 1 }, { start: 1.2, end: 2 }, { start: 3, end: 4 }]), [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
  });

  test("la sonoridad estimada ignora el silencio (como un medidor con umbral)", () => {
    const rms = new Float32Array(100).fill(0);
    for (let i = 0; i < 50; i++) rms[i] = 0.2;
    assert.ok(Math.abs(loudnessOf(rms)! - 20 * Math.log10(0.2)) < 0.01);
    assert.equal(loudnessOf(new Float32Array(10)), null);
  });
});

describe("recorte y fundidos de un sonido", () => {
  const dur = SFX_LIBRARY.impact.duration;

  test("el recorte deja al menos 80 ms y los fundidos no pasan de lo que suena", () => {
    const c = fitCueClip({ name: "impact" as const, trim_in: 5, trim_out: 5, fade_in: 3, fade_out: 3 });
    const clip = cueClip(c);
    assert.ok(clip.length >= 0.079, `${clip.length}`);
    assert.ok((c.fade_in ?? 0) + (c.fade_out ?? 0) <= clip.length + 1e-6);
    // Sin recorte ni fundidos, sin campos (los planes de antes quedan igual).
    assert.deepEqual(fitCueClip({ name: "impact" as const, trim_in: 0, fade_out: 0 }), { name: "impact" });
  });

  test("sfxCues pasa el recorte y los fundidos al render; sin ellos, el sonido entero como siempre", () => {
    const cues = sfxCues({ level: "off", duration: 10, broll: [], manual: [{ name: "impact", hitAt: 2, gain: -8, trim_in: 0.1, trim_out: 0.2, fade_in: 0.05 }, { name: "pop", hitAt: 5, gain: -8 }] });
    const impact = cues.find((c) => c.name === "impact")!;
    assert.equal(impact.from, 0.1);
    assert.ok(Math.abs(impact.length! - (dur - 0.3)) < 1e-6);
    assert.equal(impact.fade_in, 0.05);
    assert.deepEqual(Object.keys(cues.find((c) => c.name === "pop")!).sort(), ["at", "gain", "name"]);
    const span = cueSpan(impact);
    assert.ok(Math.abs(span.start - (impact.at + 0.1)) < 1e-9);
  });

  test("el navegador no puede mandar recortes fuera del archivo", () => {
    const [c] = cleanSoundCues([{ id: "a", name: "impact", at_word: 1, offset: 0, gain: -8, trim_in: 9, trim_out: 0 }], 20);
    assert.ok(c && (c.trim_in ?? 0) <= dur - 0.08 + 1e-6);
  });
});

describe("marcadores", () => {
  const timeline = buildTimeline(words, { removals: [{ from_word: 3, to_word: 4, reason: "manual", confidence: 1, source: "user" }], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] } }, DURATION);

  test("se numeran por su orden en el video final y los de palabras cortadas no aparecen", () => {
    const placed = placeMarkers(timeline, [
      { id: "b", at_word: 10, offset: 0, note: "dos" },
      { id: "a", at_word: 1, offset: 0, note: "uno" },
      { id: "c", at_word: 3, offset: 0, note: "cortado" },
    ]);
    assert.deepEqual(placed.map((m) => [m.number, m.marker.id]), [[1, "a"], [2, "b"]]);
  });

  test("el ancla es la palabra más cercana al cabezal, con su corrimiento", () => {
    const t = timeline.words[5]!.start + 0.1;
    assert.deepEqual(anchorAt(timeline, t), { at_word: timeline.words[5]!.id, offset: 0.1 });
  });

  test("Claude los lee con número, minuto, palabras y nota", () => {
    const text = markersForPrompt(timeline, [{ id: "a", at_word: 10, offset: 0, note: "pon un gráfico" }]);
    assert.match(text, /^- Marcador 1 \(0:0\d, palabra 10, palabras \d+–\d+: «.*p10.*»\)\. Nota: «pon un gráfico»\.$/);
    assert.equal(markersForPrompt(timeline, []), "");
  });

  test("notas limpias y palabras válidas", () => {
    const m = cleanMarkers([{ id: "a", at_word: 2, offset: 0, note: "  hola\u0007 " }, { id: "a", at_word: 3 }, { id: "x", at_word: 99, note: "" }], 20);
    assert.deepEqual(m, [{ id: "a", at_word: 2, offset: 0, note: "hola" }]);
  });
});

describe("código de tiempo", () => {
  test("HH:MM:SS:FF a 30 cuadros", () => {
    assert.equal(FPS, 30);
    assert.equal(timecode(0), "00:00:00:00");
    assert.equal(timecode(83.5), "00:01:23:15");
    assert.equal(timecode(3600 + 1 / 30), "01:00:00:01");
    assert.equal(frameAt(0.1 + 0.2), 9);
  });

  test("← → avanzan de a un cuadro exacto, sin pasarse del video", () => {
    assert.equal(stepFrame(0, 1, 10), 1 / 30);
    assert.equal(stepFrame(1 / 30, -1, 10), 0);
    assert.equal(stepFrame(0.05, -1, 10), 1 / 30, "desde la mitad de un cuadro vuelve a su inicio");
    assert.equal(stepFrame(0, -1, 10), 0);
    assert.equal(stepFrame(9.99, 1, 10), 299 / 30);
    assert.equal(parseTimecode("00:01:23:15"), 83.5);
    assert.equal(parseTimecode("1:30"), 90);
    assert.equal(parseTimecode("12,5"), 12.5);
    assert.equal(parseTimecode("hola"), null);
  });
});

describe("forma de onda", () => {
  const timeline = buildTimeline(words, { removals: [{ from_word: 4, to_word: 7, reason: "manual", confidence: 1, source: "user" }], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "clasico", emphasis_words: [] } }, DURATION);
  // Picos a 50 por segundo: en el segundo 4,5 del original (palabra 9, que queda) hay un golpe.
  const raw = new Uint8Array(500);
  raw[225] = 255;
  const b64 = Buffer.from(raw).toString("base64");
  const peaks = decodePeaks({ rate: 50, peak: b64, rms: b64 });

  test("el segundo del video final cae en su lugar del original (con los cortes)", () => {
    const out = timeline.words.find((w) => w.id === 9)!.start;
    assert.ok(out < 4.5, "después del corte, el video final va adelantado respecto del original");
    assert.ok(Math.abs(sourceTimeAt(timeline, out)! - 4.5) < 0.02);
    assert.ok(voiceLevelAt(peaks, timeline, out + 0.005) > 0.5);
    assert.equal(voiceLevelAt(peaks, timeline, 0.5), 0);
    const n = 400;
    const cols = waveColumns(peaks, timeline, 0, timeline.duration, n);
    const at = cols.indexOf(Math.max(...cols));
    assert.equal(cols[at], 1);
    assert.ok(Math.abs(((at + 0.5) / n) * timeline.duration - out) < 0.05);
  });

  test("picos de un AudioBuffer y columnas en bucle (la música se repite como en el render)", () => {
    const ch = new Float32Array(48000);
    ch[24000] = 0.5;
    const p = bufferPeaks(ch, 48000, 50);
    assert.equal(p.peak.length, 50);
    const cols = plainColumns(p, 0, 0, 3, 3, true);
    assert.deepEqual([...cols], [0.5, 0.5, 0.5]);
  });
});

describe("planes y revisión", () => {
  test("un plan de antes (sin los campos nuevos) sigue siendo válido y la revisión no le agrega nada", () => {
    const p = plan0();
    assert.ok(planSchemaFor(words.length).safeParse(p).success);
    const next = applyReview(p, review0(p), words, DURATION, "9:16");
    assert.equal(next.audio.voice_db, undefined);
    assert.equal(next.audio.mix, undefined);
    assert.equal(next.audio.music_fade, undefined);
    assert.equal(next.markers, undefined);
    assert.deepEqual(changedParts(p, next), []);
  });

  test("mezcla y marcadores se guardan, se validan y vuelven igual al Estudio", () => {
    const p = plan0();
    const st = { ...initialStudioState(p, words.length), voiceDb: -4, mix: { mute: ["music" as const], solo: [] }, musicFade: { in: 2, out: 0.5 }, markers: [{ id: "m1", at_word: 5, offset: 0.1, note: "aquí un zoom" }] };
    const next = applyReview(p, toReview(st, { plan: p, hasStyle: false, trackIds: [] }), words, DURATION, "9:16");
    assert.ok(planSchemaFor(words.length).safeParse(next).success);
    assert.equal(next.audio.voice_db, -4);
    assert.deepEqual(next.audio.mix, { mute: ["music"], solo: [] });
    assert.deepEqual(next.audio.music_fade, { in: 2, out: 0.5 });
    assert.equal(next.markers?.[0]?.note, "aquí un zoom");
    const back = initialStudioState(next, words.length);
    assert.equal(back.voiceDb, -4);
    assert.deepEqual(back.markers, st.markers);
    assert.equal(studioVersionLabel(p, next), "Antes de tus cambios en el Estudio (sonido, música y marcadores)");
  });

  test("los sonidos puestos a mano conservan su recorte al guardar", () => {
    const p = plan0();
    const st = { ...initialStudioState(p, words.length), soundCues: [{ id: "s1", name: "impact" as const, at_word: 2, offset: 0, gain: -8, trim_in: 0.05, fade_out: 0.1 }] };
    const next = applyReview(p, toReview(st, { plan: p, hasStyle: false, trackIds: [] }), words, DURATION, "9:16");
    assert.equal(next.audio.cues?.[0]?.trim_in, 0.05);
    const timeline = buildTimeline(words, next, DURATION);
    assert.equal(soundCueTimes(timeline, next.audio.cues ?? []).length, 1);
  });
});

describe("Claude lee los marcadores", () => {
  test("el chat del video los recibe con su número y su nota, y la regla para «el marcador 2»", async () => {
    const { videoChatTask, VIDEO_CHAT_RULES } = await import("../lib/ai/prompts/chat-video");
    const task = videoChatTask({ sentences: "[0–3] 0.0–1.5 s: hola", duration: 10, format: "9:16", playhead: null, selection: null, state: "", attachments: null, messages: [{ role: "user", text: "en el marcador 2 pon un zoom" }], markers: "- Marcador 1 (0:01, …). Nota: «a».\n- Marcador 2 (0:05, …). Nota: «b»." });
    assert.match(task, /MARCADORES[^\n]*\n- Marcador 1[\s\S]*- Marcador 2/);
    assert.match(VIDEO_CHAT_RULES, /marcador 2/);
    // Sin marcadores, el pedido queda como antes.
    assert.doesNotMatch(videoChatTask({ sentences: "", duration: 1, format: "9:16", playhead: null, selection: null, state: "", attachments: null, messages: [] }), /MARCADORES/);
  });

  test("el director también (al dirigir y al corregir) y nunca los pierde al armar el plan", async () => {
    const { readFileSync } = await import("node:fs");
    const prompt = readFileSync(new URL("../lib/ai/prompts/director.ts", import.meta.url), "utf8");
    assert.match(prompt, /MARCADORES DE LA PERSONA/);
    const service = readFileSync(new URL("../lib/video/director/service.ts", import.meta.url), "utf8");
    assert.match(service, /markers: markersText\(/);
    const assemble = readFileSync(new URL("../lib/video/director/assemble.ts", import.meta.url), "utf8");
    assert.match(assemble, /markers: prev\.markers/);
    const conversation = readFileSync(new URL("../lib/video/chat-conversation.ts", import.meta.url), "utf8");
    assert.match(conversation, /MARCADORES DEL VIDEO/);
  });
});
