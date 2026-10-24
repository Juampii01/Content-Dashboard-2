#!/usr/bin/env node
/**
 * Tablas de anchos de letra de las composiciones (lib/video/compos/runtime/font-metrics.ts): el `measureText` del
 * sandbox no puede usar el lienzo real (el código generado no toca nada de afuera), así que mide con estas tablas,
 * iguales en la vista previa y en el render. Se arman con skia-canvas y las fuentes del worker:
 *   cd worker/motion && npm ci && cd ../.. && sh worker/scripts/fetch_fonts.sh worker/fonts && node scripts/compos-fonts.mjs
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "worker/motion/package.json"));
const { Canvas, FontLibrary } = require("skia-canvas");
const fonts = join(root, "worker/fonts");

const FACES = [
  ["Inter", 500, "Inter-Medium"],
  ["Inter", 600, "Inter-SemiBold"],
  ["Inter", 700, "Inter-Bold"],
  ["Inter", 800, "Inter-ExtraBold"],
  ["Inter", 900, "Inter-Black"],
  ["Montserrat", 500, "Montserrat-Medium"],
  ["Montserrat", 600, "Montserrat-SemiBold"],
  ["Montserrat", 700, "Montserrat-Bold"],
  ["Montserrat", 800, "Montserrat-ExtraBold"],
  ["Montserrat", 900, "Montserrat-Black"],
  ["Instrument Serif", 400, "InstrumentSerif-Regular"],
  ["JetBrains Mono", 500, "JetBrainsMono-Medium"],
  ["JetBrains Mono", 700, "JetBrainsMono-Bold"],
  ["Caveat", 400, "Caveat"],
  ["Caveat", 700, "Caveat"],
  ["Anton", 400, "Anton-Regular"],
];
const byFamily = {};
for (const [fam, , file] of FACES) (byFamily[fam] ??= new Set()).add(join(fonts, `${file}.ttf`));
byFamily["Instrument Serif"].add(join(fonts, "InstrumentSerif-Italic.ttf"));
const register = FontLibrary.use.bind(FontLibrary);
for (const [fam, files] of Object.entries(byFamily)) register(fam, [...files]);

// Latin-1 imprimible + signos que se usan en textos de video.
const EXTRA = "‘’“”–—…€•✓✔✗✕→←↑↓×÷≈≠≤≥°%№™®©¿¡·";
const codes = [];
for (let c = 32; c <= 255; c++) if (c < 127 || c >= 160) codes.push(c);
for (const ch of EXTRA) codes.push(ch.codePointAt(0));

const ctx = new Canvas(64, 64).getContext("2d");
const out = {};
for (const [fam, weight] of FACES) {
  for (const style of fam === "Instrument Serif" ? ["normal", "italic"] : ["normal"]) {
    ctx.font = `${style === "italic" ? "italic " : ""}${weight} 1000px "${fam}"`;
    const adv = codes.map((c) => Math.round(ctx.measureText(String.fromCodePoint(c)).width));
    const m = ctx.measureText("Hxgjé");
    const cap = ctx.measureText("H");
    out[`${fam}|${weight}|${style}`] = {
      adv,
      asc: Math.round(m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 900),
      desc: Math.round(m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 250),
      cap: Math.round(cap.actualBoundingBoxAscent ?? 700),
    };
  }
}
const body = `// Generado por scripts/compos-fonts.mjs (no lo edites a mano). Anchos a 1000 px con skia-canvas.\nexport const FONT_CODES: number[] = ${JSON.stringify(codes)};\nexport const FONT_METRICS: Record<string, { adv: number[]; asc: number; desc: number; cap: number }> = ${JSON.stringify(out)};\n`;
writeFileSync(join(root, "lib/video/compos/runtime/font-metrics.ts"), body);
console.log(`font-metrics.ts listo: ${Object.keys(out).length} caras, ${codes.length} letras, ${Math.round(body.length / 1024)} KB`);
