"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rovingIndex, useClickOutside } from "./hooks";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      /** Atajo o dato a la derecha (ej. "⌘K"). */
      hint?: string;
      onSelect: () => void;
      disabled?: boolean;
      /** Acción destructiva (ej. "Eliminar"). */
      danger?: boolean;
    }
  | { type: "separator" };

/**
 * Menú desplegable (patrón WAI-ARIA "menu button").
 * Enter/Espacio/↓ abren y enfocan la primera opción; ↑ abre en la última; flechas, Inicio y Fin navegan;
 * Escape cierra y devuelve el foco al botón; Tab o un clic fuera cierran.
 */
export function DropdownMenu({
  trigger,
  items,
  label,
  align = "start",
  className,
}: {
  /** Contenido del botón. Si solo es un icono, pasa `label` para el nombre accesible. */
  trigger: ReactNode;
  items: MenuItem[];
  /** Nombre accesible del botón cuando el disparador no tiene texto. */
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const actionable = items.map((item, i) => (item.type !== "separator" && !item.disabled ? i : -1)).filter((i) => i >= 0);

  function focusItem(index: number | undefined) {
    if (index == null) return;
    requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }

  function openMenu(focus: "first" | "last") {
    setOpen(true);
    focusItem(focus === "first" ? actionable[0] : actionable[actionable.length - 1]);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  useClickOutside([rootRef], () => setOpen(false), open);

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        className="btn-ghost !px-3 !py-2"
        onClick={() => (open ? close() : openMenu("first"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu("last");
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          className={cn("popover absolute z-40 mt-2 min-w-60 animate-pop-in p-1.5", align === "end" ? "right-0" : "left-0")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            if (event.key === "Tab") {
              setOpen(false);
              return;
            }
            const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);
            const position = actionable.indexOf(currentIndex);
            const next = rovingIndex(event, position, actionable.length, { orientation: "vertical" });
            if (next == null) return;
            event.preventDefault();
            itemRefs.current[actionable[next]]?.focus();
          }}
        >
          {items.map((item, i) =>
            item.type === "separator" ? (
              <div key={`sep-${i}`} role="separator" className="my-1.5 h-px bg-white/10" />
            ) : (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                className={cn("menu-item", item.danger && "text-danger hover:!text-danger focus-visible:!text-danger")}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <span aria-hidden className={cn("flex-none", item.danger ? "text-danger" : "text-muted")}>{item.icon}</span>}
                <span className="flex-1 whitespace-nowrap">{item.label}</span>
                {item.hint && <span className="font-mono text-[11px] text-placeholder">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
