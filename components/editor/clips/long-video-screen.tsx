"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Link2, Loader2, MoreHorizontal, PencilLine, RefreshCcw, Sparkles, Trash2, Upload } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { DropdownMenu } from "@/components/ui/menu";
import { Steps, type StepState } from "@/components/ui/steps";
import { toast } from "@/components/ui/toast";
import { formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LongVideoView } from "@/lib/dal/clips";
import { WorkerNotice } from "../worker-notice";
import { deleteLongVideoAction, renameLongVideoAction, retryLongVideoAction } from "./actions";
import { ClipCard } from "./clip-card";
import { longStatusLabel, longStatusTone } from "./long-video-list";
import { cancelLongUpload, useLongUploads } from "./upload-store";

export type LongVideoScreenData = Omit<LongVideoView, "createdAt" | "worker"> & { createdAt: string; worker: { online: boolean; autoStart: boolean; stuck: number } };

/** Etapas que escribe el worker, con el tramo de la barra que ocupa cada una. */
const STAGES = [
  { label: "Bajando el video", until: 12 },
  { label: "Transcribiendo palabra por palabra", until: 60 },
  { label: "Buscando los mejores momentos", until: 68 },
  { label: "Siguiendo las caras y armando las vistas previas", until: 96 },
  { label: "Guardando los clips", until: 100 },
];

type Live = { status: LongVideoView["status"]; errorMessage: string | null; job: LongVideoView["job"]; worker: { online: boolean; autoStart: boolean }; projects: string };

/** Estado en vivo cada 2 s mientras se procesa (y cada 4 s si algún clip se está exportando). */
function useLive(video: LongVideoScreenData, exporting: boolean): Live {
  const router = useRouter();
  const [live, setLive] = useState<Live>({ status: video.status, errorMessage: video.errorMessage, job: video.job, worker: video.worker, projects: "" });
  const sig = useRef<{ status: string; projects: string | null }>({ status: video.status, projects: null });
  const active = video.status === "PROCESSING" || video.status === "UPLOADING" || (video.status === "READY" && exporting);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/editor/clips/${video.id}/status`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Live;
          if (stopped) return;
          setLive(next);
          const projectsChanged = sig.current.projects != null && sig.current.projects !== next.projects;
          sig.current.projects = next.projects;
          if (next.status !== sig.current.status || projectsChanged) {
            sig.current.status = next.status;
            router.refresh();
          }
        }
      } catch {
        // Sin conexión por un momento: se vuelve a intentar.
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 8000 : video.status === "READY" ? 4000 : 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, video.id, video.status, router]);
  return live;
}

export function LongVideoScreen({ video }: { video: LongVideoScreenData }) {
  const router = useRouter();
  const exporting = video.clips.some((c) => c.project && (c.project.status === "PROCESSING" || c.project.status === "RENDERING"));
  const live = useLive(video, exporting);
  const uploads = useLongUploads();
  const upload = uploads.find((u) => u.id === video.id);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(video.title);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [pending, start] = useTransition();

  // Lo que se muestra sale de los datos del servidor; el estado en vivo solo trae el progreso (y dispara el refresco).
  const status = video.status;
  const failedAt = status === "FAILED" ? (video.clips.length ? 3 : video.words ? 2 : 1) : 0;
  const stepState = (n: 1 | 2 | 3): StepState => {
    const current = status === "UPLOADING" ? 1 : status === "PROCESSING" ? 2 : status === "READY" ? 3 : failedAt;
    return n < current ? "done" : n === current ? "active" : "pending";
  };
  const visible = video.clips.filter((c) => showDiscarded || !c.discarded);
  const discarded = video.clips.filter((c) => c.discarded).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="hero-panel card flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1.5">Clips desde un video largo</p>
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 text-2xl font-bold break-words sm:text-[1.75rem]">{video.title}</h1>
            {video.canEdit && (
              <DropdownMenu
                label="Opciones del video"
                align="end"
                trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />}
                items={[
                  { label: "Renombrar", icon: <PencilLine className="h-4 w-4" aria-hidden />, onSelect: () => setRenaming(true) },
                  { label: "Borrar el video y sus clips", icon: <Trash2 className="h-4 w-4" aria-hidden />, onSelect: () => setConfirm(true), danger: true },
                ]}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <StatusBadge tone={longStatusTone[status]}>{longStatusLabel[status]}</StatusBadge>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {video.sourceKind === "link" ? <Link2 className="h-4 w-4 flex-none" aria-hidden /> : <Upload className="h-4 w-4 flex-none" aria-hidden />}
              <span className="truncate">{video.sourceKind === "link" ? (video.sourceUrl ?? "Link") : (video.sourceName ?? "Video subido")}</span>
            </span>
            {video.duration != null && <span className="font-mono">{formatDuration(video.duration)}</span>}
            {video.words > 0 && <span>{formatNumber(video.words)} palabras</span>}
          </div>
        </div>
        <div className="lg:w-64">
          <Steps
            steps={[
              { id: "subir", label: "Subir el video", state: stepState(1) },
              { id: "buscar", label: "Buscando momentos", state: stepState(2) },
              { id: "elegir", label: "Elegir clips", state: stepState(3) },
            ]}
          />
        </div>
      </header>

      {status === "UPLOADING" && (
        <section className="card mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8" aria-labelledby="upload-title">
          <p className="eyebrow">Paso 1</p>
          <h2 id="upload-title" className="text-xl font-semibold">
            {upload && upload.status !== "error" ? "Subiendo tu video" : "La subida no terminó"}
          </h2>
          {upload ? (
            <>
              <Progress value={(upload.loaded / Math.max(1, upload.total)) * 100} label={upload.status === "finishing" ? "Verificando el archivo" : upload.fileName} />
              {upload.status === "error" ? (
                <Notice tone="danger">{upload.error}</Notice>
              ) : (
                <p className="text-sm text-muted">Puedes ir a otra sección de la app: la subida sigue mientras no cierres esta pestaña. Al terminar empezamos a buscar los momentos solos.</p>
              )}
              {upload.status === "uploading" && (
                <div>
                  <Button variant="ghost" onClick={() => cancelLongUpload(video.id)}>
                    Cancelar la subida
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Se cerró la pestaña o se cortó la conexión antes de terminar. Borra este video y vuelve a subirlo.</p>
          )}
          {video.canEdit && (!upload || upload.status === "error") && (
            <div>
              <Button variant="danger" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setConfirm(true)}>
                Borrar y volver a empezar
              </Button>
            </div>
          )}
        </section>
      )}

      {status === "PROCESSING" && <Processing live={live} />}

      {status === "FAILED" && (
        <section className="card mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8">
          <Notice tone="danger" title="No pudimos sacar clips de este video">
            {live.errorMessage ?? video.errorMessage ?? "Algo falló al procesarlo."}
          </Notice>
          {video.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<RefreshCcw className="h-4 w-4" aria-hidden />}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await retryLongVideoAction(video.id);
                    if (!r.ok) toast.error(r.error);
                    else router.refresh();
                  })
                }
              >
                Volver a intentarlo
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                Borrar el video
              </Button>
            </div>
          )}
        </section>
      )}

      {status === "READY" && (
        <section aria-labelledby="clips-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow mb-1">Paso 3</p>
              <h2 id="clips-title" className="text-lg font-semibold">
                {video.clips.length === 1 ? "Encontramos 1 momento" : `Encontramos ${video.clips.length} momentos`} que funcionan solos
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted">
                Ordenados por puntaje. El puntaje compara los momentos de este video entre sí (no es una predicción de vistas): combina reglas como el gancho, el ritmo, las pausas, las preguntas y las cifras con el criterio de la IA
                {video.usedRanking ? " y el rendimiento de tus tipos de gancho en Métricas" : ""}.
              </p>
            </div>
            {discarded > 0 && (
              <Button variant="subtle" size="sm" icon={showDiscarded ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} onClick={() => setShowDiscarded((v) => !v)}>
                {showDiscarded ? "Ocultar descartados" : `Ver descartados (${discarded})`}
              </Button>
            )}
          </div>
          {video.plannedBy === "rules" && (
            <Notice tone="warning" title="Elegimos los momentos sin IA">
              {video.warning ?? "La IA no estaba disponible: los momentos salen solo de las medidas del video. Los títulos y ganchos son la primera frase de cada uno; puedes editarlos."}
            </Notice>
          )}
          {video.plannedBy === "ai" && video.warning && <Notice tone="info">{video.warning}</Notice>}
          {visible.length === 0 ? (
            <div className="card p-6 text-sm text-muted">Descartaste todos los clips. Toca &quot;Ver descartados&quot; para recuperar alguno.</div>
          ) : (
            <ol className="flex flex-col gap-4" aria-label="Clips">
              {visible.map((c) => (
                <li key={c.id}>
                  <ClipCard key={`${c.id}-${c.fromWord}-${c.toWord}`} clip={c} total={video.clips.length} canEdit={video.canEdit} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Renombrar el video"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || !name.trim()}
              icon={<Check className="h-4 w-4" aria-hidden />}
              onClick={() =>
                start(async () => {
                  const r = await renameLongVideoAction(video.id, name);
                  if (!r.ok) toast.error(r.error);
                  else setRenaming(false);
                })
              }
            >
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Nombre" htmlFor="rename-long">
          <Input id="rename-long" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar este video y sus clips?"
        description="Se borran el video largo, las vistas previas y los clips sugeridos. Los videos que ya abriste o exportaste en el Editor se conservan."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() =>
                start(async () => {
                  cancelLongUpload(video.id);
                  const r = await deleteLongVideoAction(video.id, "/editor/clips");
                  if (r && !r.ok) toast.error(r.error);
                })
              }
            >
              Borrar
            </Button>
          </>
        }
      />
      {status === "PROCESSING" || status === "UPLOADING" ? null : <WorkerNotice online={live.worker.online} autoStart={live.worker.autoStart} waiting={exporting && !live.worker.online && !live.worker.autoStart} />}
    </div>
  );
}

function Processing({ live }: { live: Live }) {
  const job = live.job;
  const progress = job?.progress ?? 0;
  const queued = !job || job.status === "QUEUED";
  const retrying = job?.status === "QUEUED" && (job.attempts ?? 0) > 0;
  const activeIndex = Math.max(0, STAGES.findIndex((s) => progress < s.until));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <WorkerNotice online={live.worker.online} autoStart={live.worker.autoStart} waiting={queued && !retrying} />
      <section className="card flex flex-col gap-6 p-6 sm:p-8" aria-labelledby="processing-title">
        <div>
          <p className="eyebrow mb-1.5">Paso 2</p>
          <h2 id="processing-title" className="text-xl font-semibold">
            Estamos buscando los mejores momentos
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Transcribimos todo el video, elegimos los momentos que se entienden solos y seguimos la cara de quien habla en cada uno. Un video de una hora tarda unos minutos. Puedes salir de esta página: te avisamos en la campana y por correo cuando termine.
          </p>
        </div>
        <Progress value={progress} label={queued ? (retrying ? (job?.stage ?? "Reintentando") : "En cola") : (job?.stage ?? "Preparando")} />
        <ol className="flex flex-col gap-1" aria-label="Etapas">
          {STAGES.map((s, i) => {
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
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : i + 1}
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
        <p className="flex items-center gap-2 text-xs text-placeholder">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          El puntaje de cada clip es relativo dentro de este video, no una predicción de vistas.
        </p>
      </section>
    </div>
  );
}
