"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { formatCompact, formatNumber } from "@/lib/format";
import { useElementWidth } from "../hooks";
import { axisTextProps, ChartFrame, ChartTooltip, niceTicks, seriesColor } from "./shared";

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** Color propio de la barra (ej. el de cada red). Por defecto, todas del mismo color: una serie, un color. */
  color?: string;
};

export type BarChartProps = {
  data: BarDatum[];
  title?: string;
  description?: string;
  /** "horizontal" para categorías con nombres largos; "vertical" para periodos (días, semanas). */
  orientation?: "vertical" | "horizontal";
  /** Nombre de la métrica (ej. "Visualizaciones") para tooltip y tabla. */
  metricLabel?: string;
  height?: number;
  valueFormat?: (value: number) => string;
  axisFormat?: (value: number) => string;
  color?: string;
  bare?: boolean;
  className?: string;
};

const MAX_THICKNESS = 24;
const RADIUS = 4;

/** Barra con el extremo de datos redondeado (4 px) y la base recta, creciendo desde una línea base. */
function barPath(x: number, y: number, w: number, h: number, orientation: "vertical" | "horizontal") {
  if (w <= 0 || h <= 0) return "";
  if (orientation === "vertical") {
    const r = Math.min(RADIUS, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  const r = Math.min(RADIUS, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/**
 * Comparación de magnitudes de una sola serie. Barras finas (máx. 24 px) con aire entre ellas.
 * Horizontal: el valor va en la punta de cada barra. Vertical: solo se rotula el máximo; el resto en el tooltip.
 */
export function BarChart({
  data,
  title,
  description,
  orientation = "vertical",
  metricLabel = "Valor",
  height,
  valueFormat = formatNumber,
  axisFormat = formatCompact,
  color,
  bare,
  className,
}: BarChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = data.length;
  const baseColor = seriesColor(0, color);
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const maxIndex = data.findIndex((d) => d.value === maxValue);

  const table = { columns: ["Categoría", metricLabel], rows: data.map((d) => [d.label, valueFormat(d.value)]) };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!n) return;
    const current = active ?? 0;
    const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    const back = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    let next: number | null = null;
    if (event.key === forward) next = Math.min(n - 1, current + 1);
    else if (event.key === back) next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") setActive(null);
    if (next != null) {
      event.preventDefault();
      setActive(next);
    }
  }

  let svg: ReactNode;
  let tooltipPos = { x: 0, y: 0 };

  if (orientation === "vertical") {
    const h = height ?? 240;
    const margin = { top: 22, right: 8, bottom: 28, left: 48 };
    const ticks = niceTicks(0, Math.max(1, maxValue), 5);
    const yMax = ticks[ticks.length - 1];
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = h - margin.top - margin.bottom;
    const band = innerW / Math.max(1, n);
    const thickness = Math.max(2, Math.min(MAX_THICKNESS, band * 0.62));
    const y = (v: number) => margin.top + innerH - (v / yMax) * innerH;
    const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 56))));
    if (active != null) tooltipPos = { x: margin.left + band * active + band / 2, y: y(data[active].value) - 56 };

    svg = (
      <svg width={width} height={h} className="block overflow-visible" aria-hidden>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? "var(--color-chart-axis)" : "var(--color-chart-grid)"}
              shapeRendering="crispEdges"
            />
            <text x={margin.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" {...axisTextProps}>
              {axisFormat(tick)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = margin.left + band * i + band / 2;
          const barH = (d.value / yMax) * innerH;
          const isActive = active === i;
          return (
            <g key={d.key}>
              <path
                d={barPath(cx - thickness / 2, margin.top + innerH - barH, thickness, barH, "vertical")}
                fill={d.color ?? baseColor}
                opacity={active == null || isActive ? 1 : 0.55}
                className="transition-opacity"
              />
              {i % labelStep === 0 && (
                <text x={cx} y={h - 8} textAnchor="middle" {...axisTextProps}>
                  {d.label}
                </text>
              )}
              {i === maxIndex && active == null && maxValue > 0 && (
                <text x={cx} y={y(d.value) - 8} textAnchor="middle" fill="var(--color-text)" fontSize={11} fontWeight={600}>
                  {axisFormat(d.value)}
                </text>
              )}
              {/* Zona de interacción: toda la franja, no solo la barra pintada. */}
              <rect
                x={margin.left + band * i}
                y={margin.top}
                width={band}
                height={innerH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>
    );
  } else {
    const rowH = 34;
    const h = height ?? Math.max(80, n * rowH + 8);
    const labelW = Math.min(160, Math.max(70, width * 0.3));
    const valueW = 64;
    const innerW = Math.max(10, width - labelW - valueW);
    const band = (h - 8) / Math.max(1, n);
    const thickness = Math.max(2, Math.min(MAX_THICKNESS - 6, band * 0.55));
    if (active != null) tooltipPos = { x: labelW + (data[active].value / (maxValue || 1)) * innerW, y: band * active - 4 };

    svg = (
      <svg width={width} height={h} className="block overflow-visible" aria-hidden>
        <line x1={labelW} x2={labelW} y1={0} y2={h - 8} stroke="var(--color-chart-axis)" shapeRendering="crispEdges" />
        {data.map((d, i) => {
          const cy = band * i + band / 2;
          const barW = (d.value / (maxValue || 1)) * innerW;
          const isActive = active === i;
          return (
            <g key={d.key}>
              <text x={labelW - 10} y={cy} dy="0.32em" textAnchor="end" fill="var(--color-muted)" fontSize={12}>
                {truncate(d.label, Math.floor(labelW / 7))}
              </text>
              <path
                d={barPath(labelW, cy - thickness / 2, barW, thickness, "horizontal")}
                fill={d.color ?? baseColor}
                opacity={active == null || isActive ? 1 : 0.55}
                className="transition-opacity"
              />
              <text
                x={labelW + barW + 8}
                y={cy}
                dy="0.32em"
                fill="var(--color-text)"
                fontSize={12}
                fontWeight={600}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {axisFormat(d.value)}
              </text>
              <rect
                x={0}
                y={band * i}
                width={width}
                height={band}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <ChartFrame title={title} description={description} table={table} bare={bare} className={className}>
      <div
        ref={containerRef}
        className="relative outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent-hi"
        tabIndex={0}
        role="img"
        aria-label={`${title ?? "Gráfico de barras"}. Usa las flechas para recorrer las barras; la tabla de datos tiene el detalle.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(null)}
      >
        {svg}
        {active != null && (
          <ChartTooltip
            x={tooltipPos.x}
            y={tooltipPos.y}
            containerWidth={width}
            title={data[active].label}
            rows={[{ key: "v", label: metricLabel, value: valueFormat(data[active].value), color: data[active].color ?? baseColor, shape: "rect" }]}
          />
        )}
      </div>
    </ChartFrame>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}
