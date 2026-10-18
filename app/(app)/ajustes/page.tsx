import type { Metadata } from "next";
import { Suspense } from "react";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { TeamSection, TeamSectionSkeleton } from "@/components/ajustes/team-section";
import { ConnectionsSection, ConnectionsSkeleton } from "@/components/ajustes/connections-section";
import { ConnectNotice } from "@/components/ajustes/connect-notice";
import { DemoSection } from "@/components/ajustes/demo-section";
import { HeyGenSection, HeyGenSectionSkeleton } from "@/components/ajustes/heygen-section";

export const metadata: Metadata = { title: "Ajustes" };


export default function AjustesPage({ searchParams }: PageProps<"/ajustes">) {
  return (
    <>
      <PageHeader
        eyebrow="Ajustes"
        title="Cuentas, claves y equipo"
        description="Conecta tus redes, guarda tus claves de servicios y decide quién más entra a tu espacio."
        icon={<Settings className="h-5 w-5" />}
      />

      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <ConnectNotice searchParams={searchParams} />
        </Suspense>

        <Section title="Redes conectadas" description="Solo pedimos permiso para leer tu contenido y sus números. Nunca publicamos ni respondemos por ti.">
          <Suspense fallback={<ConnectionsSkeleton />}>
            <ConnectionsSection />
          </Suspense>
        </Section>

        <Suspense fallback={null}>
          <DemoSection />
        </Suspense>

        <div id="claves" className="scroll-mt-6">
          <Section title="Claves de servicios" description="Tu API key de HeyGen para los videos con clon. Tu clon y tu saldo son tuyos: la clave se guarda cifrada y nunca se muestra completa.">
            <Suspense fallback={<HeyGenSectionSkeleton />}>
              <HeyGenSection />
            </Suspense>
          </Section>
        </div>

        <Section title="Equipo" description="Invita a tu editor o asistente con acceso de edición o de solo lectura.">
          <Suspense fallback={<TeamSectionSkeleton />}>
            <TeamSection />
          </Suspense>
        </Section>
      </div>
    </>
  );
}
