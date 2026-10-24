"use server";

import { z } from "zod";
import { AiError } from "@/lib/ai/client";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { isImageProviderId } from "@/lib/carousels/images";
import { ImageJobError, MAX_IMAGES_PER_JOB, startImageJob } from "@/lib/carousels/images/service";
import { AnimationError, startAnimation } from "@/lib/carousels/animate";
import { MOTIONS, VIDEO_SECONDS } from "@/lib/carousels/slide-hash";

type Scenes = Record<string, { scene: string; pose: string; photo: string | null }>;

export type ImageActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Genera imágenes (sin texto) para los slides elegidos. El carrusel tiene que estar guardado: el editor guarda
 * antes de llamar. Devuelve el trabajo (se sigue con /api/carruseles/trabajos/<id>) y las escenas usadas.
 */
export async function generateImagesAction(carouselId: string, slideIds: string[], provider: string | null): Promise<ImageActionResult<{ jobId: string; provider: string; scenes: Scenes }>> {
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

/**
 * Corrige la imagen de un slide con un único cambio (1 imagen). Si sale el personaje, se vuelven a mandar sus fotos.
 */
export async function correctImageAction(carouselId: string, slideId: string, instruction: string, provider: string | null): Promise<ImageActionResult<{ jobId: string; provider: string; scenes: Scenes }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`carruseles-imagenes:${user.id}`, 40, 3600))) return { ok: false, error: "Pediste muchas imágenes seguidas. Espera unos minutos y vuelve a intentar." };
  const text = z.string().trim().min(4, "Cuenta qué cambiar (por ejemplo: “que mire a cámara”).").max(300, "Cuéntalo en menos palabras.").safeParse(instruction);
  if (!/^[0-9a-f-]{36}$/i.test(carouselId) || !/^[a-z0-9]{1,40}$/i.test(slideId)) return { ok: false, error: "Slide no válido." };
  if (!text.success) return { ok: false, error: text.error.issues[0]?.message ?? "Cuenta qué cambiar." };
  try {
    return { ok: true, data: await startImageJob({ carouselId, slideIds: [slideId], provider: isImageProviderId(provider) ? provider : null, userId: user.id, correction: { instruction: text.data } }) };
  } catch (error) {
    if (error instanceof ImageJobError) return { ok: false, error: error.message };
    console.error("[carruseles/corregir]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos pedir la corrección. Prueba de nuevo." };
  }
}

const animateSchema = z.object({
  format: z.enum(["4:5", "9:16"]),
  motion: z.enum(Object.keys(MOTIONS) as [keyof typeof MOTIONS, ...(keyof typeof MOTIONS)[]]),
  seconds: z.coerce.number().refine((n) => (VIDEO_SECONDS as readonly number[]).includes(n), "Duración no válida."),
  hash: z.string().regex(/^[0-9a-f]{8}$/),
});

/** Anima un slide ya dibujado y subido (clave `carruseles/<id>/anim/<slide>-<azar>.jpg`). Devuelve el trabajo. */
export async function animateSlideAction(carouselId: string, slideId: string, sourceKey: string, settings: z.input<typeof animateSchema>): Promise<ImageActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await allowAttempt(`carruseles-animar:${user.id}`, 30, 3600))) return { ok: false, error: "Animaste muchos slides seguidos. Espera unos minutos." };
  const parsed = animateSchema.safeParse(settings);
  if (!/^[0-9a-f-]{36}$/i.test(carouselId) || !/^[a-z0-9]{1,40}$/i.test(slideId) || typeof sourceKey !== "string" || !parsed.success) return { ok: false, error: "Pedido no válido." };
  try {
    return { ok: true, data: await startAnimation({ carouselId, slideId, sourceKey, ...parsed.data, userId: user.id }) };
  } catch (error) {
    if (error instanceof AnimationError) return { ok: false, error: error.message };
    console.error("[carruseles/animar]", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos empezar el video. Prueba de nuevo." };
  }
}
