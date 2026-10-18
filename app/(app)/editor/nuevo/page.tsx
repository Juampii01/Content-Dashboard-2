import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { NewProjectFlow } from "@/components/editor/new-project-flow";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getCurrentUser } from "@/lib/auth";
import { getCloneSource, listScriptOptions } from "@/lib/dal/video";
import { workerStatus } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Nuevo video" };

/**
 * /editor/nuevo — parámetros para integrar con otros módulos:
 * - `?guion=<id>`: precarga el guion (Guiones → "Editar el video grabado").
 * - `?clon=<id>`: usa como original un video generado en "Videos con clon" (tabla clone_videos).
 */
async function Flow({ searchParams }: { searchParams: PageProps<"/editor/nuevo">["searchParams"] }) {
  const me = await getCurrentUser();
  const params = await searchParams;
  const guion = typeof params.guion === "string" ? params.guion : null;
  const clon = typeof params.clon === "string" ? params.clon : null;
  const [scripts, clone, worker] = await Promise.all([listScriptOptions(), clon ? getCloneSource(clon) : null, workerStatus()]);
  if (me.role === "VIEWER") return <Notice tone="warning">Tu usuario es de solo lectura. Pide acceso de edición al dueño de la cuenta para subir videos.</Notice>;
  if (!fileDriver()) {
    return (
      <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
        Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={worker.stuck > 0} />
      {clon && !clone && <Notice tone="warning">No encontramos ese video con clon. Puedes subir un video desde tu computadora.</Notice>}
      <NewProjectFlow scripts={scripts} initialScriptId={guion && scripts.some((s) => s.id === guion) ? guion : null} clone={clone} />
    </div>
  );
}

export default function NewVideoPage({ searchParams }: PageProps<"/editor/nuevo">) {
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <PageHeader
        eyebrow="Nuevo video"
        title="Sube tu video y dinos cómo lo quieres"
        description="Cuatro pasos cortos. Después revisas los cortes antes de renderizar."
        icon={<Upload className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </>
  );
}
