"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Avisos flotantes. Monta <Toaster /> una vez (en el layout) y llama a
 * `toast.success("Guardado")`, `toast.error("No se pudo guardar")` o `toast.info(...)`
 * desde cualquier componente cliente. Se anuncian con aria-live="polite",
 * se cierran solos (se pausan al pasar el mouse o enfocar) y se muestran como máximo 3 a la vez.
 */

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string; description?: string; duration: number };
type ToastOptions = { description?: string; duration?: number };

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function push(kind: ToastKind, message: string, options?: ToastOptions) {
  const item: ToastItem = {
    id: nextId++,
    kind,
    message,
    description: options?.description,
    // Los errores quedan un poco más: suelen pedir una acción.
    duration: options?.duration ?? (kind === "error" ? DEFAULT_DURATION + 3000 : DEFAULT_DURATION),
  };
  // Si ya hay 3, sale el más viejo.
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export const toast = {
  success: (message: string, options?: ToastOptions) => push("success", message, options),
  error: (message: string, options?: ToastOptions) => push("error", message, options),
  info: (message: string, options?: ToastOptions) => push("info", message, options),
  dismiss,
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const kindMeta: Record<ToastKind, { icon: ReactNode; className: string; srPrefix: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4" />, className: "text-success", srPrefix: "Listo:" },
  error: { icon: <XCircle className="h-4 w-4" />, className: "text-danger", srPrefix: "Error:" },
  info: { icon: <Info className="h-4 w-4" />, className: "text-accent-hi", srPrefix: "Aviso:" },
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Avisos"
      role="region"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {list.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const running = useRef(false);
  const meta = kindMeta[item.kind];

  function start() {
    if (running.current) return;
    running.current = true;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => dismiss(item.id), remaining.current);
  }
  function pause() {
    if (!running.current) return;
    running.current = false;
    window.clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  }

  useEffect(() => {
    start();
    return () => {
      running.current = false;
      window.clearTimeout(timer.current);
    };
    // Solo al montar: el temporizador se maneja con pause/start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="popover pointer-events-auto flex w-full animate-pop-in items-start gap-3 py-3 pr-2 pl-4 sm:w-96"
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <span aria-hidden className={cn("mt-0.5 flex-none", meta.className)}>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          <span className="sr-only">{meta.srPrefix} </span>
          {item.message}
        </p>
        {item.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Cerrar aviso"
        className="grid h-7 w-7 flex-none place-items-center rounded-md text-muted transition hover:bg-white/[0.07] hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
