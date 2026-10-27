"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { projectPeaks, type PeaksState } from "@/lib/video/peaks-service";

const idSchema = z.uuid();

/**
 * Forma de onda de la voz del video (pistas de audio del Estudio). La puede ver cualquiera del equipo; si falta, solo
 * quien edita la pide al worker.
 */
export async function peaksAction(projectId: string): Promise<{ ok: true; data: PeaksState } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!idSchema.safeParse(projectId).success) return { ok: false, error: "Proyecto no válido." };
  try {
    return { ok: true, data: await projectPeaks(projectId, { enqueue: user.role !== "VIEWER", userId: user.id }) };
  } catch (error) {
    console.error("[forma de onda]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos leer la forma de onda. Prueba de nuevo." };
  }
}
