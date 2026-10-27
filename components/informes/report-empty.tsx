import { FileText, Plug } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { addMonths, monthLabel } from "@/lib/reports/month";
import { GenerateReportButton } from "./report-actions";

/** Mes sin informe: qué trae y el botón para generarlo. */
export function ReportEmpty({ month, current, canEdit, connected = true, isOwner = false }: { month: string; current: boolean; canEdit: boolean; connected?: boolean; isOwner?: boolean }) {
  const label = monthLabel(month, { lower: true });
  // Sin redes no hay cifras: un informe vacío no le sirve a nadie. Primero, conectar.
  if (!connected) {
    return (
      <EmptyState
        icon={<Plug className="h-6 w-6" aria-hidden />}
        title="Conecta tus redes para tu primer informe"
        description={
          isOwner
            ? "El informe se arma con las cifras de Instagram, YouTube y TikTok. Conecta al menos una red y en cuanto lleguen tus números puedes generarlo."
            : "El informe se arma con las cifras de Instagram, YouTube y TikTok. Cuando el dueño de la cuenta conecte al menos una red, aquí puedes generarlo."
        }
        action={
          isOwner ? (
            <ButtonLink href="/ajustes" icon={<Plug className="h-4 w-4" aria-hidden />}>
              Conectar mis redes
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
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
