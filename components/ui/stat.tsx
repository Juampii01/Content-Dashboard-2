import type { ReactNode } from "react";
import { cn, formatCompact } from "@/lib/utils";

/** Tarjeta de métrica: número grande y legible, etiqueta y variación contra el periodo anterior. */
export function StatTile({
  label,
  value,
  delta,
  icon,
  hint,
  className,
}: {
  label: string;
  value: number | null;
  /** Variación en porcentaje contra el periodo anterior (ej. 12.5 = +12.5 %). */
  delta?: number | null;
  icon?: ReactNode;
  hint?: string;
  className?: string;
}) {
  const up = delta != null && delta >= 0;
  return (
    <div className={cn("card p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <div className="tile-icon h-9 w-9">{icon}</div>}
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{formatCompact(value)}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {delta != null && (
          <span className={cn("font-mono font-semibold", up ? "text-success" : "text-danger")}>
            {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </div>
  );
}
