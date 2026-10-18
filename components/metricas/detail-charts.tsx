"use client";

import { LineChart } from "@/components/ui/charts";
import { formatDate, formatPercent } from "@/lib/format";

export function GrowthChart({ points }: { points: { day: string; views: number | null }[] }) {
  return (
    <LineChart
      title="Cómo crecieron las visualizaciones"
      description="Una foto por día desde que la pieza se empezó a medir."
      labels={points.map((p) => formatDate(p.day, { withYear: false }))}
      fullLabels={points.map((p) => formatDate(p.day))}
      series={[{ key: "views", label: "Visualizaciones", values: points.map((p) => p.views) }]}
      area
      height={220}
    />
  );
}

export function RetentionChart({ points }: { points: { at: number; ratio: number }[] }) {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  return (
    <LineChart
      title="Retención"
      description="Qué parte del público sigue mirando en cada punto del video."
      labels={sorted.map((p) => `${Math.round(p.at * 100)} %`)}
      series={[{ key: "ret", label: "Siguen mirando", values: sorted.map((p) => Math.round(p.ratio * 1000) / 10) }]}
      valueFormat={(v) => formatPercent(v)}
      axisFormat={(v) => `${Math.round(v)} %`}
      area
      height={220}
    />
  );
}
