"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateRange, toDate, toISODate } from "@/lib/format";
import { rovingIndex, useClickOutside } from "./hooks";

export type DatePreset = "7d" | "28d" | "90d" | "365d" | "month" | "custom";

/** Rango de fechas en formato de <input type="date"> ("2026-10-12"), ambos extremos incluidos. */
export type DateRangeValue = { preset: DatePreset; from: string; to: string };

export const DATE_PRESETS: { value: Exclude<DatePreset, "custom">; label: string }[] = [
  { value: "7d", label: "Últimos 7 días" },
  { value: "28d", label: "Últimos 28 días" },
  { value: "90d", label: "Últimos 90 días" },
  { value: "365d", label: "Últimos 12 meses" },
  { value: "month", label: "Este mes" },
];

/**
 * Calcula el rango de un preset a partir de "hoy". Es una función pura para poder usarla
 * también en el servidor (ej. al leer `?rango=28d` de la URL).
 */
export function resolveDatePreset(preset: Exclude<DatePreset, "custom">, today: Date): DateRangeValue {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  if (preset === "month") start.setDate(1);
  else start.setDate(end.getDate() - (Number.parseInt(preset, 10) - 1));
  return { preset, from: toISODate(start), to: toISODate(end) };
}

function presetLabel(preset: DatePreset) {
  return DATE_PRESETS.find((p) => p.value === preset)?.label ?? "Personalizado";
}

/**
 * Selector de rango de fechas: presets en filas (lo que más se usa) y, abajo, un rango personalizado
 * con <input type="date"> nativos. Sin librerías de calendario.
 * Controlado: el padre guarda el valor (y puede sincronizarlo con la URL).
 */
export function DateRangePicker({
  value,
  onChange,
  today,
  label = "Rango de fechas",
  align = "start",
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Fecha de referencia para los presets. Por defecto, el día actual del navegador al elegir. */
  today?: Date;
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ from: value.from, to: value.to });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const fromDate = toDate(custom.from);
  const toDateValue = toDate(custom.to);
  const customError =
    !fromDate || !toDateValue ? "Elige las dos fechas." : fromDate > toDateValue ? "La fecha de inicio debe ser anterior a la final." : null;

  const allOptions = [...DATE_PRESETS.map((p) => p.value), "custom" as const];
  const selectedIndex = Math.max(0, allOptions.indexOf(value.preset));

  function openPanel() {
    setCustom({ from: value.from, to: value.to });
    setOpen(true);
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useClickOutside([rootRef], () => setOpen(false), open);

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-block", className)}
      onBlur={(event) => {
        // Si el foco sale con Tab hacia otro elemento de la página, el panel se cierra.
        const next = event.relatedTarget as Node | null;
        if (open && next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="field flex !w-auto items-center gap-2.5 !py-2 text-left text-sm"
      >
        <CalendarDays aria-hidden className="h-4 w-4 flex-none text-accent-hi" />
        <span className="sr-only">{label}: </span>
        <span className="font-semibold text-white">{presetLabel(value.preset)}</span>
        <span className="hidden text-muted sm:inline">{formatDateRange(value.from, value.to)}</span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 flex-none text-muted transition", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label={label}
          className={cn("popover absolute z-40 mt-2 w-72 animate-pop-in p-1.5", align === "end" ? "right-0" : "left-0")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div role="radiogroup" aria-label="Periodo">
            {allOptions.map((preset, i) => {
              const checked = value.preset === preset;
              return (
                <button
                  key={preset}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={i === selectedIndex ? 0 : -1}
                  className="menu-item justify-between"
                  onKeyDown={(event) => {
                    const next = rovingIndex(event, i, allOptions.length, { orientation: "vertical" });
                    if (next == null) return;
                    event.preventDefault();
                    optionRefs.current[next]?.focus();
                  }}
                  onClick={() => {
                    if (preset === "custom") {
                      requestAnimationFrame(() => document.getElementById(`${id}-from`)?.focus());
                      return;
                    }
                    onChange(resolveDatePreset(preset, today ?? new Date()));
                    close();
                  }}
                >
                  <span className={cn(checked && "font-semibold text-white")}>{presetLabel(preset)}</span>
                  {checked && <Check aria-hidden strokeWidth={3} className="h-4 w-4 text-accent-hi" />}
                </button>
              );
            })}
          </div>

          <form
            className="mt-1.5 border-t border-white/10 px-2.5 pt-3 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (customError) return;
              onChange({ preset: "custom", from: custom.from, to: custom.to });
              close();
            }}
          >
            <p className="mb-2 text-xs font-semibold text-muted">Rango personalizado</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-placeholder">
                Desde
                <input
                  id={`${id}-from`}
                  type="date"
                  value={custom.from}
                  max={custom.to || undefined}
                  onChange={(event) => setCustom((c) => ({ ...c, from: event.target.value }))}
                  className="field !px-2.5 !py-1.5 text-sm [color-scheme:dark]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-placeholder">
                Hasta
                <input
                  type="date"
                  value={custom.to}
                  min={custom.from || undefined}
                  onChange={(event) => setCustom((c) => ({ ...c, to: event.target.value }))}
                  className="field !px-2.5 !py-1.5 text-sm [color-scheme:dark]"
                />
              </label>
            </div>
            {customError && (custom.from || custom.to) ? (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {customError}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">{formatDateRange(custom.from, custom.to)}</p>
            )}
            <button type="submit" disabled={!!customError} className="btn mt-3 w-full !py-2 !text-xs">
              Aplicar rango
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
