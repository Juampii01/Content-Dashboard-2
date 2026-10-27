import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { NewTemplateFlow } from "@/components/carruseles/new-template-flow";
import { getCurrentUser } from "@/lib/auth";
import { carouselFilesReady } from "@/lib/carousels/files";

export const metadata: Metadata = { title: "Copiar un estilo" };

async function Flow() {
  await getCurrentUser();
  return <NewTemplateFlow storageReady={carouselFilesReady()} />;
}

export default function NewTemplatePage() {
  return (
    <>
      <ButtonLink href="/carruseles/plantillas" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Plantillas
      </ButtonLink>
      <PageHeader
        eyebrow="Plantillas"
        title="Copia el estilo de cualquier carrusel"
        description="Sube sus slides o pega el link. Te devolvemos una plantilla con su diseño para usar con tus textos: nunca copiamos su contenido."
        icon={<ScanSearch className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow />
      </Suspense>
    </>
  );
}
