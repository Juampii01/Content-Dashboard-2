import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, ImagePlay } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { NewPackageFlow } from "@/components/miniaturas/new-package-flow";
import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { packageSources } from "@/lib/dal/youtube";

export const metadata: Metadata = { title: "Nuevos títulos y miniaturas" };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Para mandar algo desde otro módulo: `?guion=<id>` (Guiones), `?video=<id>` (Editor) o `?pieza=<id>` (un video o
 * short de YouTube en Métricas). Preselecciona ese origen.
 */
async function Flow({ searchParams }: { searchParams: PageProps<"/miniaturas/nuevo">["searchParams"] }) {
  const params = await searchParams;
  const [lists, user] = await Promise.all([packageSources(), getCurrentUser()]);
  const pick = (key: "guion" | "video" | "pieza") => (typeof params[key] === "string" && UUID.test(params[key] as string) ? (params[key] as string) : null);
  let preset: { kind: "guion" | "video" | "pieza"; id: string } | null = null;
  for (const kind of ["guion", "video", "pieza"] as const) {
    const id = pick(kind);
    if (id) preset = { kind, id };
  }
  const data = JSON.parse(JSON.stringify(lists));
  // Si el origen pedido no está entre los recientes, se agrega igual a la lista para poder elegirlo.
  return <NewPackageFlow lists={data} preset={preset} aiReady={aiConfigured()} canEdit={user.role !== "VIEWER"} />;
}

export default function NewThumbnailsPage({ searchParams }: PageProps<"/miniaturas/nuevo">) {
  return (
    <>
      <ButtonLink href="/miniaturas" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Títulos y miniaturas
      </ButtonLink>
      <PageHeader
        eyebrow="Nuevo"
        title="Títulos y miniaturas para tu video"
        description="Eliges de qué es el video y te damos los títulos por ángulo y 3 miniaturas con tu foto y tus colores."
        icon={<ImagePlay className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </>
  );
}
