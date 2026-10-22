import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Scissors } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { LongVideoList } from "@/components/editor/clips/long-video-list";
import { NewLongVideo } from "@/components/editor/clips/new-long-video";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getCurrentUser } from "@/lib/auth";
import { listLongVideos } from "@/lib/dal/clips";

export const metadata: Metadata = { title: "Clips desde un video largo" };

async function Content() {
  const [me, { videos, worker, storageReady }] = await Promise.all([getCurrentUser(), listLongVideos()]);
  const waiting = videos.some((v) => v.status === "PROCESSING");
  return (
    <div className="flex flex-col gap-6">
      {!storageReady && (
        <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
          Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
        </Notice>
      )}
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={worker.stuck > 0 || (!worker.autoStart && waiting)} />
      <NewLongVideo canEdit={me.role !== "VIEWER"} storageReady={storageReady} />
      <section aria-labelledby="long-list-title" className="flex flex-col gap-4">
        <h2 id="long-list-title" className="text-lg font-semibold">
          Tus videos largos
        </h2>
        {videos.length === 0 ? (
          <EmptyState
            icon={<Scissors className="h-5 w-5" aria-hidden />}
            title="Todavía no sacaste clips de ningún video"
            description="Sube arriba un podcast, un live o el link de un video de YouTube. En unos minutos tienes de 5 a 10 shorts con su puntaje y por qué funcionan."
          />
        ) : (
          <LongVideoList videos={videos.map((v) => ({ ...v, updatedAt: v.updatedAt.toISOString() }))} />
        )}
      </section>
    </div>
  );
}

export default function ClipsPage() {
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <PageHeader
        eyebrow="Editor de video"
        title="Clips desde un video largo"
        description="Encontramos los momentos que funcionan solos como short, los pasamos a vertical siguiendo la cara de quien habla y los puedes editar o exportar con tu marca."
        icon={<Scissors className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Content />
      </Suspense>
    </>
  );
}
