"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { TrackSize } from "./studio-timeline";

/** Alto de las pistas de la línea de tiempo, recordado en este navegador (sin almacenamiento: el normal). */
const KEY = "studio.trackSize";

function read(): TrackSize {
  try {
    const v = localStorage.getItem(KEY);
    return v === "s" || v === "l" ? v : "m";
  } catch {
    return "m";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(KEY, cb);
  return () => window.removeEventListener(KEY, cb);
}

export function useTrackSize(): [TrackSize, (v: TrackSize) => void] {
  const size = useSyncExternalStore(subscribe, read, () => "m" as TrackSize);
  const set = useCallback((v: TrackSize) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* no se recuerda */
    }
    window.dispatchEvent(new Event(KEY));
  }, []);
  return [size, set];
}

/** Vista de la línea de tiempo: por tipo (gráficos, efectos, animaciones) o por capas (V2, V3…). Se recuerda. */
const VIEW_KEY = "studio.timelineView";
const readView = (): "tipo" | "capas" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "capas" ? "capas" : "tipo";
  } catch {
    return "tipo";
  }
};
const subscribeView = (cb: () => void) => {
  window.addEventListener(VIEW_KEY, cb);
  return () => window.removeEventListener(VIEW_KEY, cb);
};

export function useTimelineView(): ["tipo" | "capas", (v: "tipo" | "capas") => void] {
  const view = useSyncExternalStore(subscribeView, readView, () => "tipo" as const);
  const set = useCallback((v: "tipo" | "capas") => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* no se recuerda */
    }
    window.dispatchEvent(new Event(VIEW_KEY));
  }, []);
  return [view, set];
}
