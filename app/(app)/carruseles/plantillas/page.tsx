import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Palette, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/feedback";
import { TemplatesList } from "@/components/carruseles/templates-list";
import { getCurrentUser } from "@/lib/auth";
import { getCarouselLook, listCarouselTemplates } from "@/lib/dal/carousels";

export const metadata: Metadata = { title: "Plantillas de carrusel" };

async function List() {
  const [me, templates, look] = await Promise.all([getCurrentUser(), listCarouselTemplates(), getCarouselLook()]);
  const canEdit = me.role !== "VIEWER";
  if (!templates.length) {
    return (
      <EmptyState
        icon={<Palette className="h-5 w-5" aria-hidden />}
        title="Todavía no copiaste ningún estilo"
        description="Sube las imágenes de un carrusel que te guste (o pega su link) y te armamos una plantilla con su diseño para escribir tus propios carruseles. Nunca copiamos sus textos, fotos ni logos."
        action={
          canEdit ? (
            <ButtonLink href="/carruseles/plantillas/nueva" icon={<ScanSearch className="h-4 w-4" aria-hidden />}>
              Copiar un estilo
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
  return <TemplatesList templates={templates} look={{ colors: look.colors, fonts: look.fonts, identity: look.identity }} canEdit={canEdit} />;
}

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[420px]" />
      ))}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <>
      <ButtonLink href="/carruseles" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Carruseles
      </ButtonLink>
      <PageHeader
        eyebrow="Carruseles"
        title="Tus plantillas"
        description="Estilos copiados de carruseles que te gustan, listos para usar con tus textos y tu marca. Se eligen al crear un carrusel, junto a las de fábrica."
        icon={<Palette className="h-5 w-5" aria-hidden />}
        actions={
          <ButtonLink href="/carruseles/plantillas/nueva" icon={<ScanSearch className="h-4 w-4" aria-hidden />}>
            Copiar un estilo
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <List />
      </Suspense>
    </>
  );
}
