import { ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { filtersToSearch, type MetricsFilters } from "@/lib/metrics/params";

export function Pagination({ filters, total, pageSize }: { filters: MetricsFilters; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (filters.page - 1) * pageSize + 1;
  const to = Math.min(total, filters.page * pageSize);
  const href = (page: number) => `/metricas${filtersToSearch({ ...filters, page })}`;
  return (
    <nav aria-label="Páginas" className="flex items-center justify-between gap-3 text-sm text-muted">
      <span>
        {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}
      </span>
      <span className="flex gap-2">
        {filters.page > 1 && (
          <ButtonLink href={href(filters.page - 1)} variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" aria-hidden />} scroll={false}>
            Anterior
          </ButtonLink>
        )}
        {filters.page < pages && (
          <ButtonLink href={href(filters.page + 1)} variant="ghost" size="sm" scroll={false}>
            Siguiente
            <ChevronRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        )}
      </span>
    </nav>
  );
}
