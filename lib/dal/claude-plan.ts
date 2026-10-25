import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { claudePlanStatus, type ClaudePlanStatus } from "@/lib/ai/claude-plan";
import { getDb, schema } from "@/lib/db";
import { workerStatus } from "@/lib/jobs";

export type ClaudePlanPanelStatus = { isOwner: boolean; claude: ClaudePlanStatus; loginJobId: string | null; workerOnline: boolean; workerAutoStart: boolean };

/** Ajustes → Claves de servicios: la suscripción de Claude conectada (sin el token) y una conexión en curso. */
export async function getClaudePlanStatus(): Promise<ClaudePlanPanelStatus> {
  const me = await getCurrentUser();
  const [claude, worker, login] = await Promise.all([
    claudePlanStatus().catch(() => ({ connected: false, label: null, updatedAt: null })),
    workerStatus(),
    getDb()
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.type, "CLAUDE_LOGIN"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"])))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);
  return { isOwner: me.role === "OWNER", claude, loginJobId: login?.id ?? null, workerOnline: worker.online, workerAutoStart: worker.autoStart };
}
