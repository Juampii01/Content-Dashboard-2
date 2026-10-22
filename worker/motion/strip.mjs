#!/usr/bin/env node
/**
 * Tira de cuadros de una escena (control de calidad): dibuja varios instantes con el motor empaquetado y los pone
 * uno al lado del otro en un PNG. En "overlay" usa un fondo de prueba que simula un video.
 *
 *   echo '{"scene": {...}, "times": [0.2, 0.6, 1.5], "scale": 0.3}' | node worker/motion/strip.mjs salida.png
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Canvas } from "skia-canvas";
import { loadEngine, registerFonts } from "./lib.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Uso: strip.mjs salida.png < escena.json");
  process.exit(2);
}
const input = JSON.parse(readFileSync(0, "utf8"));
const engine = await loadEngine();
const families = registerFonts(input.fontsDir);
const scene = engine.sceneSchema.parse(input.scene);
const { width, height } = engine.formatSize(scene.format);
const scale = input.scale ?? 0.3;
const times = input.times ?? [0.15, 0.45, 0.9, scene.duration * 0.6, scene.duration - 0.25];
const fw = Math.round(width * scale);
const fh = Math.round(height * scale);
const gap = 12;
const sheet = new Canvas(times.length * fw + (times.length - 1) * gap, fh);
const sctx = sheet.getContext("2d");
sctx.fillStyle = "#111";
sctx.fillRect(0, 0, sheet.width, sheet.height);

const frame = new Canvas(width, height);
const ctx = frame.getContext("2d");
const compiled = engine.compileScene(scene, { width, height, measure: engine.measureWith(ctx), fonts: families });
for (const note of compiled.notes) console.error(note);
times.forEach((t, i) => {
  ctx.clearRect(0, 0, width, height);
  if (scene.mode === "overlay") fakeVideo(ctx, width, height);
  engine.renderFrame(ctx, compiled, t, { clear: false });
  sctx.drawImage(frame, i * (fw + gap), 0, fw, fh);
  sctx.fillStyle = "rgba(0,0,0,.6)";
  sctx.fillRect(i * (fw + gap), 0, 70, 26);
  sctx.fillStyle = "#fff";
  sctx.font = "16px Inter";
  sctx.fillText(`${t.toFixed(2)} s`, i * (fw + gap) + 8, 19);
});
writeFileSync(out, await sheet.toBuffer("png"));
console.log(out);

/** Fondo que simula un video de una persona hablando (sin imágenes externas). */
function fakeVideo(c, w, h) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#5b5146");
  g.addColorStop(1, "#1f1b17");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * (h > w ? 0.45 : 0.5);
  const r = Math.min(w, h) * 0.2;
  const face = c.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r * 1.3);
  face.addColorStop(0, "#d9b89a");
  face.addColorStop(1, "rgba(160,120,95,0)");
  c.fillStyle = face;
  c.beginPath();
  c.ellipse(cx, cy, r * 0.9, r * 1.15, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#2c3a4f";
  c.beginPath();
  c.ellipse(cx, cy + r * 2.6, r * 2.1, r * 1.4, 0, 0, Math.PI * 2);
  c.fill();
}
