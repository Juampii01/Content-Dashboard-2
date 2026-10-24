import "server-only";
import { eq } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { generateStructured } from "@/lib/ai/client";
import {
  CAROUSEL_RULES,
  captionSchema,
  captionTask,
  carouselAsText,
  carouselSchema,
  coversSchema,
  coversTask,
  generateTask,
  scenesSchema,
  scenesTask,
  slideOnlySchema,
  slideTask,
  type GeneratedSlide,
} from "@/lib/ai/prompts/carruseles";
import { HOOK_TYPES, variantsSchema, variantsTask } from "@/lib/ai/prompts/carruseles-copia";
import { scriptAsText } from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import type { CaptionVariant, CarouselSlide, ScriptContent } from "@/lib/db/schema";
import { cleanTags } from "./captions";
import type { CarouselObjective } from "./labels";
import { newSlideId, type TemplateRef } from "./theme";
import { LIMITS, normalizeHashtag } from "./validate";

/**
 * Lógica de Carruseles: generar la ficha con IA y las acciones de IA sobre un slide.
 * Las imágenes no se generan aquí: las dibuja la plantilla en el navegador.
 */
async function context(): Promise<string> {
  return `${CAROUSEL_RULES}\n\n${await brandContext(await getBrand())}`;
}

/**
 * Slide a partir de lo que escribió la IA. `keep` es el slide actual: se conserva todo lo que la IA no escribe
 * (plantilla, imagen, escena, personaje, original, video) y se reemplaza solo el texto.
 */
function toSlide(s: GeneratedSlide & { scenePrompt?: string }, keep?: CarouselSlide): CarouselSlide {
  return {
    ...keep,
    id: keep?.id ?? newSlideId(),
    type: s.type,
    kicker: s.kicker.trim(),
    headline: s.headline.trim(),
    highlight: s.highlight.trim(),
    body: s.body.trim(),
    cta: s.cta.trim(),
    template: keep?.template ?? null,
    ...(s.scenePrompt?.trim() ? { scenePrompt: s.scenePrompt.trim().slice(0, 600) } : {}),
  };
}

function cleanHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map(normalizeHashtag)) {
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.slice(0, LIMITS.hashtags);
}

/** Texto del guion que sirve de origen (gancho, bloques con su texto en pantalla, CTA y caption). */
function scriptSource(c: ScriptContent): string {
  return [scriptAsText(c), ...c.beats.map((b) => b.onScreenText), c.cta.onScreenText, c.caption].filter(Boolean).join("\n");
}

export async function createCarousel(input: {
  origin: "tema" | "guion" | "texto";
  topic: string;
  pastedText: string | null;
  scriptId: string | null;
  objective: CarouselObjective;
  slides: number;
  keyword: string | null;
  template: TemplateRef;
  /** Colores elegidos al crear (por ejemplo "referencia" con una plantilla propia). */
  theme?: Record<string, string> | null;
  /** Tipos de slide de la referencia, si se quiere respetar su estructura. */
  structure?: string[] | null;
  userId: string | null;
  /** Nombre del consumo en ai_usage (por defecto "carruseles.ficha"; el autopiloto y "Sacarle todo el jugo" usan el suyo). */
  feature?: string;
}): Promise<string> {
  let topic = input.topic;
  let sourceText: string | null = input.origin === "texto" ? input.pastedText : null;
  let beats: { purpose: string; text: string }[] | null = null;
  let scriptId: string | null = null;

  if (input.origin === "guion") {
    if (!input.scriptId) throw new Error("Elige un guion para armar el carrusel.");
    const [script] = await getDb().select().from(schema.scripts).where(eq(schema.scripts.id, input.scriptId)).limit(1);
    if (!script?.content) throw new Error("No encontramos ese guion.");
    scriptId = script.id;
    sourceText = scriptSource(script.content);
    topic = topic || script.idea || script.title;
    const usable = script.content.beats.filter((b) => b.spoken.trim() || b.onScreenText.trim());
    // Un slide por bloque, sin pasarse de 10 en total (portada y cierre incluidos).
    if (usable.length >= 2) beats = usable.slice(0, LIMITS.maxSlides - 2).map((b) => ({ purpose: b.purpose, text: [b.onScreenText, b.spoken].filter(Boolean).join(" — ") }));
  }

  const brand = await getBrand();
  const offer = input.keyword ? (brand?.offers.find((o) => o.keyword?.toLowerCase() === input.keyword!.toLowerCase()) ?? null) : null;
  const generated = await generateStructured({
    feature: input.feature ?? "carruseles.ficha",
    model: "main",
    context: await context(),
    task: generateTask({
      origin: input.origin,
      topic,
      sourceText,
      beats,
      objective: input.objective,
      slides: input.slides,
      keyword: input.keyword,
      offer: offer ? `${offer.name}: ${offer.promise}. CTA: ${offer.cta}` : null,
      structure: input.structure ?? null,
    }),
    schema: carouselSchema,
    maxTokens: 4_000,
    userId: input.userId,
  });

  const slides = generated.slides.slice(0, LIMITS.maxSlides).map((s) => toSlide(s));
  const [row] = await getDb()
    .insert(schema.carousels)
    .values({
      title: generated.title.trim().slice(0, 200) || topic.slice(0, 120),
      topic,
      status: "DRAFT",
      template: input.template,
      theme: input.theme ?? null,
      slides,
      caption: generated.caption.trim(),
      hashtags: cleanHashtags(generated.hashtags),
      ctaKeyword: input.keyword,
      // Lo que cuenta como "origen" para el chequeo de cifras: el tema más el texto o guion.
      sourceText: [topic, sourceText].filter(Boolean).join("\n\n"),
      scriptId,
      createdBy: input.userId,
    })
    .returning({ id: schema.carousels.id });
  return row!.id;
}

async function exists(carouselId: string) {
  const [row] = await getDb().select({ id: schema.carousels.id, ctaKeyword: schema.carousels.ctaKeyword }).from(schema.carousels).where(eq(schema.carousels.id, carouselId)).limit(1);
  if (!row) throw new Error("No encontramos ese carrusel.");
  return row;
}

export async function rewriteSlide(carouselId: string, slides: CarouselSlide[], slideId: string, instruction: string, userId: string): Promise<CarouselSlide> {
  await exists(carouselId);
  const index = slides.findIndex((s) => s.id === slideId);
  if (index < 0) throw new Error("Ese slide ya no existe.");
  const current = slides[index]!;
  const { type, kicker, headline, highlight, body, cta } = current;
  const res = await generateStructured({
    feature: "carruseles.slide",
    model: "fast",
    context: await context(),
    task: slideTask(carouselAsText(slides), index, JSON.stringify({ type, kicker, headline, highlight, body, cta }), instruction.slice(0, 300)),
    schema: slideOnlySchema,
    userId,
  });
  // El tipo del slide no cambia aunque la IA proponga otro: es una decisión de estructura.
  return toSlide({ ...res.slide, type }, current);
}

export async function coverOptions(carouselId: string, slides: CarouselSlide[], userId: string) {
  await exists(carouselId);
  const cover = slides[0];
  const res = await generateStructured({
    feature: "carruseles.portada",
    model: "main",
    context: await context(),
    task: coversTask(carouselAsText(slides), cover ? `${cover.kicker} · ${cover.headline}` : "(sin portada)"),
    schema: coversSchema,
    userId,
  });
  return res.covers.slice(0, 3).map((c) => ({ kicker: c.kicker.trim(), headline: c.headline.trim(), highlight: c.highlight.trim(), body: c.body.trim() }));
}

export async function newCaption(carouselId: string, slides: CarouselSlide[], userId: string): Promise<{ caption: string; hashtags: string[] }> {
  const row = await exists(carouselId);
  const res = await generateStructured({
    feature: "carruseles.caption",
    model: "fast",
    context: await context(),
    task: captionTask(carouselAsText(slides), row.ctaKeyword),
    schema: captionSchema,
    userId,
  });
  return { caption: res.caption.trim(), hashtags: cleanHashtags(res.hashtags) };
}

/**
 * Propone la escena (sin texto) de los slides que no la tienen, para generar sus imágenes. En los slides donde sale
 * el personaje, la escena lo incluye y trae su pose (si el slide no tenía una).
 */
export async function proposeScenes(carouselId: string, slides: CarouselSlide[], slideIds: string[], userId: string): Promise<Record<string, { scene: string; pose: string }>> {
  await exists(carouselId);
  const indexes = slideIds.map((id) => slides.findIndex((s) => s.id === id)).filter((i) => i >= 0);
  if (!indexes.length) return {};
  const withCharacter = indexes.filter((i) => slides[i]!.character === true);
  const res = await generateStructured({
    feature: "carruseles.escenas",
    model: "fast",
    context: await context(),
    task: scenesTask(carouselAsText(slides), indexes, withCharacter),
    schema: scenesSchema,
    userId,
  });
  const out: Record<string, { scene: string; pose: string }> = {};
  for (const scene of res.scenes) {
    const slide = slides[scene.index - 1];
    if (slide && indexes.includes(scene.index - 1) && scene.scenePrompt.trim()) out[slide.id] = { scene: scene.scenePrompt.trim().slice(0, 600), pose: scene.pose.trim().slice(0, 300) };
  }
  return out;
}

/** 5 variaciones del caption (dato, pregunta, problema, promesa, curiosidad) con 5 hashtags distintos cada una. */
export async function captionVariants(carouselId: string, slides: CarouselSlide[], caption: string, userId: string): Promise<CaptionVariant[]> {
  const row = await exists(carouselId);
  const res = await generateStructured({
    feature: "carruseles.variaciones",
    model: "fast",
    context: await context(),
    task: variantsTask({ carousel: carouselAsText(slides), caption, keyword: row.ctaKeyword }),
    schema: variantsSchema,
    maxTokens: 4_000,
    userId,
    fake: () => ({
      variants: HOOK_TYPES.map((hook, i) => ({
        hook,
        caption: `${["Un dato que cambia cómo contestas el teléfono.", "¿Sabes qué escucha tu paciente en los primeros segundos?", "Llaman, preguntan el precio y no vuelven.", "Llena tu agenda sin gastar más en anuncios.", "Lo que tu recepción hace sin darse cuenta."][i]}\n\nTodo está en el orden de la llamada: primero escuchas, después explicas.\n\n${row.ctaKeyword ? `💬 Comenta ${row.ctaKeyword} y te mando el guion.` : "Compártelo con tu equipo."}\n\n📌 Guárdalo para ${["tu próxima reunión de equipo", "entrenar a tu recepción", "revisar tus llamadas", "el lunes", "cuando vuelvas a contestar"][i]}.`,
        hashtags: [["#clinicadental", "#marketingdental", "#recepcion", "#dentistas", "#pacientes"], ["#odontologia", "#agendallena", "#clinicas", "#ventas", "#llamadas"], ["#dentistaslatinos", "#recepcion", "#negocios", "#salud", "#marketing"], ["#clinicadental", "#crecimiento", "#agenda", "#emprendedores", "#odontologos"], ["#dentistas", "#tips", "#atencionalcliente", "#clinicas", "#marketingdigital"]][i]!,
      })),
    }),
  });
  return res.variants.slice(0, 5).map((v) => ({ hook: v.hook, caption: v.caption.trim(), hashtags: cleanTags(v.hashtags) }));
}
