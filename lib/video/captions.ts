/**
 * Bloques de subtítulos a partir de las palabras del video final. Lo usan la vista previa (HTML)
 * y el worker (ASS y SRT), así el texto y los tiempos son los mismos en los dos lados.
 */
import { CAPTION_STYLES, isCaptionStyle, styleBlockLimits } from "./caption-styles";
import type { CaptionBlock, CaptionPresetKey, TimedWord } from "./types";

export const CAPTION_PRESETS: Record<CaptionPresetKey, { label: string; description: string }> = {
  clasico: { label: "Clásico", description: "Tres palabras por bloque; la que estás diciendo, en tu color de acento." },
  pop: { label: "Pop", description: "Una o dos palabras grandes, en mayúsculas, que entran con un pequeño salto." },
  caja: { label: CAPTION_STYLES.caja.label, description: CAPTION_STYLES.caja.description },
  hormozi: { label: CAPTION_STYLES.hormozi.label, description: CAPTION_STYLES.hormozi.description },
  karaoke: { label: CAPTION_STYLES.karaoke.label, description: CAPTION_STYLES.karaoke.description },
  palabra: { label: CAPTION_STYLES.palabra.label, description: CAPTION_STYLES.palabra.description },
  minimal: { label: CAPTION_STYLES.minimal.label, description: CAPTION_STYLES.minimal.description },
  resaltador: { label: CAPTION_STYLES.resaltador.label, description: CAPTION_STYLES.resaltador.description },
  estilo: { label: "Del estilo", description: "Copia los subtítulos del video de referencia: posición, tamaño, colores y palabras por bloque." },
  ninguno: { label: "Sin subtítulos", description: "El video sale limpio. Igual recibes el archivo SRT." },
};

const MAX_GAP = 0.45;
/** Si el siguiente bloque empieza casi enseguida, el actual se estira hasta él (sin parpadeo). */
const BRIDGE = 0.35;

/** Orden de los selectores: primero la referencia (si hay), la galería animada, los clásicos y sin subtítulos. */
export const CAPTION_PICKER_ORDER: CaptionPresetKey[] = ["estilo", "caja", "hormozi", "karaoke", "palabra", "minimal", "resaltador", "clasico", "pop", "ninguno"];

export function captionBlocks(words: TimedWord[], preset: CaptionPresetKey, style?: { wordsPerBlock: number } | null): CaptionBlock[] {
  const styled = preset === "estilo" ? Math.max(1, Math.min(6, style?.wordsPerBlock ?? 3)) : null;
  const gallery = isCaptionStyle(preset) ? styleBlockLimits(preset) : null;
  const maxWords = gallery?.words ?? styled ?? (preset === "pop" ? 2 : 3);
  const maxChars = gallery?.chars ?? (styled ? Math.max(12, styled * 9) : preset === "pop" ? 14 : 24);
  const blocks: CaptionBlock[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length) blocks.push({ start: current[0]!.start, end: current[current.length - 1]!.end, words: current });
    current = [];
  };
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1];
    const chars = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    const breakBefore =
      current.length >= maxWords ||
      chars > maxChars ||
      (prev && prev.stop) ||
      (prev && w.start - prev.end > MAX_GAP) ||
      // Pop: una palabra larga va sola.
      (preset === "pop" && current.length === 1 && (current[0]!.text.length > 7 || w.text.length > 7));
    if (breakBefore) flush();
    current.push(w);
  }
  flush();
  for (let i = 0; i < blocks.length - 1; i++) {
    const gap = blocks[i + 1]!.start - blocks[i]!.end;
    if (gap > 0 && gap < BRIDGE) blocks[i]!.end = blocks[i + 1]!.start;
  }
  return blocks;
}

/** Texto de un bloque tal como se ve en pantalla. */
export function blockText(block: CaptionBlock, preset: CaptionPresetKey, style?: { uppercase: boolean } | null): string {
  const text = block.words.map((w) => w.text).join(" ");
  if (isCaptionStyle(preset)) {
    const textCase = CAPTION_STYLES[preset].textCase;
    return textCase === "upper" ? text.toLocaleUpperCase("es") : textCase === "lower" ? text.toLocaleLowerCase("es") : text;
  }
  return preset === "pop" || (preset === "estilo" && style?.uppercase) ? text.toLocaleUpperCase("es") : text;
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** SRT del video final (siempre con bloques de tipo Clásico, que se leen mejor en un reproductor). */
export function toSrt(words: TimedWord[]): string {
  return captionBlocks(words, "clasico")
    .map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.words.map((w) => w.text).join(" ")}\n`)
    .join("\n");
}

/**
 * Mientras se ve un gráfico, el gráfico ya cuenta lo que se dice: los subtítulos se ocultan para no tapar ni
 * competir. Recorta los bloques a lo que queda fuera de esos tramos (con un margen chico).
 */
export function hideDuring(blocks: CaptionBlock[], spans: { start: number; end: number }[], margin = 0.05): CaptionBlock[] {
  if (!spans.length) return blocks;
  const inside = (t: number) => spans.some((s) => t >= s.start - margin && t < s.end + margin);
  const out: CaptionBlock[] = [];
  for (const b of blocks) {
    let run: CaptionBlock["words"] = [];
    const flush = () => {
      if (run.length) out.push({ ...b, start: Math.max(b.start, run[0]!.start), end: Math.min(b.end, run[run.length - 1]!.end), words: run });
      run = [];
    };
    for (const w of b.words) {
      if (inside((w.start + w.end) / 2)) flush();
      else run.push(w);
    }
    flush();
  }
  return out;
}
