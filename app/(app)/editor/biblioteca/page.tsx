import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, Clapperboard, Library, Music } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { LibraryManager } from "@/components/editor/library-manager";
import { MusicManager } from "@/components/editor/music-manager";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getCurrentUser } from "@/lib/auth";
import { brollAvailability, listClips, listTracks } from "@/lib/dal/editor-media";
import { workerStatus } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Biblioteca" };

/** /editor/biblioteca — clips propios del cliente para usar como b-roll y su música de fondo. */
async function LibraryContent() {
  // La sesión primero: así el build (sin variables de entorno) no toca la base.
  const me = await getCurrentUser();
  const [clips, worker, availability, tracks] = await Promise.all([listClips(), workerStatus(), brollAvailability(), listTracks()]);
  const canEdit = me.role !== "VIEWER" && Boolean(fileDriver());
  return (
    <div className="flex flex-col gap-6">
      {!fileDriver() && (
        <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
          Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
        </Notice>
      )}
      <WorkerNotice online={worker.online} autoStart={worker.autoStart} waiting={!worker.autoStart && clips.some((c) => c.status === "PROCESSING")} />
      {!availability.stock && (
        <Notice tone="info" title="El b-roll sale solo de tu biblioteca">
          Esta instalación no tiene activados los videos de stock. Sube aquí tus clips y el editor los usa donde encajan.
        </Notice>
      )}
      <SectionTitle id="clips" icon={<Clapperboard className="h-4 w-4" aria-hidden />} title="Clips de b-roll" description="Tomas tuyas que el editor pone mientras hablas." />
      <LibraryManager clips={clips.map((c) => ({ ...c, job: c.job ? { progress: c.job.progress, stage: c.job.stage } : null }))} canEdit={canEdit} />
      {clips.length === 0 && (
        <EmptyState
          icon={<Library className="h-5 w-5" aria-hidden />}
          title="Tu biblioteca está vacía"
          description="Sube clips cortos que muestren tu negocio. Ponles etiquetas (por ejemplo: oficina, teléfono, equipo) y el editor los elige solo cuando lo que dices encaja."
        />
      )}
      <section aria-labelledby="musica" className="mt-4 flex flex-col gap-4 border-t border-white/10 pt-8">
        <SectionTitle id="musica" icon={<Music className="h-4 w-4" aria-hidden />} title="Música de fondo" description="Tus pistas para poner debajo de la voz. Las eliges en la revisión de cada video." />
        <MusicManager tracks={tracks.map((t) => ({ id: t.id, title: t.title, status: t.status, duration: t.duration, url: t.url }))} canEdit={canEdit} />
      </section>
    </div>
  );
}

function SectionTitle({ id, icon, title, description }: { id: string; icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="tile-icon grid h-9 w-9 flex-none place-items-center">{icon}</span>
      <div>
        <h2 id={id} className="text-base font-semibold text-white">
          {title}
        </h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
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
        title="Tu biblioteca"
        description="Clips tuyos que el editor usa como tomas de apoyo y música para el fondo de tus videos. Súbelos una vez y úsalos siempre."
        icon={<Library className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LibraryContent />
      </Suspense>
    </>
  );
}
