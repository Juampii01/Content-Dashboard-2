"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatCompact, formatNumber } from "@/lib/format";
import { useElementWidth } from "../hooks";
import { axisTextProps, ChartFrame, ChartTooltip, niceTicks, seriesColor } from "./shared";

export type LineSeries = {
  key: string;
  label: string;
  /** Un valor por etiqueta del eje X. `null` corta la línea (día sin datos). */
  values: (number | null)[];
  /** Color explícito (ej. PLATFORM_CHART_COLORS.INSTAGRAM). Por defecto, el orden categórico fijo. */
  color?: string;
};

export type LineChartProps = {
  /** Etiquetas del eje X ya formateadas (ej. "12 oct"). */
  labels: string[];
  series: LineSeries[];
  title?: string;
  description?: string;
  /** Pinta un velo suave bajo cada línea (gráfico de área). */
  area?: boolean;
  height?: number;
  /** Formato de valores en tooltip y tabla. */
  valueFormat?: (value: number) => string;
  /** Formato del eje Y. */
  axisFormat?: (value: number) => string;
  /** Etiquetas largas para tooltip y tabla (ej. "12 oct 2026"); por defecto, `labels`. */
  fullLabels?: string[];
  bare?: boolean;
  className?: string;
};

const MARGIN = { top: 10, right: 14, bottom: 28, left: 48 };

/**
 * Evolución en el tiempo, una o varias series en un solo eje.
 * Línea de 2 px, punto final con anillo, cuadrícula fina. Al pasar el mouse (o con las flechas
 * tras enfocar el gráfico) una guía vertical marca el día y el tooltip lista todas las series.
 */
export function LineChart({
  labels,
  series,
  title,
  description,
  area = false,
  height = 240,
  valueFormat = formatNumber,
  axisFormat = formatCompact,
  fullLabels,
  bare,
  className,
}: LineChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  const colored = series.map((s, i) => ({ ...s, color: seriesColor(i, s.color) }));
  const all = colored.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all), height < 160 ? 3 : 5);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const n = labels.length;
  const x = (i: number) => MARGIN.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => MARGIN.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const maxLabels = Math.max(2, Math.floor(innerW / 84));
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  function pathFor(values: (number | null)[]) {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  function areaFor(values: (number | null)[]) {
    // Un tramo de área por cada segmento continuo.
    const segments: number[][] = [];
    let current: number[] = [];
    values.forEach((v, i) => {
      if (v == null) {
        if (current.length) segments.push(current);
        current = [];
      } else current.push(i);
    });
    if (current.length) segments.push(current);
    const base = y(Math.max(0, yMin));
    return segments
      .map((seg) => {
        const top = seg.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`).join("");
        return `${top}L${x(seg[seg.length - 1]).toFixed(1)},${base}L${x(seg[0]).toFixed(1)},${base}Z`;
      })
      .join("");
  }

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const index = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, index)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!n) return;
    const current = active ?? n - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(n - 1, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") setActive(null);
    if (next != null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const tableLabels = fullLabels ?? labels;
  const table = {
    columns: ["Fecha", ...colored.map((s) => s.label)],
    rows: labels.map((_, i) => [tableLabels[i], ...colored.map((s) => (s.values[i] == null ? "—" : valueFormat(s.values[i] as number)))]),
  };

  const activeX = active != null ? x(active) : 0;
  const tooltipY = active != null ? Math.min(...colored.map((s) => (s.values[active] != null ? y(s.values[active] as number) : innerH))) - 10 : 0;

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={colored.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
      table={table}
      bare={bare}
      className={className}
    >
      <div
        ref={containerRef}
        className="relative outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent-hi"
        tabIndex={0}
        role="img"
        aria-label={`${title ?? "Gráfico de líneas"}. Usa las flechas para recorrer los valores; la tabla de datos tiene el detalle.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          {area && (
            <defs>
              {colored.map((s, i) => (
                <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={colored.length > 1 ? 0.09 : 0.2} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
          )}

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + innerW}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? "var(--color-chart-axis)" : "var(--color-chart-grid)"}
                shapeRendering="crispEdges"
              />
              <text x={MARGIN.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" {...axisTextProps}>
                {axisFormat(tick)}
              </text>
            </g>
          ))}

          {labels.map((label, i) =>
            i % labelStep === 0 || (i === n - 1 && (n - 1) % labelStep > labelStep / 2) ? (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} {...axisTextProps}>
                {label}
              </text>
            ) : null,
          )}

          {area && colored.map((s, i) => <path key={`a-${s.key}`} d={areaFor(s.values)} fill={`url(#${gradientId}-${i})`} />)}

          {colored.map((s) => (
            <path key={s.key} d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {active != null && (
            <line x1={activeX} x2={activeX} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--color-chart-axis)" shapeRendering="crispEdges" />
          )}

          {colored.map((s) => {
            const index = active ?? lastIndex(s.values);
            const v = index != null ? s.values[index] : null;
            if (index == null || v == null) return null;
            return (
              <circle
                key={`dot-${s.key}`}
                cx={x(index)}
                cy={y(v)}
                r={4}
                fill={s.color}
                stroke="var(--color-chart-surface)"
                strokeWidth={2}
              />
            );
          })}

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {active != null && (
          <ChartTooltip
            x={activeX}
            y={tooltipY - 40}
            containerWidth={width}
            title={tableLabels[active]}
            rows={colored.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.values[active] == null ? "—" : valueFormat(s.values[active] as number),
              color: s.color,
            }))}
          />
        )}
      </div>
    </ChartFrame>
  );
}

function lastIndex(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return null;
}

/** Atajo: LineChart con velo bajo las líneas. */
export function AreaChart(props: Omit<LineChartProps, "area">) {
  return <LineChart {...props} area />;
}
