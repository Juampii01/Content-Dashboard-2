"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Teleprompter: el guion (solo lo que se dice) que se desplaza solo a la velocidad elegida, en palabras por minuto.
 * Con "Seguir mi voz", se detiene mientras no hablas y sigue cuando vuelves a hablar: mide la energía del micrófono
 * en el navegador (sin servicios externos). No reconoce palabras: si te saltas una frase, el texto no salta contigo;
 * puedes moverlo con la rueda del mouse o deslizando con el dedo.
 */
export function Teleprompter({
  paragraphs,
  running,
  wpm,
  size,
  followVoice,
  speaking,
  resetKey,
  className,
}: {
  paragraphs: string[];
  /** Se desplaza solo (mientras se graba). */
  running: boolean;
  wpm: number;
  /** Tamaño de la letra en px. */
  size: number;
  followVoice: boolean;
  speaking: boolean;
  /** Al cambiar (otra toma u otro guion), vuelve al principio. */
  resetKey: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const words = useMemo(() => paragraphs.join(" ").split(/\s+/).filter(Boolean).length, [paragraphs]);
  const live = useRef({ running, wpm, followVoice, speaking, words });
  useEffect(() => {
    live.current = { running, wpm, followVoice, speaking, words };
  }, [running, wpm, followVoice, speaking, words]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [resetKey]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const el = box.current;
      const s = live.current;
      if (el && s.running && (!s.followVoice || s.speaking) && s.words > 0) {
        // Alto del texto (sin los márgenes de arriba y abajo) repartido entre las palabras.
        const textHeight = Math.max(1, el.scrollHeight - el.clientHeight);
        const pxPerSecond = (s.wpm / 60) * (textHeight / s.words);
        carry += pxPerSecond * dt;
        if (carry >= 1) {
          const step = Math.floor(carry);
          el.scrollTop += step;
          carry -= step;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const waiting = running && followVoice && !speaking;

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        ref={box}
        tabIndex={0}
        aria-label="Teleprompter: tu guion"
        className="h-full overflow-y-auto overscroll-contain px-5 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden"
        style={{ fontSize: size, lineHeight: 1.35 }}
      >
        <div aria-hidden className="h-[30%]" />
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-[0.9em] font-semibold tracking-[-0.01em] text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
            {p}
          </p>
        ))}
        <div aria-hidden className="h-[70%]" />
      </div>
      {/* Línea de lectura: lo que está a esta altura es lo que estás diciendo. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[30%] h-[1.4em] -translate-y-[0.15em] border-y border-accent-hi/40 bg-accent/10" style={{ fontSize: size }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/70 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
      {waiting && (
        <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-muted" role="status">
          En pausa: sigue cuando hables
        </span>
      )}
    </div>
  );
}
