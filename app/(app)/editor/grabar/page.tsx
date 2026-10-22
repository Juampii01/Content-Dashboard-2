import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Video } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { RecordingStudio } from "@/components/editor/recorder/recording-studio";
import { ScriptPicker } from "@/components/editor/recorder/script-picker";
import { getCurrentUser } from "@/lib/auth";
import { getRecordingView } from "@/lib/dal/recording";

export const metadata: Metadata = { title: "Grabar" };

/**
 * /editor/grabar — grabar en el navegador con teleprompter. Parámetros para integrar con otros módulos:
 * - `?guion=<id>`: un guion (Guiones → "Grabar").
 * - `?guiones=<id>,<id>,…`: "Día de grabación" con esos guiones, en ese orden (hasta 20).
 * - `?semana=1` (o `?semana=YYYY-MM-DD`): los guiones de "Tu semana lista" (Tu semana lista → "Grabar mi semana").
 * - `?libre=1`: una toma sin guion (Editor → "Grabar ahora").
 * Sin parámetros: elegir qué guiones grabar.
 */
async function Content({ searchParams }: { searchParams: PageProps<"/editor/grabar">["searchParams"] }) {
  const me = await getCurrentUser();
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  if (me.role === "VIEWER") return <Notice tone="warning">Tu usuario es de solo lectura. Pide acceso de edición al dueño de la cuenta para grabar videos.</Notice>;
  const view = await getRecordingView({ guion: one("guion"), guiones: one("guiones"), semana: one("semana") });
  if (!view.storageReady) {
    return (
      <Notice tone="danger" title="Falta configurar el almacenamiento de videos">
        Esta instalación todavía no tiene dónde guardar los videos (VIDEO_BLOB_READ_WRITE_TOKEN). Avísale a soporte.
      </Notice>
    );
  }
  const free = one("libre") === "1";
  const asked = Boolean(one("guion") || one("guiones") || one("semana"));
  if (!free && view.session.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {asked && (
          <Notice tone="warning">
            {one("semana") ? "Tu semana todavía no tiene guiones para grabar. Elige guiones de la lista." : "No encontramos esos guiones (quizás se archivaron). Elige otros de la lista."}
          </Notice>
        )}
        <ScriptPicker week={view.week} scripts={view.scripts} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {view.missing > 0 && <Notice tone="warning">{view.missing === 1 ? "Un guion ya no existe" : `${view.missing} guiones ya no existen`} y lo dejamos fuera de la lista.</Notice>}
      <RecordingStudio key={free ? "libre" : view.session.map((s) => s.id).join(",")} session={free ? [] : view.session} defaults={view.editor.defaults} autoSummary={view.editor.summary} freeMode={free} />
    </div>
  );
}

export default function RecordPage({ searchParams }: PageProps<"/editor/grabar">) {
  return (
    <>
      <ButtonLink href="/editor" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Editor
      </ButtonLink>
      <PageHeader
        eyebrow="Grabar"
        title="Graba con tu guion en pantalla"
        description="El teleprompter avanza solo mientras hablas. Cada toma se sube sola y se vuelve un video del Editor; con «Hazlo por mí», sale editado y exportado."
        icon={<Video className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-[560px]" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
