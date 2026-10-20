import localFont from "next/font/local";
import { cn } from "@/lib/utils";
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
}) {
  if (!block || preset === "ninguno") return null;
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
