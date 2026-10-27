"use client";

import { useEffect, useState, useTransition } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/format";
import type { PlanVersionItem } from "@/lib/video/versions";
import { listPlanVersionsAction, restorePlanVersionAction } from "../director-actions";

/**
 * Versiones del video: antes de cada cambio de la IA (y de cada tanda de cambios a mano en el Estudio) queda guardado cómo estaba. Se puede volver a cualquiera; la
 * versión actual también queda guardada, así que volver también se puede deshacer.
 */
export function VersionsPanel({ projectId, busy }: { projectId: string; busy: boolean }) {
  const [versions, setVersions] = useState<PlanVersionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PlanVersionItem | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void listPlanVersionsAction(projectId).then((r) => {
      if (!alive) return;
      if (r.ok) setVersions(r.versions);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  function restore(v: PlanVersionItem) {
    start(async () => {
      const r = await restorePlanVersionAction(projectId, v.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Listo: el video volvió a esa versión.");
      // El Estudio arranca desde el plan guardado: se recarga para mostrar la versión elegida.
      window.location.reload();
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <History className="h-4 w-4" aria-hidden /> Versiones del video
        </h3>
        <p className="mt-1 text-xs text-muted">Antes de cada cambio de la IA, y mientras editas a mano (como mucho una cada 10 minutos), guardamos cómo estaba tu video. Vuelve a cualquiera: la versión de ahora también queda guardada.</p>
      </div>
      {busy && <Notice tone="info">La IA o la exportación están trabajando en este video. Cuando terminen vas a poder volver a una versión.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {!versions && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando versiones…
        </p>
      )}
      {versions && !versions.length && <p className="text-sm text-muted">Todavía no hay versiones guardadas. Aparecen cuando la IA cambia tu video o cuando lo editas a mano.</p>}
      {versions && versions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {versions.map((v) => (
            <li key={v.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-card px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-white [overflow-wrap:anywhere]">{v.label}</p>
                <p className="mt-0.5 text-xs text-muted">{formatRelative(v.createdAt)}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={busy || pending} onClick={() => setConfirm(v)} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
                Volver
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={confirm != null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="¿Volver a esta versión?"
        description={confirm ? `${confirm.label} (${formatRelative(confirm.createdAt)}). Lo que tienes ahora queda guardado como otra versión.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={() => confirm && restore(confirm)} disabled={pending} icon={pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}>
              Volver a esta versión
            </Button>
          </>
        }
      />
    </div>
  );
}
