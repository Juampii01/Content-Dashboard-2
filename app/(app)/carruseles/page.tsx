import type { Metadata } from "next";
import { GalleryHorizontalEnd } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Carruseles" };

export default function CarruselesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Carruseles"
        title="Carruseles listos para Instagram"
        description="Parte de un tema, un guion o un carrusel que te guste, y recibe las imágenes en 1080 × 1350."
        icon={<GalleryHorizontalEnd className="h-5 w-5" />}
      />
      <ModulePreview
        stage={6}
        icon={<GalleryHorizontalEnd className="h-6 w-6" />}
        title="Tu creador de carruseles"
        description="Primero revisas los textos de cada slide; después se generan las imágenes con tu estilo."
        features={[
          "Desde un tema, un guion o un carrusel de referencia",
          "Textos editables slide por slide antes de generar",
          "Corrige un solo slide sin rehacer todo",
          "Descarga todo en un ZIP",
        ]}
      />
    </>
  );
}
