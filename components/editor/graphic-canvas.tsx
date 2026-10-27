"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { compileScene, measureWith, renderFrame, toMotionScene, type CompiledScene, type MotionCanvas, type MotionScene } from "@/lib/video/motion";
import type { GraphicSpec } from "@/lib/video/graphics";
import type { VideoFormat } from "@/lib/video/types";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { cn } from "@/lib/utils";

/**
 * Vista previa de un gráfico del b-roll: dibuja en un <canvas> la misma escena que el worker con el motor de
 * motion graphics (lib/video/motion), con las mismas fuentes (Inter y Montserrat) medidas en el navegador.
 * Acepta un gráfico v1 (plantilla) o una escena v2.
 */

/** Familias CSS de las fuentes del motor en el navegador (Inter viene de globals.css). */
export const BROWSER_FAMILIES = { inter: '"Inter"', montserrat: '"Montserrat Grafico"', body: '"Inter"' };

// ─── Fuentes ──────────────────────────────────────────────────────────────

let fontsState: "idle" | "loading" | "ready" = "idle";
const listeners = new Set<() => void>();

function loadFonts() {
  if (fontsState !== "idle" || typeof document === "undefined") return;
  fontsState = "loading";
  const faces = [
    new FontFace("Montserrat Grafico", "url(/fonts/carrusel/montserrat-latin-wght-normal.woff2) format('woff2')", {
      weight: "100 900",
      unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    }),
    new FontFace("Montserrat Grafico", "url(/fonts/carrusel/montserrat-latin-ext-wght-normal.woff2) format('woff2')", {
      weight: "100 900",
      unicodeRange: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+2020, U+20A0-20AB, U+20AD-20C0, U+2C60-2C7F, U+A720-A7FF",
    }),
  ];
  for (const f of faces) document.fonts.add(f);
  const sample = "Aa1áéíóúñ“%";
  Promise.all([
    ...faces.map((f) => f.load()),
    ...[500, 600, 700, 800, 900].flatMap((w) => [document.fonts.load(`${w} 40px "Inter"`, sample), document.fonts.load(`${w} 40px "Montserrat Grafico"`, sample)]),
  ])
    .catch(() => undefined)
    .finally(() => {
      fontsState = "ready";
      listeners.forEach((l) => l());
    });
}

/** `true` cuando las fuentes de los gráficos están cargadas (antes, las medidas saldrían con otra fuente). */
export function useGraphicFonts(): boolean {
  const ready = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => fontsState === "ready",
    () => false,
  );
  useEffect(loadFonts, []);
  return ready;
}

let measureCtx: MotionCanvas | null = null;
/** Medición de textos con las fuentes reales del navegador (para validar lo que se edita a mano). */
export function measurer() {
  measureCtx ??= document.createElement("canvas").getContext("2d") as unknown as MotionCanvas;
  return measureWith(measureCtx);
}

export const formatSize = (format: VideoFormat) => (format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

/** Escena compilada lista para dibujar (null mientras cargan las fuentes o si el gráfico no es válido). */
export function useMotionScene(graphic: GraphicSpec | MotionScene | null, format: VideoFormat, duration: number): CompiledScene | null {
  const ready = useGraphicFonts();
  return useMemo(() => {
    if (!ready || !graphic) return null;
    const scene = toMotionScene(graphic, { duration: Math.max(0.6, duration), format });
    if (!scene) return null;
    const { width, height } = formatSize(format);
    return compileScene(scene, { width, height, measure: measurer(), fonts: BROWSER_FAMILIES });
  }, [ready, graphic, format, duration]);
}

/**
 * Canvas del gráfico. Con `time` dibuja ese instante (lo maneja la vista previa del video); sin `time` se
 * reproduce solo en bucle (con "menos movimiento", queda quieto en el momento de lectura).
 */
export function GraphicCanvas({
  spec,
  format,
  duration,
  time,
  scale = 0.5,
  className,
  label,
  compiled,
}: {
  spec: GraphicSpec | MotionScene;
  format: VideoFormat;
  duration: number;
  time?: number;
  /** Resolución del canvas respecto del video (0,5 = 540×960 en vertical). */
  scale?: number;
  className?: string;
  label?: string;
  /** Escena ya compilada por quien la muestra (la vista previa la usa también para la caja del lienzo). */
  compiled?: CompiledScene | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const own = useMotionScene(compiled ? null : spec, format, duration);
  const scene = compiled ?? own;
  const reduced = usePrefersReducedMotion();
  const { width, height } = formatSize(format);
  const [loopTime, setLoopTime] = useState(0);
  const controlled = time != null;

  useEffect(() => {
    if (controlled || !scene || reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // Bucle: el gráfico completo y medio segundo de pausa.
      const cycle = scene.duration + 0.6;
      setLoopTime(Math.min(scene.duration, ((now - start) / 1000) % cycle));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controlled, scene, reduced]);

  const t = controlled ? time : reduced ? (scene ? Math.max(0, scene.exit.start - 0.05) : 0) : loopTime;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !scene) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderFrame(ctx as unknown as MotionCanvas, scene, Math.max(0, Math.min(t, scene.duration)), { pixelScale: scale });
  }, [scene, t, scale]);

  return (
    <canvas
      ref={canvas}
      width={Math.round(width * scale)}
      height={Math.round(height * scale)}
      className={cn("block h-full w-full", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
