import Link from "next/link";
import { CheckCircle2, CircleDashed, Clock3, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { ReportMonthOption } from "@/lib/dal/reports";
import { monthLabel } from "@/lib/reports/month";

function status(m: ReportMonthOption): { label: string; icon: React.ReactNode } {
  if (m.report?.sentAt) return { label: `Enviado ${formatDate(m.report.sentAt, { withYear: false })}`, icon: <Send className="h-3.5 w-3.5 text-success" aria-hidden /> };
  if (m.report && !m.report.partial) return { label: "Listo", icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> };
  if (m.current) return { label: m.report ? "Avance del mes en curso" : "Mes en curso", icon: <Clock3 className="h-3.5 w-3.5 text-accent-hi" aria-hidden /> };
  if (m.report?.partial) return { label: "Avance (falta rehacerlo)", icon: <Clock3 className="h-3.5 w-3.5 text-warning" aria-hidden /> };
  return { label: "Sin generar", icon: <CircleDashed className="h-3.5 w-3.5 text-placeholder" aria-hidden /> };
}

/** Lista de meses: en pantallas grandes, una columna; en el teléfono, una fila que se desliza. */
export function MonthList({ months, selected }: { months: ReportMonthOption[]; selected: string }) {
  return (
    <nav aria-label="Meses" className="card min-w-0 p-2 lg:self-start">
      <p className="eyebrow hidden px-3 pt-2 pb-3 lg:block">Meses</p>
      <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {months.map((m) => {
          const s = status(m);
          const active = m.month === selected;
          return (
            <li key={m.month} className="flex-none lg:flex-auto">
              <Link
                href={`/inicio/informes?mes=${m.month}`}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition",
                  active ? "border-line-strong bg-accent/12 text-white" : "border-transparent text-text hover:bg-white/[0.04]",
                )}
              >
                <span className="text-sm font-semibold whitespace-nowrap">{monthLabel(m.month)}</span>
                <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
                  {s.icon}
                  {s.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
