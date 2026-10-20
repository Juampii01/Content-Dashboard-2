"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isDenied, requireEditor } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";

const AI_LIMIT = "Hiciste muchos pedidos a la IA seguidos. Espera unos minutos y vuelve a intentar.";
/** Tope de llamadas de IA por persona y por hora (protege el costo de la clave del servidor). */
const withinAiLimit = (userId: string) => allowAttempt(`carruseles:${userId}`, 60, 3600);
import { AiError } from "@/lib/ai/client";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";
import { CAROUSEL_OBJECTIVES, type CarouselObjective, type CarouselStatus } from "@/lib/carousels/labels";
import { coverOptions, createCarousel, newCaption, rewriteSlide } from "@/lib/carousels/service";
import { customIdOf, FONTS, isTemplateRef, PALETTE_KEYS, type TemplateRef } from "@/lib/carousels/theme";
import { copySlideImages, deleteCarouselFolder } from "@/lib/carousels/files";
import { getTemplate } from "@/lib/carousels/templates";
import { SLIDE_TYPE_KEYS } from "@/lib/carousels/template-spec";
import { LIMITS } from "@/lib/carousels/validate";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AiError) {
    console.error("[ia]", error.detail);
    return { ok: false, error: error.userMessage };
  }
  console.error("[carruseles]", error instanceof Error ? error.message : error);
  return { ok: false, error: error instanceof Error && /carrusel|slide|guion/.test(error.message) ? error.message : "Algo salió mal. Prueba de nuevo." };
}

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Carrusel no válido.");
/** Plantilla de fábrica (`editorial`, `foto`…) o propia (`custom:<uuid>`). */
const templateEnum = z.string().refine((v): v is TemplateRef => isTemplateRef(v), "Plantilla no válida.");

const newCarousel = z
  .object({
    origin: z.enum(["tema", "guion", "texto"]),
    topic: z.string().trim().max(600, "El tema es demasiado largo.").default(""),
    pastedText: z.string().trim().max(12000, "El texto es demasiado largo: pega hasta 12.000 caracteres.").default(""),
    scriptId: z.string().default(""),
    objective: z.enum(Object.keys(CAROUSEL_OBJECTIVES) as [CarouselObjective, ...CarouselObjective[]]),
    // Con la estructura de una referencia puede ir de 3 a 20; si no, entre los límites de siempre (ver superRefine).
    slides: z.coerce.number().int().min(3).max(20),
    keyword: z
      .string()
      .trim()
      .max(30, "La palabra clave es demasiado larga.")
      .regex(/^[\p{L}\p{N}_-]*$/u, "La palabra clave va sin espacios ni símbolos (por ejemplo, AGENDA).")
      .default(""),
    template: templateEnum,
    palette: z.enum(["", "marca", "referencia"]).default(""),
    /** Tipos de slide de la referencia, separados por coma, si se respeta su estructura. */
    structure: z.string().max(400).default(""),
  })
  .superRefine((d, ctx) => {
    if (d.origin === "tema" && d.topic.length < 8) ctx.addIssue({ code: "custom", message: "Cuenta el tema en una o dos frases." });
    if (d.origin === "texto" && d.pastedText.length < 40) ctx.addIssue({ code: "custom", message: "Pega el texto de origen (al menos un par de frases)." });
    if (d.origin === "guion" && !/^[0-9a-f-]{36}$/i.test(d.scriptId)) ctx.addIssue({ code: "custom", message: "Elige un guion." });
    if (!d.structure && (d.slides < LIMITS.minSlides || d.slides > LIMITS.maxSlides)) ctx.addIssue({ code: "custom", message: `Elige entre ${LIMITS.minSlides} y ${LIMITS.maxSlides} slides.` });
  });

export type NewCarouselState = { error?: string };

export async function createCarouselAction(_prev: NewCarouselState, formData: FormData): Promise<NewCarouselState> {
  const user = await requireEditor();
  if (isDenied(user)) return { error: user.error };
  if (!(await withinAiLimit(user.id))) return { error: AI_LIMIT };
  const parsed = newCarousel.safeParse(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  // Plantilla propia: tiene que existir y estar lista; la estructura solo vale con ella.
  const customId = customIdOf(d.template);
  let structure: string[] | null = null;
  if (customId) {
    const tpl = await getTemplate(customId);
    if (!tpl || tpl.status !== "READY" || !tpl.spec) return { error: "Esa plantilla ya no está disponible. Elige otra." };
    const types = d.structure.split(",").map((t) => t.trim()).filter((t): t is (typeof SLIDE_TYPE_KEYS)[number] => (SLIDE_TYPE_KEYS as readonly string[]).includes(t));
    if (types.length >= 3) structure = types.slice(0, 20);
  }
  let id: string;
  try {
    id = await createCarousel({
      origin: d.origin,
      topic: d.topic || (d.origin === "texto" ? d.pastedText.slice(0, 200) : ""),
      pastedText: d.pastedText || null,
      scriptId: d.origin === "guion" ? d.scriptId : null,
      objective: d.objective,
      slides: structure ? structure.length : d.slides,
      keyword: d.keyword ? d.keyword.toUpperCase() : null,
      template: d.template as TemplateRef,
      theme: customId && d.palette ? { palette: d.palette } : null,
      structure,
      userId: user.id,
    });
  } catch (error) {
    return { error: fail(error).error };
  }
  redirect(`/carruseles/${id}`);
}

const slideSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(["cover", "item", "step", "data", "quote", "cta"]),
  kicker: z.string().max(200),
  headline: z.string().max(600),
  highlight: z.string().max(200),
  body: z.string().max(1500),
  cta: z.string().max(300),
  template: templateEnum.nullable().optional(),
  // Solo imágenes nuestras (subidas o generadas), servidas por la app con sesión.
  imageUrl: z.string().max(400).regex(/^\/api\/carruseles\/archivos\/carruseles\/[0-9a-f-]{36}\/[a-z0-9-]+\.(jpg|png|webp)$/i, "Imagen no válida.").nullable().optional(),
  imageSource: z.enum(["upload", "ai"]).nullable().optional(),
  scenePrompt: z.string().max(600).nullable().optional(),
});
const slidesSchema = z.array(slideSchema).min(1, "El carrusel necesita al menos un slide.").max(20, "Máximo 20 slides.");

const themeSchema = z
  .object({
    palette: z.enum(PALETTE_KEYS as unknown as [string, ...string[]]).optional(),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    font: z.enum(Object.keys(FONTS) as [string, ...string[]]).optional(),
  })
  .strict();

const saveSchema = z.object({
  title: z.string().trim().min(1, "Ponle un título al carrusel.").max(200),
  template: templateEnum,
  theme: themeSchema,
  slides: slidesSchema,
  caption: z.string().max(5000, "El caption es demasiado largo."),
  hashtags: z.array(z.string().trim().max(80)).max(30),
});
export type CarouselDraft = Omit<z.infer<typeof saveSchema>, "slides"> & { slides: CarouselSlide[] };

export async function saveCarouselAction(id: string, draft: CarouselDraft): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Carrusel no válido." };
  const parsed = saveSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Hay un campo demasiado largo. Revísalo y vuelve a guardar." };
  const d = parsed.data;
  const res = await getDb()
    .update(schema.carousels)
    .set({ title: d.title, template: d.template, theme: d.theme as Record<string, string>, slides: d.slides as CarouselSlide[], caption: d.caption, hashtags: d.hashtags.filter(Boolean) })
    .where(eq(schema.carousels.id, id))
    .returning({ id: schema.carousels.id });
  if (!res.length) return { ok: false, error: "No encontramos ese carrusel." };
  return { ok: true };
}

export async function rewriteSlideAction(id: string, slides: CarouselSlide[], slideId: string, instruction: string): Promise<ActionResult<CarouselSlide>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await withinAiLimit(user.id))) return { ok: false, error: AI_LIMIT };
  const parsed = slidesSchema.safeParse(slides);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: "No pudimos leer el carrusel. Recarga la página." };
  try {
    return { ok: true, data: await rewriteSlide(id, parsed.data as CarouselSlide[], slideId, String(instruction ?? ""), user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function coverOptionsAction(id: string, slides: CarouselSlide[]): Promise<ActionResult<{ kicker: string; headline: string; highlight: string; body: string }[]>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await withinAiLimit(user.id))) return { ok: false, error: AI_LIMIT };
  const parsed = slidesSchema.safeParse(slides);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: "No pudimos leer el carrusel. Recarga la página." };
  try {
    return { ok: true, data: await coverOptions(id, parsed.data as CarouselSlide[], user.id) };
  } catch (error) {
    return fail(error);
  }
}

export async function captionAction(id: string, slides: CarouselSlide[]): Promise<ActionResult<{ caption: string; hashtags: string[] }>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!(await withinAiLimit(user.id))) return { ok: false, error: AI_LIMIT };
  const parsed = slidesSchema.safeParse(slides);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: "No pudimos leer el carrusel. Recarga la página." };
  try {
    return { ok: true, data: await newCaption(id, parsed.data as CarouselSlide[], user.id) };
  } catch (error) {
    return fail(error);
  }
}

const statuses = ["DRAFT", "READY", "EXPORTED", "ARCHIVED"] as const satisfies readonly CarouselStatus[];

export async function setCarouselStatusAction(id: string, status: CarouselStatus): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success || !statuses.includes(status)) return { ok: false, error: "Estado no válido." };
  await getDb().update(schema.carousels).set({ status }).where(eq(schema.carousels.id, id));
  refresh();
  return { ok: true };
}

/** Se llama cuando el ZIP ya se armó en el navegador. */
export async function markExportedAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Carrusel no válido." };
  await getDb().update(schema.carousels).set({ status: "EXPORTED", exportedAt: new Date() }).where(eq(schema.carousels.id, id));
  return { ok: true };
}

export async function duplicateCarouselAction(id: string): Promise<ActionResult<string>> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Carrusel no válido." };
  const [row] = await getDb().select().from(schema.carousels).where(eq(schema.carousels.id, id)).limit(1);
  if (!row) return { ok: false, error: "No encontramos ese carrusel." };
  const [copy] = await getDb()
    .insert(schema.carousels)
    .values({
      title: `${row.title} (copia)`.slice(0, 200),
      topic: row.topic,
      status: "DRAFT",
      template: row.template,
      theme: row.theme,
      slides: row.slides,
      caption: row.caption,
      hashtags: row.hashtags,
      ctaKeyword: row.ctaKeyword,
      sourceText: row.sourceText,
      scriptId: row.scriptId,
      createdBy: user.id,
    })
    .returning({ id: schema.carousels.id });
  // Las imágenes se copian a la carpeta de la copia (si no, borrar el original la dejaría sin ellas).
  if (row.slides.some((s) => s.imageUrl)) {
    await getDb().update(schema.carousels).set({ slides: await copySlideImages(row.slides, copy!.id) }).where(eq(schema.carousels.id, copy!.id));
  }
  refresh();
  return { ok: true, data: copy!.id };
}

/** Borra un carrusel. La interfaz pide confirmación antes de llamar. */
export async function deleteCarouselAction(id: string): Promise<ActionResult> {
  const user = await requireEditor();
  if (isDenied(user)) return user;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Carrusel no válido." };
  await getDb().delete(schema.carousels).where(eq(schema.carousels.id, id));
  // Sus imágenes (subidas o generadas) no quedan sueltas en el almacenamiento.
  await deleteCarouselFolder(id);
  refresh();
  return { ok: true };
}
