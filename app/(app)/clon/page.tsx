import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Videos con clon" };

export default function ClonPage() {
  return (
    <>
      <PageHeader
        eyebrow="Videos con clon"
        title="Videos con tu clon digital"
        description="Crea tu clon una sola vez y genera videos hablando con tu cara y tu voz a partir de un guion."
        icon={<UserRound className="h-5 w-5" />}
      />
      <ModulePreview

        icon={<UserRound className="h-6 w-6" />}
        title="Tu clon con HeyGen"
        description="Usa tu propia cuenta de HeyGen. Tu clon y tus créditos son tuyos."
        features={[
          "Crea tu clon con un video de unos 2 minutos",
          "Autorizas el uso de tu imagen desde el enlace oficial de HeyGen",
          "Genera videos con tu clon desde cualquier guion",
          "Formato vertical u horizontal",
        ]}
      />
    </>
  );
}
