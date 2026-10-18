import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Calendario" };

export default function CalendarioPage() {
  return (
    <>
      <PageHeader
        eyebrow="Calendario"
        title="¿Qué vas a publicar y cuándo?"
        description="Planea tus piezas por semana o por mes y sigue en qué estado está cada una."
        icon={<CalendarDays className="h-5 w-5" />}
      />
      <ModulePreview
        stage={4}
        icon={<CalendarDays className="h-6 w-6" />}
        title="Tu calendario de contenido"
        description="Todo lo que produces en el sistema (guiones, carruseles y videos) cae aquí, con su fecha y su red."
        features={[
          "Vista de mes y de semana",
          "Estados: idea, en guion, en producción, listo y publicado",
          "Arrastra una pieza para cambiarla de día",
          "Cada pieza publicada se une con sus métricas reales",
        ]}
      />
    </>
  );
}
