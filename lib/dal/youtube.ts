import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { Platform } from "@/lib/social/types";
import { detectDrops, dropSentence, quoteForDrop, relativeSummary, retentionMarks, type DropQuote } from "@/lib/youtube/retention";
import { curveIsFresh, editorChoices, pieceTranscript } from "@/lib/youtube/retention-service";
import type { RetentionDrop, RetentionExplanation, RetentionPoint, TranscriptSource } from "@/lib/youtube/types";

const UUID = /^[0-9a-f-]{36}$/i;

// ─── "Dónde se fue la gente" ─────────────────────────────────────────────

export type RetentionView =
  | { kind: "unsupported"; platform: Platform; message: string }
  | {
      kind: "youtube";
      itemId: string;
      type: "VIDEO" | "SHORT";
      durationSec: number | null;
      publishedAt: Date;
      points: RetentionPoint[] | null;
      capturedAt: Date | null;
      drops: (RetentionDrop & { quote: DropQuote | null; sentence: string })[];
      marks: { intro: number | null; middle: number | null; introAt: number };
      relative: { intro: number; overall: number } | null;
      transcript: { source: TranscriptSource; label: string; segments: number; updatedAt: Date | null } | null;
      insight: { explanation: RetentionExplanation; createdAt: Date; stale: boolean } | null;
      editorOptions: { id: string; title: string }[];
      transcriptJob: { id: string; status: string; error: string | null } | null;
      permalink: string | null;
      /** La curva falta o quedó vieja: la pantalla la pide a YouTube al abrirse. */
      shouldFetch: boolean;
    };

const UNSUPPORTED: Record<Exclude<Platform, "YOUTUBE">, string> = {
  INSTAGRAM:
    "Instagram no da la retención segundo a segundo a las apps conectadas: solo el tiempo medio visto y cuántos saltan en los primeros 3 segundos (los ves arriba, si la red los dio). Por eso aquí no hay curva.",
  TIKTOK: "TikTok no da la retención segundo a segundo a las apps conectadas: su API solo entrega visualizaciones, me gusta, comentarios y compartidos. Por eso aquí no hay curva.",
};

export async function getRetentionView(id: string): Promise<RetentionView | null> {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const db = getDb();
  const [item] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).limit(1);
  if (!item) return null;
  if (item.platform !== "YOUTUBE") return { kind: "unsupported", platform: item.platform, message: UNSUPPORTED[item.platform] };

  const [[curve], [insight], transcript, editorOptions, [job]] = await Promise.all([
    db.select().from(schema.retentionCurves).where(eq(schema.retentionCurves.contentItemId, id)).limit(1),
    db.select().from(schema.retentionInsights).where(eq(schema.retentionInsights.contentItemId, id)).limit(1),
    pieceTranscript(id),
    editorChoices(),
    db
      .select({ id: schema.jobs.id, status: schema.jobs.status, error: schema.jobs.errorMessage })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.type, "YOUTUBE_TRANSCRIPT"), sql`${schema.jobs.input}->>'contentItemId' = ${id}`, sql`${schema.jobs.createdAt} > now() - interval '1 day'`))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(1),
  ]);
  const points = (curve?.points as RetentionPoint[] | undefined) ?? null;
  const drops = points ? detectDrops(points, item.durationSec) : [];
  return {
    kind: "youtube",
    itemId: item.id,
    type: item.type === "SHORT" ? "SHORT" : "VIDEO",
    durationSec: item.durationSec,
    publishedAt: item.publishedAt,
    points,
    capturedAt: curve?.capturedAt ?? null,
    drops: drops.map((d) => {
      const quote = transcript ? quoteForDrop(transcript.segments, d) : null;
      return { ...d, quote, sentence: dropSentence(d, quote) };
    }),
    marks: points ? retentionMarks(points, item.durationSec) : { intro: null, middle: null, introAt: 0.1 },
    relative: points ? relativeSummary(points, item.durationSec) : null,
    transcript: transcript ? { source: transcript.source, label: transcript.label, segments: transcript.segments.length, updatedAt: transcript.updatedAt } : null,
    insight: insight
      ? {
          explanation: insight.explanation,
          createdAt: insight.createdAt,
          // Si la curva se actualizó o cambió la transcripción, la explicación quedó vieja.
          stale: Boolean(curve && curve.capturedAt.getTime() !== insight.curveCapturedAt.getTime()) || (insight.transcriptSource ?? null) !== (transcript?.source ?? null),
        }
      : null,
    editorOptions: editorOptions.map((e) => ({ id: e.id, title: e.title })),
    transcriptJob: job ? { id: job.id, status: job.status, error: job.error } : null,
    permalink: item.permalink,
    shouldFetch: !curve || !curveIsFresh(curve.capturedAt, item.publishedAt),
  };
}

// ─── Títulos y miniaturas ────────────────────────────────────────────────

export async function listPackages(limit = 60) {
  await getCurrentUser();
  return getDb()
    .select({ id: schema.ytPackages.id, title: schema.ytPackages.title, sourceKind: schema.ytPackages.sourceKind, selectedTitle: schema.ytPackages.selectedTitle, concepts: schema.ytPackages.concepts, updatedAt: schema.ytPackages.updatedAt, format: schema.ytPackages.format })
    .from(schema.ytPackages)
    .orderBy(desc(schema.ytPackages.updatedAt))
    .limit(limit);
}

export async function getPackage(id: string) {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const [row] = await getDb().select().from(schema.ytPackages).where(eq(schema.ytPackages.id, id)).limit(1);
  return row ?? null;
}

export async function activePackageJob(packageId: string) {
  await getCurrentUser();
  const [job] = await getDb()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "YT_THUMBNAILS"), inArray(schema.jobs.status, ["QUEUED", "RUNNING"]), sql`${schema.jobs.input}->>'packageId' = ${packageId}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return job?.id ?? null;
}

/** Fotos del personaje (Mi marca) con su recorte, si ya se hizo. */
export async function characterPhotos(): Promise<{ key: string; cutoutKey: string | null; cutoutStatus: "pending" | "ready" | "failed" | "none" }[]> {
  await getCurrentUser();
  const db = getDb();
  const [brand] = await db.select({ photos: schema.brandProfile.characterPhotos }).from(schema.brandProfile).limit(1);
  const keys = brand?.photos ?? [];
  if (!keys.length) return [];
  const cutouts = await db.select().from(schema.characterCutouts).where(inArray(schema.characterCutouts.photoKey, keys));
  const byKey = new Map(cutouts.map((c) => [c.photoKey, c]));
  return keys.map((key) => {
    const c = byKey.get(key);
    return { key, cutoutKey: c?.status === "ready" ? c.cutoutKey : null, cutoutStatus: c?.status ?? "none" };
  });
}

/** Lo que se puede elegir como origen: guiones, videos del Editor y videos/shorts de YouTube recientes. */
export async function packageSources() {
  await getCurrentUser();
  const db = getDb();
  const [scripts, videos, pieces] = await Promise.all([
    db
      .select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format, updatedAt: schema.scripts.updatedAt })
      .from(schema.scripts)
      .where(sql`${schema.scripts.status} <> 'ARCHIVED' and ${schema.scripts.content} is not null`)
      .orderBy(desc(schema.scripts.updatedAt))
      .limit(30),
    db
      .select({ id: schema.videoProjects.id, title: schema.videoProjects.title, format: schema.videoProjects.format, updatedAt: schema.videoProjects.updatedAt })
      .from(schema.videoProjects)
      .where(sql`${schema.videoProjects.transcript} is not null`)
      .orderBy(desc(schema.videoProjects.updatedAt))
      .limit(30),
    db
      .select({ id: schema.contentItems.id, title: schema.contentItems.title, type: schema.contentItems.type, publishedAt: schema.contentItems.publishedAt, views: schema.contentItems.views, thumbnail: sql<string | null>`coalesce(${schema.contentItems.thumbnailUrl}, ${schema.contentItems.thumbnailSourceUrl})` })
      .from(schema.contentItems)
      .where(and(eq(schema.contentItems.platform, "YOUTUBE"), eq(schema.contentItems.available, true)))
      .orderBy(desc(schema.contentItems.publishedAt))
      .limit(30),
  ]);
  return { scripts, videos, pieces };
}
