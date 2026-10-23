/**
 * Recorte de la persona: qué segundos del original necesitan máscara y dónde están sus tiras para la vista previa. La
 * clave del encuadre es la misma que arma el worker (worker/video/fx_mask.framing_key). Sin servidor.
 */
import { FX_INFO } from "./catalog";
import { fxSegments, OUTPUT, sourceFramesOf } from "./compile";
import type { Timeline } from "../timeline";
import type { EditPlan, VideoFormat } from "../types";

/** Igual que MASK_VERSION en worker/video/fx_mask.py (las pruebas lo comparan). */
export const FX_MASK_VERSION = "mp2";
/** Cuadros por bloque de máscara (un segundo del original). */
export const FX_MASK_CHUNK = 30;

export function fxMaskKey(srcW: number, srcH: number, format: VideoFormat, offsetX: number): string {
  const { w, h } = OUTPUT[format];
  const wide = srcW / srcH > (w / h) * 1.02;
  const off = wide ? Math.round(Math.max(-1, Math.min(1, offsetX)) * 100) : 0;
  return `${format.replace(":", "x")}-o${off < 0 ? "m" : "p"}${String(Math.abs(off)).padStart(3, "0")}-${FX_MASK_VERSION}`;
}

/** Bloques (segundos del original) que usan los efectos con recorte del plan. */
export function maskChunksFor(plan: Pick<EditPlan, "effects">, timeline: Pick<Timeline, "clips" | "words" | "duration">): number[] {
  const out = new Set<number>();
  for (const seg of fxSegments(timeline, plan.effects ?? [])) {
    if (!FX_INFO[seg.item.kind].mask) continue;
    const frames = Math.max(1, Math.round((seg.end - seg.start) * 30));
    for (const f of sourceFramesOf(timeline, seg.start, frames)) out.add(Math.floor(f / FX_MASK_CHUNK));
  }
  return [...out].sort((a, b) => a - b);
}

/** Bloque y recuadro de la tira para un instante del original (la tira tiene `fps` máscaras por segundo). */
export function maskTileAt(sourceTime: number, fps: number): { chunk: number; index: number } {
  const frame = Math.max(0, Math.round(sourceTime * 30));
  const chunk = Math.floor(frame / FX_MASK_CHUNK);
  const index = Math.min(fps - 1, Math.max(0, Math.round(((frame - chunk * FX_MASK_CHUNK) * fps) / FX_MASK_CHUNK)));
  return { chunk, index };
}
