"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/format";
import type { PlanVariant } from "@/lib/video/director/types";
import { applyVariantAction } from "../director-actions";
import { useHumanize } from "../studio/humanize";

/** Versiones para probar (otro gancho u otra duración). Usar una guarda la actual como "Versión anterior". */
export function VariantsPanel({ projectId, variants, current, canEdit, dirty }: { projectId: string; variants: PlanVariant[]; current: number; canEdit: boolean; dirty: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const h = useHumanize();
  if (!variants.length) return null;
  return (
    <section aria-labelledby="variants-title" className="flex flex-col gap-3">
      <div>
        <h2 id="variants-title" className="flex items-center gap-2 text-base font-semibold">
          <Layers className="h-4 w-4 text-accent-hi" aria-hidden /> Versiones para probar
        </h2>
        <p className="text-sm text-muted">El director armó otras versiones del mismo video. La tuya ahora dura {formatDuration(current)}.</p>
      </div>
      <ul className="grid gap-2">
        {variants.map((v) => (
          <li key={v.id} className="card flex flex-col gap-2 p-4">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">{v.label}</span>
              <span className="font-mono text-[11px] text-muted">{formatDuration(v.duration)}</span>
            </span>
            <span className="line-clamp-3 text-xs text-muted">{h(v.why)}</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-auto self-start"
                disabled={pending || dirty}
                onClick={() =>
                  start(async () => {
                    const r = await applyVariantAction(projectId, v.id);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`Listo: ahora editas la ${v.label.toLowerCase()}.`);
                    router.refresh();
                  })
                }
              >
                Usar esta versión
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
