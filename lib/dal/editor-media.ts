import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { fileDriver, readUrl } from "@/lib/storage";
import { brollSourcesReady } from "@/lib/video/broll";
import { stylePresetSchema, styleMetricsSchema, type StyleMetrics, type StylePreset } from "@/lib/video/style";
import type { BrollItem, BrollOption } from "@/lib/video/types";

/**
 * Datos de "Edita como este" (estilos) y de la biblioteca de b-roll. Cada función empieza con getCurrentUser().
 */
export type StyleStatus = (typeof schema.videoStyleStatusEnum.enumValues)[number];
export type ClipStatus = (typeof schema.brollClipStatusEnum.enumValues)[number];

const sign = async (key: string | null | undefined) => (key && fileDriver() ? readUrl(key).catch(() => null) : null);

type JobInfo = { progress: number; stage: string | null; status: string } | null;

/** Último trabajo de cada estilo o clip (los ids van en `jobs.input`). */
async function latestJobs(type: "VIDEO_STYLE" | "VIDEO_CLIP", field: "styleId" | "clipId", ids: string[]): Promise<Map<string, JobInfo>> {
  const map = new Map<string, JobInfo>();
  if (!ids.length) return map;
  const rows = await getDb()
    .select({ ref: sql<string>`${schema.jobs.input}->>${field}`, progress: schema.jobs.progress, stage: schema.jobs.stage, status: schema.jobs.status })
    .from(schema.jobs)
    // Un estilo también se mide desde "Copia este reel" (REEL_COPY lleva el styleId en su entrada).
    .where(and(type === "VIDEO_STYLE" ? inArray(schema.jobs.type, ["VIDEO_STYLE", "REEL_COPY"]) : eq(schema.jobs.type, type), inArray(sql<string>`${schema.jobs.input}->>${field}`, ids)))
    .orderBy(desc(schema.jobs.createdAt));
  for (const r of rows) if (!map.has(r.ref)) map.set(r.ref, { progress: r.progress, stage: r.stage, status: r.status });
  return map;
}

export type StyleView = {
  id: string;
  name: string;
  status: StyleStatus;
  sourceKind: "upload" | "link";
  sourceUrl: string | null;
  sourceName: string | null;
  thumbUrl: string | null;
  metrics: StyleMetrics | null;
  preset: StylePreset | null;
  errorMessage: string | null;
  job: JobInfo;
  updatedAt: Date;
  createdAt: Date;
};

function toView(r: typeof schema.videoStyles.$inferSelect, thumbUrl: string | null, job: JobInfo): StyleView {
  const metrics = r.metrics ? styleMetricsSchema.safeParse(r.metrics) : null;
  const preset = r.preset ? stylePresetSchema.safeParse(r.preset) : null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    sourceKind: r.sourceKind === "link" ? "link" : "upload",
    sourceUrl: r.sourceUrl,
    sourceName: r.sourceName,
    thumbUrl,
    metrics: metrics?.success ? metrics.data : null,
    preset: preset?.success ? preset.data : null,
    errorMessage: r.errorMessage,
    job,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  };
}

export async function listStyles(): Promise<StyleView[]> {
  await getCurrentUser();
  const rows = await getDb().select().from(schema.videoStyles).orderBy(desc(schema.videoStyles.updatedAt)).limit(100);
  const jobs = await latestJobs("VIDEO_STYLE", "styleId", rows.filter((r) => r.status === "ANALYZING").map((r) => r.id));
  return Promise.all(rows.map(async (r) => toView(r, await sign(r.thumbKey), jobs.get(r.id) ?? null)));
}

export async function getStyle(id: string): Promise<StyleView | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await getDb().select().from(schema.videoStyles).where(eq(schema.videoStyles.id, id)).limit(1);
  if (!r) return null;
  const jobs = r.status === "ANALYZING" ? await latestJobs("VIDEO_STYLE", "styleId", [id]) : new Map();
  return toView(r, await sign(r.thumbKey), jobs.get(id) ?? null);
}

/** Estilos listos, para elegir uno en "Nuevo video". */
export async function readyStyles(): Promise<{ id: string; name: string; thumbUrl: string | null; preset: StylePreset; aspect: string }[]> {
  const all = await listStyles();
  return all.filter((s) => s.status === "READY" && s.preset).map((s) => ({ id: s.id, name: s.name, thumbUrl: s.thumbUrl, preset: s.preset!, aspect: s.metrics?.aspect ?? "" }));
}

export type ClipView = {
  id: string;
  title: string;
  tags: string[];
  status: ClipStatus;
  thumbUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fileBytes: number | null;
  errorMessage: string | null;
  job: JobInfo;
  updatedAt: Date;
};

export async function listClips(): Promise<ClipView[]> {
  await getCurrentUser();
  const rows = await getDb().select().from(schema.brollClips).orderBy(desc(schema.brollClips.createdAt)).limit(500);
  const jobs = await latestJobs("VIDEO_CLIP", "clipId", rows.filter((r) => r.status === "PROCESSING").map((r) => r.id));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      tags: r.tags,
      status: r.status,
      thumbUrl: await sign(r.thumbKey),
      duration: r.duration,
      width: r.width,
      height: r.height,
      fileBytes: r.fileBytes,
      errorMessage: r.errorMessage,
      job: jobs.get(r.id) ?? null,
      updatedAt: r.updatedAt,
    })),
  );
}

export async function brollAvailability(): Promise<{ stock: boolean; libraryClips: number }> {
  await getCurrentUser();
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(schema.brollClips).where(eq(schema.brollClips.status, "READY"));
  return { ...brollSourcesReady(), libraryClips: row?.n ?? 0 };
}

export type SignedOption = BrollOption & { thumbUrl: string | null; previewUrl: string | null };

/** Firma miniatura y video de los clips de la biblioteca (solo claves de la biblioteca) para el navegador. */
export async function signBrollOptions(options: BrollOption[]): Promise<SignedOption[]> {
  await getCurrentUser();
  const own = (key: string | null | undefined) => (key && /^editor\/biblioteca\/[0-9a-f-]{36}\//i.test(key) ? key : null);
  return Promise.all(
    options.map(async (o) =>
      o.source === "library"
        ? { ...o, thumbUrl: await sign(own(o.thumbKey)), previewUrl: await sign(own(o.key)) }
        : { ...o, thumbUrl: o.thumb ?? null, previewUrl: o.preview ?? null },
    ),
  );
}

/** El b-roll del plan con las URLs firmadas de cada alternativa (para la revisión). */
export async function signedBroll(items: BrollItem[]): Promise<Record<string, SignedOption>> {
  const all = new Map<string, BrollOption>();
  for (const item of items) for (const o of [...item.options, ...(item.choice ? [item.choice] : [])]) all.set(`${o.source}:${o.id}`, o);
  const signed = await signBrollOptions([...all.values()]);
  return Object.fromEntries(signed.map((o) => [`${o.source}:${o.id}`, o]));
}

// ─── Música ───────────────────────────────────────────────────────────────

export type TrackView = {
  id: string;
  title: string;
  status: ClipStatus;
  duration: number | null;
  fileBytes: number | null;
  /** URL firmada para escucharla en el navegador (vence en una hora). */
  url: string | null;
  createdAt: Date;
};

/** Pistas de música del cliente (Biblioteca → Música y el selector de la revisión). */
export async function listTracks(options: { readyOnly?: boolean } = {}): Promise<TrackView[]> {
  await getCurrentUser();
  const rows = await getDb()
    .select()
    .from(schema.musicTracks)
    .where(options.readyOnly ? eq(schema.musicTracks.status, "READY") : undefined)
    .orderBy(desc(schema.musicTracks.createdAt))
    .limit(200);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      duration: r.duration,
      fileBytes: r.fileBytes,
      url: r.status === "READY" ? await sign(r.fileKey) : null,
      createdAt: r.createdAt,
    })),
  );
}
