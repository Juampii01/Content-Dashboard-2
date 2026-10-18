import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, House, Palette, Plug } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/card";
import { PlatformBadge, type PlatformKey } from "@/components/ui/platform";

export const metadata: Metadata = { title: "Inicio" };

const firstSteps = [
  {
    href: "/ajustes",
    icon: Plug,
    title: "Conecta tus redes",
    description: "Instagram, YouTube y TikTok. Con eso empiezan a llegar tus métricas.",
  },
  {
    href: "/marca",
    icon: Palette,
    title: "Completa tu marca",
    description: "Tu tono, tu público y tu estilo. Todo lo que generes va a sonar a ti.",
  },
  {
    href: "/calendario",
    icon: CalendarDays,
    title: "Planea tu primera pieza",
    description: "Pon en el calendario lo próximo que vas a publicar.",
  },
];

const platforms: PlatformKey[] = ["INSTAGRAM", "YOUTUBE", "TIKTOK"];

export default function InicioPage() {
  return (
    <>
      <PageHeader
        eyebrow="Inicio"
        title="Tu contenido, en un solo lugar"
        description="Aquí vas a ver cómo rinden tus redes esta semana, lo que tienes programado y los trabajos en curso."
        icon={<House className="h-5 w-5" />}
      />

      <div className="flex flex-col gap-6">
        <Section title="Primeros pasos" description="Tres pasos para dejar tu espacio listo.">
          <ol className="stagger grid gap-3 md:grid-cols-3">
            {firstSteps.map(({ href, icon: Icon, title, description }, i) => (
              <li key={href}>
                <Link href={href} className="card card-lift group flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <span className="tile-icon h-10 w-10">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-mono text-xs font-semibold text-muted">0{i + 1}</span>
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted">{description}</p>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-accent-hi">
                    Empezar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Tus redes" description="Cuando conectes una cuenta, aquí vas a ver su resumen de la semana.">
          <div className="grid gap-3 md:grid-cols-3">
            {platforms.map((platform) => (
              <div key={platform} className="card flex items-center justify-between gap-3 p-5">
                <PlatformBadge platform={platform} />
                <Link href="/ajustes" className="text-sm font-semibold text-accent-hi hover:text-white">
                  Conectar
                </Link>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
