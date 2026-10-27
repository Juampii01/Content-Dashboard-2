import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { CopyProgress } from "@/components/carruseles/copy-progress";
import { getCurrentUser } from "@/lib/auth";
import { getCopyView } from "@/lib/dal/carousels";

export const metadata: Metadata = { title: "Copiando un carrusel" };

async function Progress({ params }: { params: PageProps<"/carruseles/copiar/[id]">["params"] }) {
  const { id } = await params;
  const [me, copy] = await Promise.all([getCurrentUser(), getCopyView(id)]);
  if (!copy) notFound();
  // Ya terminó: directo al editor del carrusel nuevo.
  if (copy.status === "READY" && copy.carouselId) redirect(`/carruseles/${copy.carouselId}?copiado=1`);
  return <CopyProgress key={`${copy.id}-${copy.status}-${copy.source}`} copy={copy} canEdit={me.role !== "VIEWER"} />;
}

export default function CopyProgressPage({ params }: PageProps<"/carruseles/copiar/[id]">) {
  return (
    <>
      <ButtonLink href="/carruseles" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Carruseles
      </ButtonLink>
      <PageHeader eyebrow="Copiar un carrusel" title="Escribiendo tu versión" description="Leemos cada slide del original y escribimos el tuyo con tu marca. Puedes salir: sigue solo y lo ves aquí al volver." icon={<Copy className="h-5 w-5" aria-hidden />} />
      <Suspense fallback={<Skeleton className="h-72" />}>
        <Progress params={params} />
      </Suspense>
    </>
  );
}
