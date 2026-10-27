import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tabla de datos sin estado: sirve tanto en Server Components como dentro de componentes cliente.
 * - En el servidor: pasa `sort` (leído de la URL) y `sortHref` para que cada encabezado sea un enlace,
 *   y `getRowHref` para que cada fila abra su detalle. Ordena las filas con `sortRows` antes de pasarlas
 *   (o en la base de datos).
 * - En el cliente: usa <DataTable> (data-table.tsx), que agrega orden sin URL y clic en la fila.
 */

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;
type SortValue = string | number | Date | boolean | null | undefined;

export type DataTableColumn<T> = {
  /** Identificador estable de la columna (también la clave de orden en la URL). */
  key: string;
  header: ReactNode;
  /** Valor crudo para ordenar (y para la celda si no hay `cell`). */
  accessor?: (row: T) => SortValue;
  /** Cómo se dibuja la celda. Por defecto, el valor de `accessor`. */
  cell?: (row: T) => ReactNode;
  /** Columna numérica: alineada a la derecha, con cifras de ancho fijo. Ordena de mayor a menor la primera vez. */
  numeric?: boolean;
  sortable?: boolean;
  /** Dirección del primer clic. Por defecto "desc" en columnas numéricas y "asc" en el resto. */
  firstDirection?: SortDirection;
  /** Ancho fijo o mínimo (ej. "120px", "30%"). */
  width?: string;
  className?: string;
  headerClassName?: string;
  /** Fija la columna a la izquierda al desplazar en horizontal (útil para la miniatura o el título). */
  sticky?: boolean;
};

export type DataTableViewProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Título de la tabla para lectores de pantalla. */
  caption: string;
  sort?: SortState;
  /** Modo servidor/URL: el encabezado es un enlace a esta dirección. */
  sortHref?: (key: string, direction: SortDirection) => string;
  /** Modo cliente: el encabezado es un botón. */
  onSortClick?: (key: string, direction: SortDirection) => void;
  /** Cada fila abre esta dirección (la primera celda lleva el enlace y la fila entera es clicable). */
  getRowHref?: (row: T) => string;
  /** Cada fila es clicable y se activa también con Enter. */
  onRowClick?: (row: T) => void;
  /** Nombre accesible del enlace de la fila (con `getRowHref`), ej. "Abrir: título de la pieza". */
  getRowLabel?: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  /** Lo que se muestra cuando no hay filas. */
  empty?: ReactNode;
  /** Altura máxima: activa el scroll vertical con encabezado fijo. */
  maxHeight?: string;
  density?: "comfortable" | "compact";
  className?: string;
};

export function nextSortDirection<T>(column: DataTableColumn<T>, sort: SortState | undefined): SortDirection {
  const first = column.firstDirection ?? (column.numeric ? "desc" : "asc");
  if (!sort || sort.key !== column.key) return first;
  return sort.direction === "asc" ? "desc" : "asc";
}

function compare(a: SortValue, b: SortValue): number {
  // Los vacíos siempre al final, sin importar la dirección.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
}

/** Ordena filas según la columna elegida. Estable y con los valores vacíos al final. Pura: sirve en el servidor. */
export function sortRows<T>(rows: T[], columns: DataTableColumn<T>[], sort: SortState | undefined): T[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column?.accessor) return rows;
  const accessor = column.accessor;
  const factor = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((x, y) => {
      if (x.value == null || y.value == null) return compare(x.value, y.value) || x.index - y.index;
      return compare(x.value, y.value) * factor || x.index - y.index;
    })
    .map((entry) => entry.row);
}

function renderCell<T>(column: DataTableColumn<T>, row: T): ReactNode {
  if (column.cell) return column.cell(row);
  const value = column.accessor?.(row);
  if (value == null) return <span className="text-placeholder">—</span>;
  if (value instanceof Date) return value.toLocaleDateString("es");
  return String(value);
}

const ariaSort = { asc: "ascending", desc: "descending" } as const;

export function DataTableView<T>({
  columns,
  rows,
  getRowId,
  caption,
  sort,
  sortHref,
  onSortClick,
  getRowHref,
  onRowClick,
  getRowLabel,
  loading = false,
  skeletonRows = 6,
  empty,
  maxHeight,
  density = "comfortable",
  className,
}: DataTableViewProps<T>) {
  const pad = density === "compact" ? "!py-2" : "";
  const interactive = Boolean(onRowClick || getRowHref);

  return (
    <div
      className={cn("card overflow-auto overscroll-x-contain !bg-card", className)}
      style={maxHeight ? ({ maxHeight } as CSSProperties) : undefined}
      // Contenedor con scroll: enfocable para poder desplazarse con el teclado.
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="data-table" aria-busy={loading || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key ? sort.direction : null;
              const sortable = column.sortable !== false && !!column.accessor && Boolean(sortHref || onSortClick);
              const direction = nextSortDirection(column, sort);
              const icon = active === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5 text-accent-hi" />
              ) : active === "desc" ? (
                <ArrowDown className="h-3.5 w-3.5 text-accent-hi" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60 group-focus-visible:opacity-60" />
              );
              const inner = (
                <>
                  <span>{column.header}</span>
                  <span aria-hidden>{icon}</span>
                </>
              );
              const triggerClass = cn(
                "group -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:text-white",
                column.numeric && "flex-row-reverse",
                active && "text-white",
              );
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? ariaSort[active] : sortable ? "none" : undefined}
                  style={column.width ? { width: column.width, minWidth: column.width } : undefined}
                  className={cn(
                    pad,
                    column.numeric && "text-right",
                    column.sticky && "sticky left-0 z-20",
                    column.headerClassName,
                  )}
                >
                  {sortable ? (
                    sortHref ? (
                      <Link href={sortHref(column.key, direction)} scroll={false} replace className={triggerClass}>
                        {inner}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => onSortClick?.(column.key, direction)} className={triggerClass}>
                        {inner}
                      </button>
                    )
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, r) => (
                <tr key={`skeleton-${r}`} aria-hidden>
                  {columns.map((column, c) => (
                    <td key={column.key} className={pad}>
                      <div
                        className={cn("skeleton h-4", column.numeric && "ml-auto")}
                        style={{ width: column.numeric ? "3.5rem" : `${55 + ((r * 7 + c * 13) % 40)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows.length === 0
              ? (
                  <tr>
                    <td colSpan={columns.length} className="!border-b-0 !p-0">
                      {empty ?? <p className="px-6 py-14 text-center text-sm text-muted">No hay resultados con estos filtros.</p>}
                    </td>
                  </tr>
                )
              : rows.map((row) => {
                  const href = getRowHref?.(row);
                  const label = getRowLabel?.(row);
                  return (
                    <tr
                      key={getRowId(row)}
                      data-interactive={interactive || undefined}
                      className={href ? "relative" : undefined}
                      tabIndex={onRowClick && !href ? 0 : undefined}
                      onClick={onRowClick && !href ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick && !href
                          ? (event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                    >
                      {columns.map((column, c) => (
                        <td
                          key={column.key}
                          className={cn(
                            pad,
                            column.numeric && "text-right whitespace-nowrap tabular-nums",
                            column.sticky && "sticky left-0 z-[1] bg-card",
                            column.className,
                          )}
                        >
                          {href && c === 0 ? (
                            // Enlace estirado: toda la fila es clicable y hay un solo punto de foco por fila.
                            <Link href={href} aria-label={label} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:shadow-[inset_0_0_0_2px_var(--color-accent-hi)]">
                              {renderCell(column, row)}
                            </Link>
                          ) : (
                            renderCell(column, row)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
        </tbody>
      </table>
    </div>
  );
}
