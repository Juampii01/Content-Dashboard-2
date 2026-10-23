/**
 * Vuelca el "spec" de cada uno de los 17 efectos sobre un video de prueba (el que deja worker/scripts/make_fx_video.py),
 * con los textos por defecto, la marca de muestra y la cara medida. Lo usan las hojas de contacto de los efectos
 * (worker/scripts/fx_contact.py) y las pruebas.
 *
 *   node --import tsx scripts/fx-dump.mts /tmp/fx/transcript.json [--format 9:16] [--face x,y,w,h] > specs.json
 */
import { readFileSync } from "node:fs";
import { FX_GALLERY_ORDER, FX_INFO, compileFx, fxSegments, type FxKind } from "../lib/video/fx";
import { defaultFx, newFxId, type FxItem } from "../lib/video/fx/schema";
import { buildTimeline } from "../lib/video/timeline";
import type { EditPlan, VideoFormat, Word } from "../lib/video/types";

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("Uso: fx-dump.mts transcript.json [--format 9:16] [--face x,y,w,h]");
  process.exit(2);
}
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const format = (opt("--format") ?? "9:16") as VideoFormat;
const raw = JSON.parse(readFileSync(file, "utf8")) as { words: { text: string; start: number; end: number }[] };
const words: Word[] = raw.words.map((w, id) => ({ id, ...w }));
const duration = (words.at(-1)?.end ?? 1) + 0.5;
const plan = { removals: [], hook_candidates: [], selected_hook: null, corrections: {}, captions: { preset: "caja", emphasis_words: [] } } as unknown as EditPlan;
const timeline = buildTimeline(words, plan, duration);
const face = (opt("--face") ?? "380,560,300,330").split(",").map(Number);

/** Tramos de prueba: ventanas de palabras con la duración ideal de cada efecto, repartidas por el video. */
function rangeFor(kind: FxKind, k: number): { from: number; to: number } {
  const info = FX_INFO[kind];
  const want = Math.min(info.duration.max, Math.max(info.duration.min, kind === "zoom_cut" ? 1 : 3.2));
  const startT = (k * 1.4) % Math.max(1, duration - want - 1);
  const from = words.findIndex((w) => w.start >= startT);
  let to = from;
  while (to + 1 < words.length && words[to + 1]!.end - words[from]!.start <= want) to++;
  return { from: Math.max(0, from), to };
}

const brand = { accent: "#2b8cff", bg: "#030a22", surface: "#0a1a45", text: "#f2f6ff", muted: "#a7b9d4", accentText: "#ffffff", font: "inter" as const };
const out = FX_GALLERY_ORDER.map((kind, k) => {
  const r = rangeFor(kind, k);
  const spoken = words.slice(r.from, r.to + 1);
  const item: FxItem = { id: `prueba-${kind}`, kind, from_word: r.from, to_word: r.to, ...defaultFx(kind, spoken, new Date(2026, 9, 22)) };
  const seg = fxSegments(timeline, [item])[0]!;
  const spec = compileFx({ segment: seg, timeline, format, brand, face: { x: face[0]!, y: face[1]!, w: face[2]!, h: face[3]! }, thumbs: 0, cards: ["Cómo crecer en 30 días", "3 errores al grabar", "Mi rutina", "El gancho perfecto", "Escala tu marca", "Lo que nadie dice"] });
  return { kind, label: FX_INFO[kind].label, sourceStartFrame: Math.round(seg.start * 30), spec };
});
void newFxId;
process.stdout.write(JSON.stringify(out, null, 1));
