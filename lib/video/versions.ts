import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { VideoError } from "./errors";
import type { EditPlan } from "./types";
import { studioVersionLabel } from "./version-label";

/**
 * Versiones del plan (tabla video_plan_versions). Antes de que la IA cambie el plan se guarda el que había; volver a una
 * versión también guarda primero la actual. Nada se borra: cualquier versión anterior se puede recuperar.
 */
export type PlanVersionItem = { id: string; label: string; source: string; createdAt: string };

const MAX_LABEL = 160;

/**
 * Guarda el plan actual del video como versión (si hay plan y no es igual a la última versión guardada). La usan el
 * director antes de escribir un plan nuevo y `restoreVersion`.
 */
export async function snapshotPlan(projectId: string, input: { label: string; source: "ia" | "restaurar" | "estudio"; requestId?: string | null; userId?: string | null }): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ plan: schema.videoProjects.plan, format: schema.videoProjects.format }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (!row?.plan) return;
  const [last] = await db.select({ plan: schema.videoPlanVersions.plan }).from(schema.videoPlanVersions).where(eq(schema.videoPlanVersions.projectId, projectId)).orderBy(desc(schema.videoPlanVersions.createdAt)).limit(1);
  if (last && JSON.stringify(last.plan) === JSON.stringify(row.plan)) return;
  await db.insert(schema.videoPlanVersions).values({
    projectId,
    plan: row.plan,
    format: row.format ?? null,
    label: input.label.slice(0, MAX_LABEL),
    source: input.source,
    requestId: input.requestId ?? null,
    createdBy: input.userId ?? null,
  });
}

export async function listVersions(projectId: string): Promise<PlanVersionItem[]> {
  const rows = await getDb()
    .select({ id: schema.videoPlanVersions.id, label: schema.videoPlanVersions.label, source: schema.videoPlanVersions.source, createdAt: schema.videoPlanVersions.createdAt })
    .from(schema.videoPlanVersions)
    .where(eq(schema.videoPlanVersions.projectId, projectId))
    .orderBy(desc(schema.videoPlanVersions.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Vuelve a una versión. Antes guarda el plan actual como otra versión (así también se puede deshacer la vuelta). */
export async function restoreVersion(projectId: string, versionId: string, userId: string | null): Promise<void> {
  const db = getDb();
  const [project] = await db.select({ status: schema.videoProjects.status }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (!project) throw new VideoError("No encontramos ese video.");
  if (project.status === "PROCESSING" || project.status === "RENDERING") throw new VideoError("La IA o la exportación están trabajando en este video. Espera a que terminen para volver a una versión.");
  const [version] = await db.select().from(schema.videoPlanVersions).where(and(eq(schema.videoPlanVersions.id, versionId), eq(schema.videoPlanVersions.projectId, projectId))).limit(1);
  if (!version) throw new VideoError("No encontramos esa versión.");
  const when = new Intl.DateTimeFormat("es-419", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: env().APP_TIMEZONE }).format(version.createdAt);
  await snapshotPlan(projectId, { label: `Antes de volver a la versión del ${when}`, source: "restaurar", userId });
  await db
    .update(schema.videoProjects)
    .set({ plan: version.plan as Record<string, unknown>, ...(version.format === "9:16" || version.format === "16:9" ? { format: version.format } : {}) })
    .where(eq(schema.videoProjects.id, projectId));
}

/**
 * Cambios a mano en el Estudio: el guardado automático corre cada vez que la persona deja de tocar (1,2 s), así que no
 * se guarda una versión por cada arrastre. Antes de escribir, se guarda el plan que había si la última versión del
 * video no es una del Estudio de hace menos de STUDIO_VERSION_EVERY_MS (una por tanda de trabajo). Después de un
 * cambio de la IA o de volver a una versión, la tanda siguiente guarda una nueva.
 *
 * `checkpoint`: un cambio grande que no conviene mezclar con la tanda (por ejemplo, la animación que reemplaza el chat):
 * se guarda siempre, con esa etiqueta.
 */
export const STUDIO_VERSION_EVERY_MS = 10 * 60 * 1000;

export async function snapshotBeforeStudioSave(projectId: string, input: { current: EditPlan; next: EditPlan; userId: string | null; checkpoint?: string | null; now?: Date }): Promise<boolean> {
  if (JSON.stringify(input.current) === JSON.stringify(input.next)) return false;
  if (input.checkpoint) {
    await snapshotPlan(projectId, { label: input.checkpoint, source: "estudio", userId: input.userId });
    return true;
  }
  const [last] = await getDb()
    .select({ source: schema.videoPlanVersions.source, createdAt: schema.videoPlanVersions.createdAt })
    .from(schema.videoPlanVersions)
    .where(eq(schema.videoPlanVersions.projectId, projectId))
    .orderBy(desc(schema.videoPlanVersions.createdAt))
    .limit(1);
  const now = (input.now ?? new Date()).getTime();
  if (last && last.source === "estudio" && now - last.createdAt.getTime() < STUDIO_VERSION_EVERY_MS) return false;
  await snapshotPlan(projectId, { label: studioVersionLabel(input.current, input.next), source: "estudio", userId: input.userId });
  return true;
}
