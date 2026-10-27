import "server-only";
import { after } from "next/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { latestProjectJob, workerStatus, type WorkerStatus } from "@/lib/jobs";
import { fileDriver, readUrl } from "@/lib/storage";
import { cleanupReplaced } from "@/lib/video/service";
import type { EditPlan, MediaInfo, Transcript } from "@/lib/video/types";
import type { AudioPreview, AudioPreviewMedia } from "@/lib/video/studio-audio";
import { costSummary, editEstimate, readEyes, type CostSummary, type EditEstimate } from "@/lib/video/director/service";
import { clampBudget } from "@/lib/video/director/cost";
import { readBrief, readDirector, type Brief, type DirectorState, type Eyes } from "@/lib/video/director/types";

export type ProjectStatus = (typeof schema.videoProjectStatusEnum.enumValues)[number];

export type ProjectListItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  format: string;
  progress: number | null;
  stage: string | null;
  duration: number | null;
  outputDuration: number | null;
  posterUrl: string | null;
  errorMessage: string | null;
  autoExport: boolean;
  origin: string;
  updatedAt: Date;
};

export async function listProjects(): Promise<{ projects: ProjectListItem[]; worker: WorkerStatus; storageReady: boolean }> {
  await getCurrentUser();
  const db = getDb();
  const rows = await db
    .select({
      id: schema.videoProjects.id,
      title: schema.videoProjects.title,
      status: schema.videoProjects.status,
      format: schema.videoProjects.format,
      media: schema.videoProjects.media,
      outputMeta: schema.videoProjects.outputMeta,
      errorMessage: schema.videoProjects.errorMessage,
      autoExport: schema.videoProjects.autoExport,
      origin: schema.videoProjects.origin,
      updatedAt: schema.videoProjects.updatedAt,
    })
    .from(schema.videoProjects)
    .orderBy(desc(schema.videoProjects.updatedAt))
    .limit(100);
  const active = rows.filter((r) => r.status === "PROCESSING" || r.status === "RENDERING").map((r) => r.id);
  const jobs = active.length
    ? await db
        .select({ projectId: schema.jobs.videoProjectId, progress: schema.jobs.progress, stage: schema.jobs.stage, createdAt: schema.jobs.createdAt })
        .from(schema.jobs)
        .where(and(inArray(schema.jobs.videoProjectId, active), ne(schema.jobs.status, "CANCELED")))
        .orderBy(desc(schema.jobs.createdAt))
    : [];
  const latest = new Map<string, { progress: number; stage: string | null }>();
  for (const j of jobs) if (j.projectId && !latest.has(j.projectId)) latest.set(j.projectId, j);

  const projects = await Promise.all(
    rows.map(async (r) => {
      const media = (r.media ?? {}) as MediaInfo;
      const out = (r.outputMeta ?? {}) as { duration?: number; posterKey?: string };
      const posterKey = out.posterKey ?? media.posterKey ?? null;
      const job = latest.get(r.id);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        format: r.format,
        progress: job?.progress ?? null,
        stage: job?.stage ?? null,
        duration: media.duration ?? null,
        outputDuration: out.duration ?? null,
        posterUrl: posterKey && fileDriver() ? await readUrl(posterKey).catch(() => null) : null,
        errorMessage: r.errorMessage,
        autoExport: r.autoExport,
        origin: r.origin,
        updatedAt: r.updatedAt,
      };
    }),
  );
  return { projects, worker: await workerStatus(), storageReady: fileDriver() !== null };
}

export type OutputMeta = {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  lufs?: number;
  truePeak?: number;
  bytes?: number;
  posterKey?: string;
  creditsKey?: string;
  broll?: number;
  zooms?: number;
  qc?: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  replaced?: string[];
};

export type ProjectView = {
  id: string;
  title: string;
  status: ProjectStatus;
  format: "9:16" | "16:9";
  captionPreset: string;
  scriptId: string | null;
  styleId: string | null;
  brollMode: string;
  /** "Hazlo por mí": se exporta solo apenas está el plan. */
  autoExport: boolean;
  /** "Hazlo por mí" con el plan recién hecho: el render está por arrancar (si en 90 s no arrancó, se muestra la revisión). */
  autoPending: boolean;
  origin: string;
  sourceName: string | null;
  sourceBytes: number | null;
  sourceKey: string | null;
  errorMessage: string | null;
  media: MediaInfo | null;
  /** Muestra de "Audio de estudio" (10 s antes y después), si el worker la armó al analizar. */
  audioPreview: AudioPreview | null;
  transcript: Transcript | null;
  plan: EditPlan | null;
  proxyUrl: string | null;
  posterUrl: string | null;
  /** Cuadro del video original (sin el render encima): la vista previa de la revisión. */
  sourcePosterUrl: string | null;
  output: { url: string; downloadUrl: string; srtUrl: string | null; creditsUrl: string | null; meta: OutputMeta } | null;
  job: { type: string; status: string; progress: number; stage: string | null; attempts: number; maxAttempts: number; errorMessage: string | null } | null;
  worker: WorkerStatus;
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Director de edición: lo que entendió, la segunda mirada, la revisión final, los pedidos y las versiones. */
  director: DirectorView | null;
  /** Un pedido de "Edítalo así" en curso (el proyecto vuelve a "procesando" un momento). */
  editing: boolean;
};

export type SheetView = { url: string; frames: number[]; width: number; height: number };

export type DirectorView = {
  state: DirectorState;
  brief: Brief | null;
  budgetUsd: number;
  cost: CostSummary;
  /** Estimación de un pedido de "Edítalo así" (modelo, vueltas y costo, con y sin referencia). */
  editEstimate: EditEstimate;
  /** Hojas de contacto del original (para las miniaturas de "Lo que entendió") y su grilla. */
  sheets: SheetView[];
  layout: Eyes["layout"] | null;
  stats: Eyes["stats"] | null;
  /** Hojas de la revisión final (cuadros del MP4). */
  finalSheets: SheetView[];
};

async function directorView(p: typeof schema.videoProjects.$inferSelect, sign: (key: string | null | undefined) => Promise<string | null>): Promise<DirectorView | null> {
  if (!p.director && !p.eyes && !p.brief) return null;
  const state = readDirector(p.director);
  const eyes = readEyes(p.eyes);
  const budgetUsd = clampBudget(p.aiBudgetUsd);
  const cost = await costSummary(p.id, budgetUsd);
  const sheets = await Promise.all((eyes?.sheets ?? []).map(async (s) => ({ url: (await sign(s.key)) ?? "", frames: s.frames, width: s.width, height: s.height })));
  const finalSheets = await Promise.all((state.final?.sheets ?? []).map(async (key) => ({ url: (await sign(key)) ?? "", frames: [], width: 0, height: 0 })));
  return {
    state,
    brief: readBrief(p.brief),
    budgetUsd,
    cost,
    editEstimate: editEstimate(p, budgetUsd - cost.totalUsd),
    sheets: sheets.filter((s) => s.url),
    layout: eyes?.layout ?? null,
    stats: eyes?.stats ?? null,
    finalSheets: finalSheets.filter((s) => s.url),
  };
}

const safeName = (title: string) => title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";

async function previewUrls(preview: AudioPreviewMedia | undefined, sign: (key: string | undefined) => Promise<string | null>): Promise<AudioPreview | null> {
  if (!preview?.keys?.original) return null;
  const [original, soft, strong] = await Promise.all([sign(preview.keys.original), sign(preview.keys.soft), sign(preview.keys.strong)]);
  return original ? { start: preview.start, duration: preview.duration, urls: { original, soft, strong } } : null;
}

export async function getProject(id: string): Promise<ProjectView | null> {
  const me = await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await getDb().select().from(schema.videoProjects).where(eq(schema.videoProjects.id, id)).limit(1);
  if (!p) return null;
  const media = (p.media ?? null) as MediaInfo | null;
  const meta = (p.outputMeta ?? {}) as OutputMeta;
  const job = await latestProjectJob(id);
  if (meta.replaced?.length && me.role !== "VIEWER") after(() => cleanupReplaced(id).catch(() => undefined));
  const sign = async (key: string | null | undefined, download?: string) => (key && fileDriver() ? readUrl(key, { download }).catch(() => null) : null);
  const name = safeName(p.title);
  const outputUrl = p.status === "DONE" || p.outputKey ? await sign(p.outputKey) : null;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    format: p.format === "16:9" ? "16:9" : "9:16",
    captionPreset: p.captionPreset,
    scriptId: p.scriptId,
    styleId: p.styleId,
    brollMode: p.brollMode,
    autoExport: p.autoExport,
    autoPending: p.autoExport && p.status === "AWAITING_REVIEW" && !p.errorMessage && Date.now() - p.updatedAt.getTime() < 90_000,
    origin: p.origin,
    sourceName: p.sourceName,
    sourceBytes: p.sourceBytes,
    sourceKey: p.sourceKey,
    errorMessage: p.errorMessage,
    media,
    audioPreview: await previewUrls(media?.audioPreview, sign),
    transcript: (p.transcript ?? null) as Transcript | null,
    plan: (p.plan ?? null) as EditPlan | null,
    proxyUrl: await sign(media?.proxyKey),
    posterUrl: await sign(meta.posterKey ?? media?.posterKey),
    sourcePosterUrl: await sign(media?.posterKey),
    output:
      outputUrl && p.outputKey
        ? {
            url: outputUrl,
            downloadUrl: (await sign(p.outputKey, `${name}.mp4`)) ?? outputUrl,
            srtUrl: await sign(p.srtKey, `${name}.srt`),
            creditsUrl: await sign(meta.creditsKey, `${name}-creditos.txt`),
            meta,
          }
        : null,
    job: job
      ? { type: job.type, status: job.status, progress: job.progress, stage: job.stage, attempts: job.attempts, maxAttempts: job.maxAttempts, errorMessage: job.errorMessage }
      : null,
    worker: await workerStatus(),
    canEdit: me.role !== "VIEWER",
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    director: await directorView(p, sign),
    editing: p.status === "PROCESSING" && Boolean(p.plan) && (readDirector(p.director).pending != null || readDirector(p.director).cycle === "edit"),
  };
}

/** Estado liviano para la consulta periódica de la pantalla del proyecto. */
export async function getProjectStatus(id: string) {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await getDb()
    .select({ status: schema.videoProjects.status, errorMessage: schema.videoProjects.errorMessage, autoExport: schema.videoProjects.autoExport, updatedAt: schema.videoProjects.updatedAt })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .limit(1);
  if (!p) return null;
  const job = await latestProjectJob(id);
  const worker = await workerStatus();
  return {
    status: p.status,
    errorMessage: p.errorMessage,
    autoExport: p.autoExport,
    updatedAt: p.updatedAt.toISOString(),
    job: job ? { type: job.type, status: job.status, progress: job.progress, stage: job.stage, attempts: job.attempts, maxAttempts: job.maxAttempts, errorMessage: job.errorMessage } : null,
    worker: { online: worker.online, autoStart: worker.autoStart },
  };
}

/**
 * Lo que sirve para precargar el brief del director en la subida: público y CTA de Mi marca, y la CTA de cada guion.
 */
export async function briefHints(): Promise<{ audience: string; cta: string; scripts: Record<string, string> }> {
  await getCurrentUser();
  const [brand] = await getDb().select({ audience: schema.brandProfile.audience, offers: schema.brandProfile.offers }).from(schema.brandProfile).limit(1);
  const rows = await getDb()
    .select({ id: schema.scripts.id, content: schema.scripts.content })
    .from(schema.scripts)
    .where(ne(schema.scripts.status, "ARCHIVED"))
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(100);
  const scripts: Record<string, string> = {};
  for (const r of rows) {
    const cta = (r.content as { cta?: { spoken?: string } } | null)?.cta?.spoken?.trim();
    if (cta) scripts[r.id] = cta.slice(0, 300);
  }
  const firstLine = (t: string | null | undefined) => (t ?? "").split(/\n|\. /)[0]!.trim().slice(0, 200);
  return { audience: firstLine(brand?.audience), cta: (brand?.offers?.[0]?.cta ?? "").slice(0, 300), scripts };
}

/** Guiones que se pueden asociar a un video (para detectar tomas repetidas y corregir subtítulos). */
export async function listScriptOptions(): Promise<{ id: string; title: string; status: string }[]> {
  await getCurrentUser();
  return getDb()
    .select({ id: schema.scripts.id, title: schema.scripts.title, status: schema.scripts.status })
    .from(schema.scripts)
    .where(ne(schema.scripts.status, "ARCHIVED"))
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(100);
}

export async function getCloneSource(id: string): Promise<{ id: string; title: string; aspectRatio: string; ready: boolean } | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [c] = await getDb()
    .select({ id: schema.cloneVideos.id, title: schema.cloneVideos.title, aspectRatio: schema.cloneVideos.aspectRatio, status: schema.cloneVideos.status, videoUrl: schema.cloneVideos.videoUrl })
    .from(schema.cloneVideos)
    .where(eq(schema.cloneVideos.id, id))
    .limit(1);
  return c ? { id: c.id, title: c.title, aspectRatio: c.aspectRatio, ready: c.status === "COMPLETED" && Boolean(c.videoUrl) } : null;
}
