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
  slideOnlySchema,
  slideTask,
  type GeneratedSlide,
} from "@/lib/ai/prompts/carruseles";
import { scriptAsText } from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide, ScriptContent } from "@/lib/db/schema";
import type { CarouselObjective } from "./labels";
import { newSlideId, type TemplateKey } from "./theme";
import { LIMITS, normalizeHashtag } from "./validate";

/**
 * Lógica de Carruseles: generar la ficha con IA y las acciones de IA sobre un slide.
 * Las imágenes no se generan aquí: las dibuja la plantilla en el navegador.
 */
async function context(): Promise<string> {
  return `${CAROUSEL_RULES}\n\n${await brandContext(await getBrand())}`;
}

function toSlide(s: GeneratedSlide, keep?: Pick<CarouselSlide, "id" | "template" | "imageUrl">): CarouselSlide {
  return {
    id: keep?.id ?? newSlideId(),
    type: s.type,
    kicker: s.kicker.trim(),
    headline: s.headline.trim(),
    highlight: s.highlight.trim(),
    body: s.body.trim(),
    cta: s.cta.trim(),
    template: keep?.template ?? null,
    ...(keep?.imageUrl ? { imageUrl: keep.imageUrl } : {}),
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
  template: TemplateKey;
  userId: string;
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
    feature: "carruseles.ficha",
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
