#!/usr/bin/env node
/**
 * Render de un gráfico animado del editor con el motor (lib/video/motion, empaquetado en engine.mjs) y skia-canvas:
 * dibuja cada cuadro y lo manda en RGBA a ffmpeg. Pantalla completa → MP4 H.264; sobre el video → MOV qtrle con
 * alfa (el grafo de render.py lo compone como cualquier b-roll).
 *
 * Entrada (JSON por stdin): { graphic: <spec v1 o escena v2>, width, height, duration, out, fps?, fontsDir?, preset? }
 * Salida (JSON por stdout): { ok: true, frames, ms } o { ok: false, error } con código distinto de 0.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Canvas } from "skia-canvas";
import { loadEngine, registerFonts } from "./lib.mjs";

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
const { graphic, width, height, duration, out } = input;
const fps = input.fps ?? 30;
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 4096 || height > 4096) fail("Tamaño inválido.", 2);
if (!(duration > 0 && duration <= 30) || typeof out !== "string" || !out) fail("Duración o salida inválidas.", 2);

const started = Date.now();
const engine = await loadEngine();
const families = registerFonts(input.fontsDir);
const format = height > width ? "9:16" : "16:9";
const scene = engine.toMotionScene(graphic, { duration, format });
if (!scene) fail("El gráfico no es válido.", 3);

const canvas = new Canvas(width, height);
const ctx = canvas.getContext("2d");
const compiled = engine.compileScene(scene, { width, height, measure: engine.measureWith(ctx), fonts: families });
const frames = Math.max(1, Math.round(duration * fps));
const overlay = scene.mode === "overlay";
const codec = overlay ? ["-c:v", "qtrle", "-pix_fmt", "argb"] : ["-c:v", "libx264", "-preset", input.preset || "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-g", String(fps)];
const ff = spawn(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", "-frames:v", String(frames), ...codec, "-an", out],
  { stdio: ["pipe", "ignore", "pipe"] },
);
let stderr = "";
ff.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
const closed = new Promise((resolve) => ff.on("close", resolve));
ff.stdin.on("error", () => {});

for (let i = 0; i < frames; i++) {
  engine.renderFrame(ctx, compiled, i / fps);
  const data = ctx.getImageData(0, 0, width, height).data;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (ff.exitCode != null) break;
}
ff.stdin.end();
const code = await closed;
if (code !== 0) fail(`ffmpeg terminó con código ${code}: ${stderr.trim()}`, 4);
process.stdout.write(JSON.stringify({ ok: true, frames, ms: Date.now() - started, notes: compiled.notes }) + "\n");
