"use server";

import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { ComposRequestError, startStudioRequest } from "@/lib/video/compos/flows";
import { composStatus, type ComposStatus } from "@/lib/video/compos/service";
import { loadProject } from "@/lib/video/service";

/**
 * Animaciones a medida en el Estudio: "Pide una animación aquí" (sobre un tramo, con texto libre) y "Pídele un cambio a
 * esta animación". El pedido lo hace el worker con la IA (trabajo VIDEO_COMPOS) sin sacar el video de la revisión; el
 * Estudio consulta el estado y, cuando termina, pone la animación en la línea de tiempo (se puede deshacer).
 */
const idSchema = z.uuid();
const requestSchema = z.object({
  from_word: z.number().int().min(0),
  to_word: z.number().int().min(0),
  instruction: z.string().trim().min(3, "Escribe qué animación quieres.").max(600, "El pedido es demasiado largo: resúmelo en pocas frases."),
  replace: z.unknown().nullable().optional(),
});

export async function requestAnimationAction(projectId: string, input: z.input<typeof requestSchema>): Promise<{ ok: true; workId: string } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = requestSchema.safeParse(input);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Pedido no válido." };
  try {
    const { workId } = await startStudioRequest(projectId, { ...parsed.data, replace: parsed.data.replace ?? null }, user.id);
    return { ok: true, workId };
  } catch (error) {
    if (error instanceof ComposRequestError) return { ok: false, error: error.message };
    console.error("[animaciones] pedido:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos empezar la animación. Prueba de nuevo." };
  }
}

export async function composStatusAction(projectId: string): Promise<{ ok: true; data: ComposStatus } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    const project = await loadProject(projectId);
    if (!project) return { ok: false, error: "No encontramos ese proyecto." };
    return { ok: true, data: await composStatus(project) };
  } catch (error) {
    console.error("[animaciones] estado:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos consultar la animación." };
  }
}
