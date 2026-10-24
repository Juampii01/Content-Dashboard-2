#!/usr/bin/env node
/**
 * Render de un efecto del editor con el motor de efectos (lib/video/fx/engine, empaquetado en fx-engine.mjs) y
 * skia-canvas: lee los cuadros del tramo (ya encuadrados, del tamaño del video final) y, si el efecto la usa, la máscara
 * de la persona (cuadros en gris, en un archivo crudo), dibuja cada cuadro con el motor y lo manda a ffmpeg (H.264).
 *
 * Entrada (JSON por stdin): { spec, base, mask?: { path, width, height }, images?: { t0: ruta… }, out, fps?, fontsDir?,
 *   preset?, stills?: [segundos…] (en lugar del video: un PNG por instante en out-<n>.png) }
 * Salida (JSON por stdout): { ok: true, frames, ms, perFrame } o { ok: false, error }.
 *
 * Composiciones (spec.kind "composition"): el código de Claude corre en el sandbox (compos-engine.mjs: hilo aparte con
 * memoria acotada, vm sin generación de código, tiempo por cuadro) y devuelve la lista de dibujo de cada cuadro, que
 * dibuja el motor de efectos. Si falla, sale con { ok: false, compos: true, error } y el worker la descarta con aviso.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { Canvas, ImageData, loadImage } from "skia-canvas";
import { loadComposEngine, loadFxEngine, registerFxFonts } from "./lib.mjs";

let isCompos = false;
function fail(error, code = 1) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error), ...(isCompos ? { compos: true } : {}) }) + "\n");
  process.exit(code);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  fail("La entrada no es un JSON válido.", 2);
}
const { spec, base, out } = input;
const fps = input.fps ?? 30;
if (!spec || typeof spec !== "object" || spec.v !== 1) fail("El efecto no es válido.", 2);
const W = spec.width;
const H = spec.height;
if (!Number.isInteger(W) || !Number.isInteger(H) || W < 16 || H < 16 || W > 4096 || H > 4096) fail("Tamaño inválido.", 2);
if (!(spec.duration > 0 && spec.duration <= 30) || typeof out !== "string" || !out || typeof base !== "string") fail("Duración, entrada o salida inválidas.", 2);

const started = Date.now();
isCompos = spec.kind === "composition";
let sandbox = null;
if (isCompos) {
  if (!spec.compos || typeof spec.compos.code !== "string" || !spec.compos.env) fail("La composición no trae su código.", 2);
  const compos = await loadComposEngine();
  const opened = await compos.NodeSandbox.open(spec.compos.code, spec.compos.env);
  if (!opened.ok) fail(`La animación no se pudo cargar: ${opened.error}`, 5);
  sandbox = opened.sandbox;
}
const engine = await loadFxEngine();
try {
  registerFxFonts(input.fontsDir);
} catch (e) {
  fail(e.message, 3);
}

const makeCanvas = (w, h) => {
  const canvas = new Canvas(w, h);
  return { canvas, ctx: canvas.getContext("2d") };
};
const renderer = new engine.FxRenderer({ makeCanvas, fonts: engine.WORKER_FONTS });

// Miniaturas (las que no se pueden leer se saltan: el motor dibuja una tarjeta con la marca).
const images = {};
for (const [key, path] of Object.entries(input.images ?? {})) {
  try {
    images[key] = await loadImage(path);
  } catch {
    process.stderr.write(`no se pudo leer la imagen ${key}\n`);
  }
}

const frames = Math.max(1, Math.round(spec.duration * fps));
// Cuadros del tramo, en RGBA.
const dec = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", base, "-frames:v", String(frames), "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-"], { stdio: ["ignore", "pipe", "pipe"] });
let decErr = "";
dec.stderr.on("data", (d) => (decErr = (decErr + d).slice(-1500)));
const frameBytes = W * H * 4;
// Cada cuadro se copia una sola vez a su propio búfer (concatenar trozos de 64 KB sobre un cuadro de 8 MB era lentísimo).
let current = Buffer.allocUnsafe(frameBytes);
let filled = 0;
const queue = [];
let decDone = false;
let wake = null;
dec.stdout.on("data", (chunk) => {
  let off = 0;
  while (off < chunk.length) {
    const n = Math.min(frameBytes - filled, chunk.length - off);
    chunk.copy(current, filled, off, off + n);
    filled += n;
    off += n;
    if (filled === frameBytes) {
      queue.push(current);
      current = Buffer.allocUnsafe(frameBytes);
      filled = 0;
    }
  }
  if (queue.length > 4) dec.stdout.pause();
  wake?.();
});
dec.stdout.on("end", () => {
  decDone = true;
  wake?.();
});
async function nextFrame() {
  while (!queue.length && !decDone) await new Promise((r) => (wake = r));
  wake = null;
  const f = queue.shift() ?? null;
  if (queue.length <= 2) dec.stdout.resume();
  return f;
}

// Máscara: archivo crudo (un byte por píxel, un cuadro detrás del otro) → lienzo RGBA blanco con alfa.
let maskFd = null;
const mw = input.mask?.width ?? 0;
const mh = input.mask?.height ?? 0;
const maskCanvas = input.mask ? new Canvas(mw, mh) : null;
const maskRgba = input.mask ? new Uint8ClampedArray(mw * mh * 4).fill(255) : null;
const maskGray = input.mask ? Buffer.alloc(mw * mh) : null;
if (input.mask) maskFd = openSync(input.mask.path, "r");
function readMask(i) {
  const n = readSync(maskFd, maskGray, 0, mw * mh, i * mw * mh);
  if (n < mw * mh) return false;
  for (let p = 0, q = 3; p < maskGray.length; p++, q += 4) maskRgba[q] = maskGray[p];
  maskCanvas.getContext("2d").clearRect(0, 0, mw, mh);
  maskCanvas.getContext("2d").putImageData(new ImageData(maskRgba, mw, mh), 0, 0);
  return true;
}

const frameCanvas = new Canvas(W, H);
const frameCtx = frameCanvas.getContext("2d");
const canvas = new Canvas(W, H);
const ctx = canvas.getContext("2d");

const stills = Array.isArray(input.stills) ? input.stills : null;
const enc = stills
  ? null
  : spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "-", "-frames:v", String(frames), "-c:v", "libx264", "-preset", input.preset || "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-g", String(fps), "-an", out],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
let encErr = "";
enc?.stderr.on("data", (d) => (encErr = (encErr + d).slice(-1500)));
const closed = enc ? new Promise((resolve) => enc.on("close", resolve)) : Promise.resolve(0);
enc?.stdin.on("error", () => {});

const wantStill = stills ? new Map(stills.map((s, k) => [Math.min(frames - 1, Math.max(0, Math.round(s * fps))), k])) : null;
let drawMs = 0;
let last = null;
for (let i = 0; i < frames; i++) {
  const raw = (await nextFrame()) ?? last;
  if (!raw) fail(`No se pudieron leer los cuadros del tramo: ${decErr.trim()}`, 4);
  last = raw;
  if (wantStill && !wantStill.has(i)) continue;
  const t0 = Date.now();
  // skia-canvas graba todo lo dibujado: borrar antes de cada cuadro evita que la lectura repita los anteriores.
  frameCtx.clearRect(0, 0, W, H);
  frameCtx.putImageData(new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), W, H), 0, 0);
  const hasMask = input.mask ? readMask(i) : false;
  let compos = null;
  if (sandbox) {
    const r = await sandbox.frame(i / fps);
    if (!r.ok) {
      await sandbox.close();
      fail(`La animación falló en el segundo ${(i / fps).toFixed(2)}: ${r.error}`, 5);
    }
    compos = r.frame;
  }
  renderer.render(ctx, spec, i / fps, { frame: frameCanvas, mask: hasMask ? maskCanvas : null, images, compos }, 1);
  drawMs += Date.now() - t0;
  if (wantStill) {
    // toFile (saveAs es el nombre viejo y en skia-canvas 3 no espera a que se escriba el archivo).
    await (canvas.toFile ?? canvas.saveAs).call(canvas, `${out}-${wantStill.get(i)}.png`);
    continue;
  }
  const data = ctx.getImageData(0, 0, W, H).data;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once("drain", r));
  if (enc.exitCode != null) break;
}
dec.kill();
if (sandbox) await sandbox.close();
if (maskFd != null) closeSync(maskFd);
enc?.stdin.end();
const code = await closed;
if (code !== 0) fail(`ffmpeg terminó con código ${code}: ${encErr.trim()}`, 4);
const drawn = wantStill ? wantStill.size : frames;
process.stdout.write(JSON.stringify({ ok: true, frames: drawn, ms: Date.now() - started, perFrame: Math.round(drawMs / Math.max(1, drawn)) }) + "\n");
process.exit(0);
