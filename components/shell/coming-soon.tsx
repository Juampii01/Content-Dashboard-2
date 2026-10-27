import { Clock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { COMING_SOON, type ComingSoonPath } from "@/lib/coming-soon";

/** Pantalla de un módulo que todavía no está habilitado (ver lib/coming-soon.ts). */
export function ComingSoonScreen({ path, title }: { path: ComingSoonPath; title: string }) {
  return (
    <>
      <PageHeader eyebrow="Próximamente" title={title} description={COMING_SOON[path]} />
      <EmptyState
        icon={<Clock className="h-6 w-6" aria-hidden />}
        title="Muy pronto en tu cuenta"
        description="Estamos terminando de probar esta herramienta. Te avisamos apenas esté lista para usar."
        action={<ButtonLink href="/editor">Ir al Editor de video</ButtonLink>}
      />
    </>
  );
}
