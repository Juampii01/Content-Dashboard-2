/**
 * Hojas de cuadros de las composiciones (para mirarlas y pulirlas): cada muestra (o un archivo .js) sobre la persona de
 * muestra (public/efectos/demo.jpg con su recorte), dibujada con el mismo motor que el worker (sandbox de Node + motor
 * de efectos + skia-canvas). Valida cada una antes.
 *
 *   node --import tsx scripts/compos-stills.mts <carpeta de salida> [clave…] [--file comp.js] [--format 16:9] [--image foto.jpg]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { FxRenderer, WORKER_FONTS, type FxCtx } from "../lib/video/fx/engine";
import { compileComposition } from "../lib/video/compos/schema";
import { COMPOS_SAMPLES } from "../lib/video/compos/samples";
import { NodeSandbox } from "../lib/video/compos/sandbox-node";
import { validateComposition, sampleTimes } from "../lib/video/compos/validate";
import type { Composition } from "../lib/video/compos/schema";
import type { VideoFormat } from "../lib/video/types";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(join(root, "worker/motion/package.json"));
const { Canvas, loadImage, FontLibrary } = require("skia-canvas");
const fonts = join(root, "worker/fonts");
const registerFont = FontLibrary.use.bind(FontLibrary);
for (const [fam, files] of Object.entries({
  Inter: ["Inter-Medium", "Inter-SemiBold", "Inter-Bold", "Inter-ExtraBold", "Inter-Black"],
  Montserrat: ["Montserrat-Medium", "Montserrat-SemiBold", "Montserrat-Bold", "Montserrat-ExtraBold", "Montserrat-Black"],
  "Instrument Serif": ["InstrumentSerif-Regular", "InstrumentSerif-Italic"],
  "JetBrains Mono": ["JetBrainsMono-Medium", "JetBrainsMono-Bold"],
  Caveat: ["Caveat"],
  Anton: ["Anton-Regular"],
})) registerFont(fam, files.map((f) => join(fonts, `${f}.ttf`)));

const args = process.argv.slice(2);
const outDir = args[0] ?? "/tmp/compos";
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const format = (opt("--format") ?? "9:16") as VideoFormat;
const keys = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
mkdirSync(outDir, { recursive: true });

const W = format === "9:16" ? 1080 : 1920;
const H = format === "9:16" ? 1920 : 1080;
const demo = await loadImage(join(root, "public/efectos/demo.jpg"));
const alpha = await loadImage(join(root, "public/efectos/demo-alpha.png"));
// Cuadro y máscara al tamaño de salida (en 16:9, la persona centrada sobre un fondo).
const frame = new Canvas(W, H);
const fctx = frame.getContext("2d");
const mask = new Canvas(W, H);
const mctx = mask.getContext("2d");
if (format === "9:16") {
  fctx.drawImage(demo, 0, 0, W, H);
  mctx.drawImage(alpha, 0, 0, W, H);
} else {
  fctx.filter = "blur(30px)";
  fctx.drawImage(demo, -200, -900, W + 400, H * 3.2);
  fctx.filter = "none";
  fctx.drawImage(demo, (W - H * 0.5625) / 2, 0, H * 0.5625, H);
  mctx.drawImage(alpha, (W - H * 0.5625) / 2, 0, H * 0.5625, H);
}
const face = format === "9:16" ? { x: 338 * 2, y: 648, w: 264 * 2, h: 322 * 2 } : { x: 860, y: 280, w: 200, h: 250 };
const faceBox = format === "9:16" ? { x: 300, y: 500, w: 360, h: 340 } : face;
const extraImage = opt("--image") ? await loadImage(opt("--image")!) : null;

const brand = { accent: "#2b8cff", bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accentText: "#ffffff", font: "montserrat" as const };
const sentence = "Te voy a contar el error que más dinero me hizo perder este año y cómo lo arreglé en solo tres pasos simples";
const parts = sentence.split(" ");

const list = opt("--file")
  ? [{ key: "archivo", name: "archivo", code: readFileSync(opt("--file")!, "utf8"), params: [], sounds: [], hide_captions: true, tags: [], use: "" }]
  : COMPOS_SAMPLES.filter((s) => !keys.length || keys.includes(s.key));

const renderer = new FxRenderer({ makeCanvas: (w: number, h: number) => { const c = new Canvas(w, h); return { canvas: c, ctx: c.getContext("2d") as unknown as FxCtx }; }, fonts: WORKER_FONTS });

for (const s of list) {
  const duration = 3.6;
  const step = (duration - 0.4) / parts.length;
  const words = parts.map((text, i) => ({ id: i, text, start: 0.2 + i * step, end: 0.2 + i * step + step * 0.85, emphasis: i === 9, stop: false }));
  const item: Composition = { id: `muestra-${s.key}`, from_word: 0, to_word: parts.length - 1, name: s.name, code: s.code, params: s.params, source: "director", hide_captions: s.hide_captions, ...(s.key === "image_focus" && extraImage ? { images: [{ id: "g0", key: "x", width: extraImage.width, height: extraImage.height, prompt: "mapa" }] } : {}) };
  const spec = compileComposition({ item, start: 0, end: duration, timeline: { words }, format, brand, face: faceBox, captionsVisible: true });
  const check = await validateComposition(s.code, spec.compos!.env);
  console.log(s.key, check.ok ? `ok ${JSON.stringify(check.stats)}` : `FALLA ${check.error} (línea ${check.line})`);
  if (!check.ok) continue;
  const opened = await NodeSandbox.open(s.code, spec.compos!.env);
  if (!opened.ok) continue;
  const times = sampleTimes(duration, 10).filter((_, i) => i % 1 === 0).slice(0, 12);
  const tw = format === "9:16" ? 270 : 384;
  const th = format === "9:16" ? 480 : 216;
  const cols = 6;
  const sheet = new Canvas(tw * cols, th * Math.ceil(times.length / cols));
  const sctx = sheet.getContext("2d");
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext("2d");
  for (const [i, t] of times.entries()) {
    const r = await opened.sandbox.frame(t);
    if (!r.ok) {
      console.log("  cuadro", t, r.error);
      continue;
    }
    renderer.render(ctx as unknown as FxCtx, spec, t, { frame, mask, images: extraImage ? { g0: extraImage } : {}, compos: r.frame }, 1);
    sctx.drawImage(canvas, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
    sctx.fillStyle = "rgba(0,0,0,.6)";
    sctx.fillRect((i % cols) * tw, Math.floor(i / cols) * th, 70, 26);
    sctx.fillStyle = "#fff";
    sctx.font = "16px Inter";
    sctx.fillText(`${t.toFixed(2)} s`, (i % cols) * tw + 6, Math.floor(i / cols) * th + 19);
    if (i === Math.floor(times.length / 2)) await canvas.toFile(join(outDir, `${s.key}-${format.replace(":", "x")}-grande.png`));
  }
  await opened.sandbox.close();
  await sheet.toFile(join(outDir, `${s.key}-${format.replace(":", "x")}.png`));
}
