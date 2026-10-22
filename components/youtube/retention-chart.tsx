"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartFrame, ChartTooltip, axisTextProps, niceTicks } from "@/components/ui/charts/shared";
import { useElementWidth } from "@/components/ui/hooks";
import { formatDuration, formatPercent } from "@/lib/format";
import type { RetentionDrop, RetentionPoint } from "@/lib/youtube/types";

const MARGIN = { top: 26, right: 14, bottom: 28, left: 44 };

/**
 * Curva de retención con las caídas fuertes marcadas (franja y número). Mismo estilo que los gráficos de Métricas
 * (SVG propio, cuadrícula fina, tooltip, teclado y tabla de datos), con la línea en el color de YouTube.
 */
export function RetentionDropsChart({ points, drops, durationSec, height = 260 }: { points: RetentionPoint[]; drops: RetentionDrop[]; durationSec: number | null; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const n = sorted.length;
  const values = sorted.map((p) => p.ratio * 100);
  const ticks = niceTicks(0, Math.max(100, ...values), 5);
  const yMax = ticks[ticks.length - 1]!;
  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const x = (at: number) => MARGIN.left + at * innerW;
  const y = (v: number) => MARGIN.top + innerH - (v / (yMax || 1)) * innerH;
  const label = (at: number) => (durationSec ? formatDuration(at * durationSec) : `${Math.round(at * 100)} %`);

  const line = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.ratio * 100).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(sorted[n - 1]!.at).toFixed(1)},${y(0)}L${x(sorted[0]!.at).toFixed(1)},${y(0)}Z` : "";
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const color = "var(--color-chart-youtube)";

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = (event.clientX - rect.left) / rect.width;
    let best = 0;
    sorted.forEach((p, i) => {
      if (Math.abs(p.at - at) < Math.abs(sorted[best]!.at - at)) best = i;
    });
    setActive(best);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!n) return;
    const current = active ?? 0;
    if (event.key === "ArrowRight") setActive(Math.min(n - 1, current + 1));
    else if (event.key === "ArrowLeft") setActive(Math.max(0, current - 1));
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  }

  const table = {
    columns: ["Momento del video", "Siguen mirando"],
    rows: sorted.map((p) => [label(p.at), formatPercent(p.ratio * 100)]),
  };
  const ap = active != null ? sorted[active] : null;

  return (
    <ChartFrame
      title="Curva de retención"
      description={`Qué parte del público sigue mirando en cada momento. En rojo, donde más gente se fue${drops.length ? "" : " (este video no tiene caídas fuertes)"}.`}
      table={table}
    >
      <div
        ref={ref}
        className="relative outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent-hi"
        tabIndex={0}
        role="img"
        aria-label={`Curva de retención con ${drops.length} caídas marcadas. Usa las flechas para recorrer los valores; la tabla de datos tiene el detalle.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="ret-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--color-chart-axis)" : "var(--color-chart-grid)"} shapeRendering="crispEdges" />
              <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" {...axisTextProps}>
                {t} %
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} {...axisTextProps}>
              {label(t)}
            </text>
          ))}
          {drops.map((d, i) => {
            const x0 = x(d.fromAt);
            const w = Math.max(6, x(d.toAt) - x0);
            return (
              <g key={i}>
                <rect x={x0} y={MARGIN.top} width={w} height={innerH} fill="var(--color-danger)" opacity={0.14} />
                <line x1={x0} x2={x0} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--color-danger)" strokeOpacity={0.55} strokeDasharray="3 3" />
                <circle cx={x0 + w / 2} cy={MARGIN.top - 12} r={9} fill="var(--color-danger)" />
                <text x={x0 + w / 2} y={MARGIN.top - 12} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={700} fill="#1a0505">
                  {i + 1}
                </text>
              </g>
            );
          })}
          <path d={area} fill="url(#ret-area)" />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {ap && (
            <>
              <line x1={x(ap.at)} x2={x(ap.at)} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--color-chart-axis)" shapeRendering="crispEdges" />
              <circle cx={x(ap.at)} cy={y(ap.ratio * 100)} r={4} fill={color} stroke="var(--color-chart-surface)" strokeWidth={2} />
            </>
          )}
          <rect x={MARGIN.left} y={MARGIN.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)} />
        </svg>
        {ap && (
          <ChartTooltip
            x={x(ap.at)}
            y={y(ap.ratio * 100) - 50}
            containerWidth={width}
            title={durationSec ? `En ${label(ap.at)} (${Math.round(ap.at * 100)} % del video)` : `En el ${label(ap.at)} del video`}
            rows={[{ key: "r", label: "siguen mirando", value: formatPercent(ap.ratio * 100), color }]}
          />
        )}
      </div>
    </ChartFrame>
  );
}
