import type { ReactNode } from "react";

/**
 * Encabezado de cada pantalla: responde "¿qué es esto y para qué sirve?".
 * Un eyebrow corto, un título, una frase que explica y la acción principal a la derecha.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="hero-panel card mb-8 flex flex-col gap-5 p-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-7">
      {/* El texto pide al menos ~26rem: si las acciones no entran al lado, bajan a su propio renglón. */}
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:basis-[26rem]">
        {icon && <div className="tile-hero">{icon}</div>}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="text-2xl font-bold sm:text-[1.75rem]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-none flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
