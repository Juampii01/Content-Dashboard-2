/**
 * Biblioteca ampliada del Estudio: transiciones (dónde van, qué dibujan, que no tocan la unión de tramos), sonidos (la
 * lista es la misma que la del worker, los que pone la persona suenan donde se pidió) y música generada (determinista,
 * nivel parejo, 140 pistas, estilos distintos). Sin base ni red.
 *   pnpm test:video
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { FxRenderer, WORKER_FONTS, type FxCtx } from "../lib/video/fx";
import { effectsFromWire, fxLimits, FX_DIRECTOR_RULES, simulateTransitions, transitionBudget, transitionsFromWire } from "../lib/video/fx/director";
import { FX_KINDS } from "../lib/video/fx/catalog";
import { cleanTransitions, compileTransition, cutPoints, searchTransitions, TRANSITION_INFO, TRANSITION_KINDS, transitionSegments, transitionSounds, type TransitionItem } from "../lib/video/fx/transitions";
import { MUSIC_LIBRARY, musicGenLabel, tracksOf } from "../lib/video/music-gen/catalog";
import { bodyRms, renderMusic, sectionOf } from "../lib/video/music-gen/engine";
import { MUSIC_STYLES } from "../lib/video/music-gen/spec";
import { cleanSoundCues, SFX_FILES, sfxCues, soundCueTimes } from "../lib/video/sfx";
import { isSfxName, searchSfx, SFX_NAMES } from "../lib/video/sfx-library";
import { buildTimeline } from "../lib/video/timeline";
import type { EditPlan, Word } from "../lib/video/types";

const TEXT = "Hoy te cuento algo. Esto es muy importante para tu marca. Nadie te lo dice. Ahora sí lo sabes. Comenta la palabra.";
const words: Word[] = (() => {
  let t = 0.3;
  return TEXT.split(" ").map((text, id) => {
    const w = { id, text, start: +t.toFixed(3), end: +(t + 0.3).toFixed(3) };
    t += 0.4 + (text.endsWith(".") ? 1.0 : 0);
    return w;
  });
})();
const duration = words.at(-1)!.end + 0.5;
const plan = { removals: [{ from_word: 4, to_word: 4 }], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "caja", emphasis_words: [] } } as unknown as EditPlan;
const timeline = buildTimeline(words, plan, duration);
const brand = { accent: "#2b8cff", bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accentText: "#ffffff", font: "inter" as const };

describe("transiciones", () => {
  const cuts = cutPoints(timeline);

  test("son 20, con ficha, sonido de la biblioteca y buscador", () => {
    assert.equal(TRANSITION_KINDS.length, 20);
    for (const k of TRANSITION_KINDS) {
      const i = TRANSITION_INFO[k];
      assert.ok(i.label && i.description, k);
      assert.ok(i.sound === "none" || isSfxName(i.sound), `${k}: sonido ${i.sound}`);
    }
    assert.ok(searchTransitions("barrido").includes("tr_whip"));
    assert.ok(searchTransitions("circulo").includes("tr_iris"));
  });

  test("van centradas en su corte, sin pisarse ni pisar lo ocupado", () => {
    assert.ok(cuts.length >= 3, "el video de prueba tiene cortes (pausas largas y una palabra cortada)");
    const items: TransitionItem[] = cuts.slice(0, 3).map((c, i) => ({ id: `t${i}`, kind: "tr_whip", at_word: c.word }));
    const segs = transitionSegments(timeline, items);
    assert.equal(segs.length, 3);
    for (const s of segs) {
      assert.ok(Math.abs((s.start + s.end) / 2 - s.cut) < 0.05, "centrada");
      assert.ok(s.end - s.start <= 0.55);
    }
    // Un efecto o un b-roll encima del corte: no se dibuja ahí.
    const blocked = transitionSegments(timeline, items, [{ start: segs[1]!.start - 0.1, end: segs[1]!.end + 0.1 }]);
    assert.deepEqual(blocked.map((s) => s.id), ["t0", "t2"]);
    // Si el corte deja de existir (se restauró lo cortado), la transición no se dibuja.
    assert.equal(transitionSegments(timeline, [{ id: "x", kind: "tr_flash", at_word: 1 }]).length, 0);
  });

  test("lo que manda el navegador: forma válida, en un corte que existe, un corte una sola vez", () => {
    const c = cuts[0]!.word;
    const clean = cleanTransitions([{ id: "a", kind: "tr_flash", at_word: c }, { id: "b", kind: "tr_spin", at_word: c }, { id: "c", kind: "no_existe", at_word: c }, { id: "d", kind: "tr_iris", at_word: 2 }], timeline);
    assert.deepEqual(clean.map((t) => t.id), ["a"]);
  });

  test("el sonido cae justo en el corte y suena aunque los automáticos estén apagados", () => {
    const segs = transitionSegments(timeline, [{ id: "a", kind: "tr_whip", at_word: cuts[0]!.word }]);
    const snd = transitionSounds(segs);
    assert.equal(snd.length, 1);
    assert.equal(snd[0]!.hitAt, segs[0]!.cut);
    const cues = sfxCues({ level: "off", duration: timeline.duration, broll: [], manual: [{ name: "swipe", hitAt: snd[0]!.hitAt, gain: -17 }] });
    assert.equal(cues.length, 1);
    assert.ok(Math.abs(cues[0]!.at + SFX_FILES.swipe.hit - segs[0]!.cut) < 0.002);
    assert.equal(transitionSounds(transitionSegments(timeline, [{ id: "a", kind: "tr_whip", at_word: cuts[0]!.word, sound: false }])).length, 0);
  });

  const require = createRequire(new URL("../worker/motion/package.json", import.meta.url));
  let skia: { Canvas: new (w: number, h: number) => { width: number; height: number; getContext(t: "2d"): unknown } } | null = null;
  try {
    skia = require("skia-canvas");
  } catch {
    skia = null;
  }

  test("el motor dibuja las 20: en los bordes el cuadro queda igual (sin salto) y en el corte cambia", { skip: skia ? false : "sin skia-canvas" }, () => {
    const { Canvas } = skia!;
    const S = 0.2;
    const host = { makeCanvas: (w: number, h: number) => { const canvas = new Canvas(w, h); return { canvas, ctx: canvas.getContext("2d") as FxCtx }; }, fonts: WORKER_FONTS };
    const renderer = new FxRenderer(host);
    const frame = new Canvas(1080, 1920);
    const f = frame.getContext("2d") as FxCtx;
    for (let x = 0, i = 0; x < 1080; x += 23 + (i * 17) % 41, i++) {
      f.fillStyle = i % 3 === 0 ? "#30507a" : i % 3 === 1 ? "#d8c090" : "#a03040";
      f.fillRect(x, 0, 60, 1920);
    }
    for (let y = 0; y < 1920; y += 97) {
      f.fillStyle = "rgba(255,255,255,0.35)";
      f.fillRect(0, y, 1080, 18);
    }
    const ref = new Canvas(216, 384);
    const rctx = ref.getContext("2d") as FxCtx & { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
    rctx.drawImage(frame, 0, 0, 216, 384);
    const base = rctx.getImageData(0, 0, 216, 384).data;
    const diff = (kind: string, t: number) => {
      const seg = { id: `s-${kind}`, start: 1, end: 1.6, cut: 1.3, item: { id: `s-${kind}`, kind: kind as TransitionItem["kind"], at_word: 0 } };
      const spec = compileTransition({ segment: seg, format: "9:16", brand, face: { x: 400, y: 500, w: 280, h: 330 } });
      const out = new Canvas(216, 384);
      const ctx = out.getContext("2d") as FxCtx & { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
      renderer.render(ctx, spec, t, { frame, mask: null, images: {} }, S);
      const d = ctx.getImageData(0, 0, 216, 384).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += Math.abs(d[i]! - base[i]!) + Math.abs(d[i + 1]! - base[i + 1]!) + Math.abs(d[i + 2]! - base[i + 2]!);
      return sum / (d.length / 4) / 3;
    };
    for (const kind of TRANSITION_KINDS) {
      assert.ok(diff(kind, 0) < 4, `${kind}: al empezar, el cuadro tal cual (${diff(kind, 0).toFixed(1)})`);
      assert.ok(diff(kind, 0.6) < 4, `${kind}: al terminar, el cuadro tal cual (${diff(kind, 0.6).toFixed(1)})`);
      assert.ok(Math.max(diff(kind, 0.28), diff(kind, 0.32)) > 6, `${kind}: en el corte cambia`);
    }
  });
});

describe("director", () => {
  const limits = fxLimits({ allowed: [...FX_KINDS], frequency: "normal" }, 60);

  test("conoce los 100 efectos y las 20 transiciones", () => {
    for (const k of FX_KINDS) assert.ok(FX_DIRECTOR_RULES.includes(`- ${k} «`), k);
    for (const k of TRANSITION_KINDS) assert.ok(FX_DIRECTOR_RULES.includes(`- ${k} «`), k);
  });

  test("variedad: no repite un efecto (los zooms, hasta dos veces)", () => {
    const wire = [0, 7, 14, 21].map((f) => ({ from_word: f, to_word: f + 3, kind: "glitch" as const, text: "", items: [], why: "x" }));
    const res = effectsFromWire(wire, { words, limits: { ...limits, max: 10, minGap: 0 }, broll: [], forbidden: [], removed: new Set() });
    assert.equal(res.items.length, 1);
    assert.ok(res.dropped.some((d) => d.includes("No repetí")));
  });

  test("transiciones con moderación: en cortes reales o libres sobre el plano, separadas, sin repetir seguidas y nunca sobre lo ocupado", () => {
    assert.equal(transitionBudget("ninguno", 60), 0);
    assert.equal(transitionBudget("pocos", 120), 1);
    assert.ok(transitionBudget("muchos", 60) <= 8);
    const cuts = cutPoints(timeline);
    const wire = cuts.map((c) => ({ at_word: c.word, kind: "tr_whip" as const, why: "x" }));
    const res = transitionsFromWire([...wire, { at_word: 1, kind: "tr_flash", why: "sin corte" }], { timeline, limits: { ...limits, transitions: 10 }, blocked: [] });
    // En un corte o, sin corte, libre en el inicio de su palabra (offset 0).
    assert.ok(res.items.every((t) => (t.offset == null ? cuts.some((c) => c.word === t.at_word) : t.offset === 0 && !cuts.some((c) => c.word === t.at_word))), "en cortes o libres");
    for (let i = 1; i < res.items.length; i++) assert.notEqual(res.items[i]!.kind, res.items[i - 1]!.kind, "no la misma seguida");
    const blocked = transitionsFromWire(wire, { timeline, limits: { ...limits, transitions: 10 }, blocked: [{ start: 0, end: timeline.duration }] });
    assert.equal(blocked.items.length, 0);
    const sim = simulateTransitions({ words, cuts: [{ from_word: 4, to_word: 4 }], limits });
    assert.equal(sim[0]?.at_word, 5);
  });
});

describe("sonidos", () => {
  test("135 en la biblioteca, los mismos que dibuja el worker, con archivo para la vista previa", () => {
    assert.equal(SFX_NAMES.length, 135);
    const py = readFileSync(new URL("../worker/video/render.py", import.meta.url), "utf8");
    const block = py.slice(py.indexOf("SFX_NAMES = ("), py.indexOf(")", py.indexOf("SFX_NAMES = (")));
    const names = [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(names.sort(), [...SFX_NAMES].sort());
    for (const n of SFX_NAMES) {
      readFileSync(new URL(`../public/sfx/${n}.wav`, import.meta.url));
      readFileSync(new URL(`../worker/assets/sfx/${n}.wav`, import.meta.url));
    }
    assert.ok(searchSfx("dinero").includes("cash"));
    assert.ok(searchSfx("whoosh").length >= 2);
    assert.ok(searchSfx("fatality").includes("splat"), "los de cine se encuentran por lo que son");
  });

  test("los que pone la persona: anclados a su palabra (si se corta la palabra, no suenan)", () => {
    const cues = cleanSoundCues([{ id: "a", name: "ding", at_word: 6, offset: 0.1, gain: -12 }, { id: "b", name: "ding", at_word: 4 }, { id: "c", name: "nada", at_word: 2 }, { id: "a", name: "pop", at_word: 3 }], words.length);
    assert.deepEqual(cues.map((c) => c.id), ["a", "b"]);
    const times = soundCueTimes(timeline, cues);
    assert.equal(times.length, 1, "la palabra 4 está cortada");
    const w6 = timeline.words.find((w) => w.id === 6)!;
    assert.ok(Math.abs(times[0]!.hitAt - (w6.start + 0.1)) < 0.001);
    const mix = sfxCues({ level: "subtle", duration: timeline.duration, broll: [{ start: w6.start + 0.05, end: w6.start + 2 }], manual: times.map(({ cue, hitAt }) => ({ name: cue.name, hitAt, gain: cue.gain })) });
    assert.ok(mix.some((c) => c.name === "ding" && c.gain === -12), "el elegido suena aunque choque con un whoosh automático");
  });
});

describe("música generada", () => {
  test("140 pistas: 20 por estilo, con nombre, sin repetir semilla", () => {
    assert.equal(MUSIC_LIBRARY.length, 140);
    for (const s of MUSIC_STYLES) assert.equal(tracksOf(s).length, 20);
    assert.equal(new Set(MUSIC_LIBRARY.map((t) => t.id)).size, 140);
    assert.equal(new Set(MUSIC_LIBRARY.map((t) => `${t.style}-${t.seed}`)).size, 140);
    for (const s of MUSIC_STYLES) assert.equal(new Set(tracksOf(s).map((t) => t.title)).size, 20, s);
    assert.equal(musicGenLabel({ style: "lofi", seed: 5, bpm: 80 }), "Lo-fi a medida · 80 BPM");
    assert.equal(musicGenLabel(tracksOf("trap")[3]!), tracksOf("trap")[3]!.title);
  });

  test("forma: intro, A, B, puente y salida", () => {
    assert.equal(sectionOf(0, 30), "intro");
    assert.equal(sectionOf(1, 6), "a", "en una pista corta la intro dura un compás");
    assert.equal(sectionOf(2, 30), "a");
    assert.equal(sectionOf(10, 30), "b");
    assert.equal(sectionOf(18, 30), "puente");
    assert.equal(sectionOf(29, 30), "salida");
  });

  test("determinista, nivel parejo (-16 dBFS RMS), sin recortar y distinta por estilo", () => {
    const stats: { style: string; rms: number; low: number }[] = [];
    for (const style of MUSIC_STYLES) {
      const spec = { style, seed: 7, bpm: 96 } as const;
      const a = renderMusic(spec, { seconds: 8, sampleRate: 16000 });
      const b = renderMusic(spec, { seconds: 8, sampleRate: 16000 });
      assert.deepEqual(a, b, `${style}: determinista`);
      let sum = 0;
      let peak = 0;
      let low = 0;
      let prev = 0;
      for (const v of a) {
        assert.ok(Number.isFinite(v));
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
        prev = prev * 0.98 + v * 0.02;
        low += prev * prev;
      }
      const rms = 20 * Math.log10(bodyRms(a, 16000));
      assert.ok(rms > -17 && rms < -15, `${style}: ${rms.toFixed(1)} dB`);
      assert.ok(peak <= 0.9, `${style}: pico ${peak}`);
      stats.push({ style, rms, low: low / sum });
    }
    // El ambiente no tiene batería: menos graves que el trap (808).
    const lowOf = (s: string) => stats.find((x) => x.style === s)!.low;
    assert.ok(lowOf("trap") > lowOf("ambiente"), JSON.stringify(stats));
    // Semillas distintas, pistas distintas.
    const x = renderMusic({ style: "lofi", seed: 1, bpm: 80 }, { seconds: 4, sampleRate: 16000 });
    const y = renderMusic({ style: "lofi", seed: 2, bpm: 80 }, { seconds: 4, sampleRate: 16000 });
    assert.notDeepEqual(x, y);
  });
});
