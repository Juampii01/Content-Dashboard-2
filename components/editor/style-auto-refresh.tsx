"use client";

import { useAutoRefresh } from "./use-auto-refresh";

/** Mientras el estilo se analiza, la página se actualiza sola. */
export function StyleAutoRefresh() {
  useAutoRefresh(true);
  return null;
}
