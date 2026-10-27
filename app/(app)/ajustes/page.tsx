import type { Metadata } from "next";
import { Suspense } from "react";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { TeamSection, TeamSectionSkeleton } from "@/components/ajustes/team-section";
import { ConnectionsSection, ConnectionsSkeleton } from "@/components/ajustes/connections-section";
import { ConnectNotice } from "@/components/ajustes/connect-notice";
import { DemoSection } from "@/components/ajustes/demo-section";
import { SystemSection, SystemSectionSkeleton } from "@/components/ajustes/system-section";
import { HeyGenSection, HeyGenSectionSkeleton } from "@/components/ajustes/heygen-section";
import { ImageKeysSection, ImageKeysSectionSkeleton } from "@/components/ajustes/image-keys-section";
import { MusicKeysSection } from "@/components/ajustes/music-keys-section";
import { AnthropicKeySection } from "@/components/ajustes/anthropic-key-section";
import { ReportSettingsSection, ReportSettingsSkeleton } from "@/components/informes/settings-section";
import { FEATURES } from "@/lib/features";

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

        <Suspense fallback={<SystemSectionSkeleton />}>
          <SystemSection />
        </Suspense>

        <Suspense fallback={null}>
          <DemoSection />
        </Suspense>

        <div id="claves" className="scroll-mt-6">
          <Section title="Claves de servicios" description="Tu clave de API de Anthropic para toda la IA, la de OpenAI para las imágenes y, si quieres, Jamendo para música de artistas. El consumo se cobra en tus cuentas. Se guardan cifradas y nunca se muestran completas.">
            <div className="flex flex-col gap-6">
              <Suspense fallback={<div aria-hidden className="skeleton h-36" />}>
                <AnthropicKeySection />
              </Suspense>
              {FEATURES.clone && (
                <Suspense fallback={<HeyGenSectionSkeleton />}>
                  <HeyGenSection />
                </Suspense>
              )}
              <Suspense fallback={<ImageKeysSectionSkeleton />}>
                <ImageKeysSection />
              </Suspense>
              <Suspense fallback={<div aria-hidden className="skeleton h-36" />}>
                <MusicKeysSection />
              </Suspense>
            </div>
          </Section>
        </div>

        <div id="informes" className="scroll-mt-6">
          <Section title="Informe mensual" description="El PDF de cada mes con tu marca. Elige a quién le llega (tu equipo o un sponsor, hasta 10 correos) y si sale solo el día 1.">
            <Suspense fallback={<ReportSettingsSkeleton />}>
              <ReportSettingsSection />
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
