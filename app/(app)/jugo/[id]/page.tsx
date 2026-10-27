import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { PackScreen } from "@/components/jugo/pack-view";
import { getCurrentUser } from "@/lib/auth";
import { getPack } from "@/lib/dal/repurpose";

export const metadata: Metadata = { title: "Sacarle todo el jugo" };
// Los reintentos generan después de responder: les damos el tiempo máximo.
export const maxDuration = 300;

async function Pack({ params }: { params: PageProps<"/jugo/[id]">["params"] }) {
  const { id } = await params;
  const [me, pack] = await Promise.all([getCurrentUser(), getPack(id)]);
  if (!pack) notFound();
  return <PackScreen pack={pack} canEdit={me.role !== "VIEWER"} />;
}

function PackSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Cargando el paquete">
      <Skeleton className="h-28" />
      <Skeleton className="h-72" />
      <Skeleton className="h-96" />
    </div>
  );
}

export default function PackPage({ params }: PageProps<"/jugo/[id]">) {
  return (
    <>
      <ButtonLink href="/jugo" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver a Sacarle todo el jugo
      </ButtonLink>
      <Suspense fallback={<PackSkeleton />}>
        <Pack params={params} />
      </Suspense>
    </>
  );
}
