"use client";

import { Check } from "lucide-react";

export type StepState = "done" | "active" | "pending";

/**
 * Ruta de pasos para flujos largos (crear clon, editar video, crear carrusel).
 * Vertical en pantallas grandes, fila con scroll en pantallas chicas.
 */
export function Steps({
  steps,
  onSelect,
}: {
  steps: { id: string; label: string; state: StepState }[];
  onSelect?: (id: string) => void;
}) {
  return (
    <ol className="step-list" aria-label="Pasos">
      {steps.map((step, i) => (
        <li key={step.id} className="step-item" data-done={step.state === "done"}>
          <button
            type="button"
            className="step"
            data-state={step.state}
            aria-current={step.state === "active" ? "step" : undefined}
            disabled={step.state === "pending"}
            onClick={() => onSelect?.(step.id)}
          >
            <span className="step-node">{step.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            {step.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
