import type { Metadata } from "next";
import { FEATURES } from "@/lib/features";
import { Suspense } from "react";
import { Clapperboard, Library, Palette, Scissors, Upload, Video } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { ProjectList } from "@/components/editor/project-list";
import { PendingTakesNotice } from "@/components/editor/recorder/pending-takes-notice";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/dal/video";

export const metadata: Metadata = { title: "Editor de video" };

async function Projects() {
  const [me, { projects, worker, storageReady }] = await Promise.all([getCurrentUser(), listProjects()]);
  const waiting = projects.some((p) => p.status === "PROCESSING" || p.status === "RENDERING");
  return (
    <div className="flex flex-col gap-5">
      {!storageReady && (
        <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
          Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
        </Notice>
      )}
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={worker.stuck > 0 || (!worker.autoStart && waiting)} />
      {me.role !== "VIEWER" && <PendingTakesNotice />}
      {projects.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-5 w-5" aria-hidden />}
          title="Todavía no editaste ningún video"
          description={FEATURES.aiOnly ? "Sube un video donde hablas a cámara y dile a la IA cómo lo quieres: «recorta los silencios», «ponle subtítulos», «música tranquila de fondo». Ella lo edita por ti." : "Sube un video donde hablas a cámara. Te lo devolvemos con los silencios y tomas malas cortados, el mejor gancho al inicio y subtítulos con tu estilo."}
          action={
            me.role !== "VIEWER" && storageReady ? (
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/editor/nuevo" icon={<Upload className="h-4 w-4" aria-hidden />}>
                  Subir un video
                </ButtonLink>
                <ButtonLink href="/editor/grabar" variant="ghost" icon={<Video className="h-4 w-4" aria-hidden />}>
                  Grabar ahora
                </ButtonLink>
              </div>
            ) : undefined
          }
        />
      ) : (
        <ProjectList projects={projects.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }))} />
      )}
    </div>
  );
}

export default function EditorPage() {
  return (
    <>
      <PageHeader
        eyebrow="Editor de video"
        title={FEATURES.aiOnly ? "Sube tu video y edítalo hablándole a la IA" : "Sube tu video crudo y recíbelo editado"}
        description={FEATURES.aiOnly ? "Le dices qué quieres (cortes, subtítulos, música, zooms, transiciones o animaciones) y la IA lo edita por ti. Si algo no te gusta, le pides que lo deshaga." : "Cortamos silencios y tomas malas, ponemos el mejor gancho al inicio y agregamos subtítulos. Tú revisas cada corte antes del render."}
        icon={<Clapperboard className="h-5 w-5" aria-hidden />}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/editor/clips" variant="ghost" icon={<Scissors className="h-4 w-4" aria-hidden />}>
              Clips desde un video largo
            </ButtonLink>
            {!FEATURES.aiOnly && (
              <>
                <ButtonLink href="/editor/estilos" variant="ghost" icon={<Palette className="h-4 w-4" aria-hidden />}>
                  Estilos
                </ButtonLink>
                <ButtonLink href="/editor/biblioteca" variant="ghost" icon={<Library className="h-4 w-4" aria-hidden />}>
                  Biblioteca
                </ButtonLink>
              </>
            )}
            <ButtonLink href="/editor/grabar" variant="ghost" icon={<Video className="h-4 w-4" aria-hidden />}>
              Grabar ahora
            </ButtonLink>
            <ButtonLink href="/editor/nuevo" icon={<Upload className="h-4 w-4" aria-hidden />}>
              Subir un video
            </ButtonLink>
          </div>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Projects />
      </Suspense>
    </>
  );
}
