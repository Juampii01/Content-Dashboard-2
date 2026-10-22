"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AudioPreview, StudioLevel } from "@/lib/video/studio-audio";

type Side = "before" | "after";

/**
 * "Escuchar antes y después": los mismos 10 s de la toma, primero tal cual y después con el audio de estudio elegido
 * (las dos versiones a la misma sonoridad, así se compara la limpieza y no el volumen). Mientras suena, "Antes" y
 * "Después" cambian de versión en el mismo instante, para comparar una frase.
 */
export function StudioPreview({ preview, level }: { preview: AudioPreview | null; level: StudioLevel }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState(false);
  const afterUrl = level === "off" || !preview ? null : preview.urls[level];
  // Al cambiar de nivel, el panel monta otra muestra (key): esta se detiene sola.
  useEffect(() => () => audio.current?.pause(), []);

  function stop() {
    audio.current?.pause();
    audio.current = null;
    setSide(null);
    setTime(0);
  }

  function play(next: Side, at = 0) {
    const url = next === "before" ? preview?.urls.original : afterUrl;
    if (!url) return;
    audio.current?.pause();
    const el = new Audio(url);
    el.preload = "auto";
    // Solo el elemento que suena ahora puede cambiar el estado: al pasar de "Antes" a "Después", la pausa del
    // anterior rechaza su play() y eso no tiene que detener al nuevo.
    const current = () => audio.current === el;
    const fail = () => current() && stop();
    el.ontimeupdate = () => current() && setTime(el.currentTime);
    // Primero "Antes" y enseguida "Después"; al terminar "Después", se detiene.
    el.onended = () => current() && (next === "before" ? play("after", 0) : stop());
    el.onerror = () => {
      if (!current()) return;
      setError(true);
      stop();
    };
    if (at > 0) {
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = Math.min(at, Math.max(0, el.duration - 0.05));
          void el.play().catch(fail);
        },
        { once: true },
      );
    } else {
      void el.play().catch(fail);
    }
    audio.current = el;
    setSide(next);
    setTime(at);
    setError(false);
  }

  if (!preview) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-muted">
        <AudioLines className="mt-0.5 h-3.5 w-3.5 flex-none text-accent-hi" aria-hidden />
        <span>La muestra para escuchar el antes y el después se prepara al procesar un video nuevo. Este video igual sale con el audio de estudio que elijas.</span>
      </p>
    );
  }

  const duration = preview.duration || 10;
  const pct = Math.max(0, Math.min(100, (time / duration) * 100));
  const disabled = !afterUrl;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-white/[0.02] p-3">
      {side === null ? (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => play("before")} disabled={disabled} icon={<AudioLines className="h-3.5 w-3.5" aria-hidden />}>
          Escuchar antes y después
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <SegmentedControl
            label="Versión que suena"
            size="sm"
            className="flex flex-1 [&>button]:flex-1 [&>button]:justify-center"
            value={side}
            onValueChange={(s) => s !== side && play(s, audio.current?.currentTime ?? 0)}
            options={[
              { value: "before", label: "Antes" },
              { value: "after", label: "Después" },
            ]}
          />
          <button
            type="button"
            onClick={stop}
            className="grid h-8 w-8 flex-none place-items-center rounded-xl border border-white/15 text-accent-hi transition hover:border-accent/60"
            aria-label="Detener la muestra"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2" aria-hidden={side === null}>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className={cn("h-full rounded-full", side === "before" ? "bg-muted" : "bg-accent-hi")} style={{ width: `${side ? pct : 0}%` }} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {formatDuration(side ? time : 0)} / {formatDuration(duration)}
        </span>
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {error
          ? "No se pudo reproducir la muestra en este navegador."
          : disabled
            ? "Elige Suave o Fuerte para escuchar la diferencia."
            : side === "before"
              ? "Suena tu toma tal cual. Enseguida, con el audio de estudio."
              : side === "after"
                ? "Suena con el audio de estudio. Toca «Antes» para comparar."
                : `Muestra de ${formatDuration(preview.start)} a ${formatDuration(preview.start + duration)} de tu toma, al mismo volumen.`}
      </p>
    </div>
  );
}
