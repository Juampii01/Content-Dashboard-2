"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { LayoutGrid, Rows3, X } from "lucide-react";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { ChipGroup, RangeFilter, SearchInput } from "@/components/ui/filters";
import { SegmentedControl } from "@/components/ui/tabs";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { typeLabel } from "@/lib/metrics/labels";
import { filtersToSearch, type MetricsFilters, type SortKey } from "@/lib/metrics/params";
import type { ContentType, Platform } from "@/lib/social/types";
import { cn } from "@/lib/utils";

const sortOptions: { value: SortKey; label: string }[] = [
  { value: "fecha", label: "Más recientes" },
  { value: "views", label: "Más visualizaciones" },
  { value: "puntaje", label: "Mejor rendimiento" },
  { value: "interaccion", label: "Más interacción" },
  { value: "guardados", label: "Más guardados" },
  { value: "compartidos", label: "Más compartidos" },
  { value: "retencion", label: "Mejor retención" },
];

/**
 * Barra de filtros de Métricas. Cada cambio actualiza la URL (sin recargar la página):
 * así los filtros se comparten, se guardan como marcador y el botón "atrás" funciona.
 */
export function FiltersBar({ filters, counts }: { filters: MetricsFilters; counts: Partial<Record<Platform, number>> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const update = (patch: Partial<MetricsFilters>) => {
    const next = { ...filters, page: 1, ...patch };
    startTransition(() => router.replace(`${pathname}${filtersToSearch(next)}`, { scroll: false }));
  };

  const available = (Object.keys(counts) as Platform[]).filter((p) => (counts[p] ?? 0) > 0);
  const platformOptions = (["INSTAGRAM", "YOUTUBE", "TIKTOK"] as Platform[])
    .filter((p) => available.includes(p) || filters.platforms.includes(p))
    .map((p) => ({ value: p, label: p === "INSTAGRAM" ? "Instagram" : p === "YOUTUBE" ? "YouTube" : "TikTok", count: counts[p] }));
  const typeOptions = (Object.keys(typeLabel) as ContentType[]).map((t) => ({ value: t, label: typeLabel[t] }));

  const range: DateRangeValue = { preset: filters.preset, from: filters.from, to: filters.to };
  const hasExtra = filters.platforms.length || filters.types.length || filters.q || filters.minViews != null || filters.maxViews != null;

  return (
    <div className={cn("card flex flex-col gap-4 p-4 sm:p-5 transition-opacity", pending && "opacity-70")} aria-busy={pending}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <DateRangePicker value={range} onChange={(v) => update({ preset: v.preset, from: v.from, to: v.to })} />
        <SearchInput value={filters.q} onChange={(q) => update({ q })} label="Buscar en el texto" placeholder="Buscar en el caption o el título…" className="flex-1" />
        <div className="flex items-center gap-2">
          <Select aria-label="Ordenar" value={filters.sort} onChange={(e) => update({ sort: e.target.value as SortKey, dir: "desc" })} className="!w-auto">
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <SegmentedControl
            label="Vista"
            value={filters.view}
            onValueChange={(view) => update({ view, page: filters.page })}
            options={[
              { value: "tabla", label: "Tabla", icon: <Rows3 className="h-4 w-4" aria-hidden />, iconOnly: true },
              { value: "cuadricula", label: "Cuadrícula", icon: <LayoutGrid className="h-4 w-4" aria-hidden />, iconOnly: true },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {platformOptions.length > 1 && (
            <ChipGroup label="Red" showLabel allLabel="Todas" options={platformOptions} value={filters.platforms} onChange={(platforms) => update({ platforms })} />
          )}
          <ChipGroup label="Tipo" showLabel allLabel="Todos" options={typeOptions} value={filters.types} onChange={(types) => update({ types })} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <RangeFilter label="Visualizaciones" value={{ min: filters.minViews, max: filters.maxViews }} onChange={(r) => update({ minViews: r.min, maxViews: r.max })} />
          {hasExtra ? (
            <Button variant="subtle" size="sm" icon={<X className="h-3.5 w-3.5" aria-hidden />} onClick={() => update({ platforms: [], types: [], q: "", minViews: null, maxViews: null })}>
              Limpiar filtros
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
