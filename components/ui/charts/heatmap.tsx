"use client";

import { useState, type KeyboardEvent } from "react";
import { formatNumber } from "@/lib/format";
import { ChartFrame } from "./shared";

export const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WEEKDAY_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function hourRange(h: number) {
  return `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
}

/** Escala secuencial de un solo tono (azul): lo bajo se funde con la superficie, lo alto brilla. */
function cellColor(t: number) {
  if (t <= 0) return "rgba(255, 255, 255, 0.035)";
  const alpha = 0.12 + 0.88 * Math.min(1, t);
  return `rgba(77, 163, 255, ${alpha.toFixed(3)})`;
}

/**
 * Mapa de calor 7 × 24: en qué día y hora rinde mejor el contenido.
 * Filas de lunes a domingo, columnas de 0 a 23 h. Con el gráfico enfocado, las flechas recorren
 * las celdas y el tooltip muestra el valor. La tabla tiene todos los números.
 */
export function Heatmap({
  values,
  title,
  description,
  metricLabel = "Valor",
  valueFormat = formatNumber,
  bare,
  className,
}: {
  /** 7 filas (lunes primero) × 24 columnas (hora local). */
  values: number[][];
  title?: string;
  description?: string;
  metricLabel?: string;
  valueFormat?: (value: number) => string;
  bare?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...values.flat());

  const table = {
    columns: ["Día", ...Array.from({ length: 24 }, (_, h) => `${h} h`)],
    rows: values.map((row, d) => [WEEKDAY_FULL[d], ...row.map((v) => valueFormat(v))]),
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const cur = active ?? { d: 0, h: 0 };
    const moves: Record<string, { d: number; h: number }> = {
      ArrowRight: { d: cur.d, h: Math.min(23, cur.h + 1) },
      ArrowLeft: { d: cur.d, h: Math.max(0, cur.h - 1) },
      ArrowDown: { d: Math.min(6, cur.d + 1), h: cur.h },
      ArrowUp: { d: Math.max(0, cur.d - 1), h: cur.h },
      Home: { d: cur.d, h: 0 },
      End: { d: cur.d, h: 23 },
    };
    if (event.key === "Escape") return setActive(null);
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    setActive(next);
  }

  // Posición del tooltip en porcentaje de la grilla, para no medir el DOM.
  const tip = active
    ? {
        left: `calc(40px + (100% - 40px) * ${(active.h + 0.5) / 24})`,
        // Filas de arriba: el tooltip va debajo de la celda para no salirse del área con scroll.
        top: active.d < 3 ? `${(active.d + 1) * 26 + 4}px` : `${active.d * 26 - 4}px`,
        below: active.d < 3,
        flip: active.h > 15,
      }
    : null;

  return (
    <ChartFrame title={title} description={description} table={table} bare={bare} className={className}>
      <div className="-mx-1 overflow-x-auto px-1 pt-1 pb-1">
        <div
          className="relative min-w-[560px] outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-accent-hi"
          tabIndex={0}
          role="img"
          aria-label={`${title ?? "Mapa de calor por día y hora"}. Usa las flechas para recorrer las celdas; la tabla de datos tiene el detalle.`}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((a) => a ?? { d: 0, h: 0 })}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <div aria-hidden className="grid gap-[2px]" style={{ gridTemplateColumns: "38px repeat(24, minmax(0, 1fr))" }}>
            {values.map((row, d) => (
              <div key={d} className="contents">
                <span className="flex h-6 items-center text-[11px] text-placeholder">{WEEKDAY_LABELS[d]}</span>
                {row.map((v, h) => {
                  const isActive = active?.d === d && active.h === h;
                  return (
                    <span
                      key={h}
                      onPointerEnter={() => setActive({ d, h })}
                      className="h-6 rounded-[4px] transition-[box-shadow]"
                      style={{
                        background: cellColor(v / max),
                        boxShadow: isActive ? "0 0 0 2px var(--color-chart-surface), 0 0 0 3px var(--color-text)" : undefined,
                      }}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="pt-1 text-center text-[10px] text-placeholder tabular-nums">
                {h % 3 === 0 ? h : ""}
              </span>
            ))}
          </div>

          {active && tip && (
            <div
              aria-hidden
              className="popover pointer-events-none absolute z-20 min-w-40 px-3 py-2 text-xs"
              style={{
                left: tip.left,
                top: tip.top,
                transform: `translate(${tip.flip ? "calc(-100% - 10px)" : "10px"}, ${tip.below ? "0" : "-100%"})`,
              }}
            >
              <p className="mb-1 font-medium whitespace-nowrap text-muted">
                {WEEKDAY_FULL[active.d]} · {hourRange(active.h)}
              </p>
              <p>
                <span className="font-semibold text-white tabular-nums">{valueFormat(values[active.d][active.h])}</span>{" "}
                <span className="text-muted">{metricLabel.toLowerCase()}</span>
              </p>
            </div>
          )}
        </div>
      </div>
      <div aria-hidden className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-placeholder">
        <span className="mr-1">Menos</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className="h-3 w-5 rounded-[3px]" style={{ background: cellColor(t === 0 ? 0.0001 : t) }} />
        ))}
        <span className="ml-1">Más</span>
      </div>
    </ChartFrame>
  );
}
