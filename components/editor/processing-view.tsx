"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setAutoExportAction } from "./actions";
import { AutoExportToggle } from "./auto-export-toggle";
import { ANALYZE_STAGES, AUTO_STAGES, EDIT_STAGES, RENDER_STAGES } from "./labels";
import { useProjectStatus, type LiveStatus } from "./use-project-status";
import { WorkerNotice } from "./worker-notice";

type Stage = { label: string; state: "done" | "active" | "pending" };

/** Progreso real por etapa mientras el worker procesa. Se actualiza solo y se puede salir y volver. */
export function ProcessingView({
  projectId,
  initial,
  kind,
  canEdit = false,
  autoSummary,
  withReference = false,
}: {
  projectId: string;
  initial: LiveStatus;
  /** Con "Hazlo por mí" (`initial.autoExport`) se muestra una sola barra para análisis y render. */
  kind: "analyze" | "render" | "edit";
  canEdit?: boolean;
  /** Qué valores usa "Hazlo por mí" (subtítulos, música…), para mostrarlo al lado del interruptor. */
  autoSummary?: string;
  /** "Edítalo así" con un video de referencia: suma la etapa de mirarlo. */
  withReference?: boolean;
}) {
  const router = useRouter();
  const live = useProjectStatus(projectId, initial, { watch: initial.status === "AWAITING_REVIEW" });
  const [auto, setAuto] = useState(Boolean(initial.autoExport));
  const [pending, start] = useTransition();
  const job = live.job;
  const queued = !job || job.status === "QUEUED";
  const retrying = job?.status === "QUEUED" && (job.attempts ?? 0) > 0;
  const autoMode = Boolean(live.autoExport ?? auto);
  const phase: "analyze" | "render" = live.status === "RENDERING" ? "render" : live.status === "PROCESSING" || live.status === "AWAITING_REVIEW" ? "analyze" : kind === "render" ? "render" : "analyze";

  const { progress, stages, label } = autoMode ? autoProgress(live, phase) : singleProgress(live, kind, withReference);

  function toggle(next: boolean) {
    setAuto(next);
    start(async () => {
      const result = await setAutoExportAction(projectId, next);
      if (!result.ok) {
        setAuto(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Listo: lo exportamos solo apenas esté la edición." : "Listo: cuando esté la edición, la revisas tú.");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <WorkerNotice online={live.worker.online} autoStart={live.worker.autoStart} waiting={queued && !retrying} />
      <div className="card flex flex-col gap-6 p-6 sm:p-8">
        <div>
          <p className="eyebrow mb-1.5">{autoMode ? "Hazlo por mí" : kind === "analyze" ? "Preparando tu video" : kind === "edit" ? "Edítalo así" : "Renderizando"}</p>
          <h2 className="text-xl font-semibold">
            {autoMode
              ? "Estamos editando y exportando tu video"
              : kind === "analyze"
                ? "Estamos mirando tu video y dirigiendo la edición"
                : kind === "edit"
                  ? "Estamos aplicando tus cambios"
                  : "Estamos armando tu video final"}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {autoMode
              ? "Cortes, gancho, b-roll y gráficos, subtítulos con tu estilo y audio de estudio, sin pasar por la revisión. Te avisamos en la campana y por correo. Puedes cerrar esta página: el trabajo sigue."
              : kind === "analyze"
                ? "La IA mira cada escena, entiende la historia y revisa su propia edición antes de mostrártela. Cuando termine, vas a poder revisar cada decisión con su por qué. Puedes salir de esta página: el trabajo sigue."
                : kind === "edit"
                  ? "El director vuelve a pasar por todo el video con tu pedido y revisa el resultado. Tarda uno o dos minutos; puedes salir de esta página."
                  : "Cortes, audio a -14 LUFS y subtítulos. Puedes salir de esta página: el trabajo sigue."}
          </p>
        </div>

        <Progress value={progress} label={label} />

        <ol className="flex flex-col gap-1" aria-label="Etapas">
          {stages.map((s, i) => (
            <li
              key={s.label}
              className={cn("flex items-center gap-3 rounded-xl px-2 py-2 text-sm", s.state === "active" ? "bg-accent/12 font-semibold text-white" : s.state === "done" ? "text-text" : "text-placeholder")}
            >
              <span
                className={cn(
                  "grid h-7 w-7 flex-none place-items-center rounded-full border-2 font-mono text-[11px] font-bold",
                  s.state === "done" && "border-accent-hi bg-accent-hi text-bg",
                  s.state === "active" && "border-accent-hi bg-accent text-white",
                  s.state === "pending" && "border-white/20",
                )}
                aria-hidden
              >
                {s.state === "done" ? <Check className="h-3.5 w-3.5" /> : s.state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : i + 1}
              </span>
              <span>{s.label}</span>
              <span className="sr-only">{s.state === "done" ? "(lista)" : s.state === "active" ? "(en curso)" : "(pendiente)"}</span>
            </li>
          ))}
        </ol>

        {retrying && (
          <p className="text-sm text-warning" role="status">
            {job?.errorMessage ? `El intento anterior falló: ${job.errorMessage}` : "El intento anterior falló."} No tienes que hacer nada: lo reintentamos solos.
          </p>
        )}

        {canEdit && live.status === "PROCESSING" && (
          <AutoExportToggle checked={auto} onChange={toggle} disabled={pending} summary={autoSummary} compact />
        )}
      </div>
    </div>
  );
}

function stageIndex(stages: readonly { until: number }[], progress: number): number {
  const i = stages.findIndex((s) => progress < s.until);
  return i === -1 ? stages.length - 1 : i;
}

/** Una etapa por trabajo (análisis o render), como siempre. */
function singleProgress(live: LiveStatus, kind: "analyze" | "render" | "edit", withReference = false): { progress: number; stages: Stage[]; label: string } {
  const job = live.job;
  const defs = kind === "analyze" ? ANALYZE_STAGES : kind === "edit" ? (withReference ? EDIT_STAGES : EDIT_STAGES.slice(1)) : RENDER_STAGES;
  const progress = job?.progress ?? 0;
  const queued = !job || job.status === "QUEUED";
  const retrying = job?.status === "QUEUED" && (job.attempts ?? 0) > 0;
  // La etapa que nombra el worker manda; si no la nombra, se ubica por el avance.
  const byStage = job?.stage ? defs.findIndex((s) => s.match.some((m) => job.stage!.startsWith(m))) : -1;
  const activeIndex = Math.max(0, byStage >= 0 ? byStage : defs.findIndex((s) => progress < s.until));
  return {
    progress,
    label: queued ? (retrying ? (job?.stage ?? "Reintentando") : "En cola") : (job?.stage ?? "Preparando"),
    stages: defs.map((s, i) => ({ label: s.label, state: queued ? "pending" : i < activeIndex ? "done" : i === activeIndex ? "active" : "pending" })),
  };
}

/** "Hazlo por mí": análisis en la primera mitad de la barra, render en la segunda. */
function autoProgress(live: LiveStatus, phase: "analyze" | "render"): { progress: number; stages: Stage[]; label: string } {
  const job = live.job;
  // El trabajo que corresponde a la fase (justo después de un cambio, el último puede ser todavía el anterior).
  const jobPhase = job?.type === "VIDEO_RENDER" ? "render" : "analyze";
  const p = jobPhase === phase ? (job?.progress ?? 0) : phase === "render" ? 0 : 100;
  const queued = !job || (job.status === "QUEUED" && jobPhase === phase);
  const transient = live.status === "AWAITING_REVIEW";
  const local = transient ? 100 : p;
  const overall = phase === "analyze" ? Math.min(49, local * 0.49) : 50 + local * 0.5;
  const phaseStages = AUTO_STAGES.map((s, i) => ({ ...s, i }));
  const analyze = phaseStages.filter((s) => s.phase === "analyze");
  const render = phaseStages.filter((s) => s.phase === "render");
  const active = phase === "analyze" ? analyze[stageIndex(analyze, transient ? 100 : p)]!.i : render[stageIndex(render, p)]!.i;
  const label = transient ? "Empezando el render" : queued ? (phase === "render" ? "Render en cola" : "En cola") : (job?.stage ?? "Preparando");
  return {
    progress: overall,
    label,
    stages: AUTO_STAGES.map((s, i) => ({ label: s.label, state: queued && i === active && phase === "analyze" && i === 0 ? "pending" : i < active ? "done" : i === active ? "active" : "pending" })),
  };
}
