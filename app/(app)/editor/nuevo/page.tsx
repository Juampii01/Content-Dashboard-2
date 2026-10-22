import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { NewProjectFlow } from "@/components/editor/new-project-flow";
import { WorkerNotice } from "@/components/editor/worker-notice";
import { getBrand } from "@/lib/ai/brand-context";
import { getCurrentUser } from "@/lib/auth";
import { getEditorDefaults } from "@/lib/dal/editor-defaults";
import { brollAvailability, readyStyles } from "@/lib/dal/editor-media";
import { getCloneSource, listScriptOptions } from "@/lib/dal/video";
import { workerStatus } from "@/lib/jobs";
import { fileDriver } from "@/lib/storage";
import { brandGraphicLook } from "@/lib/video/graphics";

export const metadata: Metadata = { title: "Nuevo video" };

/**
 * /editor/nuevo — parámetros para integrar con otros módulos:
 * - `?guion=<id>`: precarga el guion (Guiones → "Editar el video grabado").
 * - `?clon=<id>`: usa como original un video generado en "Videos con clon" (tabla clone_videos).
 * - `?estilo=<id>`: preselecciona un estilo de "Edita como este" (tabla video_styles).
 */
async function Flow({ searchParams }: { searchParams: PageProps<"/editor/nuevo">["searchParams"] }) {
  const me = await getCurrentUser();
  const params = await searchParams;
  const guion = typeof params.guion === "string" ? params.guion : null;
  const clon = typeof params.clon === "string" ? params.clon : null;
  const estilo = typeof params.estilo === "string" ? params.estilo : null;
  const [scripts, clone, worker, styles, broll, brand, editor] = await Promise.all([
    listScriptOptions(),
    clon ? getCloneSource(clon) : null,
    workerStatus(),
    readyStyles(),
    brollAvailability(),
    getBrand(),
    getEditorDefaults(),
  ]);
  // El mismo acento que usa el render de los subtítulos (lib/video/service.ts).
  const accent = [brand?.colors?.accent, brand?.colors?.primary].find((c) => c && /^#[0-9a-f]{6}$/i.test(c)) ?? "#FFD84D";
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
      {estilo && !styles.some((st) => st.id === estilo) && <Notice tone="warning">Ese estilo no existe o todavía se está analizando. Puedes elegir otro en el paso «Estilo y b-roll».</Notice>}
      <NewProjectFlow
        scripts={scripts}
        initialScriptId={guion && scripts.some((s) => s.id === guion) ? guion : null}
        clone={clone}
        styles={styles}
        initialStyleId={estilo}
        broll={broll}
        captionBrand={{ accent, font: brandGraphicLook(brand).font }}
        defaults={{ format: editor.defaults.format, captions: editor.defaults.captions, broll: editor.defaults.broll }}
        autoSummary={editor.summary}
      />
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
        description="Cinco pasos cortos. Después revisas los cortes y el b-roll antes de exportar, o eliges «Hazlo por mí» y lo exportamos solos."
        icon={<Upload className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </>
  );
}
