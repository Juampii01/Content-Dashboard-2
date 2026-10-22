import { DataTableView, type DataTableColumn } from "@/components/ui/data-table-view";
import { OutlierBadge } from "@/components/ui/badges";
import { PlatformBadge } from "@/components/ui/platform";
import { formatDate, formatDuration, formatMultiplier, formatNumber, formatPercent } from "@/lib/format";
import type { ContentRow } from "@/lib/dal/metrics";
import { typeLabel } from "@/lib/metrics/labels";
import { filtersToSearch, type MetricsFilters, type SortKey } from "@/lib/metrics/params";

const dash = <span className="text-muted/60">—</span>;
const n = (v: number | null) => (v == null ? dash : formatNumber(v));

function retention(row: ContentRow) {
  if (row.avgViewPercentage != null) return `${formatPercent(row.avgViewPercentage, { digits: 0 })} visto`;
  if (row.avgWatchSec != null) return `${formatDuration(row.avgWatchSec)} promedio`;
  return null;
}

export function ContentTable({ rows, filters }: { rows: ContentRow[]; filters: MetricsFilters }) {
  const columns: DataTableColumn<ContentRow>[] = [
    {
      key: "pieza",
      header: "Pieza",
      sticky: true,
      width: "340px",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-14 w-10 flex-none overflow-hidden rounded-lg bg-white/5">
            {row.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-sm font-medium text-white">{row.title}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-muted">
              <PlatformBadge platform={row.platform} className="!py-0.5 !text-[11px]" />
              {typeLabel[row.type]}
            </span>
          </span>
        </div>
      ),
    },
    { key: "fecha", header: "Publicada", sortable: true, accessor: (r) => r.publishedAt, cell: (r) => <span className="whitespace-nowrap">{formatDate(r.publishedAt)}</span>, firstDirection: "desc" },
    { key: "views", header: "Visualizaciones", numeric: true, sortable: true, accessor: (r) => r.views, cell: (r) => n(r.views) },
    { key: "alcance", header: "Alcance", numeric: true, sortable: true, accessor: (r) => r.reach, cell: (r) => n(r.reach) },
    { key: "interaccion", header: "Interacción", numeric: true, sortable: true, accessor: (r) => r.engagementRate, cell: (r) => (r.engagementRate == null ? dash : formatPercent(r.engagementRate)) },
    { key: "guardados", header: "Guardados", numeric: true, sortable: true, accessor: (r) => r.saves, cell: (r) => n(r.saves) },
    { key: "compartidos", header: "Compartidos", numeric: true, sortable: true, accessor: (r) => r.shares, cell: (r) => n(r.shares) },
    { key: "retencion", header: "Retención", numeric: true, sortable: true, accessor: (r) => r.avgViewPercentage ?? r.avgWatchSec, cell: (r) => retention(r) ?? dash },
    {
      key: "puntaje",
      header: "Rendimiento",
      numeric: true,
      sortable: true,
      accessor: (r) => r.perfScore,
      cell: (r) => (r.perfScore == null ? dash : r.perfScore >= 1.5 ? <OutlierBadge ratio={r.perfScore} /> : <span className="text-muted">{formatMultiplier(r.perfScore)}</span>),
    },
  ];

  return (
    <DataTableView
      caption="Piezas publicadas en el periodo"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      sort={{ key: filters.sort, direction: filters.dir }}
      sortHref={(key, direction) => `/metricas${filtersToSearch({ ...filters, sort: key as SortKey, dir: direction, page: 1 })}`}
      getRowHref={(r) => `/metricas/${r.id}`}
      getRowLabel={(r) => `Ver detalle: ${r.title}`}
    />
  );
}
