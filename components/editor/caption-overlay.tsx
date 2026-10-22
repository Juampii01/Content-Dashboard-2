"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";
import { captionTracks, colorAt, valueAt, type CaptionLook, type WordTrack } from "@/lib/video/caption-styles";
import type { CaptionStyle } from "@/lib/video/style";
import type { CaptionBlock, CaptionPresetKey, VideoFormat } from "@/lib/video/types";

/**
 * Subtítulos dibujados en HTML sobre la vista previa, con las mismas medidas que el ASS del worker
 * (worker/video/ass.py): misma fuente, tamaño relativo a la altura, borde y margen inferior.
 * Con el preset "estilo", los parámetros salen del estilo medido en la referencia (posición, tamaño, colores, caja).
 */
const extraBold = localFont({ src: "./fonts/Montserrat-ExtraBold.ttf", weight: "800", display: "swap" });
const black = localFont({ src: "./fonts/Montserrat-Black.ttf", weight: "900", display: "swap" });

/** Alturas relativas sacadas del ASS: tamaño de fuente y borde sobre 1920 (vertical) o 1080 (horizontal). */
const SIZES: Record<"clasico" | "pop", Record<VideoFormat, { font: number; outline: number }>> = {
  clasico: { "9:16": { font: 76 / 1920, outline: 5 / 1920 }, "16:9": { font: 64 / 1080, outline: 5 / 1080 } },
  pop: { "9:16": { font: 112 / 1920, outline: 6 / 1920 }, "16:9": { font: 92 / 1080, outline: 6 / 1080 } },
};
const MARGIN_BOTTOM: Record<VideoFormat, number> = { "9:16": 0.3, "16:9": 0.21 };

export function CaptionOverlay({
  block,
  time,
  preset,
  format,
  accent,
  height,
  captionStyle,
  look,
}: {
  block: CaptionBlock | null;
  /** Instante del video final. */
  time: number;
  preset: CaptionPresetKey;
  format: VideoFormat;
  accent: string;
  /** Altura del cuadro de la vista previa, en px. */
  height: number;
  /** Parámetros del estilo (solo con el preset "estilo"). */
  captionStyle?: CaptionStyle | null;
  /** Diseño de un estilo de la galería (lib/video/caption-styles.ts). */
  look?: CaptionLook | null;
}) {
  if (!block || preset === "ninguno") return null;
  if (look && look.style === preset) return <GalleryCaption block={block} time={time} look={look} format={format} accent={accent} height={height} />;
  const activeIndex = block.words.findIndex((w, i) => time >= (i === 0 ? block.start : w.start) && (i + 1 >= block.words.length || time < block.words[i + 1]!.start));
  if (preset === "estilo" && captionStyle) return <StyledCaption block={block} activeIndex={activeIndex} height={height} st={captionStyle} />;
  const key = preset === "pop" ? "pop" : "clasico";
  const size = SIZES[key][format];
  const fontPx = size.font * height;
  const stroke = Math.max(1, size.outline * height * 2);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 flex justify-center"
      style={{ bottom: `${MARGIN_BOTTOM[format] * 100}%`, paddingInline: "8%" }}
    >
      <p
        key={preset === "pop" ? `${block.start}` : undefined}
        className={cn("m-0 text-center leading-[1.15] text-white", preset === "pop" ? `${black.className} uppercase animate-pop-in` : extraBold.className)}
        style={{
          fontSize: `${fontPx}px`,
          WebkitTextStroke: `${stroke}px #000`,
          paintOrder: "stroke fill",
          textShadow: `0 ${stroke * 0.4}px ${stroke * 0.8}px rgba(0,0,0,0.45)`,
          letterSpacing: 0,
        }}
      >
        {block.words.map((w, i) => {
          const active = preset === "clasico" ? i === activeIndex : w.emphasis;
          return (
            <span key={`${w.id}-${i}`} style={{ color: active ? accent : undefined, fontSize: preset === "clasico" && w.emphasis ? "1.12em" : undefined }}>
              {i > 0 ? " " : ""}
              {preset === "pop" ? w.text.toLocaleUpperCase("es") : w.text}
            </span>
          );
        })}
      </p>
    </div>
  );
}

/** Igual que build_style_ass: bloque centrado en `position`, con caja o borde, y la palabra activa resaltada. */
function StyledCaption({ block, activeIndex, height, st }: { block: CaptionBlock; activeIndex: number; height: number; st: CaptionStyle }) {
  const fontPx = st.size * height;
  const stroke = st.box ? 0 : st.outline ? Math.max(1, fontPx * 0.075 * 2) : 0;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: `${st.position * 100}%`, transform: "translateY(-50%)", paddingInline: "8%" }}>
      <p
        className={cn("m-0 text-center leading-[1.2]", st.font === "black" ? black.className : extraBold.className)}
        style={{
          fontSize: `${fontPx}px`,
          color: st.textColor,
          WebkitTextStroke: stroke ? `${stroke}px #000` : undefined,
          paintOrder: "stroke fill",
          textShadow: st.box ? undefined : `0 ${fontPx * 0.04}px ${fontPx * 0.08}px rgba(0,0,0,0.45)`,
          background: st.box ? (st.boxColor ?? "#000000") : undefined,
          padding: st.box ? `${fontPx * 0.12}px ${fontPx * 0.25}px` : undefined,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          display: "inline",
          textTransform: st.uppercase ? "uppercase" : undefined,
        }}
      >
        {block.words.map((w, i) => (
          <span key={`${w.id}-${i}`} style={{ color: st.highlightColor && i === activeIndex ? st.highlightColor : undefined, fontSize: !st.highlightColor && w.emphasis ? "1.1em" : undefined }}>
            {i > 0 ? " " : ""}
            {st.uppercase ? w.text.toLocaleUpperCase("es") : w.text}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Fuente de un estilo de la galería: Montserrat con los mismos archivos que el worker; Inter, la de la app (variable). */
function fontStyle(look: CaptionLook): { className?: string; style: CSSProperties } {
  if (look.font.family === "Montserrat") return { className: look.font.weight >= 900 ? black.className : extraBold.className, style: {} };
  // Tamaño óptico de texto (14), igual que los archivos estáticos de Inter que usa el worker.
  return { style: { fontFamily: "Inter, sans-serif", fontWeight: look.font.weight, fontVariationSettings: "'opsz' 14", fontOpticalSizing: "none" } };
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/**
 * Un bloque con un estilo de la galería. Igual que build_look_ass del worker: renglones centrados en `look.y`,
 * cada palabra centrada en su lugar (la escala no mueve a las demás), la caja y el resaltador detrás, la sombra
 * con el contorno, y si un renglón no entra en `maxWidth` el bloque entero se achica.
 */
function GalleryCaption({ block, time, look, format, accent, height }: { block: CaptionBlock; time: number; look: CaptionLook; format: VideoFormat; accent: string; height: number }) {
  const laid = useMemo(() => captionTracks(look, block, format, accent), [look, block, format, accent]);
  const width = format === "9:16" ? (height * 9) / 16 : (height * 16) / 9;
  const em = look.size * height;
  const rows = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const measure = () => {
      const el = rows.current;
      if (!el) return;
      const widest = Math.max(0, ...[...el.children].map((row) => (row as HTMLElement).scrollWidth));
      const next = widest > 0 ? Math.min(1, (look.maxWidth * width) / widest) : 1;
      setFit((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    };
    measure();
    if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(measure);
  }, [laid, em, width, look.maxWidth]);
  const font = fontStyle(look);
  const lines: WordTrack[][] = Array.from({ length: laid.lines }, (_, i) => laid.words.filter((w) => w.line === i));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={rows}
        className={cn("absolute left-1/2 flex flex-col items-center", font.className)}
        style={{ ...font.style, top: `${look.y * 100}%`, fontSize: `${em}px`, transform: `translate(-50%, -50%) scale(${fit})`, letterSpacing: 0, whiteSpace: "nowrap" }}
      >
        {lines.map((line, li) => (
          <div key={li} className="flex items-center" style={{ columnGap: `${look.gap}em` }}>
            {line.map((w, wi) => (
              <GalleryWord key={wi} w={w} time={time} look={look} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryWord({ w, time, look }: { w: WordTrack; time: number; look: CaptionLook }) {
  const alpha = valueAt(w.alpha, time);
  const scale = valueAt(w.scale, time);
  const color = colorAt(w.color, time);
  const stroke = look.outline > 0 ? `${look.outline * 2}em` : undefined;
  const shadow = look.shadow ? `drop-shadow(0 ${look.shadow.y}em ${look.shadow.blur}em ${rgba(look.shadow.color, look.shadow.alpha)})` : undefined;
  return (
    <span className="relative inline-block" style={{ fontSize: `${w.size}em`, lineHeight: look.lineHeight }}>
      {look.box && w.box && (
        <span
          className="absolute"
          style={{
            left: `${-look.box.padX}em`,
            right: `${-look.box.padX}em`,
            top: "50%",
            height: `${1 + 2 * look.box.padY}em`,
            marginTop: `${-(1 + 2 * look.box.padY) / 2}em`,
            borderRadius: `${look.box.radius}em`,
            background: look.box.color,
            opacity: valueAt(w.box.alpha, time),
            transform: `scale(${valueAt(w.box.scale, time)})`,
          }}
        />
      )}
      {look.marker && w.marker && (
        <span
          className="absolute"
          style={{
            left: `${-look.marker.padX}em`,
            right: `${-look.marker.padX}em`,
            top: "50%",
            height: `${look.marker.height}em`,
            marginTop: `${-look.marker.height / 2}em`,
            borderRadius: `${look.marker.radius}em`,
            background: rgba(look.marker.color, look.marker.alpha),
            transformOrigin: "left center",
            transform: `scaleX(${valueAt(w.marker.grow, time)})`,
          }}
        />
      )}
      {w.emoji && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/emoji/${w.emoji.name}.png`}
          alt=""
          className="absolute left-1/2 max-w-none"
          style={{ width: "1.1em", height: "1.1em", top: "-1.15em", marginLeft: "-0.55em", opacity: valueAt(w.emoji.alpha, time) }}
        />
      )}
      <span
        className="relative inline-block"
        style={{ color, opacity: alpha, transform: scale !== 1 ? `scale(${scale})` : undefined, WebkitTextStroke: stroke ? `${stroke} ${look.outlineColor}` : undefined, paintOrder: "stroke fill", filter: shadow }}
      >
        {w.text}
      </span>
    </span>
  );
}
