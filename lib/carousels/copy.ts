import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { generateStructured } from "@/lib/ai/client";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { COPY_RULES, copySchema, copyTask, type CopyResult } from "@/lib/ai/prompts/carruseles-copia";
import { getDb, schema } from "@/lib/db";
import type { CarouselCopyOptions, CarouselCopyReading, CarouselSlide } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs";
import { fileInfo } from "@/lib/storage";
import { cleanTags } from "./captions";
import { defaultPose } from "./character";
import { deleteReferences, REF_KEY_RE } from "./files";
import { brandPhotoKeys } from "./photos";
import { layoutFor } from "./template-spec";
import { buildSpec, validInstagramLink } from "./templates";
import { customRef, isTemplateRef, newSlideId, type TemplateRef } from "./theme";

/**
 * "Copiar un carrusel" (lo principal de carrusel-creator-pro, adaptado a esta app):
 * 1. Se crea la copia con el link o con los slides subidos (`carruseles-ref/<copia>/NN.ext`).
 * 2. El worker (CAROUSEL_COPY) baja los slides con gallery-dl o los toma del almacenamiento, los mide (si se copia
 *    el diseño) y le pasa a la app las medidas y las imágenes reducidas.
 * 3. La app arma la plantilla con el diseño del original y, a la vez, Claude con visión lee cada slide y escribe la
 *    ficha de tu versión (tu marca, tu tono, tu CTA, tu personaje). Queda un carrusel nuevo en borrador.
 * 4. Las imágenes del original se borran: se guarda solo su texto (para comprobar cifras) y el diseño.
 * Quien llama comprueba la sesión (acciones con requireEditor; el worker con WORKER_SECRET y su trabajo en curso).
 */
export class CopyError extends Error {}

export const COPY_MIN = 2;
export const COPY_MAX = 20;

type CopyRow = typeof schema.carouselCopies.$inferSelect;

export async function getCopyRow(id: string): Promise<CopyRow | null> {
  const [row] = await getDb().select().from(schema.carouselCopies).where(eq(schema.carouselCopies.id, id)).limit(1);
  return row ?? null;
}

function enqueueCopyJob(copyId: string, data: { source: "link"; url: string } | { source: "upload"; keys: string[] }, design: CarouselCopyOptions["design"], userId: string) {
  return enqueueJob({ type: "CAROUSEL_COPY", input: { copyId, design, ...data }, createdBy: userId, maxAttempts: 2, stage: "En cola" });
}

export async function createCopy(input: { source: "upload" | "link"; url?: string | null; options: CarouselCopyOptions; userId: string }): Promise<string> {
  if (input.source === "link" && !validInstagramLink(input.url ?? "")) throw new CopyError("Pega el link de un carrusel de Instagram (instagram.com/p/…).");
  const [row] = await getDb()
    .insert(schema.carouselCopies)
    .values({
      status: "ANALYZING",
      source: input.source,
      sourceUrl: input.source === "link" ? input.url!.trim().split("?")[0] : null,
      options: input.options,
      createdBy: input.userId,
    })
    .returning({ id: schema.carouselCopies.id });
  if (input.source === "link") await enqueueCopyJob(row!.id, { source: "link", url: input.url!.trim() }, input.options.design, input.userId);
  return row!.id;
}

export async function latestCopyJob(copyId: string) {
  const [job] = await getDb()
    .select({ id: schema.jobs.id, status: schema.jobs.status, progress: schema.jobs.progress, stage: schema.jobs.stage, errorMessage: schema.jobs.errorMessage })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "CAROUSEL_COPY"), sql`${schema.jobs.input}->>'copyId' = ${copyId}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return job ?? null;
}

/**
 * Si Instagram no dejó bajar el link, la misma copia pasa a "subir las imágenes" (mantiene las opciones elegidas).
 */
export async function switchCopyToUploads(copyId: string): Promise<void> {
  const row = await getCopyRow(copyId);
  if (!row) throw new CopyError("No encontramos esa copia.");
  if (row.status === "READY") throw new CopyError("Esta copia ya terminó.");
  const job = await latestCopyJob(copyId);
  if (job && (job.status === "QUEUED" || job.status === "RUNNING")) throw new CopyError("Todavía estamos leyendo el carrusel. Espera a que termine.");
  await getDb().update(schema.carouselCopies).set({ source: "upload", status: "ANALYZING", errorMessage: null, referenceCount: 0 }).where(eq(schema.carouselCopies.id, copyId));
}

/** Encola la lectura de los slides ya subidos (claves `carruseles-ref/<copia>/NN.ext`, comprobadas una por una). */
export async function analyzeCopyUploads(copyId: string, keys: string[], userId: string): Promise<string> {
  const row = await getCopyRow(copyId);
  if (!row || row.source !== "upload") throw new CopyError("No encontramos esa copia.");
  if (row.status !== "ANALYZING") throw new CopyError("Esta copia ya se leyó.");
  const unique = [...new Set(keys)].sort();
  if (unique.length < COPY_MIN) throw new CopyError("Sube al menos 2 slides del carrusel.");
  if (unique.length > COPY_MAX) throw new CopyError("Sube como máximo 20 slides.");
  for (const key of unique) {
    if (!REF_KEY_RE.test(key) || !key.startsWith(`carruseles-ref/${copyId}/`)) throw new CopyError("Una de las imágenes no es de esta copia. Vuelve a subirlas.");
    if (!(await fileInfo(key))) throw new CopyError("Una de las imágenes no terminó de subirse. Vuelve a intentarlo.");
  }
  const running = await latestCopyJob(copyId);
  if (running && (running.status === "QUEUED" || running.status === "RUNNING")) return running.id;
  await getDb().update(schema.carouselCopies).set({ referenceCount: unique.length }).where(eq(schema.carouselCopies.id, copyId));
  return enqueueCopyJob(copyId, { source: "upload", keys: unique }, row.options.design, userId);
}

/** El @ del carrusel original de un carrusel copiado (para avisar si se cuela en tu versión). */
export async function copyOfCarousel(carouselId: string): Promise<{ id: string; handle: string | null; sourceUrl: string | null } | null> {
  const [row] = await getDb()
    .select({ id: schema.carouselCopies.id, reading: schema.carouselCopies.reading, sourceUrl: schema.carouselCopies.sourceUrl })
    .from(schema.carouselCopies)
    .where(eq(schema.carouselCopies.carouselId, carouselId))
    .orderBy(desc(schema.carouselCopies.createdAt))
    .limit(1);
  return row ? { id: row.id, handle: row.reading?.handle ?? null, sourceUrl: row.sourceUrl } : null;
}

// ─── Lectura con Claude y armado del carrusel ─────────────────────────────

const FAKE_SLIDES = [
  { originalText: "5 AI TOOLS THAT REPLACE A $3,000/MONTH TEAM", role: "cover", visual: "Persona sonriendo a la izquierda, titular enorme en blanco y amarillo sobre fondo negro.", person: true },
  { originalText: "1. NOTEBOOKLM\nTurns any PDF into a podcast in 2 minutes", role: "item", visual: "Captura de la herramienta inclinada en el centro con una flecha amarilla.", person: false },
  { originalText: "2. GAMMA\nDecks in 30 seconds. 50M users.", role: "item", visual: "Laptop abierta con una presentación, fondo oscuro con brillo.", person: false },
  { originalText: "3. CURSOR\nBuild apps by talking", role: "item", visual: "La persona señala una pantalla con código borroso.", person: true },
  { originalText: "4. ELEVENLABS\nYour voice in 29 languages", role: "item", visual: "Ondas de sonido y un micrófono en primer plano.", person: false },
  { originalText: "5. MAKE\nAutomate the boring stuff", role: "item", visual: "Diagrama de nodos conectados con líneas amarillas.", person: false },
  { originalText: "Comment TOOLS and I'll send you the list", role: "cta", visual: "Persona de brazos cruzados con la palabra clave en una caja amarilla.", person: true },
] as const;

function fakeCopy(n: number, keyword: string | null, character: CarouselCopyOptions["character"], hasPhotos: boolean): CopyResult {
  const kw = keyword ?? "HERRAMIENTAS";
  const mine = [
    { type: "cover", kicker: "Para tu negocio", headline: "5 herramientas de AI que trabajan por todo tu equipo", highlight: "trabajan por todo tu equipo", body: "", cta: "" },
    { type: "item", kicker: "Herramienta 1", headline: "1. NOTEBOOKLM", highlight: "NOTEBOOKLM", body: "Convierte cualquier PDF en un podcast en 2 minutos. Ideal para tus clientes.", cta: "" },
    { type: "item", kicker: "Herramienta 2", headline: "2. GAMMA", highlight: "GAMMA", body: "Presentaciones listas en 30 segundos. Ya la usan 50M de personas.", cta: "" },
    { type: "item", kicker: "Herramienta 3", headline: "3. CURSOR", highlight: "CURSOR", body: "Crea aplicaciones explicando lo que quieres, sin escribir código.", cta: "" },
    { type: "item", kicker: "Herramienta 4", headline: "4. ELEVENLABS", highlight: "ELEVENLABS", body: "Tu voz en 29 idiomas para llegar a más clientes.", cta: "" },
    { type: "item", kicker: "Herramienta 5", headline: "5. MAKE", highlight: "MAKE", body: "Automatiza las tareas repetitivas de tu negocio.", cta: "" },
    { type: "cta", kicker: "Gratis", headline: "¿Quieres la lista completa con los links?", highlight: "lista completa", body: "Te la mando por mensaje directo.", cta: `Comenta ${kw}` },
  ] as const;
  const slides = Array.from({ length: n }, (_, i) => {
    const src = i === n - 1 ? FAKE_SLIDES[6] : FAKE_SLIDES[Math.min(i, 5)]!;
    const own = i === n - 1 ? mine[6] : mine[Math.min(i, 5)]!;
    const withFace = !hasPhotos || character === "nunca" ? false : character === "siempre" ? true : src.person;
    return {
      ...src,
      ...own,
      character: withFace,
      pose: withFace ? defaultPose(i) : "",
      scenePrompt: withFace ? `El creador en una oficina moderna y luminosa, ${defaultPose(i)}` : `${src.visual.replace(/amarill[oa]s?/g, "azul")} Sin texto.`,
    };
  });
  return {
    title: "5 herramientas de AI para tu equipo",
    original: { handle: "@cuentaviral", language: "inglés", topic: "Herramientas de AI que reemplazan a un equipo", cta: "TOOLS" },
    slides: slides as unknown as CopyResult["slides"],
    caption: `5 herramientas de AI que hacen el trabajo de todo un equipo.\n\nNotebookLM, Gamma, Cursor, ElevenLabs y Make: para qué sirve cada una y cómo empezar hoy.\n\nMenos horas en tareas repetitivas, más tiempo para tus clientes.\n\n💬 Comenta ${kw} y te mando la lista con los links.\n\n📌 Guárdalo para cuando armes tu próximo proceso.`,
    hashtags: ["#ai", "#herramientasai", "#productividad", "#automatizacion", "#negocios"],
  };
}

function sanitizeKeyword(raw: string | null | undefined): string | null {
  const k = (raw ?? "").normalize("NFC").replace(/[^\p{L}\p{N}_-]/gu, "").toUpperCase().slice(0, 30);
  return k || null;
}

/**
 * Lo llama el worker con las medidas (o null si no se copia el diseño), las imágenes reducidas (base64, en orden) y el
 * texto del post si gallery-dl lo trajo. Devuelve el carrusel creado. Si ya se armó (reintento), devuelve el mismo.
 */
export async function finishCopy(job: { id: string; input: unknown; createdBy: string | null }, rawMeasurements: unknown | null, images: string[], postText: string | null): Promise<{ carouselId: string }> {
  const copyId = String((job.input as { copyId?: string }).copyId ?? "");
  const copy = await getCopyRow(copyId);
  if (!copy) throw new CopyError("La copia ya no existe.");
  if (copy.status === "READY" && copy.carouselId) return { carouselId: copy.carouselId };
  if (images.length < COPY_MIN) throw new CopyError("Necesitamos al menos 2 slides para copiar el carrusel.");

  const options = copy.options;
  const [brand, photoKeys] = await Promise.all([getBrand(), brandPhotoKeys()]);
  const hasPhotos = photoKeys.length > 0;
  const keyword = sanitizeKeyword(options.keyword);
  const wantsDesign = options.design === "original" && rawMeasurements != null;

  const [design, reading] = await Promise.all([
    wantsDesign ? buildSpec(job, rawMeasurements, images).catch((error) => (console.error("[carruseles/copia] diseño:", error instanceof Error ? error.message : "error"), null)) : Promise.resolve(null),
    generateStructured({
      feature: "carruseles.copia",
      model: "main",
      context: `${COPY_RULES}\n\n${await brandContext(brand)}`,
      task: copyTask({ slides: images.length, keyword, character: options.character, hasPhotos, caption: postText }),
      schema: copySchema,
      images: images.slice(0, COPY_MAX).map((data) => ({ mediaType: "image/jpeg" as const, data })),
      imageSizes: images.map(() => ({ width: 1000, height: 1250 })),
      maxTokens: 10_000,
      timeoutMs: 280_000,
      userId: job.createdBy,
      jobId: job.id,
      fake: () => fakeCopy(images.length, keyword, options.character, hasPhotos),
    }),
  ]);

  const got = reading.slides.slice(0, COPY_MAX);
  if (got.length < 1) throw new CopyError("La IA no pudo leer los slides. Prueba de nuevo.");

  // Plantilla con el diseño del original (si se pidió y se pudo medir).
  let templateId: string | null = null;
  if (design) {
    const [tpl] = await getDb()
      .insert(schema.carouselTemplates)
      .values({
        name: `Diseño de «${reading.title.trim().slice(0, 50) || "un carrusel copiado"}»`.slice(0, 80),
        status: "READY",
        source: copy.source,
        sourceUrl: copy.sourceUrl,
        referenceCount: design.measurements.slides.length,
        spec: design.spec,
        measurements: design.measurements as unknown as Record<string, unknown>,
        createdBy: job.createdBy,
      })
      .returning({ id: schema.carouselTemplates.id });
    templateId = tpl!.id;
  }
  const chosen = options.template && isTemplateRef(options.template) ? (options.template as TemplateRef) : null;
  const template: TemplateRef = templateId ? customRef(templateId) : (chosen ?? (got.some((s) => s.character) && hasPhotos ? "foto" : "editorial"));

  // Personaje: lo que eligió la persona manda; en automático, como el original y al menos en el cierre.
  const faces = got.map((s) => (!hasPhotos || options.character === "nunca" ? false : options.character === "siempre" ? true : s.character));
  if (hasPhotos && options.character === "auto" && !faces.some(Boolean)) faces[faces.length - 1] = true;

  const slides: CarouselSlide[] = got.map((s, i) => {
    const character = faces[i]!;
    // Con el diseño del original, un slide sin foto no puede mostrar tu cara: ese slide pasa a "Foto + texto".
    const noPhoto = design ? layoutFor(design.spec, s.type).photo.position === "none" : false;
    return {
      id: newSlideId(),
      type: i === 0 ? "cover" : i === got.length - 1 && got.length > 1 ? "cta" : s.type === "cover" || s.type === "cta" ? "item" : s.type,
      kicker: s.kicker.trim().slice(0, 60),
      headline: s.headline.trim().slice(0, 300),
      highlight: s.highlight.trim().slice(0, 120),
      body: s.body.trim().slice(0, 600),
      cta: s.cta.trim().slice(0, 200),
      template: character && noPhoto ? "foto" : null,
      scenePrompt: s.scenePrompt.trim().slice(0, 600) || null,
      character,
      pose: character ? s.pose.trim().slice(0, 300) || defaultPose(i) : null,
      photoKey: null,
      original: { text: s.originalText.trim().slice(0, 1500), visual: s.visual.trim().slice(0, 400), person: s.person },
    };
  });

  const originalText = got.map((s, i) => `SLIDE ${i + 1}: ${s.originalText.trim()}`).join("\n");
  const ctaKeyword = keyword ?? sanitizeKeyword(reading.original.cta);
  const readingRow: CarouselCopyReading = {
    handle: reading.original.handle.trim() ? `@${reading.original.handle.trim().replace(/^@+/, "").slice(0, 60)}` : null,
    language: reading.original.language.trim().slice(0, 40),
    topic: reading.original.topic.trim().slice(0, 300),
    slides: got.map((s) => ({ text: s.originalText.trim().slice(0, 1500), role: s.role, visual: s.visual.trim().slice(0, 400), person: s.person })),
  };

  const carouselId = await getDb().transaction(async (tx) => {
    const [locked] = await tx.select({ status: schema.carouselCopies.status, carouselId: schema.carouselCopies.carouselId }).from(schema.carouselCopies).where(eq(schema.carouselCopies.id, copyId)).for("update").limit(1);
    if (locked?.status === "READY" && locked.carouselId) return locked.carouselId;
    const [row] = await tx
      .insert(schema.carousels)
      .values({
        title: reading.title.trim().slice(0, 200) || "Carrusel copiado",
        topic: readingRow.topic || null,
        status: "DRAFT",
        template,
        theme: templateId ? { palette: "referencia" } : null,
        slides,
        caption: reading.caption.trim(),
        hashtags: cleanTags(reading.hashtags),
        ctaKeyword,
        // Lo que cuenta como origen para el chequeo de cifras: el texto literal del original y el del post.
        sourceText: [`Texto del carrusel original:\n${originalText}`, postText ? `Texto del post original:\n${postText.slice(0, 3000)}` : ""].filter(Boolean).join("\n\n"),
        createdBy: job.createdBy,
      })
      .returning({ id: schema.carousels.id });
    await tx
      .update(schema.carouselCopies)
      .set({ status: "READY", reading: readingRow, templateId, carouselId: row!.id, referenceCount: images.length, errorMessage: null })
      .where(eq(schema.carouselCopies.id, copyId));
    return row!.id;
  });
  await deleteReferences(copyId);
  return { carouselId };
}
