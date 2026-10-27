"use client";

import { Heatmap } from "@/components/ui/charts";
import { formatCompact } from "@/lib/format";

export function PostingHeatmap({ values, pieces }: { values: number[][]; pieces: number }) {
  return (
    <Heatmap
      title="Cuándo rinde mejor lo que publicas"
      description={`Mediana de visualizaciones por día y hora de publicación · ${pieces} piezas de los últimos 6 meses.`}
      metricLabel="Visualizaciones (mediana)"
      values={values}
      valueFormat={formatCompact}
    />
  );
}
