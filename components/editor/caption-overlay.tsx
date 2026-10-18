import localFont from "next/font/local";
import { cn } from "@/lib/utils";
import type { CaptionBlock, CaptionPresetKey, VideoFormat } from "@/lib/video/types";

/**
 * Subtítulos dibujados en HTML sobre la vista previa, con las mismas medidas que el ASS del worker
 * (worker/video/ass.py): misma fuente, tamaño relativo a la altura, borde y margen inferior.
 */
const extraBold = localFont({ src: "./fonts/Montserrat-ExtraBold.ttf", weight: "800", display: "swap" });
const black = localFont({ src: "./fonts/Montserrat-Black.ttf", weight: "900", display: "swap" });

/** Alturas relativas sacadas del ASS: tamaño de fuente y borde sobre 1920 (vertical) o 1080 (horizontal). */
const SIZES: Record<Exclude<CaptionPresetKey, "ninguno">, Record<VideoFormat, { font: number; outline: number }>> = {
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
}: {
  block: CaptionBlock | null;
  /** Instante del video final. */
  time: number;
  preset: CaptionPresetKey;
  format: VideoFormat;
  accent: string;
  /** Altura del cuadro de la vista previa, en px. */
  height: number;
}) {
  if (!block || preset === "ninguno") return null;
  const size = SIZES[preset][format];
  const fontPx = size.font * height;
  const stroke = Math.max(1, size.outline * height * 2);
  const activeIndex = block.words.findIndex((w, i) => time >= (i === 0 ? block.start : w.start) && (i + 1 >= block.words.length || time < block.words[i + 1]!.start));
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
