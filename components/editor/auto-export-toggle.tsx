"use client";

import { useId } from "react";
import { Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Hazlo por mí": exportar solo cuando esté listo, sin pasar por la revisión. Lo usan el flujo de subida, la grabación
 * en el navegador y la pantalla de progreso. `summary` explica qué valores se van a usar (los de Mi marca).
 */
export function AutoExportToggle({
  checked,
  onChange,
  disabled,
  summary,
  compact = false,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  summary?: string;
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-4 transition", checked ? "border-accent/60 bg-accent/10" : "border-white/10", className)}>
      {!compact && (
        <span className="tile-icon h-10 w-10 flex-none">
          <Wand2 className="h-4.5 w-4.5" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p id={id} className="text-sm font-semibold text-white">
          Hazlo por mí: exportar solo cuando esté listo
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {checked
            ? "No pasa por la revisión: lo editamos y exportamos solo, y te avisamos en la campana y por correo. Después puedes revisarlo y volver a exportarlo."
            : "Apagado: cuando esté la edición propuesta, la revisas y la exportas tú."}
          {summary && checked ? <span className="mt-1 block text-text/80">{summary}</span> : null}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-7 w-12 flex-none rounded-full border transition disabled:opacity-50", checked ? "border-accent-hi bg-accent" : "border-white/20 bg-white/10")}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-6" : "left-0.5")} />
      </button>
    </div>
  );
}
