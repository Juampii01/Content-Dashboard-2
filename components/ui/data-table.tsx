"use client";

import { useMemo, useState } from "react";
import { DataTableView, sortRows, type DataTableViewProps, type SortState } from "./data-table-view";

export type { DataTableColumn, SortDirection, SortState } from "./data-table-view";
export { sortRows } from "./data-table-view";

/**
 * Tabla de datos para componentes cliente.
 * - Orden controlado: pasa `sort` + `onSortChange` (ej. para guardarlo en la URL con router.replace).
 * - Orden no controlado: pasa `defaultSort` (o nada) y la tabla lo maneja sola.
 * - `manualSorting`: las filas ya vienen ordenadas (desde el servidor o la base); la tabla no las reordena.
 * Para Server Components usa <DataTableView> con `sortHref`.
 */
export function DataTable<T>({
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  manualSorting = false,
  rows,
  columns,
  ...rest
}: Omit<DataTableViewProps<T>, "sortHref" | "onSortClick"> & {
  defaultSort?: SortState;
  onSortChange?: (sort: SortState) => void;
  manualSorting?: boolean;
}) {
  const [internal, setInternal] = useState<SortState>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : internal;

  const sorted = useMemo(() => (manualSorting ? rows : sortRows(rows, columns, sort)), [manualSorting, rows, columns, sort]);

  return (
    <DataTableView
      {...rest}
      columns={columns}
      rows={sorted}
      sort={sort}
      onSortClick={(key, direction) => {
        const next = { key, direction };
        if (sortProp === undefined) setInternal(next);
        onSortChange?.(next);
      }}
    />
  );
}
