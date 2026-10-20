import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Library } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { LibraryManager } from "@/components/editor/library-manager";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getCurrentUser } from "@/lib/auth";
import { brollAvailability, listClips } from "@/lib/dal/editor-media";
import { workerStatus } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Biblioteca de b-roll" };

/** /editor/biblioteca — clips propios del cliente para usar como b-roll. */
async function LibraryContent() {
  const [me, clips, worker, availability] = await Promise.all([getCurrentUser(), listClips(), workerStatus(), brollAvailability()]);
  const canEdit = me.role !== "VIEWER" && Boolean(fileDriver());
  return (
    <div className="flex flex-col gap-6">
      {!fileDriver() && (
        <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
          Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
        </Notice>
      )}
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={!worker.autoStart && clips.some((c) => c.status === "PROCESSING")} />
      {!availability.pexels && (
        <Notice tone="info" title="El b-roll sale solo de tu biblioteca">
          Esta instalación no tiene activados los videos de stock de Pexels. Sube aquí tus clips y el editor los usa donde encajan.
        </Notice>
      )}
      <LibraryManager clips={clips.map((c) => ({ ...c, job: c.job ? { progress: c.job.progress, stage: c.job.stage } : null }))} canEdit={canEdit} />
      {clips.length === 0 && (
        <EmptyState
          icon={<Library className="h-5 w-5" aria-hidden />}
          title="Tu biblioteca está vacía"
          description="Sube clips cortos que muestren tu negocio. Ponles etiquetas (por ejemplo: oficina, teléfono, equipo) y el editor los elige solo cuando lo que dices encaja."
        />
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <PageHeader
        eyebrow="Editor de video"
        title="Tu biblioteca de b-roll"
        description="Clips tuyos que el editor usa como tomas de apoyo mientras hablas. Súbelos una vez y etiquétalos."
        icon={<Library className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LibraryContent />
      </Suspense>
    </>
  );
}
