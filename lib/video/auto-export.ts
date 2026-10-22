import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { reviewFromPlan } from "./auto-review";
import { loadProject, startRender, VideoError } from "./service";
import type { EditPlan, VideoFormat } from "./types";

/**
 * "Hazlo por mí" (y "Exportar directo" de los clips): el proyecto se exporta solo apenas está el plan, sin pasar por la
 * revisión. El plan ya trae todo lo que hace falta: cortes seguros, gancho, gráficos y b-roll (si se pidió),
 * subtítulos, sonido de estudio, efectos y música de los valores por defecto del editor (ver lib/video/defaults.ts).
 *
 * Una sola regla para todos: `video_projects.auto_export`. La ruta del plan del worker llama a `maybeAutoExport`.
 * El proyecto queda igual de editable después: "Revisar y volver a exportar" lo devuelve a la revisión.
 */

/**
 * Exporta ya un proyecto que está en revisión. Si no se puede (por ejemplo, el plan cortó todo), queda en revisión y se
 * avisa en la campana y por correo: la persona lo exporta desde el Editor. Devuelve si arrancó el render.
 */
export async function autoExportProject(projectId: string, userId: string | null): Promise<boolean> {
  const project = await loadProject(projectId);
  if (!project || project.status !== "AWAITING_REVIEW" || !project.plan) return false;
  const plan = project.plan as EditPlan;
  try {
    await startRender(projectId, reviewFromPlan(plan, { keepHook: project.origin !== "clip" }), (project.format === "16:9" ? "16:9" : "9:16") as VideoFormat, userId ?? project.createdBy);
    return true;
  } catch (error) {
    const reason = error instanceof VideoError ? error.message : "algo falló al empezar la exportación";
    console.error("[editor] exportación automática:", error instanceof Error ? error.message : error);
    // Queda en revisión con el motivo a la vista (la pantalla deja de esperar el render).
    await getDb()
      .update(schema.videoProjects)
      .set({ errorMessage: `No pudimos exportarlo solo: ${reason}`.slice(0, 500) })
      .where(eq(schema.videoProjects.id, projectId));
    await notify({
      key: `auto-export:${projectId}:${project.updatedAt.getTime()}`,
      userId: userId ?? project.createdBy,
      tone: "error",
      title: "Tu video quedó para revisar",
      body: `"${project.title}" no se pudo exportar solo: ${reason.replace(/\.$/, "")}. Ábrelo, revisa la propuesta y expórtalo.`,
      href: `/editor/${projectId}`,
      email: true,
    });
    return false;
  }
}

/** Lo llama la ruta del plan del worker: si el proyecto tiene "Hazlo por mí", se exporta apenas está el plan. */
export async function maybeAutoExport(projectId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (project?.autoExport && project.status === "AWAITING_REVIEW") await autoExportProject(projectId, null);
}

/** Enciende o apaga "Hazlo por mí" en un proyecto. Si ya está en revisión y se enciende, se exporta ya. */
export async function setAutoExport(projectId: string, on: boolean, userId: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new VideoError("No encontramos ese proyecto.");
  if (project.status === "RENDERING" || project.status === "DONE") throw new VideoError("Este video ya se está exportando.");
  await getDb().update(schema.videoProjects).set({ autoExport: on }).where(eq(schema.videoProjects.id, projectId));
  if (on && project.status === "AWAITING_REVIEW") await autoExportProject(projectId, userId);
}
