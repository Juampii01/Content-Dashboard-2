import type { Metadata } from "next";
import { Suspense } from "react";
import { FileText, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { MonthList } from "@/components/informes/month-list";
import { ReportPreview } from "@/components/informes/report-preview";
import { ReportEmpty } from "@/components/informes/report-empty";
import { getCurrentUser } from "@/lib/auth";
import { getReport, getReportSettings, listReportMonths } from "@/lib/dal/reports";
import { isMonth } from "@/lib/reports/month";

export const metadata: Metadata = { title: "Informe mensual" };
// Generar el informe (cifras + resumen con IA + PDF) puede tardar más que una acción normal.
export const maxDuration = 120;

async function Reports({ searchParams }: { searchParams: PageProps<"/inicio/informes">["searchParams"] }) {
  const params = await searchParams;
  const [months, user, settings] = await Promise.all([listReportMonths(), getCurrentUser(), getReportSettings()]);
  const requested = typeof params.mes === "string" && isMonth(params.mes) ? params.mes : null;
  // Por defecto, el último mes cerrado (el que se manda el día 1); si no hay, el mes en curso.
  const selected = months.find((m) => m.month === requested) ?? months.find((m) => !m.current) ?? months[0]!;
  const report = await getReport(selected.month);
  const canEdit = user.role !== "VIEWER";

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <MonthList months={months} selected={selected.month} />
      <div className="min-w-0">
        {report ? (
          <ReportPreview report={report} canEdit={canEdit} recipients={settings.recipients} emailConfigured={settings.emailConfigured} />
        ) : (
          <ReportEmpty month={selected.month} current={selected.current} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Skeleton className="h-72" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function InformesPage({ searchParams }: PageProps<"/inicio/informes">) {
  return (
    <>
      <PageHeader
        eyebrow="Inicio · Informes"
        title="Informe mensual"
        description="Tu mes completo en un PDF con tu marca: cifras de cada red, tus mejores piezas, tu constancia y un resumen con IA. Listo para tu equipo o tus sponsors."
        icon={<FileText className="h-5 w-5" aria-hidden />}
        actions={
          <ButtonLink href="/ajustes#informes" variant="ghost" icon={<Settings2 className="h-4 w-4" aria-hidden />}>
            Destinatarios y envío
          </ButtonLink>
        }
      />
      <Suspense fallback={<ReportsSkeleton />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}
