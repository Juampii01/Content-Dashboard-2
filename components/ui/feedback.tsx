import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("pill", className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Barra de progreso de un trabajo en curso. */
export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex justify-between text-xs text-muted">
          <span>{label}</span>
          <span className="font-mono">{pct}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="bar-shine h-full rounded-full bg-accent-hi transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  info: "border-accent/40 bg-accent/10 text-accent-glow",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

/** Aviso dentro de una página (no flotante). */
export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-0.5", "text-text/90")}>{children}</div>
    </div>
  );
}
