"use client";

import { AlertTriangle, Check, Copy, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { CaptionVariant } from "@/lib/db/schema";
import { HOOK_LABEL, variantWarnings } from "@/lib/carousels/captions";
import { captionWithHashtags } from "@/lib/carousels/validate";
import { formatNumber } from "@/lib/format";

/**
 * Las 5 variaciones del caption (una por tipo de gancho), para probar cuál funciona mejor. Cada una se copia o se
 * usa como caption principal. Van también en variaciones.txt dentro del ZIP.
 */
export function CaptionVariants({
  variants,
  source,
  slidesCount,
  canEdit,
  busy,
  onGenerate,
  onUse,
}: {
  variants: CaptionVariant[];
  source: string;
  slidesCount: number;
  canEdit: boolean;
  busy: boolean;
  onGenerate: () => void;
  onUse: (v: CaptionVariant) => void;
}) {
  const checks = variantWarnings(variants, source, slidesCount);
  async function copy(v: CaptionVariant, i: number) {
    try {
      await navigator.clipboard.writeText(captionWithHashtags(v.caption, v.hashtags));
      toast.success(`Variación ${i + 1} copiada.`);
    } catch {
      toast.error("No se pudo copiar. Selecciona el texto y cópialo a mano.");
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/8 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Layers className="h-4 w-4 text-accent-hi" aria-hidden />
            5 variaciones para probar
          </p>
          <p className="text-xs text-muted">Cada una abre con otro tipo de gancho y lleva otros 5 hashtags.</p>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onGenerate} icon={<Layers className={busy ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} aria-hidden />}>
            {busy ? "Escribiendo…" : variants.length ? "Otras 5" : "Escribir 5 variaciones"}
          </Button>
        )}
      </div>
      {busy && !variants.length && (
        <div className="grid gap-2 md:grid-cols-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      )}
      {variants.length > 0 && (
        <ol className="grid gap-3 md:grid-cols-2">
          {variants.map((v, i) => {
            const warns = checks.byIndex[i] ?? [];
            const length = captionWithHashtags(v.caption, v.hashtags).length;
            return (
              <li key={i} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">
                    {String(i + 1).padStart(2, "0")} · {HOOK_LABEL[v.hook]}
                  </span>
                  <span className="font-mono text-[11px] text-placeholder">{formatNumber(length)} car.</span>
                </div>
                <p className="line-clamp-6 text-sm whitespace-pre-line text-white">{v.caption}</p>
                <p className="font-mono text-xs break-words text-accent-glow">{v.hashtags.join(" ")}</p>
                {warns.map((w) => (
                  <p key={w} className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                    {w}
                  </p>
                ))}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <Button variant="subtle" size="sm" onClick={() => void copy(v, i)} icon={<Copy className="h-3.5 w-3.5" aria-hidden />}>
                    Copiar
                  </Button>
                  {canEdit && (
                    <Button variant="subtle" size="sm" onClick={() => onUse(v)} icon={<Check className="h-3.5 w-3.5" aria-hidden />}>
                      Usar como principal
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {checks.all.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
          {w}
        </p>
      ))}
    </div>
  );
}
