#!/usr/bin/env node
/**
 * Música generada del editor (licencia propia): arma la pista con el mismo generador que la vista previa
 * (lib/video/music-gen, empaquetado en music-engine.mjs) y la guarda en WAV mono de 16 bits.
 *
 * Entrada (JSON por stdin): { spec: { style, seed, bpm }, seconds, out, sampleRate? }
 * Salida (JSON por stdout): { ok: true, ms, samples } o { ok: false, error }.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function fail(error, code = 1) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error) }) + "\n");
  process.exit(code);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  fail("La entrada no es un JSON válido.", 2);
}
const { spec, seconds, out } = input;
const styles = ["lofi", "corporativo", "trap", "ambiente", "acustico", "tension", "epica"];
if (!spec || !styles.includes(spec.style) || !Number.isInteger(spec.seed) || !Number.isInteger(spec.bpm)) fail("La música no es válida.", 2);
if (!(seconds > 0 && seconds <= 600) || typeof out !== "string" || !out) fail("Duración o salida inválidas.", 2);
const sr = input.sampleRate ?? 48000;
const here = dirname(fileURLToPath(import.meta.url));
const engine = await import(pathToFileURL(process.env.MUSIC_ENGINE || join(here, "music-engine.mjs")).href);
const t0 = Date.now();
const samples = engine.renderMusic(spec, { seconds, sampleRate: sr });
writeFileSync(out, engine.toWav(samples, sr));
process.stdout.write(JSON.stringify({ ok: true, ms: Date.now() - t0, samples: samples.length, version: engine.MUSIC_ENGINE_VERSION }) + "\n");
