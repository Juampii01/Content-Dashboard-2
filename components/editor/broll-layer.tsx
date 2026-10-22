"use client";

import { useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { brollAlpha, brollGeometry, clipAspectOf, entranceScale, frameCrop, lookMatrix, OUTPUT_SIZE, svgMatrixValues, type BrollEdit, type BrollFrame, type BrollGeometry, type PxBox } from "@/lib/video/broll-edit";
import type { VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";

/**
 * Un b-roll de video dibujado con su edición, en HTML y CSS, igual que el render del worker: el marco (pantalla
 * completa, mitad o tarjeta), el recorte del clip (zoom y corrimiento), el look (matriz de color con un filtro SVG en
 * sRGB, el mismo que la LUT 3D del worker), la opacidad con el fundido y el zoom de entrada.
 */

export type BrollMedia = { previewUrl: string | null; thumbUrl: string | null; width: number; height: number };

const pct = (n: number, total: number) => `${(n / total) * 100}%`;

/** Caja en porcentajes del cuadro de salida. */
export function boxStyle(box: PxBox, format: VideoFormat): CSSProperties {
  const { w: W, h: H } = OUTPUT_SIZE[format];
  return { left: pct(box.x, W), top: pct(box.y, H), width: pct(box.w, W), height: pct(box.h, H) };
}

/**
 * La persona en pantalla dividida o a un lado: se recorta la parte `from` del cuadro y se lleva a `to` (como el crop +
 * overlay del worker). Se aplica a la capa que contiene el video de la persona.
 */
export function personStyle(person: BrollGeometry["person"], format: VideoFormat): CSSProperties | undefined {
  if (!person) return undefined;
  const { w: W, h: H } = OUTPUT_SIZE[format];
  const { from, to } = person;
  return {
    clipPath: `inset(${pct(from.y, H)} ${pct(W - from.x - from.w, W)} ${pct(H - from.y - from.h, H)} ${pct(from.x, W)})`,
    transform: `translate(${pct(to.x - from.x, W)}, ${pct(to.y - from.y, H)})`,
  };
}

/** Filtro SVG con la matriz del look (en sRGB, como la LUT del worker). null si el look es neutro. */
export function LookFilter({ id, edit, accent }: { id: string; edit: BrollEdit; accent: string }) {
  const m = lookMatrix(edit.look, accent);
  if (!m) return null;
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={svgMatrixValues(m)} />
      </filter>
    </svg>
  );
}

export function BrollLayer({
  edit,
  format,
  media,
  accent,
  time,
  duration,
  pxScale,
  videoRef,
  loop = false,
  fades = true,
  onFrameDrag,
  className,
}: {
  edit: BrollEdit;
  format: VideoFormat;
  media: BrollMedia;
  /** Acento de Mi marca (duotono). */
  accent: string;
  /** Segundos desde que empieza el b-roll (para el fundido y el zoom de entrada). */
  time: number;
  duration: number;
  /** Píxeles de pantalla por píxel del video final (radios y sombras de la tarjeta). */
  pxScale: number;
  videoRef?: Ref<HTMLVideoElement>;
  loop?: boolean;
  /** false: sin fundido (en el editor del b-roll, para ver el look tal cual). */
  fades?: boolean;
  /** Arrastrar sobre el clip corre el encuadre (en el editor del b-roll). */
  onFrameDrag?: (frame: BrollFrame) => void;
  className?: string;
}) {
  const filterId = `look-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const geo = brollGeometry(edit, format, clipAspectOf(media.width, media.height));
  const box = geo.clip;
  const crop = frameCrop(media.width, media.height, box.w, box.h, edit.frame);
  const alpha = fades ? brollAlpha(edit, time, duration) : edit.look.opacity;
  const zoom = entranceScale(edit.transition, time);
  const hasFilter = Boolean(lookMatrix(edit.look, accent));
  const card = geo.card;
  const drag = useRef<{ x: number; y: number; frame: BrollFrame } | null>(null);
  // Si el navegador no puede reproducir el clip, queda su miniatura (con el mismo encuadre y look).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const playable = media.previewUrl && failedSrc !== media.previewUrl ? media.previewUrl : null;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onFrameDrag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, frame: edit.frame };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !onFrameDrag || pxScale <= 0) return;
    // Arrastrar a la derecha muestra lo que estaba a la izquierda (como mover una foto dentro de un marco).
    const freeX = (crop.sw - box.w) / 2;
    const freeY = (crop.sh - box.h) / 2;
    const dx = (e.clientX - d.x) / pxScale;
    const dy = (e.clientY - d.y) / pxScale;
    const clampF = (n: number) => Math.max(-1, Math.min(1, Math.round(n * 100) / 100));
    onFrameDrag({ ...d.frame, x: freeX > 0.5 ? clampF(d.frame.x - dx / freeX) : d.frame.x, y: freeY > 0.5 ? clampF(d.frame.y - dy / freeY) : d.frame.y });
  }
  function onPointerUp() {
    drag.current = null;
  }

  const mediaStyle: CSSProperties = {
    position: "absolute",
    maxWidth: "none",
    width: pct(crop.sw, box.w),
    height: pct(crop.sh, box.h),
    left: `-${pct(crop.cx, box.w)}`,
    top: `-${pct(crop.cy, box.h)}`,
  };
  return (
    <div
      className={cn("absolute overflow-hidden", onFrameDrag && "cursor-grab touch-none active:cursor-grabbing", className)}
      style={{
        ...boxStyle(box, format),
        opacity: alpha,
        ...(card ? { borderRadius: card.radius * pxScale, boxShadow: `0 ${card.shadowY * pxScale}px ${card.shadowBlur * pxScale}px rgba(0,0,0,${card.shadowAlpha})` } : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-hidden
    >
      <LookFilter id={filterId} edit={edit} accent={accent} />
      <div className="absolute inset-0" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined, filter: hasFilter ? `url(#${filterId})` : undefined }}>
        {playable ? (
          <video
            ref={videoRef}
            src={playable}
            poster={media.thumbUrl ?? undefined}
            muted
            playsInline
            loop={loop}
            autoPlay={loop}
            preload="auto"
            style={{ ...mediaStyle, objectFit: "cover" }}
            draggable={false}
            onError={() => setFailedSrc(playable)}
          />
        ) : media.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.thumbUrl} alt="" style={{ ...mediaStyle, objectFit: "cover" }} draggable={false} />
        ) : null}
      </div>
      {card && card.border > 0 && (
        <div className="pointer-events-none absolute inset-0" style={{ borderRadius: card.radius * pxScale, boxShadow: `inset 0 0 0 ${Math.max(1, card.border * pxScale)}px rgba(255,255,255,${card.borderAlpha})` }} />
      )}
    </div>
  );
}
