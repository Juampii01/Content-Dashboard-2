/**
 * Transcripción con tiempos del video publicado, para cruzarla con la curva de retención.
 * - Subtítulos (.srt o .vtt) que el cliente baja de YouTube Studio o que el worker trae de YouTube.
 * - Un video del Editor: sus palabras con los tiempos del video final (sin los cortes, con el gancho al principio).
 * Sin dependencias de servidor: se prueba sola.
 */
import { buildTimeline } from "@/lib/video/timeline";
import type { EditPlan, Transcript } from "@/lib/video/types";
import type { TranscriptSegment } from "./types";

export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string): number | null {
  const m = TIME.exec(stamp);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms!.padEnd(3, "0")) / 1000;
}

/** Quita etiquetas de VTT/SRT (<c>, <00:00:01.000>, <i>, {\an8}) y entidades comunes. */
function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\[(música|music|aplausos|applause|risas|laughter)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lee un archivo .srt o .vtt y devuelve los tramos con sus tiempos. Los subtítulos automáticos de YouTube repiten
 * la línea anterior en cada cue ("efecto rodillo"): las líneas repetidas se descartan.
 */
export function parseSubtitles(raw: string): TranscriptSegment[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const out: TranscriptSegment[] = [];
  let previousLines = new Set<string>();
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx]!.split("-->");
    const start = seconds(a ?? "");
    const end = seconds(b ?? "");
    if (start == null || end == null || end < start) continue;
    const cueLines = lines.slice(timeIdx + 1).map(cleanCueText).filter(Boolean);
    const fresh = cueLines.filter((l) => !previousLines.has(l));
    previousLines = new Set(cueLines);
    const body = fresh.join(" ").trim();
    if (!body) continue;
    const last = out[out.length - 1];
    // Cues de pocos milisegundos con el mismo texto (subtítulos automáticos): se unen.
    if (last && last.text === body) {
      last.end = round2(Math.max(last.end, end));
      continue;
    }
    out.push({ start: round2(start), end: round2(Math.max(end, start + 0.2)), text: body });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Agrupa palabras con tiempo en frases cortas (hasta ~12 palabras, se corta en pausas y finales de oración). */
export function wordsToSegments(words: { text: string; start: number; end: number; stop?: boolean }[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let current: { start: number; end: number; parts: string[] } | null = null;
  const close = () => {
    if (current?.parts.length) out.push({ start: round2(current.start), end: round2(current.end), text: current.parts.join(" ").replace(/\s+([,.;:!?…])/g, "$1") });
    current = null;
  };
  for (const w of words) {
    const t = w.text.trim();
    if (!t) continue;
    if (current && (w.start - current.end > 0.6 || current.parts.length >= 12)) close();
    if (!current) current = { start: w.start, end: w.end, parts: [] };
    current.parts.push(t);
    current.end = w.end;
    if (w.stop || /[.?!…]$/.test(t)) close();
  }
  close();
  return out;
}

/** Transcripción del video final de un proyecto del Editor (los tiempos del video exportado, que es el publicado). */
export function editorSegments(transcript: Transcript | null | undefined, plan: EditPlan | null | undefined, duration: number | null): TranscriptSegment[] {
  const words = transcript?.words ?? [];
  if (!words.length) return [];
  if (!plan) return wordsToSegments(words);
  const timeline = buildTimeline(words, plan, duration ?? transcript?.duration ?? words[words.length - 1]!.end);
  return wordsToSegments(timeline.words);
}

/** Valida y recorta lo que llega de afuera (worker o subida): tiempos ordenados, textos cortos, un máximo de tramos. */
export function sanitizeSegments(segments: TranscriptSegment[], max = 5000): TranscriptSegment[] {
  return segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start && s.start >= 0 && s.text.trim())
    .sort((a, b) => a.start - b.start)
    .slice(0, max)
    .map((s) => ({ start: round2(s.start), end: round2(s.end), text: s.text.trim().slice(0, 400) }));
}

export function segmentsText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
}
