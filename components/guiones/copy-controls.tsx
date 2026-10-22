"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { deleteCopyAction, retryCopyAction } from "./copy-actions";

/** Mientras la copia se analiza, la página se actualiza sola cada 3 s (solo con la pestaña a la vista). */
export function CopyAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => !document.hidden && router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

export function RetryCopyButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const result = await retryCopyAction(id);
          if (result.ok) toast.success("Lo intentamos de nuevo. Puedes salir y volver.");
          else toast.error(result.error);
        })
      }
      disabled={pending}
      icon={<RotateCcw className="h-4 w-4" aria-hidden />}
    >
      {pending ? "Enviando…" : "Reintentar"}
    </Button>
  );
}

export function DeleteCopyButton({ id, ready }: { id: string; ready: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        const message = ready ? "¿Borrar esta copia? Tu guion y tu estilo de edición se quedan donde están." : "¿Borrar esta copia? Si subiste un video, también se borra.";
        if (!window.confirm(message)) return;
        start(async () => {
          const result = await deleteCopyAction(id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Copia borrada.");
          router.push("/guiones/copiar");
        });
      }}
      disabled={pending}
      icon={<Trash2 className="h-4 w-4" aria-hidden />}
    >
      {pending ? "Borrando…" : "Borrar copia"}
    </Button>
  );
}
