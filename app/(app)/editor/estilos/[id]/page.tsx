import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Clapperboard, Link2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badges";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Progress, Skeleton } from "@/components/ui/feedback";
import { StyleDetail } from "@/components/editor/style-detail";
import { StyleAutoRefresh } from "@/components/editor/style-auto-refresh";
import { getCurrentUser } from "@/lib/auth";
import { getStyle } from "@/lib/dal/editor-media";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Estilo" };

async function Style({ params }: { params: PageProps<"/editor/estilos/[id]">["params"] }) {
  const { id } = await params;
  const [me, style] = await Promise.all([getCurrentUser(), getStyle(id)]);
  if (!style) notFound();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge tone={style.status === "READY" ? "success" : style.status === "FAILED" ? "danger" : "info"}>
              {style.status === "READY" ? "Listo" : style.status === "FAILED" ? "Con error" : style.status === "ANALYZING" ? "Analizando" : "Subida incompleta"}
            </StatusBadge>
            <span>Creado el {formatDate(style.createdAt)}</span>
            {style.sourceUrl && (
              <a href={style.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-hi hover:underline">
                <Link2 className="h-3.5 w-3.5" aria-hidden /> Ver la referencia en {style.sourceName ?? "la web"}
              </a>
            )}
          </div>
          <h1 className="truncate text-2xl font-bold">{style.name}</h1>
        </div>
        {style.status === "READY" && me.role !== "VIEWER" && (
          <ButtonLink href={`/editor/nuevo?estilo=${style.id}`} icon={<Clapperboard className="h-4 w-4" aria-hidden />}>
            Editar un video con este estilo
          </ButtonLink>
        )}
      </header>
      {style.status === "ANALYZING" && (
        <div className="card flex flex-col gap-3 p-6">
          <StyleAutoRefresh />
          <h2 className="text-lg font-semibold">Estamos analizando el video</h2>
          <p className="text-sm text-muted">Suele tardar menos de un minuto por cada minuto de video. Puedes salir y volver.</p>
          <Progress value={style.job?.progress ?? 0} label={style.job?.stage ?? "En cola"} />
        </div>
      )}
      {style.status === "FAILED" && <Notice tone="danger" title="No pudimos analizar el video">{style.errorMessage ?? "Algo salió mal en el análisis. Vuelve a intentarlo desde la lista de estilos."}</Notice>}
      {style.status === "READY" && style.metrics && style.preset && <StyleDetail metrics={style.metrics} preset={style.preset} thumbUrl={style.thumbUrl} />}
      {style.status === "READY" && (!style.metrics || !style.preset) && <Notice tone="warning">Este estilo quedó incompleto. Bórralo y vuelve a crearlo.</Notice>}
    </div>
  );
}

export default function StylePage({ params }: PageProps<"/editor/estilos/[id]">) {
  return (
    <>
      <ButtonLink href="/editor/estilos" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a los estilos
      </ButtonLink>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16" />
            <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
              <Skeleton className="aspect-[9/16]" />
              <Skeleton className="h-96" />
            </div>
          </div>
        }
      >
        <Style params={params} />
      </Suspense>
    </>
  );
}
