"use client";

import { useTransition } from "react";
import { FlaskConical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { toast } from "@/components/ui/toast";
import { clearDemoAction, loadDemoAction } from "./demo-actions";

export function DemoControls({ active }: { active: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else toast.success(res.message ?? "Listo.");
    });

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="tile-icon h-10 w-10 flex-none">
          <FlaskConical className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
            Datos de demostración {active && <StatusBadge tone="info">Activos</StatusBadge>}
          </p>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Llena la app con 6 meses de contenido de ejemplo en las redes que todavía no conectaste. Sirve para mostrarla o probarla. No se
            mezcla con tus datos reales y se borra con un clic.
          </p>
        </div>
      </div>
      <div className="flex flex-none gap-2">
        {active ? (
          <Button variant="ghost" disabled={pending} onClick={() => run(clearDemoAction)} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
            {pending ? "Borrando…" : "Borrar demo"}
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => run(loadDemoAction)} icon={<FlaskConical className="h-4 w-4" aria-hidden />}>
            {pending ? "Cargando…" : "Cargar demo"}
          </Button>
        )}
      </div>
    </div>
  );
}
