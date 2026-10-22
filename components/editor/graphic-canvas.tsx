"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildScene, counterText, elementState, type Element, type FontRef, type Measure, type Paint, type Run, type Scene } from "@/lib/video/graphic-scene";
import type { GraphicSpec } from "@/lib/video/graphics";
import type { VideoFormat } from "@/lib/video/types";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { cn } from "@/lib/utils";

/**
 * Vista previa de un gráfico del b-roll: dibuja en un <canvas> la misma escena que el worker
 * (lib/video/graphic-scene.ts), con las mismas fuentes (Inter y Montserrat) medidas en el navegador.
 */

const FAMILY: Record<FontRef["family"], string> = { inter: '"Inter"', montserrat: '"Montserrat Grafico"' };
const fontCss = (f: FontRef, size: number) => `${f.weight} ${Math.round(size)}px ${FAMILY[f.family]}`;

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
    ...[700, 800, 900].flatMap((w) => [document.fonts.load(`${w} 40px "Inter"`, sample), document.fonts.load(`${w} 40px "Montserrat Grafico"`, sample)]),
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

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();
const measure: Measure = (text, font, size) => {
  if (!text) return 0;
  const key = `${font.family}|${font.weight}|${Math.round(size)}|${text}`;
  const hit = measureCache.get(key);
  if (hit != null) return hit;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = fontCss(font, size);
  const w = measureCtx.measureText(text).width;
  if (measureCache.size > 5000) measureCache.clear();
  measureCache.set(key, w);
  return w;
};

// ─── Dibujo ───────────────────────────────────────────────────────────────

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
}

function drawBackground(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { width: w, height: h, theme } = scene;
  if (scene.mode === "full") {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w * 0.5, -h * 0.05);
    ctx.scale(w * 0.95, h * 0.55);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(theme.accent, 0.22));
    g.addColorStop(0.5, rgba(theme.accent, 0.1));
    g.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    const step = (48 * Math.min(w, h)) / 1080;
    ctx.fillStyle = rgba(theme.text, 0.045);
    for (let x = 0; x < w; x += step) ctx.fillRect(Math.floor(x), 0, 1, h);
    for (let y = 0; y < h; y += step) ctx.fillRect(0, Math.floor(y), w, 1);
  } else if (scene.veil) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const [pos, alpha] of scene.veil) g.addColorStop(pos, rgba(theme.bg, alpha));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawRun(ctx: CanvasRenderingContext2D, r: Run, ox: number, oy: number) {
  ctx.font = fontCss(r.font, r.size);
  ctx.fillStyle = r.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  if (!r.spacing) {
    ctx.fillText(r.text, ox + r.x, oy + r.baseline);
    return;
  }
  let x = ox + r.x;
  for (const ch of r.text) {
    ctx.fillText(ch, x, oy + r.baseline);
    x += measure(ch, r.font, r.size) + r.spacing;
  }
}

function drawPaint(ctx: CanvasRenderingContext2D, scene: Scene, e: Element, p: Paint, t: number) {
  const ox = e.x;
  const oy = e.y;
  switch (p.type) {
    case "rect": {
      const r = Math.min(p.r, p.w / 2, p.h / 2);
      ctx.beginPath();
      ctx.roundRect(ox + p.x, oy + p.y, p.w, p.h, r);
      ctx.fillStyle = rgba(p.fill, p.alpha);
      ctx.fill();
      if (p.stroke && p.strokeWidth && (p.strokeAlpha ?? 1) > 0) {
        const sw = p.strokeWidth;
        ctx.beginPath();
        ctx.roundRect(ox + p.x + sw / 2, oy + p.y + sw / 2, p.w - sw, p.h - sw, Math.max(0, r - sw / 2));
        ctx.strokeStyle = rgba(p.stroke, p.strokeAlpha ?? 1);
        ctx.lineWidth = sw;
        ctx.stroke();
      }
      return;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(ox + p.cx, oy + p.cy, p.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.fill, p.alpha);
      ctx.fill();
      if (p.stroke && p.strokeWidth) {
        ctx.beginPath();
        ctx.arc(ox + p.cx, oy + p.cy, Math.max(0, p.r - p.strokeWidth / 2), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(p.stroke, 1);
        ctx.lineWidth = p.strokeWidth;
        ctx.stroke();
      }
      return;
    }
    case "text":
      for (const r of p.runs) drawRun(ctx, r, ox, oy);
      return;
    case "arrow": {
      const [x1, y1, x2, y2] = [ox + p.x1, oy + p.y1, ox + p.x2, oy + p.y2];
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = p.width * 3;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - head * Math.cos(angle - Math.PI / 5), y2 - head * Math.sin(angle - Math.PI / 5));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 5), y2 - head * Math.sin(angle + Math.PI / 5));
      ctx.stroke();
      return;
    }
    case "glow": {
      ctx.save();
      ctx.translate(ox + e.w / 2, oy + e.h / 2);
      ctx.scale(e.w / 2, e.h / 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgba(p.color, p.alpha));
      g.addColorStop(0.55, rgba(p.color, p.alpha * 0.35));
      g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      return;
    }
    case "counter": {
      const c = p.counter;
      const digits = counterText(scene, c, t);
      const dw = measure(digits, c.font, c.size);
      const pw = measure(c.prefix, c.font, c.size);
      const base = { baseline: c.baseline, size: c.size, font: c.font, spacing: 0 };
      drawRun(ctx, { ...base, text: c.suffix, x: c.right, color: c.affixColor }, ox, oy);
      drawRun(ctx, { ...base, text: digits, x: c.right - dw, color: c.digitsColor }, ox, oy);
      drawRun(ctx, { ...base, text: c.prefix, x: c.right - dw - pw, color: c.affixColor }, ox, oy);
    }
  }
}

/** Dibuja la escena en el instante t (el contexto ya trae la escala a la resolución del canvas). */
export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, t: number) {
  ctx.clearRect(0, 0, scene.width, scene.height);
  drawBackground(ctx, scene);
  for (const e of scene.elements) {
    const st = elementState(scene, e, t);
    if (st.opacity <= 0.003 || st.reveal <= 0) continue;
    ctx.save();
    ctx.globalAlpha = st.opacity;
    ctx.translate(st.dx, st.dy);
    if (Math.abs(st.scale - 1) > 0.002) {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(st.scale, st.scale);
      ctx.translate(-cx, -cy);
    }
    if (st.reveal < 1) {
      ctx.beginPath();
      if (e.anim.kind === "wipe-x") ctx.rect(e.x - e.pad, e.y - e.pad, e.pad + e.w * st.reveal, e.h + 2 * e.pad);
      else ctx.rect(e.x - e.pad, e.y - e.pad, e.w + 2 * e.pad, e.pad + e.h * st.reveal);
      ctx.clip();
    }
    for (const p of e.paints) drawPaint(ctx, scene, e, p, t);
    ctx.restore();
  }
}

export const formatSize = (format: VideoFormat) => (format === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

/** Escena lista para dibujar (null mientras cargan las fuentes). */
export function useGraphicScene(spec: GraphicSpec | null, format: VideoFormat, duration: number): Scene | null {
  const ready = useGraphicFonts();
  return useMemo(() => {
    if (!ready || !spec) return null;
    const { width, height } = formatSize(format);
    return buildScene(spec, width, height, Math.max(0.6, duration), measure);
  }, [ready, spec, format, duration]);
}

/**
 * Canvas del gráfico. Con `time` dibuja ese instante (lo maneja la vista previa del video); sin `time` se
 * reproduce solo en bucle (con "menos movimiento", queda quieto en el cuadro final).
 */
export function GraphicCanvas({
  spec,
  format,
  duration,
  time,
  scale = 0.5,
  className,
  label,
}: {
  spec: GraphicSpec;
  format: VideoFormat;
  duration: number;
  time?: number;
  /** Resolución del canvas respecto del video (0,5 = 540×960 en vertical). */
  scale?: number;
  className?: string;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useGraphicScene(spec, format, duration);
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

  const t = controlled ? time : reduced ? (scene ? scene.duration - scene.exit - 0.05 : 0) : loopTime;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !scene) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintScene(ctx, scene, Math.max(0, Math.min(t, scene.duration)));
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
