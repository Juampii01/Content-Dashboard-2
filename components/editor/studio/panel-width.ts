"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Ancho de un panel lateral del Estudio que se arrastra desde su borde y se recuerda en este navegador. `side` dice de
 * qué lado está el panel: el izquierdo crece al arrastrar hacia la derecha y el derecho, hacia la izquierda.
 */
export type PanelLimits = { min: number; max: number; default: number };

function store(key: string, limits: PanelLimits) {
  const clamp = (w: number) => Math.round(Math.min(limits.max, Math.max(limits.min, w)));
  const read = (): number => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved ? clamp(saved) : limits.default;
    } catch {
      return limits.default;
    }
  };
  const write = (w: number) => {
    try {
      localStorage.setItem(key, String(clamp(w)));
    } catch {
      // Sin almacenamiento local, el ancho dura lo que dura la página.
    }
    window.dispatchEvent(new Event(key));
  };
  const subscribe = (cb: () => void) => {
    window.addEventListener(key, cb);
    return () => window.removeEventListener(key, cb);
  };
  return { clamp, read, write, subscribe };
}

const stores = new Map<string, ReturnType<typeof store>>();
function storeFor(key: string, limits: PanelLimits) {
  let s = stores.get(key);
  if (!s) {
    s = store(key, limits);
    stores.set(key, s);
  }
  return s;
}

export function usePanelWidth(key: string, limits: PanelLimits, side: "left" | "right") {
  const s = storeFor(key, limits);
  const stored = useSyncExternalStore(s.subscribe, s.read, () => limits.default);
  const [drag, setDrag] = useState<number | null>(null);
  const width = drag ?? stored;
  const save = useCallback(
    (w: number) => {
      s.write(w);
      setDrag(null);
    },
    [s],
  );
  const sign = side === "left" ? 1 : -1;
  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDrag(s.clamp(startW + sign * (ev.clientX - startX)));
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      save(startW + sign * (ev.clientX - startX));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  /** Props del borde para arrastrar (también con flechas y doble clic para volver al ancho de siempre). */
  const handle = {
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    "aria-valuemin": limits.min,
    "aria-valuemax": limits.max,
    "aria-valuenow": width,
    tabIndex: 0,
    title: "Arrastra para cambiar el ancho (doble clic: ancho de siempre)",
    onPointerDown,
    onDoubleClick: () => save(limits.default),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") save(width - sign * 24);
      else if (e.key === "ArrowRight") save(width + sign * 24);
    },
  };
  return { width, handle };
}

/** Clases del borde para arrastrar (una línea fina que se ilumina al pasar el mouse). */
export const HANDLE_CLASS =
  "absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none lg:block after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition hover:after:bg-accent/60 focus-visible:outline-none focus-visible:after:bg-accent";
