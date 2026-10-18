import { getCurrentUser } from "@/lib/auth";
import { hasDemo } from "@/lib/demo";
import { Section } from "@/components/ui/card";
import { DemoControls } from "./demo-controls";

/** Datos de ejemplo para mostrar la app sin conectar cuentas reales. Solo el dueño los carga o borra. */
export async function DemoSection() {
  const me = await getCurrentUser();
  const active = await hasDemo();
  if (me.role !== "OWNER") return null;
  return (
    <Section>
      <DemoControls active={active} />
    </Section>
  );
}
