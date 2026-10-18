import type { Metadata } from "next";
import { BarChart3, Plug } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Métricas" };

export default function MetricasPage() {
  return (
    <>
      <PageHeader
        eyebrow="Métricas"
        title="¿Qué contenido te está funcionando?"
        description="Todas tus piezas de Instagram, YouTube y TikTok con sus números, filtradas como tú quieras."
        icon={<BarChart3 className="h-5 w-5" />}
      />
      <ModulePreview
        stage={2}
        icon={<BarChart3 className="h-6 w-6" />}
        title="Tus métricas, de las tres redes"
        description="Cuando conectes tus cuentas, cada reel, carrusel, video y short va a aparecer aquí con sus números, y se actualiza todos los días."
        features={[
          "Visualizaciones, me gusta, comentarios, compartidos y guardados por pieza",
          "Filtros por red, tipo de contenido, fechas y rango de cualquier métrica",
          "Búsqueda por texto del caption y orden por cualquier columna",
          "Vista de tabla y vista de cuadrícula con miniaturas",
          "Evolución en el tiempo y comparación entre periodos",
          "Tu histórico nunca se borra, aunque la red deje de mostrar la pieza",
        ]}
        action={
          <ButtonLink href="/ajustes" icon={<Plug className="h-4 w-4" />}>
            Conectar mis redes
          </ButtonLink>
        }
      />
    </>
  );
}
