import Link from "next/link";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { Section } from "@/components/ui/card";
import { PlatformBadge } from "@/components/ui/platform";
import { calendarStatusColor, calendarStatusLabel, plannedFormatLabel } from "@/lib/calendar/labels";
import type { CalendarEntry } from "@/lib/dal/calendar";
import { formatDate } from "@/lib/format";

/** "Lo que viene": las próximas piezas del calendario (7 días), con su estado y sus redes. */
export function Upcoming({ entries, today }: { entries: CalendarEntry[]; today: string }) {
  return (
    <Section
      title="Lo que viene"
      description="Tus próximas piezas de los siguientes 7 días."
      actions={
        <Link href="/calendario" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-hi hover:text-white">
          Ver calendario <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">No tienes nada programado para esta semana.</p>
          <Link href="/calendario" className="btn-ghost inline-flex items-center gap-2 !py-1.5 text-sm">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Planear mi semana
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-white/5">
          {entries.map((e) => (
            <li key={e.id}>
              <Link href={`/calendario?vista=semana&fecha=${e.scheduledDate ?? today}`} className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-3 transition hover:bg-white/[0.03]">
                <span className="w-16 flex-none font-mono text-xs leading-tight text-accent-glow">
                  {e.scheduledDate === today ? "Hoy" : formatDate(e.scheduledDate!, { withYear: false })}
                  {e.scheduledTime ? <span className="block text-placeholder">{e.scheduledTime}</span> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 font-medium text-white">{e.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {plannedFormatLabel[e.format]}
                    {e.targets.map((t) => (
                      <PlatformBadge key={t.platform} platform={t.platform} />
                    ))}
                  </span>
                </span>
                <span className="inline-flex flex-none items-center gap-1.5 text-xs text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: calendarStatusColor[e.status] }} aria-hidden />
                  {calendarStatusLabel[e.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
