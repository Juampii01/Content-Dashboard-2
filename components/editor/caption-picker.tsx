"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { captionLook, isCaptionStyle } from "@/lib/video/caption-styles";
import { CAPTION_PRESETS, captionBlocks } from "@/lib/video/captions";
import type { CaptionStyle } from "@/lib/video/style";
import type { CaptionPresetKey, TimedWord } from "@/lib/video/types";
import { CaptionOverlay } from "./caption-overlay";

/**
 * Selector visual de subtítulos: una miniatura animada por estilo (la misma vista previa que el editor, con el
 * acento y la fuente de Mi marca) que se repite en bucle. Con "reducir movimiento", la miniatura queda quieta.
 */
const SAMPLE = "Así consigues más clientes con tus videos";
const LOOP = 3.6;

const SAMPLE_WORDS: TimedWord[] = sampleWords();

function sampleWords(): TimedWord[] {
  let t = 0.15;
  return SAMPLE.split(" ").map((text, i) => {
    const d = 0.2 + text.length * 0.03;
    const w = { id: i, text, start: +t.toFixed(3), end: +(t + d).toFixed(3), emphasis: text === "clientes" || text === "videos", stop: i === 6 };
    t += d + 0.05;
    return w;
  });
}

/** Reloj compartido de las miniaturas: avanza solo mientras alguna está en pantalla y no se pidió reducir movimiento. */
function useLoopTime(active: boolean): number {
  const [time, setTime] = useState(1.25);
  useEffect(() => {
    if (!active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now;
        setTime(((now - start) / 1000) % LOOP);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return time;
}

function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(Boolean(e?.isIntersecting)), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

function useWidth<T extends Element>(ref: React.RefObject<T | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Miniatura de un estilo: un cuadro 9:16 virtual del que se ve la franja de los subtítulos. */
export function CaptionSample({
  preset,
  time,
  accent,
  brandFont,
  emoji,
  captionStyle,
}: {
  preset: CaptionPresetKey;
  time: number;
  accent: string;
  brandFont: "montserrat" | "inter";
  emoji: boolean;
  captionStyle?: CaptionStyle | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const blocks = useMemo(() => (preset === "ninguno" ? [] : captionBlocks(SAMPLE_WORDS, preset, preset === "estilo" ? captionStyle : null)), [preset, captionStyle]);
  const look = useMemo(() => (isCaptionStyle(preset) ? captionLook(preset, { format: "9:16", accent, brandFont, emoji }) : null), [preset, accent, brandFont, emoji]);
  const block = blocks.find((b) => time >= b.start && time < b.end) ?? null;
  // La miniatura es 5:4 y muestra la franja de los subtítulos de un cuadro 9:16 virtual tan ancho que el 80 %
  // de su ancho (el máximo de un renglón) ocupa casi toda la miniatura: así el texto se lee a tamaño chico.
  const boxH = (width * 4) / 5;
  const frameW = width / 0.86;
  const frameH = (frameW * 16) / 9;
  const anchor = preset === "estilo" && captionStyle ? captionStyle.position : preset === "clasico" || preset === "pop" ? 0.66 : (look?.y ?? 0.665);
  return (
    <div ref={box} className="relative aspect-[5/4] w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#1b2b55] via-[#0c1838] to-[#050b20]" aria-hidden>
      <div className="absolute top-[-6%] left-1/2 h-[48%] w-[34%] -translate-x-1/2 rounded-[45%] bg-white/[0.07]" />
      <div className="absolute top-[38%] left-1/2 h-[80%] w-[70%] -translate-x-1/2 rounded-t-[45%] bg-white/[0.05]" />
      {preset === "ninguno" ? (
        <span className="absolute inset-x-0 top-[48%] text-center text-xs text-muted">Sin texto en pantalla</span>
      ) : (
        width > 0 && (
          <div className="absolute" style={{ width: frameW, height: frameH, left: (width - frameW) / 2, top: boxH * 0.56 - anchor * frameH }}>
            <CaptionOverlay block={block} time={time} preset={preset} format="9:16" accent={accent} height={frameH} captionStyle={captionStyle} look={look} />
          </div>
        )
      )}
    </div>
  );
}

export function CaptionPicker({
  value,
  onChange,
  options,
  accent,
  brandFont,
  emoji = false,
  captionStyle = null,
  disabled = false,
  className,
}: {
  value: CaptionPresetKey;
  onChange: (preset: CaptionPresetKey) => void;
  options: CaptionPresetKey[];
  accent: string;
  brandFont: "montserrat" | "inter";
  emoji?: boolean;
  captionStyle?: CaptionStyle | null;
  disabled?: boolean;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const time = useLoopTime(inView);
  return (
    <div ref={ref} role="radiogroup" aria-label="Estilo de subtítulos" className={cn("grid grid-cols-2 gap-2.5", className)}>
      {options.map((k) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(k)}
            title={CAPTION_PRESETS[k].description}
            className={cn(
              "group flex flex-col gap-2 rounded-2xl border p-2 text-left transition disabled:cursor-not-allowed",
              active ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25",
            )}
          >
            <CaptionSample preset={k} time={time} accent={accent} brandFont={brandFont} emoji={emoji} captionStyle={captionStyle} />
            <span className={cn("px-1 pb-0.5 text-xs font-semibold", active ? "text-white" : "text-text")}>{CAPTION_PRESETS[k].label}</span>
          </button>
        );
      })}
    </div>
  );
}
