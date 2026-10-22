import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { brandContext, getBrand } from "@/lib/ai/brand-context";
import { AiError, generateStructured } from "@/lib/ai/client";
import { ANALYSIS_RULES, COPY_RULES, analysisTask, copyScriptTask } from "@/lib/ai/prompts/copia";
import { scriptSchema, type GeneratedScript, type ObjectiveKey } from "@/lib/ai/prompts/guiones";
import { getDb, schema } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { enqueueJob } from "@/lib/jobs";
import { fileInfo } from "@/lib/storage";
import { createStyleUpload, deleteStyle, loadStyle, parseReferenceLink, saveStyleResult } from "@/lib/video/styles";
import { styleMetricsSchema } from "@/lib/video/style";
import { sharedRunsIn } from "./overlap";
import { analysisBrief, buildAnalysis, metricsSummary, sentencesFromWords, scriptTexts, structureSchema, targetWords, timedWordsSchema, transcriptLines } from "./reel-copy";
import { insertGeneratedScript } from "./service";

/**
 * "Copia este reel": la persona pega el link de un reel, TikTok o short (o sube el archivo) y recibe su propia versión.
 *
 * Ciclo: UPLOADING (solo si sube el archivo) → ANALYZING (worker: bajar, transcribir, medir la edición)
 * → WRITING (app: Claude analiza la estructura y escribe el guion) → READY o FAILED.
 * Cada copia crea un estilo del Editor (video_styles) con las medidas del original; el archivo subido vive en la
 * ruta de ese estilo y se borra al terminar. La transcripción llega del worker una sola vez y nunca se guarda.
 */
export class ReelCopyError extends Error {}

export type CopyOptions = { topic: string | null; objective: ObjectiveKey };

export async function loadCopy(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.reelCopies).where(eq(schema.reelCopies.id, id)).limit(1);
  return row ?? null;
}

async function language(): Promise<string> {
  const brand = await getBrand();
  return brand?.language?.startsWith("en") ? "en" : "es";
}

const styleName = (platform: string | null) => `Copia de ${platform ? `un video de ${platform}` : "un video subido"} · ${formatDate(new Date())}`;

async function enqueueCopy(copy: { id: string; styleId: string }, source: Record<string, unknown>, userId: string | null) {
  await enqueueJob({
    type: "REEL_COPY",
    createdBy: userId,
    stage: "En cola",
    maxAttempts: 2,
    input: { reelCopyId: copy.id, styleId: copy.styleId, ...source, language: await language() },
  });
}

export async function createCopyFromLink(input: CopyOptions & { link: string; userId: string }): Promise<string> {
  const parsed = parseReferenceLink(input.link);
  if (!parsed) throw new ReelCopyError("Pega el link de un reel de Instagram, un TikTok o un short de YouTube (empieza con https://).");
  const db = getDb();
  const [style] = await db
    .insert(schema.videoStyles)
    .values({ name: styleName(parsed.platform), status: "ANALYZING", sourceKind: "link", sourceUrl: parsed.url, sourceName: parsed.platform, createdBy: input.userId })
    .returning({ id: schema.videoStyles.id });
  const [copy] = await db
    .insert(schema.reelCopies)
    .values({
      status: "ANALYZING",
      sourceKind: "link",
      sourceUrl: parsed.url,
      platform: parsed.platform,
      topic: input.topic,
      objective: input.objective,
      format: parsed.platform === "YouTube" ? "SHORT" : "REEL",
      styleId: style!.id,
      createdBy: input.userId,
    })
    .returning({ id: schema.reelCopies.id });
  await enqueueCopy({ id: copy!.id, styleId: style!.id }, { sourceKind: "link", url: parsed.url }, input.userId);
  return copy!.id;
}

/** Reserva la copia y la ruta del archivo (la del estilo); el archivo va directo del navegador al almacenamiento. */
export async function createCopyUpload(input: CopyOptions & { fileName: string; fileType: string; fileSize: number; userId: string }): Promise<{ id: string; styleId: string; key: string }> {
  const { id: styleId, key } = await createStyleUpload({ name: styleName(null), fileName: input.fileName, fileType: input.fileType, fileSize: input.fileSize, userId: input.userId });
  const [copy] = await getDb()
    .insert(schema.reelCopies)
    .values({ status: "UPLOADING", sourceKind: "upload", topic: input.topic, objective: input.objective, format: "REEL", styleId, createdBy: input.userId })
    .returning({ id: schema.reelCopies.id });
  return { id: copy!.id, styleId, key };
}

/** La subida terminó: se verifica el archivo y se encola el análisis. */
export async function completeCopyUpload(id: string, userId: string): Promise<void> {
  const copy = await loadCopy(id);
  if (!copy) throw new ReelCopyError("No encontramos esa copia.");
  if (copy.status !== "UPLOADING" || !copy.styleId) return;
  const style = await loadStyle(copy.styleId);
  if (!style?.sourceKey) throw new ReelCopyError("La subida ya no es válida. Vuelve a empezar.");
  const info = await fileInfo(style.sourceKey);
  if (!info || info.size === 0) throw new ReelCopyError("La subida no terminó. Vuelve a elegir el archivo.");
  if (style.sourceBytes && info.size !== style.sourceBytes) throw new ReelCopyError("El archivo llegó incompleto. Vuelve a subirlo.");
  const db = getDb();
  await db.update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.videoStyles.id, style.id));
  await db.update(schema.reelCopies).set({ status: "ANALYZING", errorMessage: null }).where(and(eq(schema.reelCopies.id, id), eq(schema.reelCopies.status, "UPLOADING")));
  await enqueueCopy({ id, styleId: style.id }, { sourceKind: "upload", sourceKey: style.sourceKey }, userId);
}

const NO_SPEECH = "No encontramos suficiente voz en ese video. «Copia este reel» funciona con videos hablados: prueba con otro.";
const TOO_CLOSE = "No pudimos escribir una versión lo bastante distinta del original. Vuelve a intentarlo, mejor con un tema propio.";

/**
 * Lo llama el worker al terminar de medir: analiza la estructura, escribe la versión propia, deja listo el estilo y
 * borra el archivo subido. Idempotente: si la copia ya está lista, responde sin volver a llamar a la IA.
 */
export async function saveCopyResult(id: string, payload: { metrics: unknown; words: unknown }, jobId: string | null = null): Promise<{ status: string; scriptId: string | null }> {
  const copy = await loadCopy(id);
  if (!copy) throw new ReelCopyError("Esa copia ya no existe.");
  if (copy.status === "READY") return { status: "READY", scriptId: copy.scriptId };
  const metrics = styleMetricsSchema.safeParse(payload.metrics);
  const words = timedWordsSchema.safeParse(payload.words);
  if (!metrics.success || !words.success) throw new ReelCopyError("El análisis del video llegó incompleto. Vuelve a intentarlo.");
  const sentences = sentencesFromWords(words.data);
  const spokenWords = sentences.reduce((n, s) => n + s.words, 0);
  if (sentences.length < 3 || spokenWords < 12) throw new ReelCopyError(NO_SPEECH);

  const db = getDb();
  await db.update(schema.reelCopies).set({ status: "WRITING", errorMessage: null }).where(eq(schema.reelCopies.id, id));
  // La transcripción vive solo en memoria, durante esta llamada.
  const transcript = sentences.map((s) => s.text).join(" ");
  try {
    const structure = await generateStructured({
      feature: "copia.analisis",
      model: "main",
      context: ANALYSIS_RULES,
      task: analysisTask({ platform: copy.platform, transcript: transcriptLines(sentences), metrics: metricsSummary(metrics.data) }),
      schema: structureSchema,
      maxTokens: 3000,
      userId: copy.createdBy,
      jobId,
    });
    const analysis = buildAnalysis(structure, sentences, metrics.data, transcript);

    const context = `${COPY_RULES}\n\n${await brandContext(await getBrand())}`;
    const objective = (copy.objective as ObjectiveKey | null) ?? "seguidores";
    let avoid: string[] = [];
    let generated: GeneratedScript | null = null;
    for (let attempt = 0; attempt < 2 && !generated; attempt++) {
      const candidate = await generateStructured({
        feature: "copia.guion",
        model: "main",
        context,
        task: copyScriptTask({ brief: analysisBrief(analysis), topic: copy.topic, originalTopic: analysis.originalTopic, objective, format: copy.format, words: targetWords(spokenWords), avoid }),
        schema: scriptSchema,
        maxTokens: 4000,
        userId: copy.createdBy,
        jobId,
      });
      const runs = sharedRunsIn(scriptTexts(candidate), transcript);
      if (runs.length) avoid = runs.slice(0, 8);
      else generated = candidate;
    }
    if (!generated) throw new ReelCopyError(TOO_CLOSE);

    const scriptId = await insertGeneratedScript(generated, {
      idea: copy.topic || generated.angle,
      format: copy.format,
      objective,
      pillar: null,
      sourceUrl: copy.sourceUrl,
      // Nunca la transcripción del original: el guion se escribió solo con la estructura.
      sourceText: null,
      action: "copiar",
      userId: copy.createdBy,
    });
    if (copy.styleId) {
      // Deja listo el estilo con las medidas del original y borra el archivo subido. Sin miniatura: el original no se muestra.
      await saveStyleResult(copy.styleId, { metrics: metrics.data, thumbKey: null }).catch((e) => console.error("[copia] no se guardó el estilo:", e instanceof Error ? e.message : e));
    }
    await db.update(schema.reelCopies).set({ status: "READY", analysis, scriptId, errorMessage: null }).where(eq(schema.reelCopies.id, id));
    return { status: "READY", scriptId };
  } catch (error) {
    // El worker marca la copia como fallida con este mensaje; aquí solo se traduce el error de la IA.
    if (error instanceof AiError) {
      console.error("[copia] ia:", error.detail);
      throw new ReelCopyError(error.userMessage);
    }
    throw error;
  }
}

/** Vuelve a intentar una copia que falló (con el link, o con el archivo si todavía está guardado). */
export async function retryCopy(id: string, userId: string): Promise<void> {
  const copy = await loadCopy(id);
  if (!copy || copy.status !== "FAILED") return;
  const db = getDb();
  let style = copy.styleId ? await loadStyle(copy.styleId) : null;
  if (copy.sourceKind === "link" && copy.sourceUrl) {
    if (!style) {
      [style] = await db
        .insert(schema.videoStyles)
        .values({ name: styleName(copy.platform), status: "ANALYZING", sourceKind: "link", sourceUrl: copy.sourceUrl, sourceName: copy.platform, createdBy: userId })
        .returning();
    } else if (style.status !== "READY") {
      await db.update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.videoStyles.id, style.id));
    }
    await db.update(schema.reelCopies).set({ status: "ANALYZING", errorMessage: null, styleId: style!.id }).where(eq(schema.reelCopies.id, id));
    await enqueueCopy({ id, styleId: style!.id }, { sourceKind: "link", url: copy.sourceUrl }, userId);
    return;
  }
  if (style?.sourceKey && (await fileInfo(style.sourceKey))) {
    await db.update(schema.videoStyles).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.videoStyles.id, style.id));
    await db.update(schema.reelCopies).set({ status: "ANALYZING", errorMessage: null }).where(eq(schema.reelCopies.id, id));
    await enqueueCopy({ id, styleId: style.id }, { sourceKind: "upload", sourceKey: style.sourceKey }, userId);
    return;
  }
  throw new ReelCopyError("El video que subiste ya no está guardado. Empieza una copia nueva subiéndolo otra vez.");
}

/**
 * Borra la copia. El guion que se escribió queda en Guiones (es de la persona). El estilo queda si está listo;
 * si no, se borra con su archivo subido.
 */
export async function deleteCopy(id: string): Promise<void> {
  const copy = await loadCopy(id);
  if (!copy) return;
  await getDb()
    .update(schema.jobs)
    .set({ status: "CANCELED", finishedAt: new Date(), lockedUntil: null })
    .where(and(eq(schema.jobs.type, "REEL_COPY"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'reelCopyId' = ${id}`));
  if (copy.styleId) {
    const style = await loadStyle(copy.styleId);
    if (style && style.status !== "READY") await deleteStyle(style.id);
  }
  await getDb().delete(schema.reelCopies).where(eq(schema.reelCopies.id, id));
}
