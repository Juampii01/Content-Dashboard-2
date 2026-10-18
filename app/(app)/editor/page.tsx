import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ModulePreview } from "@/components/shell/module-preview";

export const metadata: Metadata = { title: "Editor de video" };

export default function EditorPage() {
  return (
    <>
      <PageHeader
        eyebrow="Editor de video"
        title="Sube tu video crudo y recíbelo editado"
        description="Se cortan los silencios y las tomas malas, se agregan subtítulos y b-roll, y se exporta listo para publicar."
        icon={<Clapperboard className="h-5 w-5" />}
      />
      <ModulePreview
        stage={5}
        icon={<Clapperboard className="h-6 w-6" />}
        title="Tu editor de video"
        description="Pensado para videos donde hablas a cámara. Puedes salir de la página mientras se edita."
        features={[
          "Transcripción palabra por palabra",
          "Corte de silencios, tomas repetidas y errores",
          "El mejor gancho al inicio",
          "Subtítulos con tu estilo y b-roll",
          "Audio mezclado y exportación en 9:16 o 16:9",
        ]}
      />
    </>
  );
}
