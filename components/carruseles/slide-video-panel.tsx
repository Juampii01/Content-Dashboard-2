"use client";

import { useState } from "react";
import { AlertTriangle, Clapperboard, Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import type { CarouselSlide } from "@/lib/db/schema";
import { MOTIONS, VIDEO_SECONDS, type Motion, type VideoFormat } from "@/lib/carousels/slide-hash";

export type AnimateSettings = { format: VideoFormat; motion: Motion; seconds: number };

/**
 * Video corto de este slide (opcional): el slide tal cual se ve, con un movimiento suave, en 4:5 para el carrusel o
 * en 9:16 para historias y reels. Lo hace el worker; se puede salir y volver.
 */
export function SlideVideoPanel({
  slide,
  hash,
  canEdit,
  disabled,
  running,
  progress,
  stage,
  onAnimate,
  onRemove,
}: {
  slide: CarouselSlide;
  /** Huella actual del slide: si no coincide con la del video, el video quedó viejo. */
  hash: string;
  canEdit: boolean;
  disabled: boolean;
  running: boolean;
  progress: number;
  stage: string | null;
  onAnimate: (settings: AnimateSettings) => void;
  onRemove: () => void;
}) {
  const [format, setFormat] = useState<VideoFormat>(slide.videoFormat ?? "4:5");
  const [motion, setMotion] = useState<Motion>("zoom");
  const [seconds, setSeconds] = useState<number>(6);
  const stale = Boolean(slide.videoUrl && slide.videoHash && slide.videoHash !== hash);

  return (
    <details className="group rounded-xl border border-white/10 p-3" open={Boolean(slide.videoUrl) || running}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-white">
        <span className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-accent-hi" aria-hidden />
          Video de este slide <span className="font-normal text-muted">(opcional)</span>
        </span>
        <span className="text-xs font-normal text-muted group-open:hidden">{slide.videoUrl ? "Tiene video" : "Animar"}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {slide.videoUrl && (
          <div className="flex flex-col gap-2">
            <video
              key={slide.videoUrl}
              src={slide.videoUrl}
              className={slide.videoFormat === "9:16" ? "mx-auto aspect-[9/16] max-h-80 rounded-lg border border-white/10 bg-black" : "mx-auto aspect-[4/5] max-h-80 rounded-lg border border-white/10 bg-black"}
              autoPlay
              loop
              muted
              playsInline
              aria-label="Video del slide"
            />
            {stale && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                Cambiaste el slide después de animarlo: vuelve a animarlo para que el video muestre lo nuevo.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <a href={slide.videoUrl} download className="btn-ghost inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold">
                <Download className="h-3.5 w-3.5" aria-hidden /> Descargar MP4
              </a>
              {canEdit && (
                <Button variant="subtle" size="sm" disabled={disabled || running} onClick={onRemove} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                  Quitar video
                </Button>
              )}
            </div>
          </div>
        )}
        {canEdit && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-white">Formato</span>
                <SegmentedControl
                  label="Formato del video"
                  size="sm"
                  value={format}
                  onValueChange={setFormat}
                  options={[
                    { value: "4:5", label: "4:5 carrusel" },
                    { value: "9:16", label: "9:16 historia" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-white">Duración</span>
                <SegmentedControl label="Duración del video" size="sm" value={String(seconds)} onValueChange={(v) => setSeconds(Number(v))} options={VIDEO_SECONDS.map((s) => ({ value: String(s), label: `${s} s` }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-white">Movimiento</span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Movimiento">
                {(Object.keys(MOTIONS) as Motion[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={motion === m}
                    onClick={() => setMotion(m)}
                    className={motion === m ? "rounded-lg border border-accent bg-accent/15 px-2 py-1.5 text-left" : "rounded-lg border border-white/10 px-2 py-1.5 text-left hover:border-white/25"}
                  >
                    <span className="block text-xs font-semibold text-white">{MOTIONS[m].label}</span>
                    <span className="block text-[11px] leading-snug text-muted">{MOTIONS[m].hint}</span>
                  </button>
                ))}
              </div>
            </div>
            {running ? (
              <Progress value={progress} label={stage ?? "Animando el slide"} />
            ) : (
              <div>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onAnimate({ format, motion, seconds })} icon={running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Clapperboard className="h-3.5 w-3.5" aria-hidden />}>
                  {slide.videoUrl ? "Animar de nuevo" : "Animar este slide"}
                </Button>
                <p className="mt-1 text-xs text-muted">Sin sonido. No gasta imágenes.</p>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
