"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Captions, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CAPTION_PRESETS } from "@/lib/video/captions";
import { transcribeAgainAction } from "../edit-actions";
import type { StudioApi } from "./types";

/** Clave local: «Subtitular» pidió crear la transcripción; al volver a la revisión se encienden los subtítulos. */
export const SUBS_AFTER_KEY = (projectId: string) => `studio.subsAfter.${projectId}`;

/**
 * Arriba de la pestaña Transcripción: «Subtitular» pone los subtítulos con el estilo de Mi marca usando esta misma
 * transcripción. Si el video no tiene transcripción, primero la crea y después subtitula.
 */
export function SubtitleBar({ api, onOpenStyle }: { api: StudioApi; onOpenStyle: () => void }) {
  const { props, state } = api;
  const router = useRouter();
  const [pending, start] = useTransition();
  const on = state.preset !== "ninguno";
  const fallback = props.captionDefault && props.captionDefault !== "ninguno" ? props.captionDefault : "caja";
  const noWords = props.words.length === 0;

  function subtitle() {
    if (!noWords) {
      api.update((st) => ({ ...st, preset: fallback }));
      toast.success("Listo: el video tiene subtítulos. Corrige aquí abajo la palabra que haga falta.");
      return;
    }
    start(async () => {
      const r = await transcribeAgainAction(props.projectId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      try {
        localStorage.setItem(SUBS_AFTER_KEY(props.projectId), "1");
      } catch {
        // Sin almacenamiento local los subtítulos se encienden a mano al volver.
      }
      toast.info("Creando la transcripción. Cuando termine, el video vuelve con los subtítulos puestos.");
      router.refresh();
    });
  }

  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-white/5 text-white">
          <Captions className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Subtitular</p>
          <p className="text-xs text-muted">
            {noWords ? "Este video no tiene transcripción: la creamos y con ella ponemos los subtítulos." : on ? `Subtítulos puestos · ${CAPTION_PRESETS[state.preset].label}` : "Subtítulos con esta transcripción, sin cortar nada del video."}
          </p>
        </div>
      </div>
      {props.canEdit &&
        (on && !noWords ? (
          <Button size="sm" variant="ghost" className="flex-none" icon={<Palette className="h-3.5 w-3.5" aria-hidden />} onClick={onOpenStyle}>
            Estilo
          </Button>
        ) : (
          <Button size="sm" className="flex-none" disabled={pending} onClick={subtitle} icon={pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Captions className="h-3.5 w-3.5" aria-hidden />}>
            {pending ? "Creando…" : noWords ? "Transcribir y subtitular" : "Subtitular"}
          </Button>
        ))}
    </section>
  );
}
