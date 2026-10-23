import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs";
import { fileDriver, readUrl } from "@/lib/storage";
import { FX_INFO } from "./fx/catalog";
import { compileFx, faceAnchor, fxBrandFromLook, fxCaptionHides, fxSegments, sourceFramesOf, sourceRangesOf, type FxBrand, type FxSpec } from "./fx/compile";
import { fxMaskKey, maskChunksFor } from "./fx/masks";
import type { GraphicLook } from "./graphics";
import type { Timeline } from "./timeline";
import type { EditPlan, FxMaskMedia, MediaInfo, VideoFormat } from "./types";

/**
 * Efectos en el servidor: miniaturas de tus reels (de Métricas), del plan a lo que dibuja el worker, y el recorte de la
 * persona para la vista previa (trabajo VIDEO_FX).
 */

export type FxThumb = { url: string; title: string };

/** Miniaturas de tus últimos reels y videos (Métricas). Si no hay, los efectos usan tarjetas con tu marca. */
export async function fxThumbs(limit = 8): Promise<FxThumb[]> {
  const rows = await getDb()
    .select({
      thumb: sql<string | null>`coalesce(${schema.contentItems.thumbnailUrl}, ${schema.contentItems.thumbnailSourceUrl})`,
      title: schema.contentItems.title,
      caption: schema.contentItems.caption,
    })
    .from(schema.contentItems)
    .where(and(inArray(schema.contentItems.type, ["REEL", "VIDEO", "SHORT"]), isNotNull(schema.contentItems.thumbnailUrl)))
    .orderBy(desc(schema.contentItems.publishedAt))
    .limit(limit)
    .catch(() => []);
  const out: FxThumb[] = [];
  for (const r of rows) if (r.thumb) out.push({ url: r.thumb, title: (r.title ?? r.caption ?? "").split(/\n/)[0]!.trim().slice(0, 60) });
  return out;
}

/** URL absoluta (las miniaturas de demostración son rutas de la app). */
function absolute(url: string): string {
  try {
    return new URL(url, env().NEXT_PUBLIC_APP_URL).toString();
  } catch {
    return url;
  }
}

export function fxBrand(look: GraphicLook): FxBrand {
  return fxBrandFromLook(look);
}

type EyesLike = { samples?: { t: number; face: { x: number; y: number; w: number; h: number } | null }[] } | null;

export type FxRenderItem = { spec: FxSpec; sourceFrames: number[]; images?: Record<string, string> };

/**
 * Los efectos del plan como los dibuja el worker: el spec (mismo que la vista previa), los cuadros del original de cada
 * cuadro del efecto (para la máscara) y las miniaturas. También los tramos donde se ocultan los subtítulos y donde no
 * van zooms.
 */
export async function fxForRender(input: {
  plan: EditPlan;
  timeline: Timeline;
  format: VideoFormat;
  look: GraphicLook;
  media: MediaInfo;
  eyes: unknown;
  offsetX: number;
  corrections?: Record<string, string>;
}): Promise<{ items: FxRenderItem[]; hides: { start: number; end: number }[]; avoid: { start: number; end: number }[] }> {
  const segments = fxSegments(input.timeline, input.plan.effects ?? []);
  if (!segments.length) return { items: [], hides: [], avoid: [] };
  const needThumbs = segments.some((s) => FX_INFO[s.item.kind].thumbs);
  const thumbs = needThumbs ? await fxThumbs() : [];
  const brand = fxBrand(input.look);
  const srcW = input.media.width || 1080;
  const srcH = input.media.height || 1920;
  const samples = (input.eyes as EyesLike)?.samples ?? [];
  const items = segments.map((segment) => {
    const face = faceAnchor(samples, sourceRangesOf(input.timeline, segment.start, segment.end), srcW, srcH, input.format, input.offsetX);
    const spec = compileFx({ segment, timeline: input.timeline, format: input.format, brand, face, thumbs: thumbs.length, cards: thumbs.map((t) => t.title) });
    const frames = Math.max(1, Math.round(spec.duration * 30));
    const out: FxRenderItem = { spec, sourceFrames: spec.mask ? sourceFramesOf(input.timeline, spec.start, frames) : [] };
    if (spec.thumbs.length) out.images = Object.fromEntries(spec.thumbs.map((k, i) => [k, absolute(thumbs[i]!.url)]));
    return out;
  });
  return { items, hides: fxCaptionHides(segments), avoid: segments.map((s) => ({ start: s.start, end: s.end })) };
}

// ─── Recorte para la vista previa ─────────────────────────────────────────

export type FxMaskView = { key: string; fps: number; tile: [number, number]; urls: Record<number, string>; missing: number[]; pending: boolean; failed: boolean };

/** Último trabajo de recorte del proyecto: en curso, o fallado hace poco (entonces no se vuelve a pedir enseguida). */
async function lastFxJob(projectId: string): Promise<{ pending: boolean; failedRecently: boolean }> {
  const [row] = await getDb()
    .select({ status: schema.jobs.status, at: sql<Date>`coalesce(${schema.jobs.finishedAt}, ${schema.jobs.createdAt})` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, "VIDEO_FX"), sql`${schema.jobs.input}->>'projectId' = ${projectId}`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  if (!row) return { pending: false, failedRecently: false };
  return { pending: row.status === "QUEUED" || row.status === "RUNNING", failedRecently: row.status === "FAILED" && Date.now() - new Date(row.at).getTime() < 10 * 60_000 };
}

/**
 * Pide al worker el recorte de los segundos que usan los efectos con recorte (si faltan). Devuelve lo que ya hay, con
 * las URLs firmadas de cada tira, y si hay un trabajo en curso.
 */
export async function ensureFxMasks(input: { projectId: string; plan: EditPlan; timeline: Pick<Timeline, "clips" | "words" | "duration">; media: MediaInfo; userId: string | null; enqueue?: boolean }): Promise<FxMaskView | null> {
  const { plan, media } = input;
  const format = plan.format;
  const chunks = maskChunksFor(plan, input.timeline);
  if (!chunks.length) return null;
  const key = fxMaskKey(media.width || 1080, media.height || 1920, format, plan.framing.offset_x);
  const have: FxMaskMedia | undefined = media.fxMasks?.[key];
  const ready = new Set(have?.chunks ?? []);
  const missing = chunks.filter((k) => !ready.has(k));
  const last = await lastFxJob(input.projectId);
  let pending = last.pending;
  if (missing.length && !pending && !last.failedRecently && input.enqueue !== false) {
    await enqueueJob({ type: "VIDEO_FX", createdBy: input.userId, stage: "En cola", maxAttempts: 2, input: { projectId: input.projectId, format, offsetX: plan.framing.offset_x, chunks: missing } });
    pending = true;
  }
  const urls: Record<number, string> = {};
  if (fileDriver()) {
    for (const k of chunks.filter((c) => ready.has(c))) {
      const url = await readUrl(`editor/${input.projectId}/fx/${key}/m-${String(k).padStart(5, "0")}.png`).catch(() => null);
      if (url) urls[k] = url;
    }
  }
  return { key, fps: have?.fps ?? 10, tile: have?.tile ?? (format === "9:16" ? [180, 320] : [320, 180]), urls, missing, pending, failed: !pending && last.failedRecently && missing.length > 0 };
}
