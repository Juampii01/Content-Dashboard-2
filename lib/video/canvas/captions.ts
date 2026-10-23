/**
 * Lugar de los subtítulos desde el lienzo de la revisión: posición y tamaño de todos (globales del video) y, si la
 * persona lo pide, de una línea en particular (un bloque, por el id de su primera palabra).
 *
 * Solo los estilos de la galería (lib/video/caption-styles.ts): la vista previa (caption-overlay.tsx) y el ASS del worker
 * (worker/video/ass.py, `caption_anchor`) ubican cada bloque con `captionAnchor`, así salen en el mismo lugar. Sin
 * rotación ni animación propia: cómo entran las palabras lo decide el estilo. Sin servidor.
 */
import { z } from "zod";
import { cleanTransform, IDENTITY_TRANSFORM, transformSchema, type Transform } from "./transform";
import type { CaptionLook } from "../caption-styles";
import type { CaptionBlock } from "../types";

/** Lugar ya resuelto de un bloque (lo que viaja con el bloque a la vista previa y al worker). */
export type CaptionPlace = { x: number; y: number; scale: number };

export const MAX_CAPTION_LINES = 200;

export const captionLinesSchema = z.record(z.string().regex(/^\d+$/), transformSchema);

export type CaptionPlacement = { transform?: Transform; lines?: Record<string, Transform> };

/** Clave de un bloque: el id de su primera palabra (estable mientras no cambien los cortes de ese tramo). */
export const captionBlockKey = (block: Pick<CaptionBlock, "words">): string | null => (block.words[0] ? String(block.words[0].id) : null);

/** Lugar de los subtítulos limpio: sin rotación, ids de palabra válidos y sin lo que quedó como siempre. */
export function cleanCaptionPlacement(raw: { transform?: unknown; lines?: unknown } | null | undefined, wordCount: number): CaptionPlacement {
  if (!raw) return {};
  const out: CaptionPlacement = {};
  const transform = cleanTransform(raw.transform, { rotation: false });
  if (transform) out.transform = transform;
  if (raw.lines && typeof raw.lines === "object") {
    const lines: Record<string, Transform> = {};
    for (const [id, t] of Object.entries(raw.lines as Record<string, unknown>).slice(0, MAX_CAPTION_LINES)) {
      const n = Number(id);
      if (!/^\d+$/.test(id) || n >= wordCount) continue;
      // Una línea "como siempre" igual se guarda si hay un global: así esa línea no se mueve con los demás.
      const clean = cleanTransform(t, { rotation: false }) ?? (out.transform ? { ...IDENTITY_TRANSFORM } : undefined);
      if (clean) lines[String(n)] = clean;
    }
    if (Object.keys(lines).length) out.lines = lines;
  }
  return out;
}

/** Los bloques con su lugar: el de su línea si lo tiene, si no el de todos. Sin lugar, el bloque queda igual. */
export function placeCaptionBlocks(blocks: CaptionBlock[], placement: CaptionPlacement | null | undefined): CaptionBlock[] {
  if (!placement || (!placement.transform && !placement.lines)) return blocks;
  return blocks.map((b) => {
    const key = captionBlockKey(b);
    const t = (key && placement.lines?.[key]) || placement.transform;
    if (!t || (t.x === 0 && t.y === 0 && t.scale === 1)) return b;
    return { ...b, place: { x: t.x, y: t.y, scale: t.scale } };
  });
}

/**
 * Centro, tamaño de 1 em y ancho máximo de un bloque en píxeles del video final (el mismo cálculo que `caption_anchor`
 * del worker). Agrandar también agranda el ancho máximo (hasta el 96 % del cuadro) para que el bloque no se achique solo.
 */
export function captionAnchor(look: Pick<CaptionLook, "y" | "size" | "maxWidth">, place: CaptionPlace | null | undefined, W: number, H: number): { cx: number; cy: number; em: number; maxW: number } {
  const p = place ?? { x: 0, y: 0, scale: 1 };
  return {
    cx: W * (0.5 + p.x),
    cy: H * (look.y + p.y),
    em: look.size * H * p.scale,
    maxW: Math.min(W * 0.96, look.maxWidth * W * p.scale),
  };
}
