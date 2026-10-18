import { OutlierBadge } from "@/components/ui/badges";
import { MediaThumbCard } from "@/components/ui/media-thumb-card";
import { formatCompact, formatDate } from "@/lib/format";
import type { ContentRow } from "@/lib/dal/metrics";
import { aspectFor } from "@/lib/metrics/labels";

const layouts = {
  full: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  compact: "grid-cols-2 md:grid-cols-4",
};

export function ContentGrid({ rows, layout = "full" }: { rows: ContentRow[]; layout?: keyof typeof layouts }) {
  return (
    <ul className={`grid gap-4 ${layouts[layout]}`}>
      {rows.map((row) => (
        <li key={row.id}>
          <MediaThumbCard
            src={row.thumbnail}
            title={row.title}
            aspect={aspectFor(row.platform, row.type) === "16:9" ? "16:9" : "9:16"}
            platform={row.platform}
            metric={row.views != null ? { value: formatCompact(row.views), label: "visualizaciones" } : undefined}
            duration={row.durationSec}
            badge={row.perfScore != null && row.perfScore >= 1.5 ? <OutlierBadge ratio={row.perfScore} /> : undefined}
            meta={formatDate(row.publishedAt)}
            href={`/metricas/${row.id}`}
          />
        </li>
      ))}
    </ul>
  );
}
