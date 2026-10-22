"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { listTakes } from "./take-store";
import { useTakeUploads } from "./take-uploader";

/**
 * Aviso en el Editor si quedaron tomas grabadas en este navegador sin terminar de subir (por ejemplo, se cerró la
 * pestaña): lleva a "Grabar", que las retoma solas.
 */
export function PendingTakesNotice() {
  const [pending, setPending] = useState(0);
  const uploads = useTakeUploads();
  const active = uploads.some((u) => u.status !== "done" && u.status !== "error");
  useEffect(() => {
    let alive = true;
    void listTakes().then((takes) => alive && setPending(takes.length));
    return () => {
      alive = false;
    };
  }, [active]);
  if (!pending || active) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <p className="text-sm text-text">
        <span className="font-semibold text-white">{pending === 1 ? "Tienes 1 toma sin subir." : `Tienes ${pending} tomas sin subir.`}</span> Están guardadas en este navegador; ábrelas para terminar de subirlas.
      </p>
      <ButtonLink href="/editor/grabar" size="sm" icon={<Upload className="h-4 w-4" aria-hidden />}>
        Terminar de subir
      </ButtonLink>
    </div>
  );
}
