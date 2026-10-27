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
