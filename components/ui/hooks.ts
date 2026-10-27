"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";

/**
 * Navegación con flechas para grupos de opciones (pestañas, control segmentado, menús).
 * Devuelve el índice destino o `null` si la tecla no corresponde. Salta las opciones deshabilitadas.
 */
export function rovingIndex(
  event: KeyboardEvent,
  current: number,
  count: number,
  options: { orientation?: "horizontal" | "vertical" | "both"; isDisabled?: (index: number) => boolean; loop?: boolean } = {},
): number | null {
  const { orientation = "horizontal", isDisabled = () => false, loop = true } = options;
  const nextKeys = orientation === "vertical" ? ["ArrowDown"] : orientation === "horizontal" ? ["ArrowRight"] : ["ArrowRight", "ArrowDown"];
  const prevKeys = orientation === "vertical" ? ["ArrowUp"] : orientation === "horizontal" ? ["ArrowLeft"] : ["ArrowLeft", "ArrowUp"];

  let step = 0;
  let start = current;
  if (nextKeys.includes(event.key)) step = 1;
  else if (prevKeys.includes(event.key)) step = -1;
  else if (event.key === "Home") {
    step = 1;
    start = -1;
  } else if (event.key === "End") {
    step = -1;
    start = count;
  } else return null;

  for (let i = 1; i <= count; i++) {
    let idx = start + step * i;
    if (loop) idx = (idx + count) % count;
    else if (idx < 0 || idx >= count) return null;
    if (!isDisabled(idx)) return idx;
  }
  return null;
}

/** Cierra una capa flotante al hacer clic fuera de los elementos indicados. */
export function useClickOutside(refs: RefObject<HTMLElement | null>[], onOutside: () => void, enabled: boolean) {
  const handler = useRef(onOutside);
  useLayoutEffect(() => {
    handler.current = onOutside;
  });
  useEffect(() => {
    if (!enabled) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      handler.current();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // Las refs son estables: solo importa si la capa está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Ancho real de un elemento, para que los gráficos dibujen a su tamaño (sin escalar el texto). */
export function useElementWidth<T extends HTMLElement>(fallback = 600): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

/** `true` si la persona pidió menos movimiento en su sistema. En el servidor asume que no. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
