"use client";

import { useEffect, useRef, useState } from "react";

/** Estado de un trabajo de Carruseles tal como lo devuelve /api/carruseles/trabajos/<id>. */
export type JobState = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  stage: string | null;
  error: string | null;
  retrying: string | null;
  output: Record<string, unknown>;
};

export const isActive = (s: JobState | null) => s?.status === "QUEUED" || s?.status === "RUNNING";

/**
 * Sigue un trabajo mientras está en cola o en curso (cada 1,5 s; más lento si la pestaña no se ve).
 * `onUpdate` recibe cada estado nuevo (por ejemplo, para poner las imágenes a medida que salen).
 */
export function useJob(jobId: string | null, onUpdate?: (state: JobState) => void): JobState | null {
  const [state, setState] = useState<JobState | null>(null);
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
        const res = await fetch(`/api/carruseles/trabajos/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as JobState;
          if (!alive) return;
          setState(next);
          cb.current?.(next);
          if (!isActive(next)) return;
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
