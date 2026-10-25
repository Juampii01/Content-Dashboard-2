import { getClaudePlanStatus } from "@/lib/dal/claude-plan";
import { ClaudePlanPanel } from "./claude-plan-panel";

/** Ajustes → Claves de servicios: tu suscripción de Claude para las animaciones del Editor. */
export async function ClaudePlanSection() {
  const status = await getClaudePlanStatus();
  return <ClaudePlanPanel status={status} />;
}
