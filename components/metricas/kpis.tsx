import { KpiCard } from "@/components/ui/stat";
import type { PeriodTotals } from "@/lib/dal/metrics";

/** Indicadores del periodo contra el periodo anterior de la misma duración. */
export function Kpis({ current, previous }: { current: PeriodTotals; previous: PeriodTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      <KpiCard label="Visualizaciones" value={current.views} previous={previous.views} format="compact" />
      <KpiCard label="Seguidores netos" value={current.followersNet} previous={previous.followersNet} format="number" />
      <KpiCard label="Tasa de interacción" value={current.engagementRate} previous={previous.engagementRate} format="percent" />
      <KpiCard label="Guardados y compartidos (c/ 1,000 views)" value={current.savesSharesPer1k == null ? null : Math.round(current.savesSharesPer1k * 10) / 10} previous={previous.savesSharesPer1k} format="number" />
      <KpiCard label="Tiempo medio visto" value={current.avgWatchSec} previous={previous.avgWatchSec} format="duration" />
      <KpiCard label="Piezas publicadas" value={current.pieces} previous={previous.pieces} format="number" />
    </div>
  );
}
