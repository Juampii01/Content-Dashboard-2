import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound, Settings } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { PlatformBadge, type PlatformKey } from "@/components/ui/platform";
import { Pill } from "@/components/ui/feedback";
import { TeamSection, TeamSectionSkeleton } from "@/components/ajustes/team-section";

export const metadata: Metadata = { title: "Ajustes" };

const platforms: { key: PlatformKey; description: string }[] = [
  { key: "INSTAGRAM", description: "Cuenta profesional (creador o empresa). Lee tus publicaciones y sus estadísticas." },
  { key: "YOUTUBE", description: "Tu canal. Lee tus videos, shorts y su tiempo de visualización." },
  { key: "TIKTOK", description: "Tu cuenta. Lee tus videos y sus estadísticas." },
];

export default function AjustesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Ajustes"
        title="Cuentas, claves y equipo"
        description="Conecta tus redes, guarda tus claves de servicios y decide quién más entra a tu espacio."
        icon={<Settings className="h-5 w-5" />}
      />

      <div className="flex flex-col gap-6">
        <Section title="Redes conectadas" description="Solo pedimos permiso para leer tu contenido y sus números. Nunca publicamos ni respondemos por ti.">
          <ul className="flex flex-col gap-3">
            {platforms.map(({ key, description }) => (
              <li key={key} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2">
                  <PlatformBadge platform={key} className="self-start" />
                  <p className="text-sm text-muted">{description}</p>
                </div>
                <Pill className="self-start sm:self-center">Próximamente</Pill>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Claves de servicios" description="Tu API key de HeyGen para los videos con clon. Se guarda cifrada y nunca se muestra completa.">
          <div className="flex items-center gap-3 text-sm text-muted">
            <KeyRound className="h-4 w-4 text-accent-hi" aria-hidden />
            Próximamente.
          </div>
        </Section>

        <Section title="Equipo" description="Invita a tu editor o asistente con acceso de edición o de solo lectura.">
          <Suspense fallback={<TeamSectionSkeleton />}>
            <TeamSection />
          </Suspense>
        </Section>
      </div>
    </>
  );
}
