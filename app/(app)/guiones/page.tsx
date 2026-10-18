import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Guiones" };

export default function GuionesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Guiones"
        title="De una idea a un guion listo para grabar"
        description="Escribe la idea, el tema o pega un video de referencia y recibe un guion con tu tono."
        icon={<ScrollText className="h-5 w-5" />}
      />
      <ModulePreview
        stage={3}
        icon={<ScrollText className="h-6 w-6" />}
        title="Tu generador de guiones"
        description="Usa tu perfil de marca para que cada guion suene a ti y le hable a tu público."
        features={[
          "Guion a partir de una idea, un tema o un video de referencia",
          "Reescribe el gancho o pide variantes",
          "Refuerza el llamado a la acción o acorta el guion",
          "Manda el guion al editor de video o al video con clon",
        ]}
      />
    </>
  );
}
