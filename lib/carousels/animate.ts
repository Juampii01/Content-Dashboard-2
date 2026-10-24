import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { fileInfo } from "@/lib/storage";
import { ANIM_KEY_RE, animKeyFromUrl, deleteFiles, fileUrl } from "./files";
import type { Motion, VideoFormat } from "./slide-hash";

/**
 * Animar un slide (como `animar` de carrusel-creator-pro, pero sin ajustes a mano): el navegador dibuja el slide a
 * 1080×1350 con la plantilla (el mismo dibujo de la exportación) y lo sube; el worker (CAROUSEL_ANIMATE) hace un MP4
 * corto con un movimiento sutil (acercamiento, deriva o latido), en 4:5 o en 9:16 (con el fondo del slide difuminado
 * arriba y abajo), sin sonido. El video queda en el slide; si después cambia el slide, el editor avisa que quedó viejo.
 */
export class AnimationError extends Error {}

export async function activeAnimation(carouselId: string) {
  const [job] = await getDb()
    .select({ id: schema.jobs.id, input: schema.jobs.input })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "CAROUSEL_ANIMATE"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'carouselId' = ${carouselId}`))
    .limit(1);
  return job ? { id: job.id, slideId: String((job.input as { slideId?: string }).slideId ?? "") } : null;
}

export async function startAnimation(input: { carouselId: string; slideId: string; sourceKey: string; format: VideoFormat; motion: Motion; seconds: number; hash: string; userId: string }): Promise<string> {
  if (!ANIM_KEY_RE.test(input.sourceKey) || !input.sourceKey.startsWith(`carruseles/${input.carouselId}/anim/${input.slideId.toLowerCase()}-`) || !input.sourceKey.endsWith(".jpg")) {
    throw new AnimationError("No encontramos el slide dibujado. Prueba de nuevo.");
  }
  const [row] = await getDb().select({ slides: schema.carousels.slides }).from(schema.carousels).where(eq(schema.carousels.id, input.carouselId)).limit(1);
  if (!row) throw new AnimationError("No encontramos ese carrusel.");
  if (!row.slides.some((s) => s.id === input.slideId)) throw new AnimationError("Ese slide ya no existe. Guarda el carrusel y prueba de nuevo.");
  if (!(await fileInfo(input.sourceKey))) throw new AnimationError("El slide dibujado no terminó de subirse. Prueba de nuevo.");
  const running = await activeAnimation(input.carouselId);
  if (running) throw new AnimationError("Ya hay un slide animándose en este carrusel. Espera a que termine.");
  return enqueueJob({
    type: "CAROUSEL_ANIMATE",
    input: { carouselId: input.carouselId, slideId: input.slideId, sourceKey: input.sourceKey, format: input.format, motion: input.motion, seconds: input.seconds, hash: input.hash },
    createdBy: input.userId,
    maxAttempts: 2,
    stage: "En cola",
  });
}

/** El worker subió el video: se pone en su slide (con la huella del slide dibujado) y se borran el anterior y el dibujo. */
export async function attachSlideVideo(job: { id: string; input: unknown }, key: string): Promise<{ url: string | null }> {
  const input = job.input as { carouselId?: string; slideId?: string; sourceKey?: string; format?: VideoFormat; hash?: string };
  if (!input.carouselId || !input.slideId || !ANIM_KEY_RE.test(key) || !key.endsWith(".mp4") || !key.startsWith(`carruseles/${input.carouselId}/anim/${input.slideId.toLowerCase()}-`)) {
    throw new AnimationError("Video no válido.");
  }
  const url = fileUrl(key);
  const result = await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ slides: schema.carousels.slides }).from(schema.carousels).where(eq(schema.carousels.id, input.carouselId!)).for("update").limit(1);
    const slide = row?.slides.find((s) => s.id === input.slideId);
    if (!row || !slide) return null;
    const previous = animKeyFromUrl(slide.videoUrl);
    const slides = row.slides.map((s) => (s.id === input.slideId ? { ...s, videoUrl: url, videoFormat: input.format ?? "4:5", videoHash: input.hash ?? null } : s));
    await tx.update(schema.carousels).set({ slides }).where(eq(schema.carousels.id, input.carouselId!));
    await tx.execute(sql`update jobs set output = jsonb_build_object('slideId', ${input.slideId}::text, 'url', ${url}::text) where id = ${job.id}`);
    return { previous };
  });
  const trash = [input.sourceKey ?? ""];
  if (!result) {
    await deleteFiles([key, ...trash]);
    return { url: null };
  }
  if (result.previous && result.previous !== key) trash.push(result.previous);
  await deleteFiles(trash.filter(Boolean));
  return { url };
}
