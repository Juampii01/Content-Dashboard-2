"use client";

import { useEffect, useRef, useState } from "react";

/** Estado de un trabajo de YouTube tal como lo devuelve /api/youtube/trabajos/<id>. */
export type YtJobState = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  stage: string | null;
  error: string | null;
  retrying: string | null;
  output: Record<string, unknown>;
};

export const jobActive = (s: YtJobState | null) => s?.status === "QUEUED" || s?.status === "RUNNING";

/** Sigue un trabajo mientras está en cola o en curso (cada 1,5 s; más lento si la pestaña no se ve). */
export function useYtJob(jobId: string | null, onUpdate?: (state: YtJobState) => void): YtJobState | null {
  const [state, setState] = useState<YtJobState | null>(null);
  const cb = useRef(onUpdate);
  useEffect(() => {
    cb.current = onUpdate;
  });
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/youtube/trabajos/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as YtJobState;
          if (!alive) return;
          setState(next);
          cb.current?.(next);
          if (!jobActive(next)) return;
        }
      } catch {
        // Sin red un momento: se vuelve a intentar.
      }
      if (alive) timer = setTimeout(tick, document.visibilityState === "visible" ? 1500 : 6000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);
  return jobId ? state : null;
}
