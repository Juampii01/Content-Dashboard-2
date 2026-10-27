import type { ReactNode } from "react";
import { ComingSoonScreen } from "@/components/shell/coming-soon";
import { COMING_SOON } from "@/lib/coming-soon";

/** Mientras "Videos con clon" esté en Próximamente, ninguna página de la sección se muestra. */
export default function CloneLayout({ children }: { children: ReactNode }) {
  if ("/clon" in COMING_SOON) return <ComingSoonScreen path="/clon" title="Videos con clon" />;
  return children;
}
