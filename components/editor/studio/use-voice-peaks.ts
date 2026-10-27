"use client";

import { useEffect, useState } from "react";
import { decodePeaks, type Peaks } from "@/lib/video/peaks";
import { peaksAction } from "../audio-actions";

/**
 * Forma de onda de la voz del video. La lee el servidor (lib/video/peaks-service.ts); si el video es de antes y no la
 * tiene, el worker la arma (unos segundos) y aquí se consulta cada 6 s, como mucho 10 minutos.
 */
export function useVoicePeaks(projectId: string, enabled: boolean): Peaks | null {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const poll = async () => {
      const r = await peaksAction(projectId).catch(() => null);
      if (!alive || !r?.ok) return;
      if (r.data.status === "ready") setPeaks(decodePeaks(r.data.peaks));
      else if (r.data.status === "pending" && Date.now() - started < 10 * 60_000) timer = setTimeout(poll, 6000);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, enabled]);
  return peaks;
}
