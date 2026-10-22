import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { workerStatus, type WorkerStatus } from "@/lib/jobs";
import { fileDriver, readUrl } from "@/lib/storage";
import type { ScoreDetail } from "@/lib/clips/score";
import type { Transcript } from "@/lib/video/types";

/** Datos de "Clips desde un video largo". Cada función empieza con getCurrentUser(). */

export type LongVideoStatus = (typeof schema.longVideoStatusEnum.enumValues)[number];
export type JobLive = { status: string; progress: number; stage: string | null; attempts: number; maxAttempts: number; errorMessage: string | null };

export type LongVideoListItem = {
  id: string;
  title: string;
  status: LongVideoStatus;
  sourceKind: string;
  sourceName: string | null;
  sourceUrl: string | null;
  duration: number | null;
  posterUrl: string | null;
  clips: number;
  best: number | null;
  errorMessage: string | null;
  job: JobLive | null;
  updatedAt: Date;
};

const sign = async (key: string | null | undefined, download?: string) => (key && fileDriver() ? readUrl(key, { download }).catch(() => null) : null);

/** Último trabajo de cada video largo (el que se muestra con su progreso). */
async function latestJobs(ids: string[]): Promise<Map<string, JobLive>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({ longVideoId: sql<string>`${schema.jobs.input}->>'longVideoId'`, status: schema.jobs.status, progress: schema.jobs.progress, stage: schema.jobs.stage, attempts: schema.jobs.attempts, maxAttempts: schema.jobs.maxAttempts, errorMessage: schema.jobs.errorMessage })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "LONG_VIDEO_CLIPS"), inArray(sql<string>`${schema.jobs.input}->>'longVideoId'`, ids)))
    .orderBy(desc(schema.jobs.createdAt));
  const out = new Map<string, JobLive>();
  for (const r of rows) if (!out.has(r.longVideoId)) out.set(r.longVideoId, r);
  return out;
}

export async function listLongVideos(): Promise<{ videos: LongVideoListItem[]; worker: WorkerStatus; storageReady: boolean }> {
  await getCurrentUser();
  const db = getDb();
  const rows = await db
    .select({
      id: schema.longVideos.id,
      title: schema.longVideos.title,
      status: schema.longVideos.status,
      sourceKind: schema.longVideos.sourceKind,
      sourceName: schema.longVideos.sourceName,
      sourceUrl: schema.longVideos.sourceUrl,
      media: schema.longVideos.media,
      errorMessage: schema.longVideos.errorMessage,
      updatedAt: schema.longVideos.updatedAt,
      clips: sql<number>`(select count(*)::int from long_video_clips c where c.long_video_id = ${schema.longVideos.id} and not c.discarded)`,
      best: sql<number | null>`(select max(score) from long_video_clips c where c.long_video_id = ${schema.longVideos.id} and not c.discarded)`,
    })
    .from(schema.longVideos)
    .orderBy(desc(schema.longVideos.updatedAt))
    .limit(60);
  const jobs = await latestJobs(rows.filter((r) => r.status === "PROCESSING" || r.status === "FAILED").map((r) => r.id));
  const videos = await Promise.all(
    rows.map(async (r) => {
      const media = (r.media ?? {}) as { duration?: number; posterKey?: string };
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        sourceKind: r.sourceKind,
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        duration: media.duration ?? null,
        posterUrl: await sign(media.posterKey),
        clips: Number(r.clips ?? 0),
        best: r.best == null ? null : Number(r.best),
        errorMessage: r.errorMessage,
        job: jobs.get(r.id) ?? null,
        updatedAt: r.updatedAt,
      };
    }),
  );
  return { videos, worker: await workerStatus(), storageReady: fileDriver() !== null };
}

export type ClipWord = { id: number; text: string; start: number; end: number };

export type ClipView = {
  id: string;
  rank: number;
  discarded: boolean;
  fromWord: number;
  toWord: number;
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
  title: string;
  hookText: string;
  reason: string;
  hookType: string | null;
  score: number;
  detail: ScoreDetail;
  framing: { mode: "face" | "center"; faceRatio: number; maxFaces: number; speakerSwitches: number } | null;
  previewUrl: string | null;
  posterUrl: string | null;
  /** Palabras de la ventana (para mover el inicio y el fin por palabra). */
  words: ClipWord[];
  project: { id: string; status: string; mode: "editor" | "export"; errorMessage: string | null; downloadUrl: string | null } | null;
};

export type LongVideoView = {
  id: string;
  title: string;
  status: LongVideoStatus;
  sourceKind: string;
  sourceName: string | null;
  sourceUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  words: number;
  plannedBy: "ai" | "rules" | null;
  warning: string | null;
  usedRanking: boolean;
  errorMessage: string | null;
  job: JobLive | null;
  worker: WorkerStatus;
  clips: ClipView[];
  canEdit: boolean;
  createdAt: Date;
};

const safeName = (title: string) => title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "clip";

export async function getLongVideo(id: string): Promise<LongVideoView | null> {
  const me = await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [row] = await db.select().from(schema.longVideos).where(eq(schema.longVideos.id, id)).limit(1);
  if (!row) return null;
  const media = (row.media ?? {}) as { duration?: number; width?: number; height?: number };
  const analysis = (row.analysis ?? {}) as { plannedBy?: "ai" | "rules"; warning?: string | null; ranking?: boolean };
  const words = ((row.transcript as Transcript | null)?.words ?? []) as ClipWord[];
  const clipRows = row.status === "READY" ? await db.select().from(schema.longVideoClips).where(eq(schema.longVideoClips.longVideoId, id)).orderBy(asc(schema.longVideoClips.rank)) : [];
  const projectIds = clipRows.map((c) => c.projectId).filter((p): p is string => Boolean(p));
  const projects = projectIds.length
    ? await db
        .select({ id: schema.videoProjects.id, status: schema.videoProjects.status, outputKey: schema.videoProjects.outputKey, errorMessage: schema.videoProjects.errorMessage, title: schema.videoProjects.title })
        .from(schema.videoProjects)
        .where(inArray(schema.videoProjects.id, projectIds))
    : [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const job = (await latestJobs([id])).get(id) ?? null;
  const clips = await Promise.all(
    clipRows.map(async (c): Promise<ClipView> => {
      const p = c.projectId ? byId.get(c.projectId) : undefined;
      const f = c.framing as ClipView["framing"] | null;
      return {
        id: c.id,
        rank: c.rank,
        discarded: c.discarded,
        fromWord: c.fromWord,
        toWord: c.toWord,
        start: c.start,
        end: c.end,
        windowStart: c.windowStart,
        windowEnd: c.windowEnd,
        title: c.title,
        hookText: c.hookText,
        reason: c.reason,
        hookType: c.hookType,
        score: c.score,
        detail: c.scoreDetail as unknown as ScoreDetail,
        framing: f ? { mode: f.mode, faceRatio: f.faceRatio, maxFaces: f.maxFaces, speakerSwitches: f.speakerSwitches } : null,
        previewUrl: await sign(c.previewKey),
        posterUrl: await sign(c.posterKey),
        words: words.filter((w) => w.end > c.windowStart && w.start < c.windowEnd).map((w) => ({ id: w.id, text: w.text, start: w.start, end: w.end })),
        project: p
          ? {
              id: p.id,
              status: p.status,
              mode: c.exportMode === "export" ? "export" : "editor",
              errorMessage: p.errorMessage,
              downloadUrl: p.status === "DONE" ? await sign(p.outputKey, `${safeName(p.title)}.mp4`) : null,
            }
          : null,
      };
    }),
  );
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    sourceKind: row.sourceKind,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    duration: media.duration ?? null,
    width: media.width ?? null,
    height: media.height ?? null,
    words: words.length,
    plannedBy: analysis.plannedBy ?? null,
    warning: analysis.warning ?? null,
    usedRanking: Boolean(analysis.ranking),
    errorMessage: row.errorMessage,
    job,
    worker: await workerStatus(),
    clips,
    canEdit: me.role !== "VIEWER",
    createdAt: row.createdAt,
  };
}

/** Estado en vivo (la pantalla lo consulta cada 2 s mientras se procesa). */
export async function getLongVideoStatus(id: string): Promise<{ status: LongVideoStatus; errorMessage: string | null; job: JobLive | null; worker: { online: boolean; autoStart: boolean }; projects: string } | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select({ status: schema.longVideos.status, errorMessage: schema.longVideos.errorMessage }).from(schema.longVideos).where(eq(schema.longVideos.id, id)).limit(1);
  if (!row) return null;
  const job = (await latestJobs([id])).get(id) ?? null;
  const worker = await workerStatus();
  // Firma corta del estado de los proyectos de sus clips: si cambia, la pantalla se refresca.
  const projects = await getDb().execute<{ sig: string | null }>(sql`
    select string_agg(p.id::text || ':' || p.status, ',' order by p.id) as sig
    from long_video_clips c join video_projects p on p.id = c.project_id where c.long_video_id = ${id}
  `);
  return { ...row, job, worker: { online: worker.online, autoStart: worker.autoStart }, projects: projects.rows[0]?.sig ?? "" };
}
