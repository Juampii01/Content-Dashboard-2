import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { WeekScreen } from "@/components/autopiloto/week-screen";
import { getAutopilotView } from "@/lib/dal/autopilot";

export const metadata: Metadata = { title: "Tu semana lista" };
// "Armar mi semana ahora" y los reintentos escriben después de responder: les damos el tiempo máximo.
export const maxDuration = 300;

async function Content() {
  return <WeekScreen view={await getAutopilotView()} />;
}

function WeekSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]" aria-busy="true" aria-label="Cargando tu semana">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export default function SemanaPage() {
  return (
    <>
      <ButtonLink href="/calendario" variant="subtle" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} className="mb-4">
        Volver al Calendario
      </ButtonLink>
      <PageHeader
        eyebrow="Autopiloto semanal"
        title="Tu semana lista"
        description="Cada lunes te dejamos el plan de la semana con sus guiones y carruseles escritos. Aprueba lo que te sirva: queda en tu calendario."
        icon={<Sparkles className="h-5 w-5" aria-hidden />}
      />
      <Suspense fallback={<WeekSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
