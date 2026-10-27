/**
 * Forma de onda de la voz (la mide el worker: worker/video/peaks.py). Picos y RMS por ventana de 1/rate s del video
 * original, en 0..255 con raíz cuadrada (v = 255·√a). Aquí se decodifica y se pasa al tiempo del video final con los
 * tramos del timeline: lo usan la línea de tiempo (dibujo) y los medidores de la vista previa. Sin servidor.
 */
import type { Timeline } from "./timeline";
import { FPS, type MediaInfo } from "./types";

export const PEAKS_VERSION = 1;

/** Lo que guarda el worker en `media.peaks`. */
export type PeaksMedia = { version: number; key: string; rate: number; count: number };

/** Lo que recibe el navegador: los dos arreglos ya decodificados (amplitud lineal 0 a 1). */
export type Peaks = { rate: number; peak: Float32Array; rms: Float32Array };

/** Lo que manda el servidor (base64, como lo subió el worker). */
export type PeaksPayload = { rate: number; peak: string; rms: string };

export function peaksOf(media: Pick<MediaInfo, "peaks"> | null | undefined): PeaksMedia | null {
  const p = media?.peaks;
  return p && p.version === PEAKS_VERSION && typeof p.key === "string" && p.rate > 0 ? p : null;
}

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function decodePeaks(payload: PeaksPayload): Peaks {
  const lin = (bytes: Uint8Array) => {
    const out = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i]! / 255) ** 2;
    return out;
  };
  return { rate: payload.rate, peak: lin(fromBase64(payload.peak)), rms: lin(fromBase64(payload.rms)) };
}

/** Segundo del original que suena en el segundo `t` del video final (null fuera de los tramos). */
export function sourceTimeAt(timeline: Pick<Timeline, "clips">, t: number): number | null {
  let acc = 0;
  for (const c of timeline.clips) {
    const d = (c.endFrame - c.startFrame) / FPS;
    if (t >= acc && t < acc + d) return c.startFrame / FPS + (t - acc);
    acc += d;
  }
  return null;
}

/** Nivel (RMS lineal) de la voz original en el segundo `t` del video final; 0 fuera de los tramos. */
export function voiceLevelAt(peaks: Peaks, timeline: Pick<Timeline, "clips">, t: number): number {
  const src = sourceTimeAt(timeline, t);
  if (src == null) return 0;
  const i = Math.floor(src * peaks.rate);
  // Una ventana de 60 ms (como un medidor de verdad: no salta con cada ventana de 20 ms).
  let sum = 0;
  let n = 0;
  for (let k = i - 1; k <= i + 1; k++) {
    if (k < 0 || k >= peaks.rms.length) continue;
    sum += peaks.rms[k]! ** 2;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * Columnas de la forma de onda para dibujar `[t0, t1]` del video final en `columns` píxeles: el pico más alto de cada
 * columna (0 a 1). Recorre los tramos: lo que sale de cada uno es su pedazo del original.
 */
export function waveColumns(peaks: Peaks, timeline: Pick<Timeline, "clips">, t0: number, t1: number, columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, columns));
  if (columns <= 0 || t1 <= t0) return out;
  const step = (t1 - t0) / columns;
  // Mapa de los tramos: inicio en el final y en el original.
  const map: { o0: number; o1: number; s0: number }[] = [];
  let acc = 0;
  for (const c of timeline.clips) {
    const d = (c.endFrame - c.startFrame) / FPS;
    map.push({ o0: acc, o1: acc + d, s0: c.startFrame / FPS });
    acc += d;
  }
  let j = 0;
  for (let col = 0; col < columns; col++) {
    const a = t0 + col * step;
    const b = a + step;
    let max = 0;
    while (j < map.length && map[j]!.o1 <= a) j++;
    for (let m = j; m < map.length && map[m]!.o0 < b; m++) {
      const seg = map[m]!;
      const sa = seg.s0 + Math.max(a, seg.o0) - seg.o0;
      const sb = seg.s0 + Math.min(b, seg.o1) - seg.o0;
      const i0 = Math.max(0, Math.floor(sa * peaks.rate));
      const i1 = Math.min(peaks.peak.length - 1, Math.max(i0, Math.ceil(sb * peaks.rate) - 1));
      for (let i = i0; i <= i1; i++) if (peaks.peak[i]! > max) max = peaks.peak[i]!;
    }
    out[col] = max;
  }
  return out;
}

/** Picos de un AudioBuffer (música o un sonido) a `rate` ventanas por segundo, para dibujarlos igual que la voz. */
export function bufferPeaks(channel: Float32Array, sampleRate: number, rate = 50): Peaks {
  const hop = Math.max(1, Math.round(sampleRate / rate));
  const n = Math.ceil(channel.length / hop);
  const peak = new Float32Array(n);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    let sum = 0;
    const end = Math.min(channel.length, (i + 1) * hop);
    for (let k = i * hop; k < end; k++) {
      const v = Math.abs(channel[k]!);
      if (v > max) max = v;
      sum += v * v;
    }
    peak[i] = max;
    rms[i] = Math.sqrt(sum / Math.max(1, end - i * hop));
  }
  return { rate: sampleRate / hop, peak, rms };
}

/** Columnas de unos picos «planos» (un archivo que suena desde `start` en el video final, sin tramos). */
export function plainColumns(peaks: Peaks, start: number, t0: number, t1: number, columns: number, loop = false): Float32Array {
  const out = new Float32Array(Math.max(0, columns));
  if (columns <= 0 || t1 <= t0 || !peaks.peak.length) return out;
  const step = (t1 - t0) / columns;
  const len = peaks.peak.length;
  for (let col = 0; col < columns; col++) {
    const a = (t0 + col * step - start) * peaks.rate;
    const b = (t0 + (col + 1) * step - start) * peaks.rate;
    let max = 0;
    for (let i = Math.floor(a); i < Math.max(Math.floor(a) + 1, Math.ceil(b)); i++) {
      const k = loop ? ((i % len) + len) % len : i;
      if (k < 0 || k >= len) continue;
      if (peaks.peak[k]! > max) max = peaks.peak[k]!;
    }
    out[col] = max;
  }
  return out;
}

/** dBFS de una amplitud lineal (con piso en -60). */
export const toDbfs = (a: number) => (a > 0.001 ? Math.max(-60, 20 * Math.log10(a)) : -60);
