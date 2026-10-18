"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { useElementWidth } from "../hooks";

/**
 * Tendencia mínima para tarjetas de métricas: sin ejes ni tooltip, solo la forma.
 * El punto final marca el periodo actual. Lleva nombre accesible propio porque no tiene tabla.
 */
export function Sparkline({
  values,
  label,
  color = "var(--color-accent-hi)",
  height = 36,
  area = true,
  className,
}: {
  values: (number | null)[];
  /** Ej. "Visualizaciones de los últimos 28 días, en subida". */
  label: string;
  color?: string;
  height?: number;
  area?: boolean;
  className?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(120);
  const gradientId = useId();
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);

  if (points.length < 2) return <div ref={ref} className={cn("w-full", className)} style={{ height }} />;

  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2);
  const line = points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const first = points[0];

  return (
    <div ref={ref} role="img" aria-label={label} className={cn("w-full", className)}>
      <svg width={width} height={height} className="block overflow-visible" aria-hidden>
        {area && (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={`${line}L${x(last.i)},${height}L${x(first.i)},${height}Z`} fill={`url(#${gradientId})`} />
          </>
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={color} stroke="var(--color-chart-surface)" strokeWidth={2} />
      </svg>
    </div>
  );
}
