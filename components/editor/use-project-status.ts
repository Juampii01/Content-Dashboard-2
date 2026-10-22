"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type LiveStatus = {
  status: string;
  errorMessage: string | null;
  /** "Hazlo por mí": se exporta solo apenas está el plan. */
  autoExport?: boolean;
  job: { type: string; status: string; progress: number; stage: string | null; attempts: number; maxAttempts: number; errorMessage: string | null } | null;
  worker: { online: boolean; autoStart: boolean };
};

const ACTIVE = new Set(["PROCESSING", "RENDERING"]);

/**
 * Consulta el estado real cada 2 s mientras el proyecto se procesa.
 * Cuando cambia de estado (por ejemplo, queda listo para revisar), refresca la página del servidor.
 * Con "Hazlo por mí", el paso por "en revisión" dura un instante (enseguida arranca el render): ese estado no
 * refresca la página, se sigue consultando hasta que llega el render (o un error).
 */
export function useProjectStatus(projectId: string, initial: LiveStatus, opts: { watch?: boolean } = {}): LiveStatus {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const statusRef = useRef(initial.status);
  const transientSince = useRef<number | null>(null);

  useEffect(() => {
    if (!ACTIVE.has(initial.status) && !opts.watch) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/editor/projects/${projectId}/status`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as LiveStatus;
          if (stopped) return;
          setLive(next);
          const transient = Boolean(next.autoExport && next.status === "AWAITING_REVIEW" && !next.errorMessage);
          if (transient) {
            transientSince.current ??= Date.now();
            // Si en 90 s no arrancó el render, algo lo frenó: se muestra la revisión.
            if (Date.now() - transientSince.current > 90_000) {
              router.refresh();
              return;
            }
          } else transientSince.current = null;
          if (next.status !== statusRef.current && !transient) {
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
  }, [projectId, initial.status, router, opts.watch]);

  return live;
}
