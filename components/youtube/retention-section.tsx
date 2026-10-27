import { aiConfigured } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth";
import { getRetentionView } from "@/lib/dal/youtube";
import { RetentionPanel, type RetentionPanelData } from "./retention-panel";

/** "Dónde se fue la gente" en el detalle de una pieza. Va dentro de un <Suspense> (lee la sesión). */
export async function RetentionSection({ id }: { id: string }) {
  const [view, user] = await Promise.all([getRetentionView(id), getCurrentUser()]);
  if (!view) return null;
  // Las fechas viajan como texto al componente de cliente.
  const data = JSON.parse(JSON.stringify(view)) as RetentionPanelData;
  return <RetentionPanel data={data} canEdit={user.role !== "VIEWER"} aiReady={aiConfigured()} />;
}
