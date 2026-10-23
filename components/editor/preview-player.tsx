"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { brollAlpha, brollGeometry, clipAspectOf, DEFAULT_EDIT, graphicSideGeometry, type BrollEdit } from "@/lib/video/broll-edit";
import type { OutputZoom } from "@/lib/video/effects";
import type { CaptionLook } from "@/lib/video/caption-styles";
import type { BrollGraphic } from "@/lib/video/motion-graphics";
import type { CaptionStyle } from "@/lib/video/style";
import { outputToSource } from "@/lib/video/timeline";
import { FPS, type CaptionBlock, type CaptionPresetKey, type Clip, type VideoFormat } from "@/lib/video/types";
import { BrollLayer, personStyle } from "./broll-layer";
import { FxVideoLayer } from "./fx/fx-canvas";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { FX_INFO, type FxSpec } from "@/lib/video/fx";
import { CaptionOverlay } from "./caption-overlay";
import { GraphicCanvas } from "./graphic-canvas";
import { graphicHidesCaptions } from "@/lib/video/effects";

export type PreviewHandle = {
  /** Salta a un instante del video final y, si se pide, reproduce. */
  seekOutput: (out: number, play?: boolean) => void;
};

/** Un b-roll en la vista previa: tramo del video final y el clip (video liviano o, si no hay, su miniatura) o el gráfico. */
export type PreviewBroll = {
  id: string;
  start: number;
  end: number;
  previewUrl: string | null;
  thumbUrl: string | null;
  graphic?: BrollGraphic | null;
  /** Ubicación, encuadre, look y tiempo (sin esto, pantalla completa al centro). */
  edit?: BrollEdit;
  /** Tamaño del clip (para el recorte y la forma de la tarjeta). */
  width?: number;
  height?: number;
};

/** Escala del zoom en un instante del video final (igual que la expresión de zoompan del worker). */
export function zoomAt(zooms: OutputZoom[], t: number): number {
  const z = zooms.find((x) => t >= x.start && t < x.end);
  if (!z) return 1;
  return 1 + (z.scale - 1) * (z.ramp > 0 ? Math.min(1, (t - z.start) / z.ramp) : 1);
}

/**
 * Vista previa sin render: reproduce el proxy saltando los cortes con JS (los mismos tramos que va a renderizar
 * el worker), simula el encuadre final, los zooms y el b-roll, y dibuja los subtítulos en HTML.
 * Así hay un solo render al final.
 */
export const PreviewPlayer = forwardRef<PreviewHandle, {
  src: string | null;
  poster: string | null;
  clips: Clip[];
  duration: number;
  blocks: CaptionBlock[];
  preset: CaptionPresetKey;
  format: VideoFormat;
  accent: string;
  sourceWidth: number;
  sourceHeight: number;
  offsetX: number;
  /** Se llama ~10 veces por segundo con el instante del original (para resaltar la palabra en el texto). */
  onSourceTime?: (t: number | null) => void;
  /** Segundo del video final (también en pausa, al saltar): lo usa la línea de tiempo del ritmo. */
  onOutputTime?: (t: number) => void;
  captionStyle?: CaptionStyle | null;
  /** Diseño de un estilo de la galería de subtítulos (lib/video/caption-styles.ts). */
  captionLook?: CaptionLook | null;
  broll?: PreviewBroll[];
  zooms?: OutputZoom[];
  /** Altura (0 a 1) hacia donde apuntan los zooms: la cara. */
  focusY?: number;
  /** Colores de Mi marca para el b-roll: acento (duotono) y fondo (pantalla dividida). */
  brandAccent?: string;
  brandGround?: string;
  /** Efectos de la biblioteca (el mismo spec que dibuja el worker) y lo que necesitan: tiras de máscaras y miniaturas. */
  effects?: FxSpec[];
  fxStrips?: Record<number, HTMLImageElement | undefined>;
  fxMaskFps?: number;
  fxImages?: Record<string, HTMLImageElement | undefined>;
}>(function PreviewPlayer(
  {
    src,
    poster,
    clips,
    duration,
    blocks,
    preset,
    format,
    accent,
    sourceWidth,
    sourceHeight,
    offsetX,
    onSourceTime,
    onOutputTime,
    captionStyle = null,
    captionLook = null,
    broll = [],
    zooms = [],
    focusY = 0.42,
    brandAccent = "#0070f8",
    brandGround = "#030a22",
    effects = [],
    fxStrips = {},
    fxMaskFps = 10,
    fxImages = {},
  },
  ref,
) {
  const reducedMotion = usePrefersReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const clipIndex = useRef(0);
  const raf = useRef(0);
  const lastReport = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [out, setOut] = useState(0);
  const [height, setHeight] = useState(640);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const offsets = useMemo(() => {
    let acc = 0;
    return clips.map((c) => {
      const start = acc;
      acc += (c.endFrame - c.startFrame) / FPS;
      return start;
    });
  }, [clips]);

  const clipsRef = useRef(clips);
  const offsetsRef = useRef(offsets);
  useEffect(() => {
    clipsRef.current = clips;
    offsetsRef.current = offsets;
  }, [clips, offsets]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const outputCb = useRef(onOutputTime);
  useEffect(() => {
    outputCb.current = onOutputTime;
  }, [onOutputTime]);
  const seekOutput = useCallback((target: number, play = false) => {
    const v = video.current;
    const list = clipsRef.current;
    if (!v || !list.length) return;
    const { clipIndex: i, source } = outputToSource(list, Math.max(0, target));
    clipIndex.current = i;
    v.currentTime = source;
    setOut(Math.max(0, target));
    outputCb.current?.(Math.max(0, target));
    if (play) void v.play().catch(() => undefined);
  }, []);

  useImperativeHandle(ref, () => ({ seekOutput }), [seekOutput]);

  // Si cambian los cortes con el video en pausa, se mantiene el mismo instante del video final.
  useEffect(() => {
    if (!playing && ready) seekOutput(Math.min(out, Math.max(0, duration - 0.05)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  const tick = useCallback(() => {
    const v = video.current;
    const list = clipsRef.current;
    if (!v || !list.length) return;
    let i = clipIndex.current;
    const t = v.currentTime;
    const clip = list[i];
    if (!clip) return;
    const start = clip.startFrame / FPS;
    const end = clip.endFrame / FPS;
    if (t >= end - 0.5 / FPS || t < start - 0.25) {
      // Fin del tramo (o el video quedó fuera): al siguiente tramo, o se termina.
      if (t >= end - 0.5 / FPS) i += 1;
      if (i >= list.length) {
        v.pause();
        clipIndex.current = 0;
        v.currentTime = list[0]!.startFrame / FPS;
        setOut(0);
        onSourceTime?.(null);
        return;
      }
      clipIndex.current = i;
      v.currentTime = list[i]!.startFrame / FPS;
    } else {
      const o = offsetsRef.current[i]! + Math.max(0, t - start);
      setOut(o);
      const now = performance.now();
      if (onSourceTime && now - lastReport.current > 100) {
        lastReport.current = now;
        onSourceTime(t);
        outputCb.current?.(o);
      }
    }
    raf.current = requestAnimationFrame(tick);
  }, [onSourceTime]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf.current);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      cancelAnimationFrame(raf.current);
    };
  }, [tick]);

  function toggle() {
    const v = video.current;
    if (!v || !clips.length) return;
    if (v.paused) {
      if (out >= duration - 0.05) seekOutput(0, true);
      else {
        const { clipIndex: i, source } = outputToSource(clips, out);
        clipIndex.current = i;
        if (Math.abs(v.currentTime - source) > 0.05) v.currentTime = source;
        void v.play().catch(() => undefined);
      }
    } else v.pause();
  }

  // Encuadre: el video original dentro del cuadro de salida, igual que el recorte del worker.
  const outRatio = format === "9:16" ? 9 / 16 : 16 / 9;
  const srcRatio = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : outRatio;
  let videoStyle: CSSProperties;
  let blurBackground = false;
  if (srcRatio > outRatio * 1.02) {
    const widthPct = (srcRatio / outRatio) * 100;
    const free = widthPct - 100;
    videoStyle = { width: `${widthPct}%`, height: "100%", left: `${-(free / 2) * (1 + offsetX)}%`, top: 0 };
  } else if (srcRatio < outRatio / 1.02 && format === "16:9") {
    const widthPct = (srcRatio / outRatio) * 100;
    videoStyle = { width: `${widthPct}%`, height: "100%", left: `${(100 - widthPct) / 2}%`, top: 0 };
    blurBackground = true;
  } else {
    videoStyle = { width: "100%", height: "100%", left: 0, top: 0, objectFit: "cover" };
  }

  const activeBroll = broll.find((b) => out >= b.start && out < b.end) ?? null;
  const activeFx = activeBroll ? null : (effects.find((e) => out >= e.start && out < e.end) ?? null);
  // Igual que el render: durante un gráfico no se muestran subtítulos (salvo una palabra clave arriba).
  const block = useMemo(() => (activeBroll?.graphic && graphicHidesCaptions(activeBroll.graphic) ? null : (blocks.find((b) => out >= b.start && out < b.end) ?? null)), [blocks, out, activeBroll]);
  const pct = duration ? (out / duration) * 100 : 0;
  const zoom = zoomAt(zooms, out);
  const brollVideo = useRef<HTMLVideoElement>(null);

  // Pantalla dividida o a un lado (clip o gráfico en 16:9): la persona pasa a su parte del cuadro.
  const activeEdit = activeBroll?.edit ?? DEFAULT_EDIT;
  const person = !activeBroll
    ? null
    : activeBroll.graphic
      ? graphicSideGeometry(format, activeBroll.graphic.mode, (activeBroll.graphic as { position?: string }).position)
      : brollGeometry(activeEdit, format, clipAspectOf(activeBroll.width, activeBroll.height), focusY).person;
  const pxScale = height / (format === "9:16" ? 1920 : 1080);

  // El b-roll de la vista previa sigue al video principal: arranca en su punto (más el segundo del clip elegido) y se
  // pausa con él. Si el clip es más corto que el tramo, vuelve a empezar (como el render).
  useEffect(() => {
    const v = brollVideo.current;
    if (!v || !activeBroll?.previewUrl) return;
    const raw = Math.max(0, out - activeBroll.start) + (activeBroll.edit?.clip_start ?? 0);
    const target = v.duration && Number.isFinite(v.duration) && raw >= v.duration ? raw % v.duration : raw;
    if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [activeBroll, out, playing]);

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frame}
        className="relative mx-auto w-full overflow-hidden rounded-2xl border border-white/10 bg-black"
        style={{ aspectRatio: format === "9:16" ? "9 / 16" : "16 / 9", maxWidth: format === "9:16" ? 360 : undefined }}
      >
        {person && <div aria-hidden className="absolute inset-0" style={{ background: brandGround }} />}
        {src ? (
          <div className="absolute inset-0 overflow-hidden" style={personStyle(person, format)}>
          {/* El fondo desenfocado va con la persona: en pantalla dividida o a un lado se recorta y se mueve con ella (como en el render). */}
          {blurBackground && poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
          )}
          <div className="absolute inset-0" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: `50% ${focusY * 100}%` }}>
          <video
            ref={video}
            src={src}
            poster={poster ?? undefined}
            preload="auto"
            playsInline
            className="absolute"
            style={videoStyle}
            onLoadedMetadata={() => {
              setReady(true);
              if (clips[0]) {
                clipIndex.current = 0;
                video.current!.currentTime = clips[0].startFrame / FPS;
              }
            }}
            onError={() => setError(true)}
            onClick={toggle}
            aria-label="Vista previa del video editado"
          />
          </div>
          </div>
        ) : null}
        {activeBroll &&
          (activeBroll.graphic ? (
            // El gráfico se dibuja en el mismo instante que el render (en "sobre tu video", el video sigue debajo).
            <div
              key={activeBroll.id}
              className="pointer-events-none absolute inset-0"
              style={{ opacity: brollAlpha({ transition: activeEdit.transition === "cut" ? "cut" : "fade" }, Math.max(0, out - activeBroll.start), activeBroll.end - activeBroll.start) }}
            >
              <GraphicCanvas spec={activeBroll.graphic} format={format} duration={activeBroll.end - activeBroll.start} time={Math.max(0, out - activeBroll.start)} scale={0.5} />
            </div>
          ) : activeBroll.previewUrl || activeBroll.thumbUrl ? (
            <BrollLayer
              key={activeBroll.id}
              className="pointer-events-none"
              edit={activeEdit}
              format={format}
              media={{ previewUrl: activeBroll.previewUrl, thumbUrl: activeBroll.thumbUrl, width: activeBroll.width ?? 0, height: activeBroll.height ?? 0 }}
              accent={brandAccent}
              time={Math.max(0, out - activeBroll.start)}
              duration={activeBroll.end - activeBroll.start}
              pxScale={pxScale}
              videoRef={brollVideo}
            />
          ) : null)}
        {activeFx && (
          // El efecto se dibuja con el mismo motor que el render, sobre el cuadro del video (ya con su encuadre).
          <div key={activeFx.id} className="pointer-events-none absolute inset-0">
            <FxVideoLayer
              spec={activeFx}
              time={Math.max(0, out - activeFx.start)}
              video={video.current}
              sourceWidth={sourceWidth}
              sourceHeight={sourceHeight}
              offsetX={offsetX}
              strips={fxStrips}
              maskFps={fxMaskFps}
              images={fxImages}
              reducedMotion={reducedMotion}
            />
          </div>
        )}
        {activeBroll && <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{activeBroll.graphic ? "Gráfico" : "B-roll"}</span>}
        {activeFx && <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{FX_INFO[activeFx.kind].label}</span>}
        <CaptionOverlay block={block} time={out} preset={preset} format={format} accent={accent} height={height} captionStyle={captionStyle} look={captionLook} />
        {(!src || error) && (
          <div className="absolute inset-0 grid place-items-center bg-bg/80 p-6 text-center text-sm text-text">
            {error ? "Este navegador no pudo reproducir la vista previa. Recarga la página o prueba con Chrome o Safari; el render final no se ve afectado." : "La vista previa todavía no está lista."}
          </div>
        )}
        {src && !playing && ready && (
          <button type="button" onClick={toggle} className="absolute inset-0 grid place-items-center bg-black/10 transition hover:bg-black/20" aria-label="Reproducir la vista previa">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-bg shadow-lg">
              <Play className="ml-0.5 h-6 w-6" aria-hidden />
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost !h-9 !w-9 !p-0" onClick={toggle} disabled={!ready || !clips.length} aria-label={playing ? "Pausar" : "Reproducir"}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        <input
          type="range"
          className="range flex-1"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.01}
          value={Math.min(out, duration)}
          style={{ ["--pct" as string]: `${pct}%` }}
          onChange={(e) => seekOutput(Number(e.target.value), playing)}
          aria-label="Posición en el video final"
          disabled={!ready}
        />
        <span className="w-[5.5rem] text-right font-mono text-xs text-muted tabular-nums">
          {formatDuration(out)} / {formatDuration(duration)}
        </span>
        <button type="button" className="btn-ghost !h-9 !w-9 !p-0" onClick={() => seekOutput(0, true)} disabled={!ready} aria-label="Ver desde el principio">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
});
