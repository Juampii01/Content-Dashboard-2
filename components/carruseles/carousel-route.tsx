"use client";

import { Check } from "lucide-react";

export type RouteStep = { id: string; label: string; detail: string; done: boolean; optional?: boolean };

/**
 * Ruta del carrusel (la de carrusel-creator-pro: ficha → imágenes → descripción → video → descargar), siempre en fila.
 * Cada paso muestra si está listo y lleva a su sección. El primero que falta queda marcado como el actual.
 */
export function CarouselRoute({ steps, onGo }: { steps: RouteStep[]; onGo: (id: string) => void }) {
  const current = steps.find((s) => !s.done && !s.optional)?.id ?? null;
  return (
    <ol className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1" aria-label="Pasos del carrusel">
      {steps.map((s, i) => {
        const state = s.done ? "done" : s.id === current ? "active" : "pending";
        return (
          <li key={s.id} className="flex-none">
            <button type="button" className="step !w-auto" data-state={state} aria-current={s.id === current ? "step" : undefined} onClick={() => onGo(s.id)}>
              <span className="step-node">{s.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}</span>
              <span className="flex flex-col leading-tight">
                <span>{s.label}</span>
                <span className="text-[11px] font-normal text-muted">{s.detail}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
