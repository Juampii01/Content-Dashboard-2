import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { CopyFlow } from "@/components/carruseles/copy-flow";
import { aiConfigured } from "@/lib/ai/client";
import { getCarouselLook, getCopySetup } from "@/lib/dal/carousels";

export const metadata: Metadata = { title: "Copiar un carrusel" };

const LINK_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/?(\?.*)?$/;

/** `?link=<url de Instagram>` precarga el link del carrusel (para mandar aquí desde otros módulos). */
async function Flow({ searchParams }: { searchParams: PageProps<"/carruseles/copiar">["searchParams"] }) {
  const params = await searchParams;
  const link = typeof params.link === "string" && LINK_RE.test(params.link) ? params.link : null;
  const [setup, look] = await Promise.all([getCopySetup(), getCarouselLook()]);
  return (
    <CopyFlow
      photos={setup.photos}
      keywords={look.keywords}
      templates={setup.templates.map((t) => ({ id: t.id, name: t.name }))}
      storageReady={setup.storageReady}
      aiReady={aiConfigured()}
      initialUrl={link}
    />
  );
}

export default function CopyCarouselPage({ searchParams }: PageProps<"/carruseles/copiar">) {
  return (
    <>
      <ButtonLink href="/carruseles" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Carruseles
      </ButtonLink>
      <PageHeader
        eyebrow="Copiar un carrusel"
        title="Copia un carrusel que ya funciona"
        description="Pega el link de un carrusel viral (o sube sus slides). Te devolvemos tu versión con tu marca, tu tono, tu CTA y tu cara, lista para revisar."
        icon={<Copy className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </>
  );
}
