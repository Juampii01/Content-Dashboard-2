import "server-only";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { AiError, generateStructured } from "@/lib/ai/client";
import { STYLE_RULES, styleSchema, styleTask } from "@/lib/ai/prompts/carruseles";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import { enqueueJob } from "@/lib/jobs";
import { fileInfo } from "@/lib/storage";
import { deleteReferences, REF_KEY_RE } from "./files";
import { draftSpec, measurementsSchema } from "./style/draft";
import { normalizeSpec, parseSpec, type TemplateSpec } from "./template-spec";
import { customRef } from "./theme";

/**
 * Plantillas desde referencia: crear (con imágenes subidas o un link), analizar en el worker (CAROUSEL_STYLE),
 * terminar el análisis con Claude (visión) y administrar (renombrar, borrar).
 * Quien llama comprueba la sesión (acciones con requireEditor; el worker con WORKER_SECRET y su trabajo en curso).
 */
export class TemplateError extends Error {}

export const MIN_REFERENCES = 2;
export const MAX_REFERENCES = 20;
const LINK_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/?(\?.*)?$/;

export function defaultTemplateName(): string {
  return `Estilo del ${formatDate(new Date())}`;
}

export function validInstagramLink(url: string): boolean {
  return LINK_RE.test(url.trim());
}

export async function createTemplate(input: { name: string | null; source: "upload" | "link"; url?: string | null; userId: string }): Promise<string> {
  if (input.source === "link" && !validInstagramLink(input.url ?? "")) throw new TemplateError("Pega el link de un carrusel de Instagram (instagram.com/p/…).");
  const [row] = await getDb()
    .insert(schema.carouselTemplates)
    .values({
      name: (input.name?.trim() || defaultTemplateName()).slice(0, 80),
      status: "ANALYZING",
      source: input.source,
      sourceUrl: input.source === "link" ? input.url!.trim().split("?")[0] : null,
      createdBy: input.userId,
    })
    .returning({ id: schema.carouselTemplates.id });
  if (input.source === "link") await enqueueStyleJob(row!.id, { source: "link", url: input.url!.trim() }, input.userId);
  return row!.id;
}

async function enqueueStyleJob(templateId: string, data: { source: "link"; url: string } | { source: "upload"; keys: string[] }, userId: string) {
  return enqueueJob({ type: "CAROUSEL_STYLE", input: { templateId, ...data }, createdBy: userId, maxAttempts: 2, stage: "En cola" });
}

/** Encola el análisis de las imágenes ya subidas (claves `carruseles-ref/<id>/NN.ext`, comprobadas una por una). */
export async function analyzeUploads(templateId: string, keys: string[], userId: string): Promise<string> {
  const [row] = await getDb().select().from(schema.carouselTemplates).where(eq(schema.carouselTemplates.id, templateId)).limit(1);
  if (!row || row.source !== "upload") throw new TemplateError("No encontramos esa plantilla.");
  if (row.status !== "ANALYZING") throw new TemplateError("Esta plantilla ya se analizó.");
  const unique = [...new Set(keys)].sort();
  if (unique.length < MIN_REFERENCES) throw new TemplateError("Sube al menos 2 imágenes del carrusel.");
  if (unique.length > MAX_REFERENCES) throw new TemplateError("Sube como máximo 20 imágenes.");
  for (const key of unique) {
    if (!REF_KEY_RE.test(key) || !key.startsWith(`carruseles-ref/${templateId}/`)) throw new TemplateError("Una de las imágenes no es de esta plantilla. Vuelve a subirlas.");
    if (!(await fileInfo(key))) throw new TemplateError("Una de las imágenes no terminó de subirse. Vuelve a intentarlo.");
  }
  const running = await latestStyleJob(templateId);
  if (running && (running.status === "QUEUED" || running.status === "RUNNING")) return running.id;
  await getDb().update(schema.carouselTemplates).set({ referenceCount: unique.length }).where(eq(schema.carouselTemplates.id, templateId));
  return enqueueStyleJob(templateId, { source: "upload", keys: unique }, userId);
}

export async function latestStyleJob(templateId: string) {
  const [job] = await getDb()
    .select({ id: schema.jobs.id, status: schema.jobs.status, progress: schema.jobs.progress, stage: schema.jobs.stage, errorMessage: schema.jobs.errorMessage })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "CAROUSEL_STYLE"), sql`${schema.jobs.input}->>'templateId' = ${templateId}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return job ?? null;
}

/**
 * Lo llama el worker (con su trabajo en curso) con las medidas y las imágenes reducidas. Arma el borrador medido,
 * se lo pasa a Claude con las imágenes, valida el resultado y deja la plantilla lista. Borra las referencias.
 */
export async function finishStyle(job: { id: string; input: unknown; createdBy: string | null }, rawMeasurements: unknown, images: string[]): Promise<{ spec: TemplateSpec; usedAi: boolean }> {
  const templateId = String((job.input as { templateId?: string }).templateId ?? "");
  const [row] = await getDb().select().from(schema.carouselTemplates).where(eq(schema.carouselTemplates.id, templateId)).limit(1);
  if (!row) throw new TemplateError("La plantilla ya no existe.");
  const parsed = measurementsSchema.safeParse(rawMeasurements);
  if (!parsed.success) throw new TemplateError("Las medidas del carrusel llegaron incompletas.");
  const measurements = parsed.data;
  const draft = draftSpec(measurements);

  let spec = draft;
  let usedAi = false;
  try {
    const result = await generateStructured({
      feature: "carruseles.estilo",
      model: "main",
      context: STYLE_RULES,
      task: styleTask({ slides: measurements.slides.length, measurements: compactMeasurements(measurements), draft: JSON.stringify(draft) }),
      schema: styleSchema,
      images: images.slice(0, 12).map((data) => ({ mediaType: "image/jpeg" as const, data })),
      maxTokens: 6_000,
      userId: job.createdBy,
      jobId: job.id,
    });
    spec = normalizeSpec(result, draft);
    usedAi = true;
  } catch (error) {
    // Sin IA, el borrador medido ya es una plantilla usable: se guarda y se avisa en el log.
    console.error("[carruseles/estilo]", error instanceof AiError ? error.detail : error instanceof Error ? error.message : "error");
  }
  await getDb()
    .update(schema.carouselTemplates)
    .set({ status: "READY", spec, measurements: measurements as unknown as Record<string, unknown>, referenceCount: measurements.slides.length, errorMessage: null })
    .where(eq(schema.carouselTemplates.id, templateId));
  await deleteReferences(templateId);
  return { spec, usedAi };
}

/** Medidas resumidas para el prompt (sin repetir paletas largas): lo que Claude necesita para corregir el borrador. */
function compactMeasurements(m: ReturnType<typeof measurementsSchema.parse>): string {
  return JSON.stringify({
    summary: m.summary,
    slides: m.slides.map((s) => ({
      i: s.index + 1,
      bg: s.background,
      photo: s.photo,
      blocks: s.text_blocks.map((b) => ({ role: b.role, x: b.x, y: b.y, w: b.w, h: b.h, lines: b.lines, px: b.font_px, lh: b.line_height, color: b.color, hl: b.highlight, align: b.align, upper: b.upper_ratio })),
      fonts: { headline: s.fonts.headline?.slice(0, 2), body: s.fonts.body?.slice(0, 2) },
      ornaments: s.ornaments,
    })),
  });
}

// ─── Administrar ──────────────────────────────────────────────────────────

export type TemplateListItem = {
  id: string;
  name: string;
  status: "ANALYZING" | "READY" | "FAILED";
  source: string;
  referenceCount: number;
  spec: TemplateSpec | null;
  errorMessage: string | null;
  updatedAt: Date;
  createdAt: Date;
};

export async function listTemplates(onlyReady = false): Promise<TemplateListItem[]> {
  const rows = await getDb()
    .select()
    .from(schema.carouselTemplates)
    .where(onlyReady ? eq(schema.carouselTemplates.status, "READY") : undefined)
    .orderBy(desc(schema.carouselTemplates.updatedAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    source: r.source,
    referenceCount: r.referenceCount,
    spec: parseSpec(r.spec),
    errorMessage: r.errorMessage,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  }));
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  const res = await getDb().update(schema.carouselTemplates).set({ name: name.trim().slice(0, 80) }).where(eq(schema.carouselTemplates.id, id)).returning({ id: schema.carouselTemplates.id });
  if (!res.length) throw new TemplateError("No encontramos esa plantilla.");
}

/** Carruseles que usan la plantilla (en todo el carrusel o en algún slide). */
export async function carouselsUsing(id: string) {
  const ref = customRef(id);
  return getDb()
    .select({ id: schema.carousels.id, template: schema.carousels.template, slides: schema.carousels.slides })
    .from(schema.carousels)
    .where(or(eq(schema.carousels.template, ref), like(sql`${schema.carousels.slides}::text`, `%${ref}%`)));
}

/** Borra la plantilla: cancela su análisis, borra las referencias y pasa a Editorial los carruseles que la usaban. */
export async function deleteTemplate(id: string): Promise<number> {
  const ref = customRef(id);
  const using = await carouselsUsing(id);
  for (const c of using) {
    const slides: CarouselSlide[] = c.slides.map((s) => (s.template === ref ? { ...s, template: null } : s));
    await getDb()
      .update(schema.carousels)
      .set({ template: c.template === ref ? "editorial" : c.template, slides })
      .where(eq(schema.carousels.id, c.id));
  }
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "CAROUSEL_STYLE"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'templateId' = ${id}`));
  await getDb().delete(schema.carouselTemplates).where(eq(schema.carouselTemplates.id, id));
  await deleteReferences(id);
  return using.length;
}
