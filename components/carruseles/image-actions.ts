"use server";

import { z } from "zod";
import { AiError } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { isImageProviderId } from "@/lib/carousels/images";
import { ImageJobError, MAX_IMAGES_PER_JOB, startImageJob } from "@/lib/carousels/images/service";

export type ImageActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Genera imágenes (sin texto) para los slides elegidos. El carrusel tiene que estar guardado: el editor guarda
 * antes de llamar. Devuelve el trabajo (se sigue con /api/carruseles/trabajos/<id>) y las escenas usadas.
 */
export async function generateImagesAction(carouselId: string, slideIds: string[], provider: string | null): Promise<ImageActionResult<{ jobId: string; provider: string; scenes: Record<string, string> }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`carruseles-imagenes:${user.id}`, 40, 3600))) return { ok: false, error: "Pediste muchas imágenes seguidas. Espera unos minutos y vuelve a intentar." };
  const ids = z.array(z.string().regex(/^[a-z0-9]{1,40}$/i)).min(1, "Elige al menos un slide.").max(MAX_IMAGES_PER_JOB, `Hasta ${MAX_IMAGES_PER_JOB} imágenes por vez.`).safeParse(slideIds);
  if (!/^[0-9a-f-]{36}$/i.test(carouselId) || !ids.success) return { ok: false, error: ids.success ? "Carrusel no válido." : (ids.error.issues[0]?.message ?? "Slides no válidos.") };
  try {
    return { ok: true, data: await startImageJob({ carouselId, slideIds: ids.data, provider: isImageProviderId(provider) ? provider : null, userId: user.id }) };
  } catch (error) {
    if (error instanceof ImageJobError) return { ok: false, error: error.message };
    if (error instanceof AiError) return { ok: false, error: error.userMessage };
    console.error("[carruseles/imagenes]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos pedir las imágenes. Prueba de nuevo." };
  }
}
