"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Botones al pie (ej. "Cancelar" / "Guardar"). */
  footer?: ReactNode;
  /** Cerrar al hacer clic en el fondo. Desactívalo en formularios largos para no perder lo escrito. */
  dismissOnBackdrop?: boolean;
  className?: string;
};

/**
 * Base común de Dialog y Sheet sobre el <dialog> nativo con showModal():
 * el navegador se encarga de la capa superior, el fondo inerte y la trampa de foco.
 * Aquí sumamos: título y descripción enlazados, cierre con Escape y con clic en el fondo,
 * bloqueo del scroll de la página y devolución del foco al elemento que lo abrió.
 */
function ModalBase({ open, onOpenChange, title, description, children, footer, dismissOnBackdrop = true, className, variant }: ModalProps & { variant: "dialog" | "sheet" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  // Cierre hecho por el propio componente al desmontarse: no debe avisar al padre (en modo estricto
  // React desmonta y vuelve a montar, y un diálogo que arranca abierto se cerraba solo).
  const closingInternally = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  const titleId = useId();
  const descId = useId();

  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Si el componente se desmonta abierto, se cierra igual para no dejar la página bloqueada.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) {
        closingInternally.current = true;
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      data-lock-scroll=""
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(variant === "sheet" ? "sheet" : "dialog", className)}
      onClose={() => {
        // Escape, form method="dialog" o close(): siempre se sincroniza el estado y vuelve el foco.
        if (closingInternally.current) {
          closingInternally.current = false;
          return;
        }
        if (open) onOpenChangeRef.current(false);
        const target = returnFocus.current;
        returnFocus.current = null;
        if (target?.isConnected) requestAnimationFrame(() => target.focus());
      }}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // El clic cuenta como "fuera" solo si empezó y terminó en el fondo (no al arrastrar para seleccionar texto).
        if (dismissOnBackdrop && pressStartedOnBackdrop.current && event.target === event.currentTarget) {
          onOpenChange(false);
        }
        pressStartedOnBackdrop.current = false;
      }}
    >
      {open && (
        <div className={cn("flex max-h-[inherit] flex-col", variant === "sheet" && "h-full")}>
          <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-sm leading-relaxed text-muted">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
              className="-mt-1 -mr-2 grid h-9 w-9 flex-none place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>}
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Diálogo centrado para confirmar o completar una acción corta. */
export function Dialog(props: ModalProps) {
  return <ModalBase {...props} variant="dialog" />;
}

/** Panel lateral (desde la derecha) para ver el detalle de una pieza sin salir de la lista. */
export function Sheet(props: ModalProps) {
  return <ModalBase {...props} variant="sheet" />;
}
