import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { NewScriptForm } from "@/components/guiones/new-script-form";
import { aiConfigured } from "@/lib/ai/client";
import { brandIsReady, getBrandProfile } from "@/lib/dal/brand";
import { getSourcePiece } from "@/lib/dal/scripts";
import { formatCompact } from "@/lib/format";
import { platformLabel } from "@/lib/social/types";

export const metadata: Metadata = { title: "Nuevo guion" };

async function Form({ searchParams }: { searchParams: PageProps<"/guiones/nuevo">["searchParams"] }) {
  const params = await searchParams;
  const desde = typeof params.desde === "string" ? params.desde : null;
  const [brand, piece] = await Promise.all([getBrandProfile(), desde ? getSourcePiece(desde) : null]);
  const source = piece
    ? {
        id: piece.id,
        label: `${platformLabel[piece.platform]}${piece.views != null ? ` · ${formatCompact(piece.views)} visualizaciones` : ""}${piece.perfScore ? ` · ×${piece.perfScore.toFixed(1)} tu mediana` : ""}`,
        text: [piece.title, piece.caption].filter(Boolean).join(" — "),
      }
    : null;
  return (
    <NewScriptForm
      pillars={brand?.pillars.map((p) => p.name) ?? []}
      offers={brand?.offers.map((o) => o.name) ?? []}
      source={source}
      aiReady={aiConfigured()}
      brandReady={brandIsReady(brand)}
    />
  );
}

export default function NewScriptPage({ searchParams }: PageProps<"/guiones/nuevo">) {
  return (
    <>
      <ButtonLink href="/guiones" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Guiones
      </ButtonLink>
      <PageHeader eyebrow="Nuevo guion" title="¿Qué quieres contar?" description="Con tu idea, tu marca y lo que ya te funcionó, escribimos el guion completo." icon={<FilePlus2 className="h-5 w-5" aria-hidden />} />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}
