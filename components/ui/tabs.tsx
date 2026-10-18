"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rovingIndex } from "./hooks";

export type TabItem<V extends string = string> = {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Número a la derecha de la etiqueta (ej. cantidad de piezas). */
  count?: number;
  disabled?: boolean;
  /** Contenido del panel. Si ninguna pestaña lo trae, solo se dibuja la barra (útil cuando cada pestaña es una ruta o un filtro). */
  content?: ReactNode;
};

/**
 * Pestañas accesibles (patrón WAI-ARIA): una sola pestaña entra en el orden de tabulación,
 * las flechas cambian de pestaña, Inicio/Fin van a la primera y la última.
 * Controlada (`value` + `onValueChange`) o no controlada (`defaultValue`).
 */
export function Tabs<V extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
  panelClassName,
}: {
  items: TabItem<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Nombre del grupo para lectores de pantalla. */
  label: string;
  className?: string;
  panelClassName?: string;
}) {
  const id = useId();
  const [internal, setInternal] = useState<V | undefined>(defaultValue ?? items.find((i) => !i.disabled)?.value);
  const selected = value ?? internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasPanels = items.some((item) => item.content !== undefined);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === selected));

  function select(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    if (value === undefined) setInternal(item.value);
    onValueChange?.(item.value);
    refs.current[index]?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-white/10">
        {items.map((item, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={active}
              aria-controls={hasPanels ? `${id}-panel-${i}` : undefined}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(i)}
              onKeyDown={(event) => {
                const next = rovingIndex(event, i, items.length, { isDisabled: (n) => !!items[n].disabled });
                if (next == null) return;
                event.preventDefault();
                select(next);
              }}
              className={cn(
                "relative -mb-px inline-flex flex-none items-center gap-2 rounded-t-lg px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-45",
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
                active ? "text-white after:bg-accent-hi" : "text-muted after:bg-transparent hover:text-white",
              )}
            >
              {item.icon && <span aria-hidden className={active ? "text-accent-hi" : ""}>{item.icon}</span>}
              {item.label}
              {item.count != null && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                    active ? "bg-accent/25 text-accent-glow" : "bg-white/[0.06] text-muted",
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hasPanels &&
        items.map((item, i) => (
          <div
            key={item.value}
            role="tabpanel"
            id={`${id}-panel-${i}`}
            aria-labelledby={`${id}-tab-${i}`}
            hidden={i !== selectedIndex}
            tabIndex={0}
            className={cn("pt-5 focus-visible:outline-offset-4", panelClassName)}
          >
            {i === selectedIndex && item.content}
          </div>
        ))}
    </div>
  );
}

export type SegmentOption<V extends string = string> = {
  value: V;
  label: string;
  icon?: ReactNode;
  /** Muestra solo el icono; la etiqueta queda para lectores de pantalla. */
  iconOnly?: boolean;
  disabled?: boolean;
};

/**
 * Control segmentado para elegir una vista ("Tabla" / "Cuadrícula").
 * Semántica de grupo de opciones (radiogroup): Tab entra a la opción elegida y las flechas cambian la opción.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  size = "md",
  className,
}: {
  options: SegmentOption<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [internal, setInternal] = useState<V | undefined>(defaultValue ?? options[0]?.value);
  const selected = value ?? internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === selected));

  function select(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (value === undefined) setInternal(option.value);
    onValueChange?.(option.value);
    refs.current[index]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("segmented", className)}>
      {options.map((option, i) => {
        const active = i === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.iconOnly ? option.label : undefined}
            title={option.iconOnly ? option.label : undefined}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            onClick={() => select(i)}
            onKeyDown={(event) => {
              const next = rovingIndex(event, i, options.length, { orientation: "both", isDisabled: (n) => !!options[n].disabled });
              if (next == null) return;
              event.preventDefault();
              select(next);
            }}
            className={cn("segmented-item disabled:cursor-not-allowed disabled:opacity-45", size === "md" && "px-3.5 py-2 text-sm")}
          >
            {option.icon && <span aria-hidden>{option.icon}</span>}
            {!option.iconOnly && option.label}
          </button>
        );
      })}
    </div>
  );
}
