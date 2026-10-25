"use server";

import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { ComposRequestError, startStudioRequest } from "@/lib/video/compos/flows";
import { composStatus, type ComposStatus } from "@/lib/video/compos/service";
import { ackRequests, cancelRequest } from "@/lib/video/compos/requests";
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
  instruction: z.string().trim().min(3, "Escribe qué animación quieres.").max(1500, "El pedido es demasiado largo: resúmelo en pocas frases."),
  replace: z.unknown().nullable().optional(),
});

/** Varios pedidos pueden correr a la vez. `error`: el pedido quedó creado pero sin tope de IA (se muestra en él). */
export async function requestAnimationAction(projectId: string, input: z.input<typeof requestSchema>): Promise<{ ok: true; workId: string; error: string | null } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const parsed = requestSchema.safeParse(input);
  if (!idSchema.safeParse(projectId).success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Pedido no válido." };
  try {
    const { workId, error } = await startStudioRequest(projectId, { ...parsed.data, replace: parsed.data.replace ?? null }, user.id);
    return { ok: true, workId, error };
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

const workIdSchema = z.string().regex(/^w[0-9a-z]{1,30}$/);

/** Cancela un pedido de animación (en cola: no se hace; en curso: se detiene en el próximo paso). */
export async function cancelAnimationAction(projectId: string, workId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!idSchema.safeParse(projectId).success || !workIdSchema.safeParse(workId).success) return { ok: false, error: "Pedido no válido." };
  return (await cancelRequest(projectId, workId)) ? { ok: true } : { ok: false, error: "Ese pedido ya terminó." };
}

/** Marca pedidos como entregados: ya están en la revisión guardada (o la persona cerró el aviso de uno fallido). */
export async function ackAnimationsAction(projectId: string, workIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  const ids = workIds.filter((w) => workIdSchema.safeParse(w).success).slice(0, 30);
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Pedido no válido." };
  await ackRequests(projectId, ids);
  return { ok: true };
}
