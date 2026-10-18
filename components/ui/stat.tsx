import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCompact, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { DeltaBadge } from "./badges";
import { Sparkline } from "./charts/sparkline";

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
  return (
    <div className={cn("card p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <div className="tile-icon h-9 w-9">{icon}</div>}
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{formatCompact(value)}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <DeltaBadge value={delta} />
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </div>
  );
}

export type KpiFormat = "number" | "compact" | "percent" | "duration";

const formatters: Record<KpiFormat, (value: number) => string> = {
  number: (v) => formatNumber(v),
  compact: formatCompact,
  percent: (v) => formatPercent(v),
  duration: formatDuration,
};

/**
 * Tarjeta de KPI para Inicio y Métricas.
 * Valor grande (cifras proporcionales, no de ancho fijo), variación contra el periodo anterior
 * y, opcional, la tendencia en una mini línea.
 */
export function KpiCard({
  label,
  value,
  format = "number",
  delta,
  previous,
  comparisonLabel = "vs. periodo anterior",
  invertDelta = false,
  trend,
  trendColor,
  icon,
  loading = false,
  className,
}: {
  label: string;
  value: number | null | undefined;
  /** "number" → 12.345 · "compact" → 12,4 mil · "percent" (puntos porcentuales) → 4,8 % · "duration" (segundos) → 1:05. */
  format?: KpiFormat;
  /** Variación porcentual ya calculada. Si no viene y hay `previous`, se calcula. */
  delta?: number | null;
  /** Valor del periodo anterior (para calcular la variación). */
  previous?: number | null;
  comparisonLabel?: string;
  /** Para métricas donde bajar es bueno. */
  invertDelta?: boolean;
  /** Serie para la mini línea (ej. valor diario del periodo). */
  trend?: (number | null)[];
  trendColor?: string;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const change =
    delta !== undefined
      ? delta
      : value != null && previous != null && previous !== 0
        ? ((value - previous) / Math.abs(previous)) * 100
        : null;
  const display = value == null ? "—" : formatters[format](value);
  const full = value != null && format === "compact" ? formatNumber(value) : undefined;

  return (
    <div className={cn("card flex flex-col p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <div className="tile-icon -mt-1 h-8 w-8">{icon}</div>}
      </div>
      {loading ? (
        <>
          <div className="skeleton mt-3 h-9 w-28" />
          <div className="skeleton mt-2.5 h-4 w-36" />
        </>
      ) : (
        <>
          <p className="mt-2 text-[2rem] leading-tight font-semibold tracking-tight text-white" title={full}>
            {display}
            {full && full !== display && <span className="sr-only"> ({full})</span>}
          </p>
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {change != null ? (
              <>
                <DeltaBadge value={change} invert={invertDelta} comparisonLabel={comparisonLabel} />
                <span aria-hidden className="text-placeholder">
                  {comparisonLabel}
                </span>
              </>
            ) : (
              <span className="text-placeholder">Sin datos del periodo anterior</span>
            )}
          </div>
        </>
      )}
      {trend && trend.length > 1 && (
        <Sparkline
          values={loading ? [] : trend}
          color={trendColor}
          label={`Tendencia de ${label.toLowerCase()} en el periodo`}
          className="mt-4"
        />
      )}
    </div>
  );
}
