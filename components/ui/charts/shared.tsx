"use client";

import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Piezas comunes de los gráficos: paleta, escalas, marco con título/leyenda/tabla y tooltip.
 * Los gráficos son SVG hecho a mano (sin librería): pesan poco, usan los tokens de la marca
 * y controlamos la accesibilidad (tabla alternativa, teclado, tooltip en hover y foco).
 */

/** Orden categórico fijo (validado): la serie 1 siempre es chart-1. Nunca se reciclan colores. */
export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

/** Color de gráfico de cada red (distinto del color de etiqueta: ver globals.css). */
export const PLATFORM_CHART_COLORS = {
  INSTAGRAM: "var(--color-chart-instagram)",
  YOUTUBE: "var(--color-chart-youtube)",
  TIKTOK: "var(--color-chart-tiktok)",
} as const;

export function seriesColor(index: number, override?: string) {
  if (override) return override;
  if (index >= CHART_COLORS.length) {
    // Más de 5 series no se distinguen: agrúpalas en "Otros" o usa gráficos pequeños por serie.
    if (process.env.NODE_ENV !== "production") console.warn("Gráfico con más de 5 series: agrupa el resto en «Otros».");
    return "var(--color-muted)";
  }
  return CHART_COLORS[index];
}

function niceNumber(range: number, round: boolean) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/** Marcas "redondas" para un eje (0, 2 mil, 4 mil...). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(0, min);
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / Math.max(1, count - 1), true);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export type LegendItem = { key: string; label: string; color: string; shape?: "line" | "rect" };

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={item.shape === "rect" ? "h-2.5 w-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full"}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export type TableData = { columns: string[]; rows: (string | number)[][] };

/** Tabla con los mismos datos del gráfico: la alternativa accesible (y la que se ve con "Ver datos"). */
export function ChartDataTable({ data, caption, visible }: { data: TableData; caption: string; visible: boolean }) {
  return (
    <div className={visible ? "max-h-80 overflow-auto rounded-xl border border-white/10" : "sr-only"}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0">
          <tr>
            {data.columns.map((column, i) => (
              <th key={column} scope="col" className={cn("!py-2", i > 0 && "text-right")}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="!border-b-white/[0.06] !bg-transparent !py-2 !font-medium !text-text">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="!py-2 text-right tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Marco de cada gráfico: título, descripción, leyenda (con 2+ series) y el botón "Ver datos"
 * que cambia el gráfico por su tabla. La tabla siempre existe para lectores de pantalla.
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  actions,
  children,
  className,
  bare = false,
}: {
  title?: string;
  description?: string;
  legend?: LegendItem[];
  table: TableData;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Sin tarjeta alrededor (cuando el gráfico ya está dentro de una sección). */
  bare?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  return (
    <figure className={cn("m-0 min-w-0", !bare && "card p-5", className)} aria-labelledby={title ? titleId : undefined}>
      {(title || description) && (
        <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && (
              <h3 id={titleId} className="text-sm font-semibold text-white">
                {title}
              </h3>
            )}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted transition hover:bg-white/5 hover:text-white"
            >
              {showTable ? <BarChart3 aria-hidden className="h-3.5 w-3.5" /> : <Table2 aria-hidden className="h-3.5 w-3.5" />}
              {showTable ? "Ver gráfico" : "Ver datos"}
            </button>
          </div>
        </figcaption>
      )}
      {legend && legend.length > 1 && !showTable && <Legend items={legend} className="mb-3" />}
      {showTable ? null : children}
      <ChartDataTable data={table} caption={title ?? "Datos del gráfico"} visible={showTable} />
    </figure>
  );
}

export type TooltipRow = { key: string; label: string; value: string; color: string; shape?: "line" | "rect" };

/** Tooltip de gráfico: el valor primero y en blanco, la serie después y apagada. */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  title,
  rows,
}: {
  x: number;
  y: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
}) {
  const flip = x > containerWidth - 190;
  return (
    <div
      aria-hidden
      className="popover pointer-events-none absolute z-20 min-w-36 px-3 py-2.5 text-xs"
      style={{ left: flip ? undefined : x + 14, right: flip ? containerWidth - x + 14 : undefined, top: Math.max(0, y) }}
    >
      <p className="mb-1.5 font-medium text-muted">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              className={row.shape === "rect" ? "h-2.5 w-2.5 flex-none rounded-[3px]" : "h-0.5 w-3 flex-none rounded-full"}
              style={{ background: row.color }}
            />
            <span className="font-semibold text-white tabular-nums">{row.value}</span>
            <span className="truncate text-muted">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Texto de los ejes: cifras de ancho fijo, color apagado. */
export const axisTextProps = {
  fill: "var(--color-placeholder)",
  fontSize: 11,
  style: { fontVariantNumeric: "tabular-nums" as const },
};
