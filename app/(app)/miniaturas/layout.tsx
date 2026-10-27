import type { ReactNode } from "react";
import { ComingSoonScreen } from "@/components/shell/coming-soon";
import { COMING_SOON } from "@/lib/coming-soon";

/** Mientras "Títulos y miniaturas" esté en Próximamente, ninguna página de la sección se muestra. */
export default function ThumbnailsLayout({ children }: { children: ReactNode }) {
  if ("/miniaturas" in COMING_SOON) return <ComingSoonScreen path="/miniaturas" title="Títulos y miniaturas" />;
  return children;
}
