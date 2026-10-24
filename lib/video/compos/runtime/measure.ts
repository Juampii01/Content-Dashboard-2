/**
 * Medición de texto de las composiciones con tablas de anchos (font-metrics.ts): la usan el runtime del sandbox
 * (measureText) y el que dibuja la lista (letra a letra con interletrado), así los dos miden igual.
 */
import { FONT_CODES, FONT_METRICS } from "./font-metrics";

const CODE_INDEX = new Map<number, number>();
FONT_CODES.forEach((c, i) => CODE_INDEX.set(c, i));

export const FONT_RE = /^\s*(italic\s+|oblique\s+|normal\s+)?(small-caps\s+)?(\d{3}|bold|normal|lighter|bolder)?\s*([\d.]+)px\s+(.+)$/i;

type FontFace = { adv: number[]; asc: number; desc: number; cap: number };

export function parseFont(font: string): { face: FontFace; size: number } {
  const m = FONT_RE.exec(font);
  const size = m ? Number(m[4]) : 10;
  const weightRaw = m?.[3]?.toLowerCase();
  const weight = weightRaw === "bold" ? 700 : weightRaw && /^\d+$/.test(weightRaw) ? Number(weightRaw) : 400;
  const italic = Boolean(m?.[1] && /italic|oblique/i.test(m[1]));
  const family = (m?.[5] ?? "Inter").split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  return { face: faceFor(family, weight, italic), size: Number.isFinite(size) ? size : 10 };
}

function faceFor(family: string, weight: number, italic: boolean): FontFace {
  const fam = Object.keys(FONT_METRICS).some((k) => k.startsWith(`${family}|`)) ? family : "Inter";
  let best: FontFace | null = null;
  let bestD = Infinity;
  for (const [k, v] of Object.entries(FONT_METRICS)) {
    const [f, w, s] = k.split("|");
    if (f !== fam) continue;
    const d = Math.abs(Number(w) - weight) + (s === (italic ? "italic" : "normal") ? 0 : 1000);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best ?? FONT_METRICS["Inter|500|normal"]!;
}

export function measure(font: string, spacing: number, text: string) {
  const { face, size } = parseFont(font);
  let w = 0;
  let n = 0;
  for (const ch of String(text)) {
    const i = CODE_INDEX.get(ch.codePointAt(0)!);
    w += i == null ? 620 : face.adv[i]!;
    n++;
  }
  const width = (w * size) / 1000 + spacing * n;
  return {
    width,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    actualBoundingBoxAscent: (face.cap * size) / 1000,
    actualBoundingBoxDescent: (face.desc * size) / 1000 * 0.6,
    fontBoundingBoxAscent: (face.asc * size) / 1000,
    fontBoundingBoxDescent: (face.desc * size) / 1000,
  };
}

