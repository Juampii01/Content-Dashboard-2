import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { buildSystemStatus, type SystemStatus } from "@/lib/system/status";
import { readConnections, readFailedClones, readFailedJobs, readServices, readWorker } from "@/lib/system/queries";

/** Estado del sistema para Ajustes. Solo el dueño: null para el resto del equipo. */
export async function getSystemStatus(): Promise<SystemStatus | null> {
  const user = await getCurrentUser();
  if (user.role !== "OWNER") return null;
  const [worker, failedJobs, failedClones, connections, services] = await Promise.all([readWorker(), readFailedJobs(7), readFailedClones(7), readConnections(), readServices()]);
  return buildSystemStatus({ worker, failedJobs, failedClones, connections, services, now: new Date() });
}
