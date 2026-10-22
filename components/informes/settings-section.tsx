import { getReportSettings } from "@/lib/dal/reports";
import { ReportSettingsPanel } from "./settings-panel";

/** Ajustes → Informe mensual: destinatarios y envío automático. */
export async function ReportSettingsSection() {
  const settings = await getReportSettings();
  return <ReportSettingsPanel settings={settings} />;
}

export function ReportSettingsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="skeleton h-24" />
      <div className="skeleton h-10 w-2/3" />
    </div>
  );
}
