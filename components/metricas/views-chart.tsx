"use client";

import { AreaChart, PLATFORM_CHART_COLORS } from "@/components/ui/charts";
import { formatDate } from "@/lib/format";
import type { DailySeries } from "@/lib/dal/metrics";
import type { Platform } from "@/lib/social/types";

const names: Record<Platform, string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };

export function ViewsChart({ data }: { data: DailySeries }) {
  const platforms = Object.keys(data.byPlatform) as Platform[];
  return (
    <AreaChart
      title="Visualizaciones por día"
      description="Total diario de cada red en el periodo elegido."
      labels={data.days.map((d) => formatDate(d, { withYear: false }))}
      fullLabels={data.days.map((d) => formatDate(d))}
      series={platforms.map((p) => ({ key: p, label: names[p], values: data.byPlatform[p]!, color: PLATFORM_CHART_COLORS[p] }))}
      height={260}
    />
  );
}
