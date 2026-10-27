import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { readBytes } from "@/lib/storage";
import { peaksOf, type PeaksPayload } from "./peaks";
import type { MediaInfo } from "./types";

/**
 * Forma de onda de la voz para el Estudio. El JSON lo arma el worker (worker/video/peaks.py) y se lee aquí, en el
 * servidor (así el navegador no depende de que el almacenamiento acepte pedidos de otro origen). Un video de antes de
 * las pistas de audio no la tiene: se pide al worker (VIDEO_PEAKS) una sola vez; si falló hace poco, no se repite.
 */
export type PeaksState = { status: "ready"; peaks: PeaksPayload } | { status: "pending" } | { status: "missing" };

const MAX_BYTES = 2 * 1024 * 1024;

async function lastPeaksJob(projectId: string): Promise<{ pending: boolean; failedRecently: boolean }> {
  const [row] = await getDb()
    .select({ status: schema.jobs.status, at: sql<Date>`coalesce(${schema.jobs.finishedAt}, ${schema.jobs.createdAt})` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "VIDEO_PEAKS"), sql`${schema.jobs.input}->>'projectId' = ${projectId}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  if (!row) return { pending: false, failedRecently: false };
  return { pending: row.status === "QUEUED" || row.status === "RUNNING", failedRecently: row.status === "FAILED" && Date.now() - new Date(row.at).getTime() < 30 * 60_000 };
}

export async function projectPeaks(projectId: string, opts: { enqueue: boolean; userId: string | null }): Promise<PeaksState> {
  const [project] = await getDb().select({ media: schema.videoProjects.media, status: schema.videoProjects.status }).from(schema.videoProjects).where(eq(schema.videoProjects.id, projectId)).limit(1);
  if (!project) return { status: "missing" };
  const media = (project.media ?? null) as MediaInfo | null;
  const meta = peaksOf(media);
  if (meta && meta.key.startsWith(`editor/${projectId}/`)) {
    try {
      const raw = JSON.parse((await readBytes(meta.key, MAX_BYTES)).toString("utf8")) as { rate?: unknown; peak?: unknown; rms?: unknown };
      if (typeof raw.rate === "number" && raw.rate > 0 && typeof raw.peak === "string" && typeof raw.rms === "string") return { status: "ready", peaks: { rate: raw.rate, peak: raw.peak, rms: raw.rms } };
    } catch (error) {
      console.error("[forma de onda] no se pudo leer:", error instanceof Error ? error.message : error);
    }
    // Está anotada pero no se pudo leer: no se vuelve a pedir (el worker la daría por hecha y se repetiría sin fin).
    return { status: "missing" };
  }
  if (!media?.proxyKey) return { status: "missing" };
  const last = await lastPeaksJob(projectId);
  if (last.pending) return { status: "pending" };
  if (!opts.enqueue || last.failedRecently) return { status: "missing" };
  await enqueueJob({ type: "VIDEO_PEAKS", createdBy: opts.userId, stage: "En cola", maxAttempts: 2, input: { projectId } });
  return { status: "pending" };
}
