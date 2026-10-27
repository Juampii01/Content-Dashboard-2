"use client";

import { cloneElement, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Ayuda corta al pasar el mouse o enfocar con teclado. Enlazada con aria-describedby al elemento.
 * El hijo debe ser un único elemento enfocable (botón, enlace). Escape la oculta.
 * No pongas información esencial solo aquí: en pantallas táctiles no hay hover.
 */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  function show(delay: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }
  function hide() {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(event) => event.pointerType === "mouse" && show(250)}
      onPointerLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          hide();
        }
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "popover pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-snug font-medium text-text transition-opacity duration-150",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          open ? "opacity-100" : "invisible opacity-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}
