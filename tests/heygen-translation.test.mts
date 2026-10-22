/**
 * Traducción con el clon y frases corregidas contra el simulador de HeyGen v3 (tests/mocks/heygen-mock.mjs), sin red.
 *   pnpm test:clon
 *
 * Cubre: subida directa (slot firmado → PUT con las cabeceras exactas → complete), traducción (idiomas, campos que
 * la API rechaza, estados, cobro por la duración del original), voz (marcas por palabra, error de idioma, ruta de
 * respaldo), sincronía de labios, y los cálculos puros de tarifas y de la ventana de una frase.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, statSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { createHeyGenClient, HeyGenError } from "../lib/heygen/client";
import { defaultLanguage, languageLabel, sortLanguages } from "../lib/heygen/languages";
import { balanceShortfall, estimateLipsync, estimateTranslation, TRANSLATION_MODES } from "../lib/heygen/pricing";
import { uploadToHeyGen } from "../lib/heygen/transfer";
import { translationAsVideo } from "../lib/heygen/translation";
import { captionCorrections, fitSpeech, fixWindow, HIDDEN_WORD, lipsyncClip, MAX_TEMPO, speechSpan } from "../lib/video/phrase-fix";
import type { Word } from "../lib/video/types";

const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const KEY = "hg_test_valida_00000000001234";
let mock: ChildProcess;
const dir = mkdtempSync(join(tmpdir(), "clon-test-"));
const video = join(dir, "original.mp4");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(path: string, type: string) {
  return { body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, size: statSync(path).size, contentType: type };
}

before(async () => {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=6", "-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
  mock = spawn("node", ["tests/mocks/heygen-mock.mjs"], { env: { ...process.env, HEYGEN_MOCK_PORT: String(PORT), MOCK_RENDER_MS: "2500", MOCK_WEBHOOKS: "0" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/__mock/state`)).ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("el simulador no arrancó");
});
after(() => mock?.kill());

const client = () => createHeyGenClient(KEY, { baseUrl: BASE });
const state = async () => (await (await fetch(`${BASE}/__mock/state`)).json()) as {
  accounts: Record<string, { wallet: { remaining_balance: number } }>;
  assets: { id: string; completed: boolean; size: number; duration: number }[];
  translations: { id: string; mode: string; audioOnly: boolean; status: string; body: Record<string, unknown> }[];
  lipsyncs: { id: string; status: string; body: Record<string, unknown> }[];
  speeches: number;
};

describe("subida directa y traducción", () => {
  test("sube el video como asset con la subida directa", async () => {
    const id = await uploadToHeyGen(client(), open(video, "video/mp4"), { filename: "original.mp4", contentType: "video/mp4", idempotencyKey: "t-1" });
    const s = await state();
    const asset = s.assets.find((a) => a.id === id)!;
    assert.equal(asset.completed, true);
    assert.equal(asset.size, statSync(video).size);
    assert.ok(Math.abs(asset.duration - 6) < 0.2, `duración ${asset.duration}`);
  });

  test("rechaza tipos que HeyGen no acepta y videos de más de 200 MB, sin pedir un slot", async () => {
    const before = (await state()).assets.length;
    await assert.rejects(uploadToHeyGen(client(), open(video, "video/quicktime"), { filename: "x.mov", contentType: "video/quicktime", idempotencyKey: "t-2" }), /MP4 o WebM/);
    await assert.rejects(
      uploadToHeyGen(client(), { ...open(video, "video/mp4"), size: 300 * 1024 ** 2 }, { filename: "x.mp4", contentType: "video/mp4", idempotencyKey: "t-3" }),
      /200 MB/,
    );
    assert.equal((await state()).assets.length, before);
  });

  test("lista idiomas y traduce: estados, resultado y cobro por la duración del original", async () => {
    const c = client();
    const languages = await c.listTranslationLanguages();
    assert.ok(languages.includes("English"));
    assert.equal(defaultLanguage(languages), "English (United States)");
    assert.equal(sortLanguages(languages)[0], "English (United States)");
    assert.equal(languageLabel("Portuguese (Brazil)"), "Portugués (Brasil)");
    assert.equal(languageLabel("Klingon"), "Klingon");

    const wallet = (await state()).accounts[KEY]!.wallet.remaining_balance;
    const asset = await uploadToHeyGen(c, open(video, "video/mp4"), { filename: "o.mp4", contentType: "video/mp4", idempotencyKey: "t-4" });
    const [id] = await c.createVideoTranslation(
      { video: { type: "asset_id", asset_id: asset }, output_languages: ["English"], mode: "precision", translate_audio_only: false, speaker_num: 1, keep_the_same_format: true, callback_id: "fila-1", title: "Prueba" },
      "tr-1",
    );
    assert.ok(id);
    // El mismo Idempotency-Key devuelve la misma traducción (un reintento no cobra dos veces).
    const again = await c.createVideoTranslation({ video: { type: "asset_id", asset_id: asset }, output_languages: ["English"], mode: "precision" }, "tr-1");
    assert.equal(again[0], id);

    let t = await c.getVideoTranslation(id!);
    assert.ok(["pending", "running"].includes(t.status));
    assert.equal(translationAsVideo(t).video_url, null);
    for (let i = 0; i < 40 && t.status !== "completed"; i++) {
      await sleep(250);
      t = await c.getVideoTranslation(id!);
    }
    assert.equal(t.status, "completed");
    const v = translationAsVideo(t);
    assert.ok(v.video_url && v.subtitle_url);
    assert.equal(v.status, "completed");
    await sleep(700);
    const charged = wallet - (await state()).accounts[KEY]!.wallet.remaining_balance;
    const expected = estimateTranslation(6, "precision").usd;
    assert.ok(Math.abs(charged - expected) <= 0.02, `cobró ${charged}, estimamos ${expected}`);
  });

  test("la API rechaza campos desconocidos e idiomas que no existen (400 → INVALID)", async () => {
    const c = client();
    const asset = await uploadToHeyGen(c, open(video, "video/mp4"), { filename: "o.mp4", contentType: "video/mp4", idempotencyKey: "t-5" });
    await assert.rejects(c.createVideoTranslation({ video: { type: "asset_id", asset_id: asset }, output_languages: ["Klingon"] }, "tr-2"), (e: unknown) => e instanceof HeyGenError && e.kind === "INVALID");
    await assert.rejects(
      c.createVideoTranslation({ video: { type: "asset_id", asset_id: asset }, output_languages: ["English"], enable_lipsync: true } as never, "tr-3"),
      (e: unknown) => e instanceof HeyGenError && e.kind === "INVALID",
    );
  });

  test("una traducción fallida informa el motivo", async () => {
    const c = client();
    const asset = await uploadToHeyGen(c, open(video, "video/mp4"), { filename: "o.mp4", contentType: "video/mp4", idempotencyKey: "t-6" });
    const [id] = await c.createVideoTranslation({ video: { type: "asset_id", asset_id: asset }, output_languages: ["French"], title: "[falla]", translate_audio_only: true }, "tr-4");
    let t = await c.getVideoTranslation(id!);
    for (let i = 0; i < 40 && t.status !== "failed"; i++) {
      await sleep(250);
      t = await c.getVideoTranslation(id!);
    }
    assert.equal(t.status, "failed");
    assert.match(t.failure_message ?? "", /speaker/);
    assert.equal((await state()).translations.find((x) => x.id === id)!.audioOnly, true);
  });
});

describe("voz clonada y labios", () => {
  test("genera la frase con la voz del clon y devuelve marcas por palabra", async () => {
    const s = await client().generateSpeech({ text: "Hola, esto lo dije bien esta vez", voice_id: "voz_clon_juampi", language: "es" });
    assert.ok(s.audio_url.endsWith(".mp3"));
    assert.ok(s.duration > 1 && s.duration < 5);
    const span = speechSpan(s.duration, s.word_timestamps);
    assert.ok(span.end > span.start && span.end <= s.duration);
  });

  test("si HeyGen dice que la voz no puede ese idioma, el error es INVALID (la app lo explica)", async () => {
    await assert.rejects(client().generateSpeech({ text: "Hello [idioma]", voice_id: "voz_clon_juampi", language: "en" }), (e: unknown) => e instanceof HeyGenError && e.kind === "INVALID");
  });

  test("sincronía de labios de un tramo con la voz nueva", async () => {
    const c = client();
    const wallet = (await state()).accounts[KEY]!.wallet.remaining_balance;
    const clipVideo = await uploadToHeyGen(c, open(video, "video/mp4"), { filename: "tramo.mp4", contentType: "video/mp4", idempotencyKey: "l-1" });
    const wav = join(dir, "voz.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=6", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", wav]);
    const clipAudio = await uploadToHeyGen(c, open(wav, "audio/wav"), { filename: "voz.wav", contentType: "audio/wav", idempotencyKey: "l-2" });
    const id = await c.createLipsync({ video: { type: "asset_id", asset_id: clipVideo }, audio: { type: "asset_id", asset_id: clipAudio }, mode: "speed", enable_dynamic_duration: false, keep_the_same_format: true, callback_id: "fix-1" }, "l-3");
    let l = await c.getLipsync(id);
    for (let i = 0; i < 40 && l.status !== "completed"; i++) {
      await sleep(250);
      l = await c.getLipsync(id);
    }
    assert.equal(l.status, "completed");
    assert.ok(l.video_url);
    assert.equal((await state()).lipsyncs.find((x) => x.id === id)!.body.enable_dynamic_duration, false);
    await sleep(700);
    const charged = wallet - (await state()).accounts[KEY]!.wallet.remaining_balance;
    assert.ok(Math.abs(charged - estimateLipsync(6, "speed").usd) <= 0.02, `cobró ${charged}`);
  });
});

describe("cálculos", () => {
  test("tarifas de traducción de la tabla oficial (19-oct-2026)", () => {
    assert.equal(TRANSLATION_MODES.speed.usdPerMinute, 0.81);
    assert.equal(TRANSLATION_MODES.precision.usdPerMinute, 1.5);
    assert.equal(TRANSLATION_MODES.audio_only.usdPerMinute, 0.57);
    assert.deepEqual(estimateTranslation(90, "speed"), { seconds: 90, usd: 1.22, credits: 24, usdPerMinute: 0.81 });
    assert.equal(balanceShortfall({ unit: "usd", amount: 1, note: null, plan: null }, { usd: 1.22, credits: 24 })?.includes("no alcanza"), true);
    assert.equal(balanceShortfall({ unit: "usd", amount: 5, note: null, plan: null }, { usd: 1.22, credits: 24 }), null);
    assert.equal(balanceShortfall({ unit: "unknown", amount: null, note: null, plan: null }, { usd: 99, credits: 99 }), null);
  });

  const words: Word[] = [
    { id: 0, text: "Hoy", start: 0.2, end: 0.5 },
    { id: 1, text: "te", start: 0.55, end: 0.7 },
    { id: 2, text: "cuento", start: 0.75, end: 1.1 },
    { id: 3, text: "tres", start: 1.6, end: 1.9 },
    { id: 4, text: "errores.", start: 1.95, end: 2.5 },
    { id: 5, text: "Primero", start: 3.4, end: 3.9 },
  ];

  test("la ventana toma parte del silencio de alrededor sin pisar a las vecinas", () => {
    const w = fixWindow(words, 3, 4, 10)!;
    assert.ok(w.start < 1.6 && w.start >= 1.1, `inicio ${w.start}`);
    assert.ok(w.end > 2.5 && w.end <= 2.85 && w.end < 3.4, `fin ${w.end}`);
    assert.deepEqual(fixWindow(words, 0, 0, 10)!.start, 0.1);
    assert.equal(fixWindow(words, 4, 3, 10), null);
    assert.deepEqual(lipsyncClip(w, 2.7), { start: Math.round((w.start - 0.4) * 1000) / 1000, end: 2.7 });
  });

  test("la voz nueva entra si no hay que acelerarla más de ×1,2", () => {
    const w = { start: 1, end: 3 };
    assert.deepEqual(fitSpeech(1.5, w), { ok: true, tempo: 1, gap: 0.5 });
    const fast = fitSpeech(2.3, w);
    assert.ok(fast.ok && fast.tempo === 1.15);
    const slow = fitSpeech(2 * MAX_TEMPO + 0.1, w);
    assert.equal(slow.ok, false);
  });

  test("los subtítulos de la frase nueva se reparten sobre las palabras viejas", () => {
    assert.deepEqual(captionCorrections(3, 4, "cinco errores graves"), { "3": "cinco", "4": "errores graves" });
    assert.deepEqual(captionCorrections(0, 2, "Hola"), { "0": HIDDEN_WORD, "1": HIDDEN_WORD, "2": "Hola" });
    assert.deepEqual(captionCorrections(0, 1, ""), {});
  });
});
