"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { brollGeometry, clipAspectOf, DEFAULT_EDIT, graphicAlpha, graphicSideGeometry, svgMatrixValues, clipTimeAt, type BrollEdit, type ColorMatrix } from "@/lib/video/broll-edit";
import type { OutputZoom } from "@/lib/video/effects";
import type { CaptionLook } from "@/lib/video/caption-styles";
import type { BrollGraphic } from "@/lib/video/motion-graphics";
import type { CaptionStyle } from "@/lib/video/style";
import { outputToSource } from "@/lib/video/timeline";
import { FPS, type CaptionBlock, type CaptionPresetKey, type Clip, type VideoFormat } from "@/lib/video/types";
import { BrollLayer, personStyle } from "./broll-layer";
import { FxVideoLayer } from "./fx/fx-canvas";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { type FxSpec } from "@/lib/video/fx";
import { CaptionOverlay, type CaptionBoxReport } from "./caption-overlay";
import { GraphicCanvas, useMotionScene } from "./graphic-canvas";
import { graphicHidesCaptions } from "@/lib/video/effects";
import { FX_MOVABLE, isFxKind } from "@/lib/video/fx/catalog";
import { specLabel } from "@/lib/video/fx/transitions";
import { graphicKindLabel } from "@/lib/video/motion-graphics";
import { placedContentBox } from "@/lib/video/motion";
import { IDENTITY_TRANSFORM, transformedBox, type Box, type Transform } from "@/lib/video/canvas/transform";
import { TransformOverlay, type CanvasElement } from "./canvas/transform-overlay";
import { canvasId, captionCanvasTexts, effectCanvasTexts, graphicCanvasTexts, movableEffectLabel } from "./canvas/elements";

export type PreviewHandle = {
  /** Salta a un instante del video final y, si se pide, reproduce. */
  seekOutput: (out: number, play?: boolean) => void;
  /** Pausa la vista previa. */
  pause: () => void;
  /** El video de la vista previa (para saber si está reproduciendo o cambiar la velocidad). */
  video: () => HTMLVideoElement | null;
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
  /** "image": una foto de la biblioteca (con su movimiento y su encaje). */
  kind?: "video" | "image";
};

/**
 * Lienzo de la revisión (components/editor/canvas): con esto, lo que se ve se puede tocar, mover, agrandar y editar.
 * Ids de los elementos: ver `canvasId` ("graphic:<b-roll>", "effect:<efecto>", "caption:<primera palabra del bloque>").
 */
export type PreviewCanvas = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, next: Transform) => void;
  onText: (id: string, textId: string, value: string) => void;
  /** Solo mirar (sin permiso para editar). */
  disabled?: boolean;
};

const NO_ORDER: Record<string, number> = {};

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
  /** Lienzo para tocar lo que se ve (opcional: sin esto, la vista previa es solo para mirar). */
  canvas?: PreviewCanvas;
  /**
   * Orden de dibujo de lo que se superpone (lib/video/layers.ts, el mismo que manda el render): clave "b:<b-roll>",
   * "f:<efecto>" o "t:<transición>" → lugar (0 = abajo). Sin esto, el b-roll abajo y los efectos encima.
   */
  order?: Record<string, number>;
  /** Color del video principal (lib/video/grade.ts): la misma matriz que el worker escribe como LUT. null = sin cambios. */
  grade?: ColorMatrix | null;
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
    grade = null,
    effects = [],
    fxStrips = {},
    fxMaskFps = 10,
    fxImages = {},
    canvas,
    order = NO_ORDER,
  },
  ref,
) {
  const reducedMotion = usePrefersReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const gradeId = `grade-${useId().replace(/:/g, "")}`;
  const frame = useRef<HTMLDivElement>(null);
  const clipIndex = useRef(0);
  const raf = useRef(0);
  const lastReport = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [out, setOut] = useState(0);
  // Segundo de la barra mientras se arrastra (null = sin arrastrar).
  const [scrub, setScrub] = useState<number | null>(null);
  const [height, setHeight] = useState(640);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  // El elemento del video para las capas de efectos (se guarda al montarlo: no se lee la ref durante el render).
  const [baseVideo, setBaseVideo] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    setBaseVideo(el);
  }, []);

  const offsets = useMemo(() => clips.reduce<number[]>((list, c, i) => [...list, i === 0 ? 0 : list[i - 1]! + (clips[i - 1]!.endFrame - clips[i - 1]!.startFrame) / FPS], []), [clips]);

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

  useImperativeHandle(ref, () => ({ seekOutput, pause: () => video.current?.pause(), video: () => video.current }), [seekOutput]);

  // Si cambian los cortes con el video en pausa, se mantiene el mismo instante del video final.
  useEffect(() => {
    if (!playing && ready) seekOutput(Math.min(out, Math.max(0, duration - 0.05)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  // El cuadro siguiente llama a la versión más nueva de `tick` (sin que se llame a sí mismo antes de existir).
  const tickRef = useRef<() => void>(() => undefined);
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
    raf.current = requestAnimationFrame(() => tickRef.current());
  }, [onSourceTime]);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

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
    // Con el lienzo, tocar el video suelta lo elegido (sin reproducir).
    if (canvas?.selectedId) {
      canvas.onSelect(null);
      return;
    }
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

  // Capas: todo lo que se ve ahora (b-roll, gráficos, efectos y transiciones), de abajo hacia arriba, en el mismo
  // orden que el render (lib/video/layers.ts). Los efectos se dibujan sobre el cuadro del video y tapan lo de abajo.
  const { activeBrolls, activeFxs, layers, activeBroll, topBroll, activeFx, fxOnTop, hideCaptions, topGraphicBroll } = useMemo(() => {
    const zOf = (key: string, fallback: number) => order[key] ?? fallback;
    const activeBrolls = broll.filter((b) => out >= b.start && out < b.end);
    const activeFxs = effects.filter((e) => out >= e.start && out < e.end);
    const layers = [
      ...activeBrolls.map((b, i) => ({ kind: "broll" as const, z: zOf(`b:${b.id}`, i - 1000), b })),
      ...activeFxs.map((f, i) => ({ kind: "fx" as const, z: order[`f:${f.id}`] ?? order[`c:${f.id}`] ?? order[`t:${f.id}`] ?? 1000 + i, f })),
    ].sort((a, b) => a.z - b.z);
    const brolls = layers.flatMap((l) => (l.kind === "broll" ? [l.b] : []));
    const fxs = layers.flatMap((l) => (l.kind === "fx" ? [l.f] : []));
    return {
      activeBrolls,
      activeFxs,
      layers,
      // La de abajo decide dónde va la persona (pantalla dividida); la de arriba, lo que se toca en el lienzo.
      activeBroll: brolls[0] ?? null,
      topBroll: brolls[brolls.length - 1] ?? null,
      activeFx: fxs[fxs.length - 1] ?? null,
      fxOnTop: layers.length > 0 && layers[layers.length - 1]!.kind === "fx",
      // Igual que el render: durante un gráfico no se muestran subtítulos (salvo una palabra clave arriba).
      hideCaptions: activeBrolls.some((b) => b.graphic && graphicHidesCaptions(b.graphic)),
      // El gráfico de más arriba es el que se toca en el lienzo (los demás se dibujan igual, cada uno con su escena).
      topGraphicBroll: brolls.filter((b) => b.graphic).pop() ?? null,
    };
  }, [broll, effects, out, order]);
  const block = useMemo(() => (hideCaptions ? null : (blocks.find((b) => out >= b.start && out < b.end) ?? null)), [blocks, out, hideCaptions]);
  const pct = duration ? (out / duration) * 100 : 0;
  const zoom = zoomAt(zooms, out);

  // Pantalla dividida o a un lado (clip o gráfico en 16:9): la persona pasa a su parte del cuadro.
  const activeEdit = activeBroll?.edit ?? DEFAULT_EDIT;
  const person = !activeBroll
    ? null
    : activeBroll.graphic
      ? graphicSideGeometry(format, activeBroll.graphic.mode, (activeBroll.graphic as { position?: string }).position)
      : brollGeometry(activeEdit, format, clipAspectOf(activeBroll.width, activeBroll.height), focusY).person;
  const pxScale = height / (format === "9:16" ? 1920 : 1080);

  // ─── Lienzo: los elementos que se ven ahora, con su caja (las mismas cuentas que dibujan los motores) ───
  const outW = format === "9:16" ? 1080 : 1920;
  const outH = format === "9:16" ? 1920 : 1080;
  const activeGraphic = topGraphicBroll?.graphic ?? null;
  const compiledGraphic = useMotionScene(activeGraphic, format, topGraphicBroll ? topGraphicBroll.end - topGraphicBroll.start : 1);
  const [fxBox, setFxBox] = useState<{ id: string; box: Box } | null>(null);
  const [capBox, setCapBox] = useState<CaptionBoxReport>(null);
  const onFxMovable = useCallback((id: string, box: Box | null) => {
    setFxBox((prev) => {
      if (!box) return prev?.id === id ? null : prev;
      if (prev && prev.id === id && Math.abs(prev.box.x - box.x) < 0.5 && Math.abs(prev.box.y - box.y) < 0.5 && Math.abs(prev.box.w - box.w) < 0.5 && Math.abs(prev.box.h - box.h) < 0.5) return prev;
      return { id, box };
    });
  }, []);
  const onCaptionBox = useCallback((box: CaptionBoxReport) => {
    setCapBox((prev) => {
      if (!box) return prev ? null : prev;
      if (prev && Math.abs(prev.x - box.x) < 0.5 && Math.abs(prev.y - box.y) < 0.5 && Math.abs(prev.w - box.w) < 0.5 && Math.abs(prev.h - box.h) < 0.5) return prev;
      return box;
    });
  }, []);
  const elements = useMemo<CanvasElement[]>(() => {
    if (!canvas) return [];
    const out: CanvasElement[] = [];
    if (topGraphicBroll && activeGraphic && compiledGraphic && !fxOnTop) {
      out.push({
        id: canvasId({ kind: "graphic", key: topGraphicBroll.id }),
        kind: "graphic",
        label: `Gráfico · ${graphicKindLabel(activeGraphic)}`,
        box: placedContentBox(compiledGraphic),
        transform: topGraphicBroll.edit?.transform ?? IDENTITY_TRANSFORM,
        rotatable: true,
        texts: graphicCanvasTexts(activeGraphic),
        textsTitle: "Edita los textos del gráfico",
      });
    }
    const movable = activeFx && isFxKind(activeFx.kind) ? FX_MOVABLE[activeFx.kind] : null;
    if (activeFx && isFxKind(activeFx.kind) && movable && fxBox?.id === activeFx.id) {
      out.push({
        id: canvasId({ kind: "effect", key: activeFx.id }),
        kind: "effect",
        label: movableEffectLabel(activeFx.kind),
        box: transformedBox(fxBox.box, activeFx.place?.transform, outW, outH),
        transform: activeFx.place?.transform ?? IDENTITY_TRANSFORM,
        rotatable: movable.rotation,
        texts: effectCanvasTexts(activeFx.kind, { text: activeFx.text, kicker: activeFx.kicker, items: activeFx.items }),
        textsTitle: "Edita los textos del efecto",
      });
    }
    const key = block?.words[0] ? String(block.words[0].id) : null;
    if (block && key && captionLook && captionLook.style === preset && capBox && pxScale > 0) {
      const p = block.place;
      out.push({
        id: canvasId({ kind: "caption", key }),
        kind: "caption",
        label: "Subtítulos",
        box: { cx: (capBox.x + capBox.w / 2) / pxScale, cy: (capBox.y + capBox.h / 2) / pxScale, w: capBox.w / pxScale, h: capBox.h / pxScale, rotation: 0 },
        transform: p ? { x: p.x, y: p.y, scale: p.scale } : IDENTITY_TRANSFORM,
        rotatable: false,
        texts: captionCanvasTexts(block),
        textsTitle: "Corrige una palabra del subtítulo",
      });
    }
    return out;
  }, [canvas, topGraphicBroll, activeGraphic, compiledGraphic, activeFx, fxBox, block, captionLook, preset, capBox, pxScale, outW, outH, fxOnTop]);

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
          {grade && (
            <svg aria-hidden width="0" height="0" className="absolute">
              <filter id={gradeId} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={svgMatrixValues(grade)} />
              </filter>
            </svg>
          )}
          <div className="absolute inset-0" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: `50% ${focusY * 100}%`, filter: grade ? `url(#${gradeId})` : undefined }}>
          <video
            ref={videoRef}
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
        {layers.map((l) =>
          l.kind === "broll" ? (
            l.b.graphic ? (
              // El gráfico se dibuja en el mismo instante que el render (en "sobre tu video", el video sigue debajo).
              <div
                key={`b:${l.b.id}`}
                className="pointer-events-none absolute inset-0"
                style={{ opacity: graphicAlpha(l.b.edit ?? DEFAULT_EDIT, Math.max(0, out - l.b.start), l.b.end - l.b.start) }}
              >
                <GraphicCanvas spec={l.b.graphic} compiled={l.b === topGraphicBroll ? compiledGraphic : undefined} format={format} duration={l.b.end - l.b.start} time={Math.max(0, out - l.b.start)} scale={0.5} />
              </div>
            ) : l.b.previewUrl || l.b.thumbUrl ? (
              <SyncedBroll key={`b:${l.b.id}`} item={l.b} out={out} playing={playing} format={format} accent={brandAccent} pxScale={pxScale} />
            ) : null
          ) : (
            // El efecto se dibuja con el mismo motor que el render, sobre el cuadro del video (ya con su encuadre).
            <div key={`f:${l.f.id}`} className="pointer-events-none absolute inset-0">
              <FxVideoLayer
                spec={l.f}
                time={Math.max(0, out - l.f.start)}
                video={baseVideo}
                sourceWidth={sourceWidth}
                sourceHeight={sourceHeight}
                offsetX={offsetX}
                strips={fxStrips}
                maskFps={fxMaskFps}
                images={fxImages}
                reducedMotion={reducedMotion}
                onMovable={canvas && l.f === activeFx ? onFxMovable : undefined}
              />
            </div>
          ),
        )}
        {topBroll && <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-paper">{topBroll.graphic ? "Gráfico" : "B-roll"}{activeBrolls.length > 1 ? ` +${activeBrolls.length - 1}` : ""}</span>}
        {activeFx && <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-paper">{activeFx.kind === "composition" ? `Animación · ${activeFx.text}` : specLabel(activeFx.kind)}{activeFxs.length > 1 ? ` +${activeFxs.length - 1}` : ""}</span>}
        <CaptionOverlay block={block} time={out} preset={preset} format={format} accent={accent} height={height} captionStyle={captionStyle} look={captionLook} onBox={canvas ? onCaptionBox : undefined} />
        {(!src || error) && (
          <div className="absolute inset-0 grid place-items-center bg-bg/80 p-6 text-center text-sm text-text">
            {error ? "Este navegador no pudo reproducir la vista previa. Recarga la página o prueba con Chrome o Safari; el render final no se ve afectado." : "La vista previa todavía no está lista."}
          </div>
        )}
        {src && !playing && ready && !canvas && (
          <button type="button" onClick={toggle} className="absolute inset-0 grid place-items-center bg-black/10 transition hover:bg-black/20" aria-label="Reproducir la vista previa">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-bg shadow-lg">
              <Play className="ml-0.5 h-6 w-6" aria-hidden />
            </span>
          </button>
        )}
        {src && !playing && ready && canvas && !canvas.selectedId && !elements.length && (
          // Con el lienzo, el botón de reproducir no tapa el cuadro: así se puede tocar lo que se ve.
          <button type="button" onClick={toggle} className="absolute top-1/2 left-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-bg shadow-lg transition hover:scale-105" aria-label="Reproducir la vista previa">
            <Play className="ml-0.5 h-6 w-6" aria-hidden />
          </button>
        )}
        {canvas && (
          <TransformOverlay
            format={format}
            elements={elements}
            selectedId={canvas.selectedId}
            onSelect={canvas.onSelect}
            onChange={canvas.onTransform}
            onTextChange={canvas.onText}
            onInteract={() => video.current?.pause()}
            disabled={canvas.disabled}
          />
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
          // Mientras se arrastra, la barra sigue al mouse (la vista previa tarda un instante en llegar a ese segundo).
          value={Math.min(scrub ?? out, duration)}
          style={{ ["--pct" as string]: `${scrub != null ? (Math.min(scrub, duration) / Math.max(0.1, duration)) * 100 : pct}%` }}
          onPointerDown={() => setScrub(out)}
          onPointerUp={() => setScrub(null)}
          onPointerCancel={() => setScrub(null)}
          onBlur={() => setScrub(null)}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (scrub != null) setScrub(t);
            seekOutput(t, playing);
          }}
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

/** Un clip de b-roll que sigue al video principal: arranca en su punto (más el segundo del clip elegido) y se pausa con
 * él; si el clip es más corto que el tramo, vuelve a empezar (como el render). Uno por capa: pueden verse varios a la vez. */
function SyncedBroll({ item, out, playing, format, accent, pxScale }: { item: PreviewBroll; out: number; playing: boolean; format: VideoFormat; accent: string; pxScale: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !item.previewUrl) return;
    const speed = item.edit?.speed ?? 1;
    const target = clipTimeAt(out - item.start, item.edit?.clip_start ?? 0, speed, v.duration);
    if (v.playbackRate !== speed) v.playbackRate = speed;
    if (Math.abs(v.currentTime - target) > 0.35 * Math.max(1, speed)) v.currentTime = target;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [item, out, playing]);
  return (
    <BrollLayer
      className="pointer-events-none"
      edit={item.edit ?? DEFAULT_EDIT}
      format={format}
      media={{ previewUrl: item.previewUrl, thumbUrl: item.thumbUrl, width: item.width ?? 0, height: item.height ?? 0, kind: item.kind }}
      seed={item.id}
      accent={accent}
      time={Math.max(0, out - item.start)}
      duration={item.end - item.start}
      pxScale={pxScale}
      videoRef={ref}
    />
  );
}
