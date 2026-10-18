import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Mi marca" };

export default function MarcaPage() {
  return (
    <>
      <PageHeader
        eyebrow="Mi marca"
        title="Cómo suena y se ve tu marca"
        description="Lo que pongas aquí lo usan los guiones, los carruseles, el editor y el clon."
        icon={<Palette className="h-5 w-5" />}
      />
      <ModulePreview
        stage={3}
        icon={<Palette className="h-6 w-6" />}
        title="Tu perfil de marca"
        description="Se completa una vez y se ajusta cuando quieras."
        features={[
          "Nombre, usuario y nicho",
          "Público ideal y tono",
          "Palabras que nunca quieres usar",
          "Colores, tipografía y fotos tuyas",
          "Estilo de subtítulos para tus videos",
        ]}
      />
    </>
  );
}
