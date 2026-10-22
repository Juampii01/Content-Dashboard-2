import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import type { RepurposeSourceKind } from "@/lib/ai/prompts/jugo";
import { getDb, schema } from "@/lib/db";
import type { CarouselSlide, RepurposeCopy, RepurposeParts } from "@/lib/db/schema";
import { packPieces, STALE_AFTER_MS } from "@/lib/repurpose/service";
import { loadSource, type RepurposeSource } from "@/lib/repurpose/source";
import { formatMultiplier } from "@/lib/format";

/** Datos de "Sacarle todo el jugo". Cada función empieza validando la sesión. */
const UUID = /^[0-9a-f-]{36}$/i;

export type PackScript = { id: string; title: string; format: string; status: string; hooks: { text: string; type: string; score: number }[]; estimatedSeconds: number | null; angle: string; idea: string | null };
export type PackCarousel = { id: string; title: string; status: string; template: string; theme: Record<string, string> | null; slides: CarouselSlide[]; caption: string | null; hashtags: string[] };
export type ScheduledInfo = { entryId: string; date: string | null };

export type PackView = {
  id: string;
  title: string;
  sourceKind: RepurposeSourceKind;
  sourceHref: string | null;
  createdAt: string;
  /** La parte quedó "en curso" demasiado tiempo: se cortó y se puede reintentar. */
  parts: { [K in keyof RepurposeParts]: RepurposeParts[K] & { stale: boolean } };
  generating: boolean;
  carousel: PackCarousel | null;
  shorts: PackScript[];
  copy: RepurposeCopy | null;
  /** Pieza de origen (video o guion) que se puede programar. */
  origin: { kind: "editor" | "guion"; id: string; title: string } | null;
  /** Clave "tipo:id" → entrada del calendario. */
  scheduled: Record<string, ScheduledInfo>;
  pieces: number;
};

export async function getPack(id: string): Promise<PackView | null> {
  await getCurrentUser();
  if (!UUID.test(id)) return null;
  const db = getDb();
  const [pack] = await db.select().from(schema.repurposePacks).where(eq(schema.repurposePacks.id, id)).limit(1);
  if (!pack) return null;
  const stale = Date.now() - pack.updatedAt.getTime() > STALE_AFTER_MS;
  const parts = Object.fromEntries(Object.entries(pack.parts).map(([k, v]) => [k, { ...v, stale: v.status === "pending" && stale }])) as PackView["parts"];

  const carouselId = pack.parts.carousel.carouselId ?? null;
  const shortIds = pack.parts.shorts.scriptIds ?? [];
  const [carousel] = carouselId
    ? await db
        .select({ id: schema.carousels.id, title: schema.carousels.title, status: schema.carousels.status, template: schema.carousels.template, theme: schema.carousels.theme, slides: schema.carousels.slides, caption: schema.carousels.caption, hashtags: schema.carousels.hashtags })
        .from(schema.carousels)
        .where(eq(schema.carousels.id, carouselId))
        .limit(1)
    : [];
  const shortRows = shortIds.length
    ? await db
        .select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format, status: schema.scripts.status, content: schema.scripts.content, estimatedSeconds: schema.scripts.estimatedSeconds, idea: schema.scripts.idea })
        .from(schema.scripts)
        .where(inArray(schema.scripts.id, shortIds))
    : [];
  const shorts = shortIds
    .map((sid) => shortRows.find((r) => r.id === sid))
    .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.status !== "ARCHIVED")
    .map((r) => ({
      id: r.id,
      title: r.title,
      format: r.format,
      status: r.status,
      hooks: (r.content?.hooks ?? []).slice(0, 3).map((h) => ({ text: h.text, type: h.type, score: h.score })),
      estimatedSeconds: r.estimatedSeconds,
      angle: r.content?.angle ?? "",
      idea: r.idea,
    }));

  let origin: PackView["origin"] = null;
  if (pack.sourceKind === "video" && pack.videoProjectId) {
    const [p] = await db.select({ title: schema.videoProjects.title }).from(schema.videoProjects).where(eq(schema.videoProjects.id, pack.videoProjectId)).limit(1);
    if (p) origin = { kind: "editor", id: pack.videoProjectId, title: p.title };
  } else if (pack.sourceKind === "guion" && pack.scriptId) {
    const [s] = await db.select({ title: schema.scripts.title }).from(schema.scripts).where(eq(schema.scripts.id, pack.scriptId)).limit(1);
    if (s) origin = { kind: "guion", id: pack.scriptId, title: s.title };
  }

  // Qué piezas ya están en el calendario (por cualquier camino, no solo desde aquí).
  const pieces = packPieces(pack);
  const scriptIds = pieces.filter((p) => p.kind === "guion").map((p) => p.id);
  const entries = pieces.length
    ? await db
        .select({ id: schema.calendarEntries.id, date: schema.calendarEntries.scheduledDate, scriptId: schema.calendarEntries.scriptId, carouselId: schema.calendarEntries.carouselId, videoProjectId: schema.calendarEntries.videoProjectId })
        .from(schema.calendarEntries)
        .where(
          or(
            scriptIds.length ? inArray(schema.calendarEntries.scriptId, scriptIds) : undefined,
            carouselId ? eq(schema.calendarEntries.carouselId, carouselId) : undefined,
            pack.videoProjectId ? eq(schema.calendarEntries.videoProjectId, pack.videoProjectId) : undefined,
          ),
        )
    : [];
  const scheduled: Record<string, ScheduledInfo> = {};
  for (const e of entries) {
    // Una entrada con carrusel o video también puede tener guion: cuenta para su fuente principal.
    const key = e.carouselId ? `carrusel:${e.carouselId}` : e.videoProjectId ? `editor:${e.videoProjectId}` : e.scriptId ? `guion:${e.scriptId}` : null;
    if (key && !scheduled[key]) scheduled[key] = { entryId: e.id, date: e.date };
  }

  const sourceHref =
    pack.sourceKind === "video" && pack.videoProjectId ? `/editor/${pack.videoProjectId}` : pack.sourceKind === "guion" && pack.scriptId ? `/guiones/${pack.scriptId}` : pack.contentItemId ? `/metricas/${pack.contentItemId}` : null;

  return {
    id: pack.id,
    title: pack.title,
    sourceKind: pack.sourceKind,
    sourceHref,
    createdAt: pack.createdAt.toISOString(),
    parts,
    generating: Object.values(parts).some((p) => p.status === "pending" && !p.stale),
    carousel: carousel && carousel.status !== "ARCHIVED" ? carousel : null,
    shorts,
    copy: pack.parts.copy.data ?? null,
    origin,
    scheduled,
    pieces: pieces.length,
  };
}

export type PackListItem = { id: string; title: string; sourceKind: RepurposeSourceKind; createdAt: string; ready: number; failed: number; generating: boolean };

function summarize(parts: RepurposeParts, updatedAt: Date) {
  const values = Object.values(parts);
  const stale = Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
  return { ready: values.filter((p) => p.status === "ready").length, failed: values.filter((p) => p.status === "failed" || (p.status === "pending" && stale)).length, generating: !stale && values.some((p) => p.status === "pending") };
}

export async function listPacks(limit = 20): Promise<PackListItem[]> {
  await getCurrentUser();
  const rows = await getDb()
    .select({ id: schema.repurposePacks.id, title: schema.repurposePacks.title, sourceKind: schema.repurposePacks.sourceKind, parts: schema.repurposePacks.parts, createdAt: schema.repurposePacks.createdAt, updatedAt: schema.repurposePacks.updatedAt })
    .from(schema.repurposePacks)
    .orderBy(desc(schema.repurposePacks.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, sourceKind: r.sourceKind, createdAt: r.createdAt.toISOString(), ...summarize(r.parts, r.updatedAt) }));
}

export type SourceView = RepurposeSource & { previous: PackListItem[] };

/** El contenido de origen y los paquetes que ya se sacaron de él. */
export async function getRepurposeSource(kind: RepurposeSourceKind, id: string): Promise<SourceView | null> {
  await getCurrentUser();
  const source = await loadSource(kind, id);
  if (!source) return null;
  const column = kind === "video" ? schema.repurposePacks.videoProjectId : kind === "guion" ? schema.repurposePacks.scriptId : schema.repurposePacks.contentItemId;
  const rows = await getDb()
    .select({ id: schema.repurposePacks.id, title: schema.repurposePacks.title, sourceKind: schema.repurposePacks.sourceKind, parts: schema.repurposePacks.parts, createdAt: schema.repurposePacks.createdAt, updatedAt: schema.repurposePacks.updatedAt })
    .from(schema.repurposePacks)
    .where(and(eq(column, id), eq(schema.repurposePacks.sourceKind, kind)))
    .orderBy(desc(schema.repurposePacks.createdAt))
    .limit(5);
  return { ...source, previous: rows.map((r) => ({ id: r.id, title: r.title, sourceKind: r.sourceKind, createdAt: r.createdAt.toISOString(), ...summarize(r.parts, r.updatedAt) })) };
}

export type SourceSuggestion = { kind: RepurposeSourceKind; id: string; title: string; detail: string };

/** Puntos de partida para la pantalla sin origen: videos terminados, guiones recientes y las piezas que mejor rindieron. */
export async function listSourceSuggestions(): Promise<{ videos: SourceSuggestion[]; scripts: SourceSuggestion[]; pieces: SourceSuggestion[] }> {
  await getCurrentUser();
  const db = getDb();
  const [videos, scripts, pieces] = await Promise.all([
    db
      .select({ id: schema.videoProjects.id, title: schema.videoProjects.title, format: schema.videoProjects.format })
      .from(schema.videoProjects)
      .where(and(inArray(schema.videoProjects.status, ["DONE", "AWAITING_REVIEW"]), isNotNull(schema.videoProjects.transcript)))
      .orderBy(desc(schema.videoProjects.updatedAt))
      .limit(5),
    db
      .select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format })
      .from(schema.scripts)
      .where(and(ne(schema.scripts.status, "ARCHIVED"), isNotNull(schema.scripts.content)))
      .orderBy(desc(schema.scripts.updatedAt))
      .limit(5),
    db.execute<{ id: string; title: string | null; caption: string | null; platform: string; perf_score: number | null }>(sql`
      select id, title, caption, platform, perf_score from content_items
      where available and perf_score is not null and length(coalesce(title, '') || coalesce(caption, '')) > 60 and published_at > now() - interval '120 days'
      order by perf_score desc limit 5`),
  ]);
  const fmt: Record<string, string> = { REEL: "Reel", SHORT: "Short", YT_LONG: "YouTube largo", STORY: "Historias" };
  const net: Record<string, string> = { INSTAGRAM: "Instagram", YOUTUBE: "YouTube", TIKTOK: "TikTok" };
  return {
    videos: videos.map((v) => ({ kind: "video", id: v.id, title: v.title, detail: `Video ${v.format}` })),
    scripts: scripts.map((s) => ({ kind: "guion", id: s.id, title: s.title, detail: `Guion · ${fmt[s.format] ?? s.format}` })),
    pieces: pieces.rows.map((p) => ({
      kind: "pieza",
      id: p.id,
      title: (p.title || p.caption?.split("\n").find((l) => l.trim()) || "Pieza").slice(0, 120),
      detail: `${net[p.platform] ?? p.platform} · ${formatMultiplier(Number(p.perf_score))} tu mediana`,
    })),
  };
}
