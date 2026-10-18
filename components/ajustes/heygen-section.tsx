import { getHeyGenStatus } from "@/lib/dal/clone";
import { HeyGenKeyPanel } from "./heygen-key-panel";

/** Ajustes → Claves de servicios: la API key de HeyGen del cliente. Solo el dueño la cambia. */
export async function HeyGenSection() {
  const status = await getHeyGenStatus({ withBalance: true });
  return <HeyGenKeyPanel status={status} />;
}

export function HeyGenSectionSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="skeleton h-20" />
      <div className="skeleton h-10 w-2/3" />
    </div>
  );
}
