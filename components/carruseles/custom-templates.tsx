"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TemplateSpec } from "@/lib/carousels/template-spec";

/**
 * Plantillas propias disponibles en la pantalla (id → nombre y spec). Las páginas las cargan del servidor y las dejan
 * aquí; `Slide` las lee cuando la plantilla de un slide es `custom:<id>`, sin pasar el spec por cada componente.
 */
export type CustomTemplateInfo = { id: string; name: string; spec: TemplateSpec };

const Ctx = createContext<Record<string, CustomTemplateInfo>>({});

export function CustomTemplatesProvider({ templates, children }: { templates: CustomTemplateInfo[]; children: ReactNode }) {
  const map = Object.fromEntries(templates.map((t) => [t.id, t]));
  return <Ctx.Provider value={map}>{children}</Ctx.Provider>;
}

export function useCustomTemplate(id: string | null): CustomTemplateInfo | null {
  const map = useContext(Ctx);
  return id ? (map[id] ?? null) : null;
}

export function useCustomTemplates(): CustomTemplateInfo[] {
  return Object.values(useContext(Ctx));
}
