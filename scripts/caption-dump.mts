/**
 * Vuelca, para cada estilo de la galería de subtítulos, el diseño y los bloques con sus pistas (lo mismo que la app
 * manda al worker). Lo usan las pruebas del worker (worker/tests/fixtures/caption-styles.json) y la comparación
 * visual con la vista previa.
 *   node --import tsx scripts/caption-dump.mts <salida.json> [formato] [acento]
 */
import { writeFileSync } from "node:fs";
import { CAPTION_STYLE_KEYS, captionLook, captionTracks } from "../lib/video/caption-styles";
import { captionBlocks } from "../lib/video/captions";
import type { TimedWord, VideoFormat } from "../lib/video/types";

const [out = "captions.json", format = "9:16", accent = "#0070F8"] = process.argv.slice(2);
const text = "Hoy te muestro cómo ganar más dinero con tus videos sin gastar en anuncios.";
let t = 0.3;
const words: TimedWord[] = text.split(" ").map((w, i) => {
  const d = 0.18 + w.length * 0.035;
  const word = { id: i, text: w, start: +t.toFixed(3), end: +(t + d).toFixed(3), emphasis: /dinero|videos/.test(w), stop: /\.$/.test(w) };
  t += d + 0.06;
  return word;
});
const fmt = format as VideoFormat;
const styles = Object.fromEntries(
  CAPTION_STYLE_KEYS.map((style) => {
    const look = captionLook(style, { format: fmt, accent, brandFont: "montserrat", emoji: true });
    const blocks = captionBlocks(words, style);
    return [style, { preset: style, accent, look, blocks: blocks.map((b) => captionTracks(look, b, fmt, accent)), raw: blocks }];
  }),
);
writeFileSync(out, JSON.stringify({ format, words, styles }));
console.log(out);
