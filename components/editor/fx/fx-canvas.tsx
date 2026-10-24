"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FxRenderer, type FxCtx, type FxFonts, type FxSpec } from "@/lib/video/fx";
import { framingMap } from "@/lib/video/fx/compile";
import { maskTileAt } from "@/lib/video/fx/masks";
import { composBox, composKey, subscribeCompos } from "@/lib/video/compos/sandbox-browser";
import type { VideoFormat } from "@/lib/video/types";
import { useGraphicFonts } from "../graphic-canvas";
import { cn } from "@/lib/utils";

/**
 * Vista previa de los efectos: el mismo motor que el worker (lib/video/fx/engine) dibujando en un <canvas>, con las
 * mismas fuentes (autoalojadas, OFL) y el mismo recorte de la persona (las tiras de máscaras que arma el worker).
 */

/** Familias de las fuentes de los efectos en el navegador. */
export const BROWSER_FX_FONTS: FxFonts = { sans: "Inter", display: "Montserrat Grafico", serif: "Instrument Serif FX", mono: "JetBrains Mono", hand: "Caveat FX", cut: "Anton FX" };

let fxFontsState: "idle" | "loading" | "ready" = "idle";
const fxListeners = new Set<() => void>();

function loadFxFonts() {
  if (fxFontsState !== "idle" || typeof document === "undefined") return;
  fxFontsState = "loading";
  const latin = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2197, U+2212, U+2215, U+FEFF, U+FFFD";
  const faces = [
    new FontFace("Instrument Serif FX", "url(/fonts/carrusel/instrument-serif-latin-400-normal.woff2) format('woff2')", { weight: "400", style: "normal", unicodeRange: latin }),
    new FontFace("Instrument Serif FX", "url(/fonts/carrusel/instrument-serif-latin-ext-400-normal.woff2) format('woff2')", { weight: "400", style: "normal", unicodeRange: "U+0100-02BA, U+1E00-1E9F" }),
    new FontFace("Instrument Serif FX", "url(/fonts/carrusel/instrument-serif-latin-400-italic.woff2) format('woff2')", { weight: "400", style: "italic", unicodeRange: latin }),
    new FontFace("Caveat FX", "url(/fonts/carrusel/caveat-latin-wght-normal.woff2) format('woff2')", { weight: "400 700", unicodeRange: latin }),
    new FontFace("Anton FX", "url(/fonts/carrusel/anton-latin-400-normal.woff2) format('woff2')", { weight: "400", unicodeRange: latin }),
  ];
  for (const f of faces) document.fonts.add(f);
  Promise.all([...faces.map((f) => f.load()), document.fonts.load('500 30px "JetBrains Mono"', "Aa1"), document.fonts.load('900 60px "Inter"', "Aa1")])
    .catch(() => undefined)
    .finally(() => {
      fxFontsState = "ready";
      fxListeners.forEach((l) => l());
    });
}

/** `true` cuando las fuentes de los efectos (y las de los gráficos) están cargadas. */
export function useFxFonts(): boolean {
  const base = useGraphicFonts();
  const ready = useSyncExternalStore(
    (cb) => {
      fxListeners.add(cb);
      return () => fxListeners.delete(cb);
    },
    () => fxFontsState === "ready",
    () => false,
  );
  useEffect(loadFxFonts, []);
  return base && ready;
}

/** Un renderizador por componente (sus lienzos auxiliares se reutilizan entre cuadros). */
export function useFxRenderer(reducedMotion: boolean): FxRenderer {
  return useMemo(
    () =>
      new FxRenderer({
        makeCanvas: (w, h) => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          return { canvas, ctx: canvas.getContext("2d") as unknown as FxCtx };
        },
        fonts: BROWSER_FX_FONTS,
        reducedMotion,
      }),
    [reducedMotion],
  );
}

/** Carga una imagen (miniaturas, tiras de máscaras, la persona de muestra). null mientras carga o si falla. */
export function useImages(urls: Record<string, string | null | undefined>): Record<string, HTMLImageElement | undefined> {
  const [loaded, setLoaded] = useState<Record<string, HTMLImageElement | undefined>>({});
  const key = JSON.stringify(urls);
  useEffect(() => {
    let alive = true;
    const entries = Object.entries(JSON.parse(key) as Record<string, string | null>).filter(([, u]) => u);
    for (const [k, url] of entries) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => alive && setLoaded((prev) => (prev[k] === img ? prev : { ...prev, [k]: img }));
      img.src = url!;
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return loaded;
}

/** Lienzos de trabajo para el cuadro encuadrado y la máscara del instante. */
function scratch(ref: { current: HTMLCanvasElement | null }, w: number, h: number): HTMLCanvasElement {
  let c = ref.current;
  if (!c) {
    c = document.createElement("canvas");
    ref.current = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Capa del efecto activo en la vista previa del video: toma el cuadro del <video> (con el encuadre del render), la
 * máscara del instante (si ya está) y dibuja el cuadro completo del efecto encima del video.
 */
export function FxVideoLayer({
  spec,
  time,
  video,
  sourceWidth,
  sourceHeight,
  offsetX,
  strips,
  maskFps,
  images,
  reducedMotion,
  className,
  onMovable,
}: {
  spec: FxSpec;
  time: number;
  video: HTMLVideoElement | null;
  sourceWidth: number;
  sourceHeight: number;
  offsetX: number;
  /** Tiras de máscaras cargadas, por segundo del original. */
  strips: Record<number, HTMLImageElement | undefined>;
  maskFps: number;
  images: Record<string, HTMLImageElement | undefined>;
  reducedMotion: boolean;
  className?: string;
  /** Caja de diseño del elemento movible del efecto (si tiene), en píxeles del video final: la usa el lienzo. */
  onMovable?: (id: string, box: { x: number; y: number; w: number; h: number } | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const movableCb = useRef(onMovable);
  useEffect(() => {
    movableCb.current = onMovable;
  }, [onMovable]);
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const fonts = useFxFonts();
  const renderer = useFxRenderer(reducedMotion);
  const scale = spec.format === "9:16" ? 0.5 : 0.375;
  const cw = Math.round(spec.width * scale);
  const ch = Math.round(spec.height * scale);
  // Composiciones: el código corre en un Web Worker sin red (/compos-sandbox.js) y devuelve la lista de dibujo de cada
  // cuadro; se dibuja con el mismo motor que el render. Mientras llega el cuadro, se ve el video tal cual.
  const compos = spec.kind === "composition" ? (spec.compos ?? null) : null;
  const box = useMemo(() => (compos ? composBox(composKey(compos.code, compos.env), compos.code, compos.env) : null), [compos]);
  const [composTick, setComposTick] = useState(0);
  const composStatus = useSyncExternalStore(
    subscribeCompos,
    () => box?.status ?? "ready",
    () => "loading",
  );
  // Con el video en pausa, se vuelve a dibujar cuando termina de buscar el cuadro (si no, queda el de antes o nada).
  const [seekTick, setSeekTick] = useState(0);
  useEffect(() => {
    if (!video) return;
    const bump = () => setSeekTick((n) => n + 1);
    video.addEventListener("seeked", bump);
    video.addEventListener("loadeddata", bump);
    return () => {
      video.removeEventListener("seeked", bump);
      video.removeEventListener("loadeddata", bump);
    };
  }, [video]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !fonts) return;
    let frame: HTMLCanvasElement | null = null;
    if (video && video.readyState >= 2 && video.videoWidth) {
      frame = scratch(frameRef, cw, ch);
      const fx = frame.getContext("2d")!;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // Mismo recorte que el render, en píxeles del proxy.
      const m = framingMap(sourceWidth || vw, sourceHeight || vh, spec.format, offsetX);
      const kx = vw / (sourceWidth || vw);
      const ky = vh / (sourceHeight || vh);
      const s = cw / spec.width;
      fx.clearRect(0, 0, cw, ch);
      if (m.pillar) {
        fx.filter = `blur(${Math.round(24 * s)}px) brightness(0.92)`;
        fx.drawImage(video, 0, 0, vw, vh, -cw * 0.1, -ch * 0.1, cw * 1.2, ch * 1.2);
        fx.filter = "none";
      }
      fx.drawImage(video, m.sx * kx, m.sy * ky, m.sw * kx, m.sh * ky, m.dx * s, m.dy * s, m.dw * s, m.dh * s);
    }
    let mask: HTMLCanvasElement | null = null;
    if (spec.mask && video) {
      const { chunk, index } = maskTileAt(video.currentTime, maskFps);
      const strip = strips[chunk];
      if (strip && strip.naturalWidth) {
        const tw = strip.naturalWidth / maskFps;
        const th = strip.naturalHeight;
        mask = scratch(maskRef, Math.round(tw), Math.round(th));
        const mx = mask.getContext("2d")!;
        mx.clearRect(0, 0, mask.width, mask.height);
        mx.drawImage(strip, index * tw, 0, tw, th, 0, 0, mask.width, mask.height);
      }
    }
    let list = null;
    if (box) {
      const idx = Math.max(0, Math.min(Math.round(spec.duration * 30) - 1, Math.round(time * 30)));
      list = box.cached(idx) ?? box.cached(idx - 1) ?? null;
      if (!box.cached(idx)) void box.frame(idx, idx / 30).then((f) => f && setComposTick((n) => n + 1));
      // Los próximos cuadros, por adelantado (al reproducir).
      for (let k = 1; k <= 3; k++) if (idx + k < spec.duration * 30 && !box.cached(idx + k)) void box.frame(idx + k, (idx + k) / 30);
    }
    const drawn = renderer.render(ctx as unknown as FxCtx, spec, time, { frame, mask, images, compos: list }, scale);
    movableCb.current?.(spec.id, drawn.movable);
  }, [spec, time, video, fonts, renderer, strips, maskFps, images, sourceWidth, sourceHeight, offsetX, cw, ch, scale, seekTick, box, composTick, composStatus]);

  return (
    <>
      <canvas ref={canvas} width={cw} height={ch} className={cn("block h-full w-full", className)} aria-hidden />
      {box && composStatus === "broken" && (
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-warning" role="status">
          Esta animación tiene un error: pídele un cambio o quítala.
        </span>
      )}
    </>
  );
}

/**
 * Muestra de un efecto en bucle (galería): la persona de muestra con su recorte. Con "reducir movimiento", quieta en un
 * momento representativo.
 */
export function FxDemoCanvas({ spec, time, frame, mask, images = {}, reducedMotion, className, label }: { spec: FxSpec; time: number; frame: HTMLImageElement | undefined; mask: HTMLImageElement | undefined; images?: Record<string, HTMLImageElement | undefined>; reducedMotion: boolean; className?: string; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fonts = useFxFonts();
  const renderer = useFxRenderer(reducedMotion);
  const scale = 0.25;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !fonts || !frame) return;
    renderer.render(ctx as unknown as FxCtx, spec, time, { frame, mask: mask ?? null, images }, scale);
  }, [spec, time, frame, mask, images, fonts, renderer]);
  return <canvas ref={canvas} width={Math.round(spec.width * scale)} height={Math.round(spec.height * scale)} className={cn("block h-full w-full", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export type { VideoFormat };
