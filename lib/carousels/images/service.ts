import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getBrand } from "@/lib/ai/brand-context";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs";
import { deleteFiles, fileUrl, keyFromUrl, SLIDE_KEY_RE } from "../files";
import { proposeScenes } from "../service";
import { layoutFor, parseSpec } from "../template-spec";
import { customIdOf } from "../theme";
import { IMAGE_PROVIDERS, providersStatus, type ImageProviderId } from ".";
import { defaultPose, pickPhotos } from "../character";
import { brandPhotoKeys, ensurePhotoTraits } from "../photos";
import { correctionPrompt, imagePrompt, type ImagePromptInput } from "./prompt";

/**
 * Imágenes con IA para los slides: encola el trabajo CAROUSEL_IMAGES (lo hace el worker), recibe cada imagen
 * a medida que sale y lleva la cuenta de las últimas 24 h (los planes de ChatGPT tienen un límite diario).
 */
export class ImageJobError extends Error {}

type CarouselRow = typeof schema.carousels.$inferSelect;
export const MAX_IMAGES_PER_JOB = 10;

async function loadCarousel(id: string): Promise<CarouselRow> {
  const [row] = await getDb().select().from(schema.carousels).where(eq(schema.carousels.id, id)).limit(1);
  if (!row) throw new ImageJobError("No encontramos ese carrusel.");
  return row;
}

export async function activeImageJob(carouselId: string) {
  const [job] = await getDb()
    .select({ id: schema.jobs.id, status: schema.jobs.status, progress: schema.jobs.progress, stage: schema.jobs.stage, input: schema.jobs.input, output: schema.jobs.output })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "CAROUSEL_IMAGES"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'carouselId' = ${carouselId}`))
    .limit(1);
  return job ?? null;
}

/** Dónde queda el texto respecto de la imagen, según la plantilla del slide. */
async function placements(row: CarouselRow): Promise<(slide: CarouselSlide) => ImagePromptInput["textPlacement"]> {
  const ids = [...new Set([row.template, ...row.slides.map((s) => s.template)].map((t) => customIdOf(t)).filter((x): x is string => Boolean(x)))];
  const specs = ids.length ? await getDb().select({ id: schema.carouselTemplates.id, spec: schema.carouselTemplates.spec }).from(schema.carouselTemplates).where(inArray(schema.carouselTemplates.id, ids)) : [];
  const byId = new Map(specs.map((s) => [s.id, parseSpec(s.spec)]));
  return (slide) => {
    const ref = slide.template || row.template;
    const custom = customIdOf(ref);
    if (custom) {
      const spec = byId.get(custom);
      const pos = spec ? layoutFor(spec, slide.type).photo.position : "top";
      return pos === "full" ? "over" : pos === "left" || pos === "right" ? "side" : "below";
    }
    return ref === "tweet" ? "inside" : "below";
  };
}

/** Un pedido de imagen para el worker. Las fotos del personaje y la imagen a corregir van como claves del almacenamiento. */
export type ImageJobItem = { slideId: string; prompt: string; characterKeys?: string[]; editKey?: string | null };

/**
 * Encola la generación de imágenes de los slides elegidos. Los slides sin escena (o con personaje y sin pose) la
 * reciben de la IA primero (y se guarda). En los slides con personaje se eligen sus fotos de referencia según la pose.
 * Con `correction`, se edita la imagen actual de un slide con un único cambio (como `corregir` del Creator).
 * Devuelve el trabajo y las escenas y poses, para que el editor las muestre.
 */
export async function startImageJob(input: {
  carouselId: string;
  slideIds: string[];
  provider: ImageProviderId | null;
  userId: string;
  correction?: { instruction: string } | null;
}) {
  const status = await providersStatus();
  // Siempre la clave de API de OpenAI (la cuenta de ChatGPT ya no se usa).
  const providerId = status.preferred;
  if (!providerId) throw new ImageJobError("Agrega tu clave de API de OpenAI en Ajustes → Claves de servicios para generar imágenes.");
  if (!(await IMAGE_PROVIDERS[providerId].workerCredentials())) throw new ImageJobError("Vuelve a conectar tu ChatGPT en Ajustes → Claves de servicios.");
  if (await activeImageJob(input.carouselId)) throw new ImageJobError("Ya hay imágenes generándose para este carrusel. Espera a que terminen.");

  const row = await loadCarousel(input.carouselId);
  const wanted = input.slideIds.filter((id) => row.slides.some((s) => s.id === id)).slice(0, input.correction ? 1 : MAX_IMAGES_PER_JOB);
  if (!wanted.length) throw new ImageJobError("Elige al menos un slide.");

  const photoKeys = await brandPhotoKeys();
  const wantsCharacter = (s: CarouselSlide) => s.character === true && photoKeys.length > 0;
  let slides = row.slides;

  if (!input.correction) {
    // Escenas (y poses) que faltan: las propone la IA y quedan guardadas en el slide (editables).
    const missing = wanted.filter((id) => {
      const s = slides.find((x) => x.id === id)!;
      return !s.scenePrompt?.trim() || (wantsCharacter(s) && !s.pose?.trim());
    });
    if (missing.length) {
      const scenes = await proposeScenes(row.id, row.slides, missing, input.userId);
      slides = row.slides.map((s, i) => {
        const hit = scenes[s.id];
        if (!hit) return s;
        return {
          ...s,
          scenePrompt: s.scenePrompt?.trim() ? s.scenePrompt : hit.scene,
          ...(s.character && !s.pose?.trim() ? { pose: hit.pose || defaultPose(i) } : {}),
        };
      });
      await getDb().update(schema.carousels).set({ slides }).where(eq(schema.carousels.id, row.id));
    }
  }

  const photos = wanted.some((id) => wantsCharacter(slides.find((s) => s.id === id)!)) ? await ensurePhotoTraits(input.userId) : [];
  const brand = await getBrand();
  const placementOf = await placements({ ...row, slides });
  // Consistencia: la primera imagen con IA del carrusel (que no se vaya a reemplazar) es la referencia de estilo.
  const styleSlide = input.correction ? null : slides.find((s) => s.imageSource === "ai" && keyFromUrl(s.imageUrl) && !wanted.includes(s.id));
  const items: ImageJobItem[] = wanted.map((id) => {
    const index = slides.findIndex((s) => s.id === id);
    const slide = slides[index]!;
    const pose = slide.pose?.trim() || defaultPose(index);
    const characterKeys = wantsCharacter(slide) && photos.length ? pickPhotos(photos, pose, index, slide.photoKey) : [];
    if (input.correction) {
      const editKey = keyFromUrl(slide.imageUrl);
      if (!editKey) throw new ImageJobError("Este slide no tiene una imagen para corregir. Genera una primero.");
      return { slideId: slide.id, prompt: correctionPrompt({ instruction: input.correction.instruction, character: characterKeys.length ? { photos: characterKeys.length } : null }), characterKeys, editKey };
    }
    return {
      slideId: slide.id,
      characterKeys,
      prompt: imagePrompt({
        scene: slide.scenePrompt?.trim() || slide.headline,
        slide,
        textPlacement: placementOf(slide),
        brand: { niche: brand?.niche ?? null, colors: brand?.colors ?? null },
        withReference: Boolean(styleSlide) || wanted.indexOf(id) > 0,
        character: characterKeys.length ? { photos: characterKeys.length, pose } : null,
      }),
    };
  });
  const jobId = await enqueueJob({
    type: "CAROUSEL_IMAGES",
    input: { carouselId: row.id, provider: providerId, items, styleRefKey: styleSlide ? keyFromUrl(styleSlide.imageUrl) : null, correction: Boolean(input.correction) },
    createdBy: input.userId,
    maxAttempts: 2,
    stage: "En cola",
  });
  const picked = Object.fromEntries(items.map((i) => [i.slideId, i.characterKeys?.[0] ?? null]));
  return {
    jobId,
    provider: providerId,
    scenes: Object.fromEntries(slides.filter((s) => wanted.includes(s.id)).map((s) => [s.id, { scene: s.scenePrompt ?? "", pose: s.pose ?? "", photo: picked[s.id] ?? null }])),
  };
}

/** El worker avisa que una imagen está lista: se pone en su slide y se anota en la salida del trabajo. */
export async function attachGeneratedImage(job: { id: string; input: unknown }, slideId: string, key: string, provider: string) {
  const input = job.input as { carouselId?: string; items?: { slideId: string }[] };
  if (!input.carouselId || !SLIDE_KEY_RE.test(key) || !key.startsWith(`carruseles/${input.carouselId}/`)) throw new ImageJobError("Imagen no válida.");
  if (!input.items?.some((i) => i.slideId === slideId)) throw new ImageJobError("Ese slide no es de este trabajo.");
  const url = fileUrl(key);
  const old = await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ slides: schema.carousels.slides }).from(schema.carousels).where(eq(schema.carousels.id, input.carouselId!)).for("update").limit(1);
    if (!row) return null;
    const slide = row.slides.find((s) => s.id === slideId);
    if (!slide) return null;
    // La imagen anterior queda como "anterior" (para volver a ella si la nueva no gusta); la de antes se borra.
    const previous = keyFromUrl(slide.imageUrl);
    const older = keyFromUrl(slide.prevImageUrl);
    const slides = row.slides.map((s) => (s.id === slideId ? { ...s, imageUrl: url, imageSource: "ai" as const, prevImageUrl: previous ? fileUrl(previous) : null, prevImageSource: previous ? (s.imageSource ?? null) : null } : s));
    await tx.update(schema.carousels).set({ slides }).where(eq(schema.carousels.id, input.carouselId!));
    // Salida parcial: el editor la lee mientras el trabajo sigue y pone cada imagen apenas sale.
    await tx.execute(sql`
      update jobs set output = jsonb_build_object(
        'provider', ${provider}::text,
        'slides', coalesce(output->'slides', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('slideId', ${slideId}::text, 'url', ${url}::text, 'prev', ${previous ? fileUrl(previous) : null}::text))
      ) where id = ${job.id}`);
    // Solo se borra si ningún otro slide la usa (al duplicar un slide, la imagen se comparte).
    const used = (k: string) => slides.some((s) => keyFromUrl(s.imageUrl) === k || keyFromUrl(s.prevImageUrl) === k);
    return { previous: older && older !== previous && !used(older) ? older : null, prev: previous ? fileUrl(previous) : null };
  });
  if (!old) {
    // El slide se borró mientras se generaba: la imagen no se usa.
    await deleteFiles([key]);
    return { url: null, prev: null };
  }
  if (old.previous && old.previous !== key) await deleteFiles([old.previous]);
  return { url, prev: old.prev };
}

/** Imágenes generadas en las últimas 24 h, por proveedor (para avisar antes de llegar al límite del plan). */
export async function imagesLast24h(): Promise<{ chatgpt: number; openai: number }> {
  const rows = await getDb().execute<{ provider: string | null; n: number }>(sql`
    select input->>'provider' as provider, coalesce(sum(jsonb_array_length(coalesce(output->'slides', '[]'::jsonb))), 0)::int as n
    from jobs where type = 'CAROUSEL_IMAGES' and created_at > now() - interval '24 hours'
    group by 1`);
  const out = { chatgpt: 0, openai: 0 };
  for (const r of rows.rows) {
    if (r.provider === "chatgpt") out.chatgpt += Number(r.n);
    else if (r.provider === "openai-api") out.openai += Number(r.n);
  }
  return out;
}
