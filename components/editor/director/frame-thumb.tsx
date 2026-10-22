import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Grilla de una hoja de contacto (la misma que arma el worker en worker/video/eyes.py). */
export type SheetGrid = { tileW: number; tileH: number; cols: number; rows: number; labelH: number };
export type ThumbSheet = { url: string; frames: number[] };

/** La grilla que usa el worker para un video de este tamaño (vertical, horizontal o cuadrado). */
export function gridFor(width: number, height: number): SheetGrid {
  const ratio = width / Math.max(1, height);
  if (ratio < 0.8) return { tileW: 216, tileH: 384, cols: 6, rows: 3, labelH: 22 };
  if (ratio > 1.25) return { tileW: 384, tileH: 216, cols: 4, rows: 5, labelH: 22 };
  return { tileW: 288, tileH: 288, cols: 5, rows: 4, labelH: 22 };
}

/**
 * Miniatura de un cuadro recortada de su hoja de contacto (sin pedir otra imagen): la hoja es una grilla de cuadros
 * con una franja de texto debajo de cada uno; se muestra solo el cuadro con background-position en porcentajes.
 * `frame` es el número del cuadro (#1, #2…). Si la hoja no lista sus cuadros, se cuentan en orden.
 */
export function FrameThumb({ sheets, grid, frame, className, label }: { sheets: ThumbSheet[]; grid: SheetGrid; frame: number | null; className?: string; label?: string }) {
  const per = grid.cols * grid.rows;
  let sheet: ThumbSheet | undefined;
  let k = -1;
  if (frame != null) {
    sheet = sheets.find((s) => s.frames.includes(frame));
    if (sheet) k = sheet.frames.indexOf(frame);
    else if (sheets.every((s) => !s.frames.length)) {
      sheet = sheets[Math.floor((frame - 1) / per)];
      k = (frame - 1) % per;
    }
  }
  const ratio = `${grid.tileW} / ${grid.tileH}`;
  if (!sheet || k < 0) return <div className={cn("rounded-lg bg-white/[0.06]", className)} style={{ aspectRatio: ratio }} aria-hidden />;
  const col = k % grid.cols;
  const row = Math.floor(k / grid.cols);
  const rowH = grid.tileH + grid.labelH;
  const totalH = grid.rows * rowH;
  const style: CSSProperties = {
    aspectRatio: ratio,
    backgroundImage: `url("${sheet.url}")`,
    backgroundSize: `${grid.cols * 100}% ${(totalH / grid.tileH) * 100}%`,
    backgroundPosition: `${grid.cols > 1 ? (col / (grid.cols - 1)) * 100 : 0}% ${totalH > grid.tileH ? ((row * rowH) / (totalH - grid.tileH)) * 100 : 0}%`,
    backgroundRepeat: "no-repeat",
  };
  return <div role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("rounded-lg bg-black/40", className)} style={style} />;
}
