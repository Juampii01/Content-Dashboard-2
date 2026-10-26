import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { generateStructured } from "@/lib/ai/client";
import { CONCEPT_RULES, conceptsSchema, conceptsTask, TITLE_RULES, titlesSchema, titlesTask } from "@/lib/ai/prompts/youtube";
import { IMAGE_PROVIDERS, providersStatus, type ImageProviderId } from "@/lib/carousels/images";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { loadSource } from "@/lib/repurpose/source";
import { BACKGROUND_KEY_RE, CUTOUT_KEY_RE, deletePackageFolder, deleteThumbFiles, MAX_PHOTOS, PHOTO_KEY_RE } from "./files";
import { backgroundPrompt, thumbWords } from "./thumbnail-layout";
import { countFitting, normalizeTitleGroups, TITLE_VISIBLE_MAX } from "./titles";
import { pieceTranscript } from "./retention-service";
import { segmentsText } from "./transcript";
import type { ThumbnailConcept, TitleBasis, TitleGroup } from "./types";

/**
 * "Títulos y miniaturas" de YouTube: a partir de un guion, un video del Editor, una pieza publicada o un tema se
 * proponen 8 a 10 títulos por ángulo (con la base de lo que mejor le rindió al canal) y 3 conceptos de miniatura.
 * Los fondos los genera el worker (YT_THUMBNAILS) con el mismo proveedor de imágenes de Carruseles; el texto lo dibuja
 * la plantilla en el navegador. Sin sesión: lo llaman las acciones y las rutas, que ya la validan.
 */
export class PackageError extends Error {}

export type PackageSourceKind = "guion" | "video" | "pieza" | "tema";
const shortId = () => randomBytes(4).toString("hex");

// ─── Base de los títulos ────────────────────────────────────────────────

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0;
};

/**
 * Los títulos de YouTube que mejor le rindieron al canal. La API de YouTube Analytics no da el CTR de las miniaturas
 * (impresiones y clics solo salen en YouTube Studio o en los reportes masivos de la Reporting API), así que se mide
 * con las vistas: a los 7 días contra la mediana del mismo tipo (el puntaje de Métricas) o, si no hay, las vistas
 * totales contra la mediana de los videos del mismo tipo.
 */
export async function titleBasis(format: "VIDEO" | "SHORT"): Promise<TitleBasis> {
  const rows = await getDb()
    .select({ title: schema.contentItems.title, type: schema.contentItems.type, views: schema.contentItems.views, perf: schema.contentItems.perfScore })
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.platform, "YOUTUBE"), eq(schema.contentItems.available, true), sql`${schema.contentItems.title} is not null`, sql`${schema.contentItems.publishedAt} > now() - interval '730 days'`));
  const byType = new Map<string, number>();
  for (const type of ["VIDEO", "SHORT"]) {
    const views = rows.filter((r) => r.type === type && r.views != null).map((r) => Number(r.views));
    if (views.length >= 4) byType.set(type, median(views));
  }
  const scored = rows
    .map((r) => {
      const m = byType.get(r.type);
      const ratio = r.perf != null ? Number(r.perf) : m && r.views != null ? Number(r.views) / m : null;
      return ratio == null || !r.title ? null : { title: r.title.slice(0, 120), ratio, type: r.type as "VIDEO" | "SHORT" };
    })
    .filter((r): r is NonNullable<typeof r> => r != null && r.ratio >= 1)
    .sort((a, b) => Number(b.type === format) - Number(a.type === format) || b.ratio - a.ratio)
    .slice(0, 8);
  return {
    metric: "vistas",
    note: scored.length
      ? "Medido con vistas contra tu mediana: YouTube no da el CTR de las miniaturas por su API"
      : "Todavía no hay suficientes videos de YouTube para comparar; YouTube tampoco da el CTR por su API",
    examples: scored,
  };
}

// ─── Generación con IA ──────────────────────────────────────────────────

async function generateTitles(input: { format: "VIDEO" | "SHORT"; sourceLabel: string; title: string; text: string; basis: TitleBasis; userId: string }): Promise<TitleGroup[]> {
  const brand = await getBrand();
  const context = `${TITLE_RULES}\n\n${await brandContext(brand)}`;
  let groups = normalizeTitleGroups((await generateStructured({ feature: "youtube.titulos", context, task: titlesTask(input), schema: titlesSchema, maxTokens: 2000, userId: input.userId })).groups, 10, shortId);
  // Un reintento si quedaron pocos o muchos se cortan en el teléfono (los que pasan de 60 se marcan en la pantalla).
  const check = countFitting(groups);
  if (check.total < 8 || check.long.length > 2) {
    const feedback = [
      check.total < 8 ? `Diste ${check.total} títulos: tienen que ser 8 a 10.` : "",
      check.long.length ? `Estos pasan de ${TITLE_VISIBLE_MAX} caracteres; acórtalos: ${check.long.map((t) => `«${t}»`).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const retry = normalizeTitleGroups((await generateStructured({ feature: "youtube.titulos", context, task: titlesTask({ ...input, feedback }), schema: titlesSchema, maxTokens: 2000, userId: input.userId })).groups, 10, shortId);
    const again = countFitting(retry);
    if (again.fitting > check.fitting) groups = retry;
  }
  return groups;
}

function fixConceptText(text: string, highlight: string): { text: string; highlight: string } {
  const words = thumbWords(text);
  const kept = words.slice(0, 4).join(" ");
  const hl = thumbWords(highlight).every((w) => kept.toLowerCase().includes(w.toLowerCase())) ? highlight : words[words.length > 1 ? words.length - 1 : 0] ?? "";
  return { text: kept, highlight: hl };
}

async function generateConcepts(input: { title: string; text: string; titles: string[]; photoKey: string | null; userId: string }): Promise<ThumbnailConcept[]> {
  const brand = await getBrand();
  const result = await generateStructured({
    feature: "youtube.miniaturas",
    context: `${CONCEPT_RULES}\n\n${await brandContext(brand)}`,
    task: conceptsTask({ title: input.title, text: input.text, titles: input.titles, hasPhotos: Boolean(input.photoKey) }),
    schema: conceptsSchema,
    maxTokens: 1500,
    userId: input.userId,
  });
  return result.concepts.slice(0, 3).map((c) => {
    const fixed = fixConceptText(c.text, c.highlight);
    const withPhoto = c.withPhoto && c.layout !== "texto-centro";
    return {
      id: shortId(),
      name: c.name.slice(0, 60),
      idea: c.idea.slice(0, 300),
      text: fixed.text,
      highlight: fixed.highlight,
      scene: c.scene.slice(0, 600),
      layout: c.layout,
      font: null,
      photoKey: withPhoto ? input.photoKey : null,
      backgroundKey: null,
      backgroundStatus: "none",
    } satisfies ThumbnailConcept;
  });
}

// ─── Crear y editar ─────────────────────────────────────────────────────

async function sourceFor(kind: PackageSourceKind, id: string | null, topic: string | null) {
  if (kind === "tema") {
    const text = (topic ?? "").trim();
    if (text.length < 8) throw new PackageError("Escribe de qué trata el video (al menos una frase).");
    return { title: text.split("\n")[0]!.slice(0, 120), text, label: "Tema que escribiste", scriptId: null, videoProjectId: null, contentItemId: null, format: null as "VIDEO" | "SHORT" | null };
  }
  const source = id ? await loadSource(kind, id) : null;
  if (!source) throw new PackageError("No encontramos ese origen. Elige otro.");
  let text = source.text;
  let label = source.textOrigin;
  let format: "VIDEO" | "SHORT" | null = null;
  if (kind === "pieza") {
    const [item] = await getDb().select({ platform: schema.contentItems.platform, type: schema.contentItems.type }).from(schema.contentItems).where(eq(schema.contentItems.id, source.id)).limit(1);
    if (item?.platform !== "YOUTUBE") throw new PackageError("Elige un video o short de YouTube.");
    format = item.type === "SHORT" ? "SHORT" : "VIDEO";
    // Si la pieza tiene transcripción (subtítulos o Editor), es mucho más rica que el título y la descripción.
    const transcript = await pieceTranscript(source.id);
    if (transcript) {
      text = `${source.title}\n\n${segmentsText(transcript.segments)}`;
      label = transcript.label;
    }
  }
  if (source.words < 6 && text.length < 40) throw new PackageError("Ese origen tiene muy poco texto. Prueba con un guion completo o un video editado.");
  return { title: source.title, text, label, scriptId: source.scriptId, videoProjectId: source.videoProjectId, contentItemId: source.contentItemId, format };
}

export async function createPackage(input: { kind: PackageSourceKind; id: string | null; topic: string | null; format: "VIDEO" | "SHORT" | null; userId: string }): Promise<string> {
  const source = await sourceFor(input.kind, input.id, input.topic);
  const format = input.format ?? source.format ?? "VIDEO";
  const basis = await titleBasis(format);
  const photos = await brandPhotos();
  const titles = await generateTitles({ format, sourceLabel: source.label, title: source.title, text: source.text, basis, userId: input.userId });
  const concepts = await generateConcepts({ title: source.title, text: source.text, titles: titles.flatMap((g) => g.options.map((o) => o.text)), photoKey: photos[0] ?? null, userId: input.userId });
  const [row] = await getDb()
    .insert(schema.ytPackages)
    .values({
      title: source.title.slice(0, 160),
      sourceKind: input.kind,
      scriptId: source.scriptId,
      videoProjectId: source.videoProjectId,
      contentItemId: source.contentItemId,
      sourceText: source.text.slice(0, 20_000),
      format,
      titles,
      titleBasis: basis,
      concepts,
      createdBy: input.userId,
    })
    .returning({ id: schema.ytPackages.id });
  return row!.id;
}

async function loadPackage(id: string) {
  const [row] = await getDb().select().from(schema.ytPackages).where(eq(schema.ytPackages.id, id)).limit(1);
  if (!row) throw new PackageError("No encontramos ese paquete.");
  return row;
}

export async function regenerateTitles(id: string, userId: string): Promise<void> {
  const row = await loadPackage(id);
  const basis = await titleBasis(row.format);
  const titles = await generateTitles({ format: row.format, sourceLabel: "contenido guardado", title: row.title, text: row.sourceText, basis, userId });
  await getDb().update(schema.ytPackages).set({ titles, titleBasis: basis }).where(eq(schema.ytPackages.id, id));
}

export async function selectTitle(id: string, text: string | null): Promise<void> {
  await getDb().update(schema.ytPackages).set({ selectedTitle: text?.trim().slice(0, 100) || null }).where(eq(schema.ytPackages.id, id));
}

export type ConceptPatch = Partial<Pick<ThumbnailConcept, "text" | "highlight" | "layout" | "photoKey" | "scene" | "font" | "name">>;

/** Cambia un concepto (texto, foto, ubicación, fuente o escena). Nada de esto regenera el fondo. */
export async function updateConcept(id: string, conceptId: string, patch: ConceptPatch): Promise<void> {
  if (patch.photoKey && !PHOTO_KEY_RE.test(patch.photoKey)) throw new PackageError("Foto no válida.");
  if (patch.photoKey && !(await brandPhotos()).includes(patch.photoKey)) throw new PackageError("Esa foto ya no está en Mi marca.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ concepts: schema.ytPackages.concepts }).from(schema.ytPackages).where(eq(schema.ytPackages.id, id)).for("update").limit(1);
    if (!row) throw new PackageError("No encontramos ese paquete.");
    if (!row.concepts.some((c) => c.id === conceptId)) throw new PackageError("No encontramos esa miniatura.");
    const concepts = row.concepts.map((c) => (c.id === conceptId ? { ...c, ...patch } : c));
    await tx.update(schema.ytPackages).set({ concepts }).where(eq(schema.ytPackages.id, id));
  });
}

export async function deletePackage(id: string): Promise<void> {
  await getDb().delete(schema.ytPackages).where(eq(schema.ytPackages.id, id));
  await deletePackageFolder(id);
}

// ─── Fotos del personaje ────────────────────────────────────────────────

export async function brandPhotos(): Promise<string[]> {
  const [brand] = await getDb().select({ photos: schema.brandProfile.characterPhotos }).from(schema.brandProfile).limit(1);
  return brand?.photos ?? [];
}

/** Suma una foto a Mi marca (crea el perfil si todavía no existe) y pide su recorte. */
export async function addBrandPhoto(key: string, userId: string): Promise<void> {
  if (!PHOTO_KEY_RE.test(key)) throw new PackageError("Foto no válida.");
  const photos = await brandPhotos();
  if (photos.length >= MAX_PHOTOS) throw new PackageError(`Puedes tener hasta ${MAX_PHOTOS} fotos. Quita alguna para subir otra.`);
  await getDb()
    .insert(schema.brandProfile)
    .values({ id: "brand", characterPhotos: [key] })
    .onConflictDoUpdate({ target: schema.brandProfile.id, set: { characterPhotos: sql`array_append(${schema.brandProfile.characterPhotos}, ${key})` } });
  await requestCutouts([key], userId);
}

export async function removeBrandPhoto(key: string): Promise<void> {
  if (!PHOTO_KEY_RE.test(key)) throw new PackageError("Foto no válida.");
  await getDb().update(schema.brandProfile).set({ characterPhotos: sql`array_remove(${schema.brandProfile.characterPhotos}, ${key})` });
  const [cut] = await getDb().delete(schema.characterCutouts).where(eq(schema.characterCutouts.photoKey, key)).returning({ cutoutKey: schema.characterCutouts.cutoutKey });
  await deleteThumbFiles([key, cut?.cutoutKey]);
  // Las miniaturas que la usaban quedan sin foto (se puede elegir otra).
  await getDb().execute(sql`
    update yt_packages set concepts = (
      select coalesce(jsonb_agg(case when c->>'photoKey' = ${key} then jsonb_set(c, '{photoKey}', 'null'::jsonb) else c end), '[]'::jsonb)
      from jsonb_array_elements(concepts) c
    ) where concepts @> ${JSON.stringify([{ photoKey: key }])}::jsonb`);
}

/** Encola el recorte de las fotos que todavía no lo tienen (o que fallaron). */
export async function requestCutouts(keys: string[], userId: string | null): Promise<string | null> {
  const valid = [...new Set(keys.filter((k) => PHOTO_KEY_RE.test(k)))];
  if (!valid.length) return null;
  const existing = await getDb().select().from(schema.characterCutouts).where(inArray(schema.characterCutouts.photoKey, valid));
  const missing = valid.filter((k) => !existing.some((e) => e.photoKey === k && (e.status === "ready" || e.status === "pending")));
  if (!missing.length) return null;
  for (const key of missing) {
    await getDb()
      .insert(schema.characterCutouts)
      .values({ photoKey: key, status: "pending" })
      .onConflictDoUpdate({ target: schema.characterCutouts.photoKey, set: { status: "pending", error: null, updatedAt: new Date() } });
  }
  return enqueueJob({ type: "YT_THUMBNAILS", input: { packageId: null, concepts: [], photos: missing }, createdBy: userId, maxAttempts: 2, stage: "En cola" });
}

// ─── Fondos (worker) ─────────────────────────────────────────────────────

export async function activeJob(packageId: string) {
  const [job] = await getDb()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "YT_THUMBNAILS"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'packageId' = ${packageId}`))
    .limit(1);
  return job ?? null;
}

/** Encola los fondos de los conceptos elegidos (y el recorte de sus fotos, si falta). Devuelve el id del trabajo. */
export async function startBackgrounds(input: { packageId: string; conceptIds: string[]; provider: ImageProviderId | null; userId: string }): Promise<string> {
  const status = await providersStatus();
  const providerId = input.provider && status[input.provider === "chatgpt" ? "chatgpt" : "openai"].configured ? input.provider : status.preferred;
  if (!providerId) throw new PackageError("Agrega tu clave de API de OpenAI en Ajustes → Claves de servicios para generar los fondos.");
  if (!(await IMAGE_PROVIDERS[providerId].workerCredentials())) throw new PackageError("Vuelve a conectar tu ChatGPT en Ajustes → Claves de servicios.");
  if (await activeJob(input.packageId)) throw new PackageError("Ya se están generando fondos para este video. Espera a que terminen.");
  const row = await loadPackage(input.packageId);
  const wanted = row.concepts.filter((c) => input.conceptIds.includes(c.id)).slice(0, 3);
  if (!wanted.length) throw new PackageError("Elige al menos una miniatura.");
  const brand = await getBrand();
  const items = wanted.map((c) => ({
    conceptId: c.id,
    prompt: backgroundPrompt({ scene: c.scene, layout: c.layout, hasPhoto: Boolean(c.photoKey), niche: brand?.niche ?? null, colors: brand?.colors ?? null }),
  }));
  // Fotos usadas que todavía no tienen recorte: se recortan en el mismo trabajo.
  const photoKeys = [...new Set(wanted.map((c) => c.photoKey).filter((k): k is string => Boolean(k)))];
  const cut = photoKeys.length ? await getDb().select().from(schema.characterCutouts).where(inArray(schema.characterCutouts.photoKey, photoKeys)) : [];
  const photos = photoKeys.filter((k) => !cut.some((c) => c.photoKey === k && (c.status === "ready" || c.status === "pending")));
  for (const key of photos) {
    await getDb().insert(schema.characterCutouts).values({ photoKey: key, status: "pending" }).onConflictDoUpdate({ target: schema.characterCutouts.photoKey, set: { status: "pending", error: null, updatedAt: new Date() } });
  }
  const jobId = await enqueueJob({
    type: "YT_THUMBNAILS",
    input: { packageId: input.packageId, provider: providerId === "chatgpt" ? "chatgpt" : "openai", concepts: items, photos },
    createdBy: input.userId,
    // Un solo intento: reintentar volvería a gastar imágenes del plan del cliente en los fondos que ya salieron.
    maxAttempts: 1,
    stage: "En cola",
  });
  const ids = new Set(wanted.map((c) => c.id));
  await getDb().transaction(async (tx) => {
    const [fresh] = await tx.select({ concepts: schema.ytPackages.concepts }).from(schema.ytPackages).where(eq(schema.ytPackages.id, input.packageId)).for("update").limit(1);
    const concepts = (fresh?.concepts ?? []).map((c) => (ids.has(c.id) ? { ...c, backgroundStatus: "pending" as const, backgroundError: null } : c));
    await tx.update(schema.ytPackages).set({ concepts }).where(eq(schema.ytPackages.id, input.packageId));
  });
  return jobId;
}

type JobRow = { id: string; input: unknown };

/** El worker avisa que un fondo está listo (o que falló). Se reemplaza el anterior y se borra su archivo. */
export async function attachBackground(job: JobRow, conceptId: string, key: string | null, provider: string | null, error: string | null) {
  const input = job.input as { packageId?: string; concepts?: { conceptId: string }[] };
  if (!input.packageId || !input.concepts?.some((c) => c.conceptId === conceptId)) throw new PackageError("Esa miniatura no es de este trabajo.");
  if (key && (!BACKGROUND_KEY_RE.test(key) || !key.startsWith(`miniaturas/${input.packageId}/${conceptId}-`))) throw new PackageError("Imagen no válida.");
  const previous = await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ concepts: schema.ytPackages.concepts }).from(schema.ytPackages).where(eq(schema.ytPackages.id, input.packageId!)).for("update").limit(1);
    if (!row) return { gone: true, old: null as string | null };
    const current = row.concepts.find((c) => c.id === conceptId);
    if (!current) return { gone: true, old: null };
    const concepts = row.concepts.map((c) =>
      c.id !== conceptId
        ? c
        : key
          ? { ...c, backgroundKey: key, backgroundStatus: "ready" as const, backgroundError: null, backgroundProvider: provider }
          : { ...c, backgroundStatus: (c.backgroundKey ? "ready" : "failed") as ThumbnailConcept["backgroundStatus"], backgroundError: error?.slice(0, 300) ?? "No se pudo generar el fondo." },
    );
    await tx.update(schema.ytPackages).set({ concepts }).where(eq(schema.ytPackages.id, input.packageId!));
    if (key) {
      await tx.execute(sql`update jobs set output = jsonb_build_object('done', coalesce(output->'done', '[]'::jsonb) || jsonb_build_array(${conceptId}::text)) where id = ${job.id}::uuid`);
    }
    return { gone: false, old: key ? current.backgroundKey : null };
  });
  if (previous.gone && key) await deleteThumbFiles([key]);
  else if (previous.old && previous.old !== key) await deleteThumbFiles([previous.old]);
}

/** El worker avisa que una foto ya tiene su recorte (o por qué no). */
export async function attachCutout(job: JobRow, photoKey: string, key: string | null, method: string, error: string | null) {
  const input = job.input as { photos?: string[] };
  if (!input.photos?.includes(photoKey)) throw new PackageError("Esa foto no es de este trabajo.");
  if (key && !CUTOUT_KEY_RE.test(key)) throw new PackageError("Recorte no válido.");
  const [old] = await getDb().select().from(schema.characterCutouts).where(eq(schema.characterCutouts.photoKey, photoKey)).limit(1);
  const values = key ? { status: "ready" as const, cutoutKey: key, method: method.slice(0, 40), error: null } : { status: "failed" as const, cutoutKey: null, method: method.slice(0, 40), error: error?.slice(0, 300) ?? "No se pudo recortar." };
  await getDb()
    .insert(schema.characterCutouts)
    .values({ photoKey, ...values })
    .onConflictDoUpdate({ target: schema.characterCutouts.photoKey, set: { ...values, updatedAt: new Date() } });
  if (old?.cutoutKey && old.cutoutKey !== key) await deleteThumbFiles([old.cutoutKey]);
  // Si la foto se borró mientras se recortaba, el recorte no se usa.
  if (key && !(await brandPhotos()).includes(photoKey)) {
    await getDb().delete(schema.characterCutouts).where(eq(schema.characterCutouts.photoKey, photoKey));
    await deleteThumbFiles([key]);
  }
}
