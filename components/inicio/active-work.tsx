import Link from "next/link";
import { ArrowRight, Clapperboard, UserRound } from "lucide-react";
import { Section } from "@/components/ui/card";
import type { ActiveWork as Work } from "@/lib/dal/home";

/** "En curso": videos procesando, renderizando o listos para revisar, y videos con clon generándose. */
export function ActiveWork({ items }: { items: Work[] }) {
  if (items.length === 0) return null;
  return (
    <Section title="En curso" description="Lo que se está procesando. Puedes salir y volver: sigue solo.">
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((w) => (
          <li key={`${w.kind}-${w.id}`}>
            <Link href={w.href} className="card card-lift flex items-center gap-4 p-4">
              <span className="tile-icon h-10 w-10 flex-none">
                {w.kind === "video" ? <Clapperboard className="h-5 w-5" aria-hidden /> : <UserRound className="h-5 w-5" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium text-white">{w.title}</span>
                <span className={w.needsAction ? "text-xs font-semibold text-accent-hi" : "text-xs text-muted"}>{w.label}</span>
                {w.progress != null && (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.progress} aria-label={w.label}>
                    <span className="bar-shine block h-full rounded-full bg-gradient-to-r from-accent to-accent-hi" style={{ width: `${Math.max(3, w.progress)}%` }} />
                  </span>
                )}
              </span>
              <ArrowRight className="h-4 w-4 flex-none text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
