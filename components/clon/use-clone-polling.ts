"use client";

import { useEffect, useMemo, useState } from "react";
import type { CloneVideoItem } from "@/lib/dal/clone";
import { isInProgress } from "@/lib/heygen/labels";
import { pollCloneVideosAction } from "./actions";

const INTERVAL_MS = 10_000;

/**
 * Polling de respaldo del webhook: mientras haya videos en curso en pantalla, cada ~10 s le pide al servidor
 * que los revise en HeyGen y trae su estado nuevo. Se pausa con la pestaña oculta y se detiene cuando no queda nada en curso.
 */
export function useClonePolling(initial: CloneVideoItem[]): CloneVideoItem[] {
  const [updates, setUpdates] = useState<Record<string, CloneVideoItem>>({});
  const items = useMemo(() => initial.map((item) => updates[item.id] ?? item), [initial, updates]);
  const pendingKey = items
    .filter((item) => isInProgress(item.status))
    .map((item) => item.id)
    .join(",");

  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    let cancelled = false;
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const res = await pollCloneVideosAction(ids);
        if (!cancelled && res.ok) {
          setUpdates((prev) => {
            const next = { ...prev };
            for (const item of res.data) next[item.id] = item;
            return next;
          });
        }
      } catch {
        // Sin conexión: se vuelve a intentar en el próximo ciclo.
      } finally {
        running = false;
      }
    };
    const first = setTimeout(tick, 1500);
    const timer = setInterval(tick, INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pendingKey]);

  return items;
}
