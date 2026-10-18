"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type LiveStatus = {
  status: string;
  errorMessage: string | null;
  job: { type: string; status: string; progress: number; stage: string | null; attempts: number; maxAttempts: number; errorMessage: string | null } | null;
  worker: { online: boolean; autoStart: boolean };
};

const ACTIVE = new Set(["PROCESSING", "RENDERING"]);

/**
 * Consulta el estado real cada 2 s mientras el proyecto se procesa.
 * Cuando cambia de estado (por ejemplo, queda listo para revisar), refresca la página del servidor.
 */
export function useProjectStatus(projectId: string, initial: LiveStatus): LiveStatus {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const statusRef = useRef(initial.status);

  useEffect(() => {
    if (!ACTIVE.has(initial.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/editor/projects/${projectId}/status`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as LiveStatus;
          if (stopped) return;
          setLive(next);
          if (next.status !== statusRef.current) {
            statusRef.current = next.status;
            router.refresh();
            return;
          }
        }
      } catch {
        // Sin conexión por un momento: se vuelve a intentar.
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 6000 : 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, initial.status, router]);

  return live;
}
