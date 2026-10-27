import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMultiplier, formatNumber, formatPercent } from "@/lib/format";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClass: Record<StatusTone, string> = {
  neutral: "border-white/15 bg-white/[0.05] text-muted",
  info: "border-accent-hi/40 bg-accent/12 text-accent-glow",
  success: "border-success/35 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
};

const toneIcon: Record<StatusTone, ReactNode> = {
  neutral: <Circle className="h-3 w-3" />,
  info: <Info className="h-3.5 w-3.5" />,
  success: <CheckCircle2 className="h-3.5 w-3.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" />,
  danger: <XCircle className="h-3.5 w-3.5" />,
};

/**
 * Estado con tono semántico: "Publicado", "En curso", "Error"...
 * Siempre lleva icono y texto, para que el color nunca sea la única señal.
 */
export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: StatusTone;
  /** Reemplaza el icono por defecto del tono. `null` lo oculta (solo si el texto ya es inequívoco). */
  icon?: ReactNode | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {icon !== null && <span aria-hidden className="flex-none">{icon ?? toneIcon[tone]}</span>}
      {children}
    </span>
  );
}

/**
 * Variación porcentual contra el periodo anterior: "▲ +12.5 %", "▼ -3.2 %" o "sin cambio".
 * Flecha + signo + texto: el color acompaña, no informa solo.
 * `invert` para métricas donde subir es malo (ej. tasa de abandono).
 */
export function DeltaBadge({
  value,
  invert = false,
  digits = 1,
  comparisonLabel,
  size = "sm",
  className,
}: {
  /** Puntos porcentuales: 12.5 = +12.5 %. `null` → no se muestra nada. */
  value: number | null | undefined;
  invert?: boolean;
  digits?: number;
  /** Texto para lectores de pantalla, ej. "frente a los 28 días anteriores". */
  comparisonLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const threshold = 0.5 * 10 ** -digits;
  const flat = Math.abs(value) < threshold;
  const up = value > 0;
  const good = flat ? null : up !== invert;
  const sizes = size === "md" ? "px-2 py-1 text-xs gap-1" : "px-1.5 py-0.5 text-[11px] gap-0.5";
  // Con una base muy chica (de 3 a 1,366) un "+45,433%" no se lee: a partir de +1,000% se muestra "×456".
  const multiple = up && value >= 1000 ? `×${formatNumber(Math.round(1 + value / 100))}` : null;
  const srText = flat
    ? `Sin cambio${comparisonLabel ? ` ${comparisonLabel}` : ""}`
    : multiple
      ? `${multiple.replace("×", "")} veces más${comparisonLabel ? ` ${comparisonLabel}` : ""}`
      : `${up ? "Subió" : "Bajó"} ${formatPercent(Math.abs(value), { digits })}${comparisonLabel ? ` ${comparisonLabel}` : ""}`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-semibold whitespace-nowrap tabular-nums",
        sizes,
        good === null && "bg-white/[0.06] text-muted",
        good === true && "bg-success/12 text-success",
        good === false && "bg-danger/12 text-danger",
        className,
      )}
    >
      <span aria-hidden className="flex items-center gap-0.5">
        {flat ? (
          <>sin cambio</>
        ) : (
          <>
            <span className="text-[0.8em]">{up ? "▲" : "▼"}</span>
            {multiple ?? formatPercent(value, { digits, signed: true })}
          </>
        )}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}

/**
 * Insignia de pieza destacada: cuántas veces supera su promedio ("×3.2").
 * Pensada para el hueco `badge` de MediaThumbCard y para filas de tabla.
 */
export function OutlierBadge({ ratio, className }: { ratio: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-paper/20 bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper tabular-nums backdrop-blur",
        className,
      )}
      title={`Rinde ${formatMultiplier(ratio)} su promedio`}
    >
      <span aria-hidden>{formatMultiplier(ratio)}</span>
      <span className="sr-only">Rinde {formatMultiplier(ratio)} su promedio</span>
    </span>
  );
}
