"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { RetryKind } from "@/lib/system/status";
// Se reusan las acciones de reintento de cada módulo (mismas reglas, mismos permisos), no se duplican.
import { retryAction } from "@/components/editor/actions";
import { retryClipAction, retryStyleAction } from "@/components/editor/media-actions";
import { retryLongVideoAction } from "@/components/editor/clips/actions";
import { retryCloneVideoAction } from "@/components/clon/actions";

const actions: Record<RetryKind, (id: string) => Promise<{ ok: boolean; error?: string }>> = {
  video: retryAction,
  style: retryStyleAction,
  broll: retryClipAction,
  long: retryLongVideoAction,
  clone: retryCloneVideoAction,
};

/** Botón "Reintentar" de un trabajo fallido en el estado del sistema. */
export function SystemRetryButton({ kind, id, title }: { kind: RetryKind; id: string; title: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending || done}
      aria-label={`Reintentar ${title}`}
      icon={<RotateCcw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />}
      onClick={() =>
        start(async () => {
          const res = await actions[kind](id);
          if (res.ok) {
            setDone(true);
            toast.success("Listo, lo volvimos a poner en marcha.");
          } else toast.error(res.error ?? "No pudimos reintentarlo. Prueba de nuevo en un momento.");
        })
      }
    >
      {done ? "En marcha" : pending ? "Reintentando" : "Reintentar"}
    </Button>
  );
}
