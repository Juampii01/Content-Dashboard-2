/**
 * Del plan al dibujo: tramos de los efectos en el video final y su "spec" (todo en píxeles y segundos del efecto) que
 * dibujan la vista previa y el worker con el mismo motor. Una sola fuente de verdad: lo que se ve en la revisión es lo
 * que sale en el MP4. Sin servidor.
 */
import { outputRange, type Timeline } from "../timeline";
import { FPS, type VideoFormat } from "../types";
import { FX_INFO, type FxKind } from "./catalog";
import type { FxItem } from "./schema";
import { FX_MOVABLE } from "./catalog";
import { cleanPlace, type Place } from "../canvas/transform";

export const FX_VERSION = 1;

export type Box = { x: number; y: number; w: number; h: number };

export type FxWord = { t0: number; t1: number; text: string; stop: boolean; strong: boolean };

export type FxSpec = {
  v: 1;
  id: string;
  kind: FxKind;
  /** Semilla estable (inclinaciones, posiciones, temblor). */
  seed: number;
  start: number;
  end: number;
  duration: number;
  format: VideoFormat;
  width: number;
  height: number;
  text: string;
  items: string[];
  kicker: string;
  /** Colores de la marca. */
  accent: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accentText: string;
  display: "inter" | "montserrat";
  /** Cara (en píxeles del video final): hacia donde apuntan los zooms y lo que nunca se tapa. */
  face: Box;
  /** Palabras del tramo en segundos del efecto. */
  words: FxWord[];
  /** Momentos (segundos del efecto) en que aparece cada ítem / cada palabra fuerte. */
  marks: number[];
  /** Corte del video final dentro del tramo (segundos del efecto), si hay. */
  cut: number | null;
  /** Claves de las imágenes (miniaturas de tus reels): "t0", "t1"… */
  thumbs: string[];
  /** Títulos de respaldo para las tarjetas si no hay miniaturas. */
  cards: string[];
  /** Necesita el recorte de la persona. */
  mask: boolean;
  /** Lugar y animación del elemento movible (lienzo de la revisión). Sin esto, como siempre. */
  place?: Place;
};

export type FxSegment = { id: string; start: number; end: number; item: FxItem };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Los efectos van a la rejilla de cuadros (el worker los dibuja cuadro a cuadro). */
const snap = (t: number) => Math.round(t * FPS) / FPS;

/** Tramos de los efectos en el video final (como el b-roll): sin pisarse, dentro del video, con su duración mínima. */
export function fxSegments(timeline: Pick<Timeline, "words" | "duration">, items: FxItem[]): FxSegment[] {
  const out: FxSegment[] = [];
  for (const item of [...items].sort((a, b) => a.from_word - b.from_word)) {
    const range = outputRange(timeline, item.from_word, item.to_word);
    if (!range) continue;
    const info = FX_INFO[item.kind];
    let start = Math.max(0, range.start - 0.05);
    let end = Math.min(timeline.duration, range.end + 0.15);
    if (item.kind === "zoom_cut") {
      // Una transición dura poco: se centra en el tramo.
      const mid = (start + end) / 2;
      const half = Math.min(info.duration.max, Math.max(info.duration.min, end - start)) / 2;
      start = Math.max(0, mid - half);
      end = Math.min(timeline.duration, mid + half);
    }
    if (end - start > info.duration.max) end = start + info.duration.max;
    if (end - start < info.duration.min) end = Math.min(timeline.duration, start + info.duration.min);
    const prev = out[out.length - 1];
    if (prev && start < prev.end) start = prev.end;
    start = snap(start);
    end = snap(end);
    if (end - start < 0.5) continue;
    out.push({ id: item.id, start: round3(start), end: round3(end), item });
  }
  return out;
}

// ─── Encuadre: de la cara medida en el original al video final ───────────

export const OUTPUT: Record<VideoFormat, { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 } };

/** Dónde cae el original en el video final (el mismo recorte que el render: worker/video/fx_mask.framing_filter). */
export function framingMap(srcW: number, srcH: number, format: VideoFormat, offsetX: number): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number; pillar: boolean } {
  const { w: W, h: H } = OUTPUT[format];
  const target = W / H;
  const ratio = srcW / srcH;
  if (ratio > target * 1.02) {
    const cropW = Math.min(srcW, Math.round((srcH * target) / 2) * 2);
    const free = srcW - cropW;
    const x = Math.max(0, Math.min(free, Math.round((free / 2) * (1 + Math.max(-1, Math.min(1, offsetX))))));
    return { sx: x, sy: 0, sw: cropW, sh: srcH, dx: 0, dy: 0, dw: W, dh: H, pillar: false };
  }
  if (ratio < target / 1.02 && format === "16:9") {
    const dw = Math.round((H * ratio) / 2) * 2;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (W - dw) / 2, dy: 0, dw, dh: H, pillar: true };
  }
  // Mismo formato (o casi): cubre el cuadro, recortado al centro.
  const scale = Math.max(W / srcW, H / srcH);
  const sw = W / scale;
  const sh = H / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh, dx: 0, dy: 0, dw: W, dh: H, pillar: false };
}

type FaceSample = { t: number; face: { x: number; y: number; w: number; h: number } | null };

/** Cara del tramo en píxeles del video final: la mediana de las caras medidas en los segundos del original. */
export function faceAnchor(samples: FaceSample[], sourceRanges: { start: number; end: number }[], srcW: number, srcH: number, format: VideoFormat, offsetX: number): Box {
  const { w: W, h: H } = OUTPUT[format];
  const map = framingMap(srcW, srcH, format, offsetX);
  const inRange = samples.filter((s) => s.face && sourceRanges.some((r) => s.t >= r.start - 1 && s.t <= r.end + 1));
  const pool = inRange.length ? inRange : samples.filter((s) => s.face);
  const fallback: Box = { x: W * 0.36, y: H * (format === "9:16" ? 0.22 : 0.2), w: W * (format === "9:16" ? 0.28 : 0.16), h: H * (format === "9:16" ? 0.17 : 0.3) };
  if (!pool.length) return fallback;
  const med = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  const nx = med(pool.map((s) => s.face!.x));
  const ny = med(pool.map((s) => s.face!.y));
  const nw = med(pool.map((s) => s.face!.w));
  const nh = med(pool.map((s) => s.face!.h));
  const kx = map.dw / map.sw;
  const ky = map.dh / map.sh;
  const box = { x: map.dx + (nx * srcW - map.sx) * kx, y: map.dy + (ny * srcH - map.sy) * ky, w: nw * srcW * kx, h: nh * srcH * ky };
  // Fuera del cuadro (recorte muy corrido): se usa el lugar de siempre.
  if (box.x + box.w < 0 || box.x > W || box.y + box.h < 0 || box.y > H) return fallback;
  return { x: round1(box.x), y: round1(box.y), w: round1(box.w), h: round1(box.h) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Tramos del original que se ven durante el efecto (para la cara y para la máscara). */
export function sourceRangesOf(timeline: Pick<Timeline, "clips">, start: number, end: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let acc = 0;
  for (const c of timeline.clips) {
    const dur = (c.endFrame - c.startFrame) / FPS;
    const a = Math.max(start, acc);
    const b = Math.min(end, acc + dur);
    if (b > a) out.push({ start: c.startFrame / FPS + (a - acc), end: c.startFrame / FPS + (b - acc) });
    acc += dur;
  }
  return out;
}

/** Cuadros del original de cada cuadro del efecto (el worker los usa para leer la máscara). */
export function sourceFramesOf(timeline: Pick<Timeline, "clips">, start: number, frames: number): number[] {
  const out: number[] = [];
  const startFrame = Math.round(start * FPS);
  let acc = 0;
  let ci = 0;
  for (let i = 0; i < frames; i++) {
    const f = startFrame + i;
    while (ci < timeline.clips.length && f >= acc + (timeline.clips[ci]!.endFrame - timeline.clips[ci]!.startFrame)) {
      acc += timeline.clips[ci]!.endFrame - timeline.clips[ci]!.startFrame;
      ci++;
    }
    const c = timeline.clips[Math.min(ci, timeline.clips.length - 1)];
    out.push(c ? Math.min(c.endFrame - 1, c.startFrame + (f - acc)) : 0);
  }
  return out;
}

// ─── Spec ─────────────────────────────────────────────────────────────────

export type FxBrand = { accent: string; bg: string; surface: string; text: string; muted: string; accentText: string; font: "inter" | "montserrat" };

/** Colores y fuente de Mi marca (el mismo "look" de los gráficos). */
export function fxBrandFromLook(look: { theme: { accent: string; bg: string; surface: string; text: string; muted: string; accentText: string }; font: "inter" | "montserrat" }): FxBrand {
  const t = look.theme;
  return { accent: t.accent, bg: t.bg, surface: t.surface, text: t.text, muted: t.muted, accentText: t.accentText, font: look.font };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Momentos en que se dice cada ítem (la primera palabra que coincide); si no se encuentra, repartidos en el tramo. */
export function revealMarks(items: string[], words: FxWord[], duration: number): number[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9ñ ]+/g, " ")
      .trim();
  const ws = words.map((w) => norm(w.text));
  const marks: number[] = [];
  let from = 0;
  items.forEach((item, k) => {
    const keys = norm(item)
      .split(/\s+/)
      .filter((x) => x.length >= 4);
    let hit = -1;
    for (let i = from; i < ws.length && hit < 0; i++) if (keys.some((key) => ws[i]!.startsWith(key.slice(0, Math.max(4, key.length - 2))))) hit = i;
    if (hit >= 0) {
      marks.push(words[hit]!.t0);
      from = hit + 1;
    } else marks.push(round3(0.6 + ((duration - 1) * (k + 0.5)) / Math.max(1, items.length)));
  });
  // Siempre en orden y separados al menos 0,25 s.
  for (let i = 1; i < marks.length; i++) if (marks[i]! < marks[i - 1]! + 0.25) marks[i] = round3(marks[i - 1]! + 0.25);
  return marks;
}

export function compileFx(input: {
  segment: FxSegment;
  timeline: Pick<Timeline, "words" | "clips" | "duration">;
  format: VideoFormat;
  brand: FxBrand;
  face: Box;
  corrections?: Record<string, string>;
  thumbs: number;
  cards?: string[];
}): FxSpec {
  const { segment: seg, timeline, format, brand } = input;
  const item = seg.item;
  const { w: W, h: H } = OUTPUT[format];
  const duration = round3(seg.end - seg.start);
  const strong = new Set(item.words ?? []);
  const words: FxWord[] = timeline.words
    .filter((w) => w.end > seg.start && w.start < seg.end)
    .map((w) => ({ t0: round3(Math.max(0, w.start - seg.start)), t1: round3(Math.min(duration, w.end - seg.start)), text: w.text, stop: w.stop, strong: strong.has(w.id) }));
  const info = FX_INFO[item.kind];
  const items = (item.items ?? []).filter(Boolean);
  let marks: number[] = [];
  if (item.kind === "checklist" || item.kind === "green_screen") marks = revealMarks(items, words, duration);
  else if (item.kind === "digital_zoom") marks = words.filter((w) => w.strong).map((w) => w.t0);
  // Corte del video final dentro del tramo (para la transición con zoom): el más cercano al centro.
  let cut: number | null = null;
  if (item.kind === "zoom_cut") {
    let acc = 0;
    const cuts: number[] = [];
    for (const [i, c] of timeline.clips.entries()) {
      if (i > 0) cuts.push(acc);
      acc += (c.endFrame - c.startFrame) / FPS;
    }
    const inside = cuts.filter((t) => t > seg.start + 0.1 && t < seg.end - 0.1).sort((a, b) => Math.abs(a - (seg.start + seg.end) / 2) - Math.abs(b - (seg.start + seg.end) / 2));
    cut = inside.length ? round3(inside[0]! - seg.start) : null;
  }
  return {
    v: 1,
    id: item.id,
    kind: item.kind,
    seed: seedOf(item.id),
    start: seg.start,
    end: seg.end,
    duration,
    format,
    width: W,
    height: H,
    text: (item.text ?? "").trim(),
    items,
    kicker: (item.kicker ?? "").trim(),
    accent: item.accent ?? brand.accent,
    bg: brand.bg,
    surface: brand.surface,
    ink: brand.text,
    muted: brand.muted,
    accentText: brand.accentText,
    display: brand.font,
    face: input.face,
    words,
    marks,
    cut,
    thumbs: info.thumbs ? Array.from({ length: Math.min(8, input.thumbs) }, (_, i) => `t${i}`) : [],
    cards: info.thumbs ? (input.cards ?? []).slice(0, 8) : [],
    mask: info.mask,
    ...fxPlace(item),
  };
}

/** El lugar del elemento movible de un efecto (solo si el efecto lo tiene y cambió algo). */
function fxPlace(item: FxItem): { place?: Place } {
  const movable = FX_MOVABLE[item.kind];
  if (!movable) return {};
  const place = cleanPlace({ transform: item.transform, anim: item.anim }, { rotation: movable.rotation });
  return place ? { place } : {};
}

/** Tramos (segundos del video final) donde un efecto oculta los subtítulos. */
export function fxCaptionHides(segments: FxSegment[]): { start: number; end: number }[] {
  return segments.filter((s) => FX_INFO[s.item.kind].captions === "hide").map((s) => ({ start: s.start, end: s.end }));
}
