import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, GalleryHorizontalEnd } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { NewCarouselFlow } from "@/components/carruseles/new-carousel-flow";
import { aiConfigured } from "@/lib/ai/client";
import { brandIsReady, getBrandProfile } from "@/lib/dal/brand";
import { getCarouselLook, listScriptsForCarousel } from "@/lib/dal/carousels";

export const metadata: Metadata = { title: "Nuevo carrusel" };

/** `?guion=<id>` precarga un guion como origen (lo usa el botón "Hacer carrusel" de Guiones). */
async function Flow({ searchParams }: { searchParams: PageProps<"/carruseles/nuevo">["searchParams"] }) {
  const params = await searchParams;
  const guion = typeof params.guion === "string" && /^[0-9a-f-]{36}$/i.test(params.guion) ? params.guion : null;
  const [brand, look, scripts] = await Promise.all([getBrandProfile(), getCarouselLook(), listScriptsForCarousel()]);
  const preselected = guion && scripts.some((s) => s.id === guion) ? guion : null;
  return (
    <NewCarouselFlow
      scripts={scripts}
      preselectedScript={preselected}
      keywords={look.keywords}
      look={{ colors: look.colors, fonts: look.fonts, identity: look.identity }}
      aiReady={aiConfigured()}
      brandReady={brandIsReady(brand)}
    />
  );
}

export default function NewCarouselPage({ searchParams }: PageProps<"/carruseles/nuevo">) {
  return (
    <>
      <ButtonLink href="/carruseles" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Carruseles
      </ButtonLink>
      <PageHeader
        eyebrow="Nuevo carrusel"
        title="Arma tu carrusel en 4 pasos"
        description="Eliges de dónde sale, qué quieres que haga la gente y la plantilla. La IA escribe cada slide con tu voz."
        icon={<GalleryHorizontalEnd className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </>
  );
}
