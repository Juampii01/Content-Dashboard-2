import type { ReactNode } from "react";
import { Check, Hammer } from "lucide-react";

/**
 * Vista temporal de un módulo que todavía no está construido.
 * Explica qué va a hacer, sin datos inventados. Se reemplaza cuando llega su etapa (CLAUDE.md §7).
 */
export function ModulePreview({
  icon,
  title,
  description,
  features,
  stage,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  features: string[];
  stage: number;
  action?: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-8 p-6 sm:p-8 md:flex-row">
        <div className="flex-1">
          <div className="tile-icon mb-4 h-12 w-12">{icon}</div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
          <span className="pill mt-5 !border-warning/40 !bg-warning/10 !text-warning">
            <Hammer className="h-3.5 w-3.5" />
            En construcción · etapa {stage}
          </span>
          {action && <div className="mt-6">{action}</div>}
        </div>
        <ul className="stagger flex flex-1 flex-col gap-2.5">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
              <Check className="mt-0.5 h-4 w-4 flex-none text-accent-hi" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
