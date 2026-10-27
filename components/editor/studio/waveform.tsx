"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Peaks } from "@/lib/video/peaks";
import { fadeGainAt } from "@/lib/video/audio-mix";
import type { SfxName } from "@/lib/video/sfx-library";
import { sfxBuffer } from "../sound/use-sound";
import { peaksOfBuffer } from "./use-studio-mix";

/**
 * Formas de onda de la línea de tiempo. La de una pista entera (voz, música) se dibuja en un canvas del ancho de lo que
 * se ve (pegado al borde con `sticky`), así un zoom grande no crea un canvas gigante; la de un sonido, en un SVG chico
 * dentro de su bloque.
 */

/** Picos de los sonidos de la biblioteca que están en la línea de tiempo (los mismos WAV del render). */
export function useSfxPeaks(names: SfxName[]): Partial<Record<SfxName, Peaks>> {
  const [map, setMap] = useState<Partial<Record<SfxName, Peaks>>>({});
  const key = [...new Set(names)].sort().join(",");
  useEffect(() => {
    let alive = true;
    for (const name of key ? (key.split(",") as SfxName[]) : []) {
      void sfxBuffer(name).then((buf) => {
        const p = peaksOfBuffer(buf);
        if (alive && p) setMap((m) => (m[name] ? m : { ...m, [name]: p }));
      });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

/** Forma de onda de un sonido recortado (`from` y `length`, s del archivo) con sus fundidos, para su bloque. */
export function MiniWave({ peaks, from, length, fadeIn = 0, fadeOut = 0, className }: { peaks: Peaks | undefined; from: number; length: number; fadeIn?: number; fadeOut?: number; className?: string }) {
  if (!peaks || length <= 0) return null;
  const n = Math.max(8, Math.min(160, Math.round(length * 60)));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * length;
    const k = Math.min(peaks.peak.length - 1, Math.max(0, Math.floor((from + t) * peaks.rate)));
    const k2 = Math.min(peaks.peak.length - 1, Math.floor((from + t + length / n) * peaks.rate));
    let v = 0;
    for (let j = k; j <= Math.max(k, k2); j++) v = Math.max(v, peaks.peak[j] ?? 0);
    v *= fadeGainAt(t, 0, length, fadeIn, fadeOut);
    const x = (i / n) * 100;
    top.push(`${x.toFixed(2)},${(50 - v * 46).toFixed(2)}`);
    bottom.unshift(`${x.toFixed(2)},${(50 + v * 46).toFixed(2)}`);
  }
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className={className}>
      <polygon points={[...top, ...bottom].join(" ")} fill="currentColor" />
    </svg>
  );
}

/**
 * Forma de onda de una pista larga, del ancho de lo que se ve. `columns(t0, t1, n)` da la altura (0 a 1) de cada
 * columna; `marks`, líneas finas (los cortes, en la voz). Se vuelve a dibujar al hacer scroll o al cambiar `version`.
 */
export function ViewportWave({
  scroller,
  labelWidth,
  pps,
  duration,
  height,
  columns,
  version,
  color,
  marks = [],
}: {
  scroller: RefObject<HTMLDivElement | null>;
  labelWidth: number;
  pps: number;
  duration: number;
  height: number;
  columns: (t0: number, t1: number, n: number) => Float32Array;
  version: string;
  color: string;
  marks?: number[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ left: 0, width: 600 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: Math.max(50, el.clientWidth - labelWidth) }));
    };
    on();
    el.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", on);
      ro.disconnect();
    };
  }, [scroller, labelWidth]);

  const marksKey = marks.join(",");
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(view.width);
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const t0 = view.left / pps;
    const t1 = Math.min(duration, (view.left + w) / pps);
    const n = Math.max(1, Math.round(Math.max(0, t1 - t0) * pps));
    if (t1 <= t0) return;
    const cols = columns(t0, t1, n);
    const mid = height / 2;
    g.fillStyle = color;
    for (let i = 0; i < cols.length; i++) {
      const h = Math.max(0.5, cols[i]! * (height / 2 - 2));
      g.fillRect(i, mid - h, 1, h * 2);
    }
    g.fillStyle = "rgba(22,23,27,.35)";
    for (const m of marksKey ? marksKey.split(",").map(Number) : []) {
      const x = (m - t0) * pps;
      if (x >= 0 && x <= w) g.fillRect(Math.round(x), 0, 1, height);
    }
    // `columns` cambia con `version` (lo arma el Estudio con los datos de cada pista).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pps, duration, height, version, color, marksKey]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none sticky block" style={{ left: labelWidth, width: view.width, height }} />;
}
