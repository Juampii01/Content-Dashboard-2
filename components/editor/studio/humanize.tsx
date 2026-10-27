"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Traductor de los textos del director (ids internos → frases citadas y tiempos) para los paneles de la revisión.
 * Sin proveedor, deja el texto tal cual (los paneles se siguen usando fuera del Estudio).
 */
const HumanizeContext = createContext<(text: string) => string>((t) => t);

export function HumanizeProvider({ value, children }: { value: (text: string) => string; children: ReactNode }) {
  return <HumanizeContext.Provider value={value}>{children}</HumanizeContext.Provider>;
}

export function useHumanize(): (text: string | null | undefined) => string {
  const fn = useContext(HumanizeContext);
  return (text) => (text ? fn(text) : "");
}
