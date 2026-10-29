import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FEATURES } from "@/lib/features";

import { Suspense } from "react";
import { ArrowLeft, Palette } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { NewStyle } from "@/components/editor/style-new";
import { StyleList } from "@/components/editor/style-list";
import { getCurrentUser } from "@/lib/auth";
import { listStyles } from "@/lib/dal/editor-media";
import { workerStatus } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Estilos de edición" };

/** /editor/estilos — "Edita como este": estilos copiados de videos de referencia. */
async function Styles() {
  // La sesión primero: así el build (sin variables de entorno) no toca la base.
  const me = await getCurrentUser();
  const [styles, worker] = await Promise.all([listStyles(), workerStatus()]);
  const canEdit = me.role !== "VIEWER";
  return (
    <div className="flex flex-col gap-6">
      {!fileDriver() && (
        <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
          Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
        </Notice>
      )}
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={!worker.autoStart && styles.some((s) => s.status === "ANALYZING")} />
      {canEdit && fileDriver() && <NewStyle canEdit={canEdit} />}
      <section aria-labelledby="styles-title" className="flex flex-col gap-4">
        <h2 id="styles-title" className="text-base font-semibold">
          Tus estilos
        </h2>
        {styles.length === 0 ? (
          <EmptyState
            icon={<Palette className="h-5 w-5" aria-hidden />}
            title="Todavía no tienes estilos"
            description="Sube un reel o pega el link de uno que te guste cómo está editado. Lo usamos como guía para cortar, hacer zooms, poner b-roll y subtítulos en tus videos."
          />
        ) : (
          <StyleList styles={styles.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }))} canEdit={canEdit} />
        )}
      </section>
    </div>
  );
}

export default function StylesPage() {
  // Edición solo con IA: la biblioteca y los estilos a mano no se usan (lo que necesites, adjúntalo en el chat).
  if (FEATURES.aiOnly) redirect("/editor");
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <PageHeader
        eyebrow="Editor de video"
        title="Edita como tus videos favoritos"
        description="Crea un estilo a partir de un video de referencia y aplícalo a tus videos: mismo ritmo, mismos zooms, mismo b-roll, mismos subtítulos."
        icon={<Palette className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Styles />
      </Suspense>
    </>
  );
}
