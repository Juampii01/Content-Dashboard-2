import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, Sparkles } from "lucide-react";
import { Section } from "@/components/ui/card";
import type { WeeklyReportContent } from "@/lib/db/schema";
import { formatDateRange } from "@/lib/format";
import { addDays } from "@/lib/metrics/params";
import { GenerateReportButton } from "./generate-report-button";

/** Resumen de la semana pasada, escrito por la IA con los números reales. */
export function WeeklyReport({
  report,
  expectedWeek,
  canGenerate,
}: {
  report: { weekStart: string; content: WeeklyReportContent } | null;
  expectedWeek: string;
  canGenerate: boolean;
}) {
  const stale = !report || report.weekStart < expectedWeek;
  const action = canGenerate && stale ? <GenerateReportButton label={report ? "Resumir la semana pasada" : "Generar resumen"} /> : null;

  if (!report) {
    return (
      <Section title="Resumen de la semana" description="Cada lunes la IA lee tus números y te dice qué funcionó, qué vigilar y qué publicar." actions={action}>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Sparkles className="h-4 w-4 text-accent-hi" aria-hidden />
          {canGenerate ? "Todavía no hay resumen. Se genera solo el lunes, o puedes generarlo ahora." : "El primer resumen aparece el lunes."}
        </p>
      </Section>
    );
  }

  const { content, weekStart } = report;
  return (
    <Section title={`Resumen de la semana · ${formatDateRange(weekStart, addDays(weekStart, 6))}`} actions={action}>
      <p className="mb-5 text-lg font-semibold leading-snug text-white">{content.headline}</p>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_1.2fr]">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">Lo que funcionó</h3>
          <ul className="space-y-2">
            {content.wins.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-text/90">
                <CircleCheck className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">A vigilar</h3>
          <ul className="space-y-2">
            {content.watch.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-text/90">
                <CircleAlert className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">Para esta semana</h3>
          <ul className="space-y-2">
            {content.nextWeek.map((idea, i) => (
              <li key={i}>
                <Link
                  href={`/guiones/nuevo?idea=${encodeURIComponent(`${idea.title}. Gancho: ${idea.hook}`)}`}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-white/10 p-3 transition hover:border-line-strong hover:bg-white/[0.03]"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{idea.title}</span>
                    <span className="mt-0.5 block text-sm text-text/90">“{idea.hook}”</span>
                    <span className="mt-0.5 block text-xs text-muted">{idea.why}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 flex-none text-accent-hi opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-label="Escribir guion" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
