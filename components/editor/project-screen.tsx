"use client";

import { useEffect, useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCcw, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Progress } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import type { ProjectView } from "@/lib/dal/video";
import { formatBytes, formatDate } from "@/lib/format";
import type { CaptionPresetKey } from "@/lib/video/types";
import { MAX_VIDEO_BYTES_CLIENT, VIDEO_ACCEPT } from "./constants";
import { deleteAction, reopenAction, retryAction } from "./actions";
import { statusLabel, statusTone, type ProjectStatus } from "./labels";
import { ProcessingView } from "./processing-view";
import { ResultView } from "./result-view";
import type { SignedOption } from "./broll-panel";
import type { GraphicLook } from "@/lib/video/graphics";
import { ReviewEditor } from "./review-editor";
import { startUpload, submitUpload, useUpload } from "./upload-manager";

type View = Omit<ProjectView, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
  accent: string;
  uploadMode: "blob" | "local";
  /** Qué valores usa "Hazlo por mí" (para la pantalla de progreso). */
  autoSummary?: string;
};

export function ProjectScreen({
  project,
  signedBroll = {},
  style = null,
  graphicLook,
  tracks = [],
}: {
  project: View;
  tracks?: ComponentProps<typeof ReviewEditor>["tracks"];
  graphicLook: GraphicLook;
  signedBroll?: Record<string, SignedOption>;
  style?: ComponentProps<typeof ReviewEditor>["style"];
}) {
  const status = project.status as ProjectStatus;
  const working = status === "PROCESSING" || status === "RENDERING" || (status === "AWAITING_REVIEW" && project.autoPending);
  return (
    <div className="flex flex-col gap-6">
      <ProjectHeader project={project} status={status} />
      {status === "UPLOADING" && <UploadPending project={project} />}
      {working && (
        <ProcessingView
          projectId={project.id}
          kind={status === "RENDERING" ? "render" : "analyze"}
          canEdit={project.canEdit}
          autoSummary={project.autoSummary}
          initial={{ status, errorMessage: project.errorMessage, autoExport: project.autoExport, job: project.job, worker: { online: project.worker.online, autoStart: project.worker.autoStart } }}
        />
      )}
      {status === "AWAITING_REVIEW" && !project.autoPending && project.errorMessage && (
        <Notice tone="warning" title="No lo exportamos solo">
          {project.errorMessage.replace(/^No pudimos exportarlo solo: /, "")} Revisa la propuesta y expórtala cuando quieras.
        </Notice>
      )}
      {status === "AWAITING_REVIEW" && !project.autoPending && project.plan && project.transcript && (
        <ReviewEditor
          projectId={project.id}
          plan={project.plan}
          words={project.transcript.words}
          duration={project.media?.duration ?? project.transcript.duration}
          sourceWidth={project.media?.width ?? 1080}
          sourceHeight={project.media?.height ?? 1920}
          proxyUrl={project.proxyUrl}
          posterUrl={project.sourcePosterUrl ?? project.posterUrl}
          accent={project.accent}
          canEdit={project.canEdit}
          signedBroll={signedBroll}
          style={style}
          graphicLook={graphicLook}
          tracks={tracks}
          audioPreview={project.audioPreview}
        />
      )}
      {status === "DONE" && project.output && (
        <ResultView projectId={project.id} format={project.format} output={project.output} posterUrl={project.posterUrl} canEdit={project.canEdit} auto={project.autoExport} />
      )}
      {status === "DONE" && !project.output && <Notice tone="warning">El video quedó listo, pero no encontramos el archivo. Vuelve a editarlo y renderízalo otra vez.</Notice>}
      {status === "FAILED" && <FailedView project={project} />}
    </div>
  );
}

function ProjectHeader({ project, status }: { project: View; status: ProjectStatus }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <StatusBadge tone={statusTone[status]}>{statusLabel[status]}</StatusBadge>
          <span>{project.format === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"}</span>
          <span>· Creado el {formatDate(project.createdAt)}</span>
        </div>
        <h1 className="truncate text-2xl font-bold">{project.title}</h1>
        {project.sourceName && (
          <p className="mt-1 truncate text-sm text-muted">
            {project.sourceName}
            {project.sourceBytes ? ` · ${formatBytes(project.sourceBytes)}` : ""}
          </p>
        )}
      </div>
      {project.canEdit && (
        <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirm(true)}>
          Borrar
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Borrar este video?"
        description="Se borran el original, la vista previa y el video editado. No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              className="!bg-danger/90 ![background-image:none]"
              onClick={() =>
                start(async () => {
                  const result = await deleteAction(project.id);
                  if (result && !result.ok) toast.error(result.error);
                })
              }
            >
              {pending ? "Borrando…" : "Borrar video"}
            </Button>
          </>
        }
      />
    </header>
  );
}

function UploadPending({ project }: { project: View }) {
  const upload = useUpload(project.id);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const finished = upload?.status === "done";
  // Al terminar la subida, la pantalla pasa sola al progreso (sin tocar "Ver el progreso").
  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  if (upload && upload.status !== "error") {
    const pct = upload.total ? (upload.loaded / upload.total) * 100 : 0;
    return (
      <div className="card mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8">
        <div>
          <p className="eyebrow mb-1.5">Subiendo</p>
          <h2 className="text-xl font-semibold">{upload.status === "finishing" || upload.status === "done" ? "Listo, enviando a procesar…" : "Subiendo tu video"}</h2>
          <p className="mt-1.5 text-sm text-muted">
            Puedes moverte por la app mientras sube, pero no cierres esta pestaña. {formatBytes(upload.loaded)} de {formatBytes(upload.total)}.
          </p>
        </div>
        <Progress value={pct} label={upload.fileName} />
        {upload.status === "done" && (
          <Button variant="ghost" className="self-start" onClick={() => router.refresh()}>
            Ver el progreso
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Notice tone="warning" title="La subida no terminó">
        {upload?.error ?? "Se cerró la página antes de terminar de subir el video."} Vuelve a elegir el mismo archivo para continuar.
      </Notice>
      <UploadDropzone
        accept={VIDEO_ACCEPT}
        acceptLabel="el mismo video (MP4, MOV, WEBM o MKV)"
        maxSize={MAX_VIDEO_BYTES_CLIENT}
        error={error}
        disabled={!project.canEdit}
        onFiles={([file]) => {
          if (!file || !project.sourceKey) return;
          if (project.sourceBytes && file.size !== project.sourceBytes) {
            setError(`Ese archivo pesa ${formatBytes(file.size)} y el original pesaba ${formatBytes(project.sourceBytes)}. Elige el mismo video o crea un proyecto nuevo.`);
            return;
          }
          setError(null);
          startUpload({ file, projectId: project.id, key: project.sourceKey, mode: project.uploadMode });
          void submitUpload(project.id, { title: project.title, format: project.format, preset: project.captionPreset as CaptionPresetKey, scriptId: project.scriptId, autoExport: project.autoExport }).then((r) => {
            if (r.ok) router.refresh();
          });
        }}
      />
    </div>
  );
}

function FailedView({ project }: { project: View }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const wasRender = project.job?.type === "VIDEO_RENDER";
  return (
    <div className="card mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-danger" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold">{wasRender ? "No pudimos renderizar el video" : "No pudimos preparar el video"}</h2>
          <p className="mt-1 text-sm text-text/90">{project.errorMessage ?? "Algo salió mal en el procesamiento."}</p>
          {project.job && project.job.attempts > 1 && <p className="mt-1 text-xs text-muted">Lo intentamos {project.job.attempts} veces.</p>}
        </div>
      </div>
      {project.canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            icon={<RefreshCcw className="h-4 w-4" aria-hidden />}
            onClick={() =>
              start(async () => {
                const result = await retryAction(project.id);
                if (!result.ok) toast.error(result.error);
                else router.refresh();
              })
            }
          >
            Reintentar
          </Button>
          {wasRender && project.plan && <ReopenButton projectId={project.id} />}
        </div>
      )}
    </div>
  );
}

function ReopenButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await reopenAction(projectId);
          if (!result.ok) toast.error(result.error);
          else router.refresh();
        })
      }
    >
      Volver a la revisión
    </Button>
  );
}
