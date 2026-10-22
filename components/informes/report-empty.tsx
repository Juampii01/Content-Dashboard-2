import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { addMonths, monthLabel } from "@/lib/reports/month";
import { GenerateReportButton } from "./report-actions";

/** Mes sin informe: qué trae y el botón para generarlo. */
export function ReportEmpty({ month, current, canEdit }: { month: string; current: boolean; canEdit: boolean }) {
  const label = monthLabel(month, { lower: true });
  return (
    <EmptyState
      icon={<FileText className="h-6 w-6" aria-hidden />}
      title={current ? `Avance de ${label}` : `Informe de ${label}`}
      description={
        current
          ? `El mes sigue en curso: puedes generar un avance con los datos de hoy. El informe completo se prepara solo el 1 de ${monthLabel(addMonths(month, 1), { lower: true, withYear: false })}.`
          : "Cifras de cada red contra el mes anterior, tus 5 mejores piezas, la que menos funcionó, tu constancia y un resumen con IA. Tarda menos de un minuto."
      }
      action={
        canEdit ? (
          <GenerateReportButton month={month} label={current ? "Generar avance" : "Generar informe"} />
        ) : (
          <p className="text-sm text-muted">Tu usuario es de solo lectura: pídele a un editor que lo genere.</p>
        )
      }
    />
  );
}
