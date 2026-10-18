"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

/** Chip que se prende y se apaga (aria-pressed). */
export function ToggleChip({
  pressed,
  onPressedChange,
  children,
  icon,
  count,
  disabled,
  className,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  /** Icono o punto de color a la izquierda (decorativo: el texto informa). */
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn("chip", className)}
    >
      {icon && <span aria-hidden className="flex items-center">{icon}</span>}
      {children}
      {count != null && <span className="font-mono text-[10px] text-placeholder tabular-nums">{count}</span>}
    </button>
  );
}

export type ChipOption<V extends string = string> = { value: V; label: string; icon?: ReactNode; count?: number; disabled?: boolean };

/**
 * Grupo de chips de selección múltiple (ej. redes o tipos de contenido).
 * Ningún chip elegido equivale a "todos": el botón "Todas" limpia la selección.
 */
export function ChipGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  allLabel = "Todos",
  showLabel = false,
  className,
}: {
  /** Nombre del grupo (ej. "Red"). Se anuncia siempre; se ve solo con `showLabel`. */
  label: string;
  options: ChipOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  /** Texto del chip que limpia la selección. `null` lo oculta. */
  allLabel?: string | null;
  showLabel?: boolean;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span id={labelId} className={showLabel ? "mr-1 text-xs font-semibold text-muted" : "sr-only"}>
        {label}
      </span>
      {allLabel && (
        <ToggleChip pressed={value.length === 0} onPressedChange={() => onChange([])}>
          {allLabel}
        </ToggleChip>
      )}
      {options.map((option) => {
        const pressed = value.includes(option.value);
        return (
          <ToggleChip
            key={option.value}
            pressed={pressed}
            icon={option.icon}
            count={option.count}
            disabled={option.disabled}
            onPressedChange={(next) =>
              onChange(next ? [...value, option.value] : value.filter((v) => v !== option.value))
            }
          >
            {option.label}
          </ToggleChip>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

/**
 * Búsqueda con espera (debounce): avisa `onChange` cuando la persona deja de escribir.
 * El botón de borrar y la tecla Escape limpian al instante.
 * Si `value` cambia desde afuera (ej. "Limpiar filtros" o la URL), el campo se actualiza.
 */
export function SearchInput({
  value = "",
  onChange,
  delay = 300,
  label = "Buscar",
  placeholder = "Buscar…",
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  delay?: number;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [emitted, setEmitted] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincroniza con el valor externo sin efecto (estado derivado del prop anterior).
  // Si el valor nuevo es el eco de lo que ya avisamos, no se pisa lo que la persona siguió escribiendo.
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== emitted) setText(value);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function emit(next: string) {
    window.clearTimeout(timer.current);
    setEmitted(next);
    onChange(next);
  }

  function update(next: string, immediate = false) {
    setText(next);
    window.clearTimeout(timer.current);
    if (immediate) emit(next);
    else timer.current = window.setTimeout(() => emit(next), delay);
  }

  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-placeholder" />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.preventDefault();
            update("", true);
          }
          if (event.key === "Enter") emit(text);
        }}
        className="field !py-2 pr-10 pl-10 text-sm [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => {
            update("", true);
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted transition hover:bg-white/[0.07] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rango numérico                                                      */
/* ------------------------------------------------------------------ */

export type NumericRange = { min: number | null; max: number | null };

/**
 * Filtro por rango de una métrica: mínimo y máximo (ambos opcionales).
 * Avisa `onChange` al salir del campo o con Enter, para no filtrar a cada tecla.
 */
export function RangeFilter({
  label,
  value,
  onChange,
  unit,
  className,
}: {
  /** Ej. "Visualizaciones". */
  label: string;
  value: NumericRange;
  onChange: (value: NumericRange) => void;
  /** Texto corto a la derecha de cada campo (ej. "s" o "%"). */
  unit?: string;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ min: toText(value.min), max: toText(value.max) });
  const [last, setLast] = useState(value);
  if (value.min !== last.min || value.max !== last.max) {
    setLast(value);
    setDraft({ min: toText(value.min), max: toText(value.max) });
  }

  const min = parse(draft.min);
  const max = parse(draft.max);
  const invalid = min != null && max != null && min > max;

  function commit() {
    if (invalid) return;
    if (min !== value.min || max !== value.max) onChange({ min, max });
  }

  const input = (key: "min" | "max", placeholder: string, ariaLabel: string) => (
    <div className="relative flex-1">
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        placeholder={placeholder}
        value={draft[key]}
        onChange={(event) => setDraft((d) => ({ ...d, [key]: event.target.value.replace(/[^\d.,]/g, "") }))}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        className={cn("field !py-2 text-sm tabular-nums", unit && "pr-8", invalid && "!border-danger/70")}
      />
      {unit && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-placeholder">{unit}</span>}
    </div>
  );

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-1.5 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex items-center gap-2">
        {input("min", "Mín.", `${label}: mínimo`)}
        <span aria-hidden className="text-placeholder">–</span>
        {input("max", "Máx.", `${label}: máximo`)}
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          El mínimo no puede ser mayor que el máximo.
        </p>
      )}
    </fieldset>
  );
}

function toText(value: number | null) {
  return value == null ? "" : String(value);
}

/** Acepta "12000", "12,000" o "12.5": la coma se toma como separador de miles y el punto como decimal (es-419). */
function parse(text: string): number | null {
  const clean = text.trim();
  if (!clean) return null;
  const normalized = clean.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
