"use client";

import { Check, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { ANALYZE_STAGES, RENDER_STAGES } from "./labels";
import { useProjectStatus, type LiveStatus } from "./use-project-status";
import { WorkerNotice } from "./worker-notice";

/** Progreso real por etapa mientras el worker procesa. Se actualiza solo y se puede salir y volver. */
export function ProcessingView({ projectId, initial, kind }: { projectId: string; initial: LiveStatus; kind: "analyze" | "render" }) {
  const live = useProjectStatus(projectId, initial);
  const job = live.job;
  const stages = kind === "analyze" ? ANALYZE_STAGES : RENDER_STAGES;
  const progress = job?.progress ?? 0;
  const queued = !job || job.status === "QUEUED";
  const retrying = job?.status === "QUEUED" && (job.attempts ?? 0) > 0;
  const activeIndex = Math.max(
    0,
    stages.findIndex((s) => (job?.stage && s.match.includes(job.stage)) || progress < s.until),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <WorkerNotice online={live.worker.online} autoStart={live.worker.autoStart} waiting={queued && !retrying} />
      <div className="card flex flex-col gap-6 p-6 sm:p-8">
        <div>
          <p className="eyebrow mb-1.5">{kind === "analyze" ? "Preparando tu video" : "Renderizando"}</p>
          <h2 className="text-xl font-semibold">
            {kind === "analyze" ? "Estamos transcribiendo y armando la edición" : "Estamos armando tu video final"}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {kind === "analyze"
              ? "Cuando termine, vas a poder revisar cada corte antes del render. Puedes salir de esta página: el trabajo sigue."
              : "Cortes, audio a -14 LUFS y subtítulos. Puedes salir de esta página: el trabajo sigue."}
          </p>
        </div>

        <Progress value={progress} label={queued ? (retrying ? job?.stage ?? "Reintentando" : "En cola") : (job?.stage ?? "Preparando")} />

        <ol className="flex flex-col gap-1" aria-label="Etapas">
          {stages.map((s, i) => {
            const state = queued ? "pending" : i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
            return (
              <li key={s.label} className={cn("flex items-center gap-3 rounded-xl px-2 py-2 text-sm", state === "active" ? "bg-accent/12 font-semibold text-white" : state === "done" ? "text-text" : "text-placeholder")}>
                <span
                  className={cn(
                    "grid h-7 w-7 flex-none place-items-center rounded-full border-2 font-mono text-[11px] font-bold",
                    state === "done" && "border-accent-hi bg-accent-hi text-bg",
                    state === "active" && "border-accent-hi bg-accent text-white",
                    state === "pending" && "border-white/20",
                  )}
                  aria-hidden
                >
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
                </span>
                <span>{s.label}</span>
                <span className="sr-only">{state === "done" ? "(lista)" : state === "active" ? "(en curso)" : "(pendiente)"}</span>
              </li>
            );
          })}
        </ol>

        {retrying && (
          <p className="text-sm text-warning" role="status">
            {job?.errorMessage ? `El intento anterior falló: ${job.errorMessage}` : "El intento anterior falló."} No tienes que hacer nada: lo reintentamos solos.
          </p>
        )}
      </div>
    </div>
  );
}
