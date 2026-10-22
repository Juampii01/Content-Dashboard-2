import "server-only";
import { and, desc, eq, inArray, ne, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { blobConfigured } from "@/lib/storage/copy";
import { fetchBalance, getCredentialRow, type CloneVideoRow } from "@/lib/heygen/service";
import { spokenTextFromScript } from "@/lib/heygen/text";
import { readUrl } from "@/lib/storage/files";
import { buildTimeline } from "@/lib/video/timeline";
import type { EditPlan, MediaInfo, Transcript } from "@/lib/video/types";

/** Lo que la interfaz necesita de un video con clon (sin URLs: los archivos se sirven por /api/clon/[id]/archivo). */
export type CloneVideoItem = {
  id: string;
  /** "avatar": video nuevo con el clon · "translation": traducción de un video. */
  kind: "avatar" | "translation";
  /** Idioma de salida (nombre de HeyGen, como "English"), si es una traducción o un video en otro idioma. */
  language: string | null;
  /** De qué video salió (traducciones y videos traducidos con el clon). */
  source: { type: "editor" | "clone" | "upload"; id: string | null; title: string; mode?: "speed" | "precision" | "audio_only" } | null;
  title: string;
  status: CloneVideoRow["status"];
  errorMessage: string | null;
  avatarName: string | null;
  engine: string;
  aspectRatio: string;
  resolution: string;
  captions: boolean;
  speed: number;
  estimatedSeconds: number | null;
  estimatedCostUsd: number | null;
  durationSeconds: number | null;
  hasVideo: boolean;
  hasSubtitles: boolean;
  hasThumbnail: boolean;
  filesStored: boolean;
  scriptId: string | null;
  createdAt: string;
  completedAt: string | null;
  retriedInto: string | null;
  /** Ya tiene id en HeyGen (en una traducción, false = todavía subiendo el video). */
  sentToHeyGen: boolean;
};

export function toCloneVideoItem(row: CloneVideoRow): CloneVideoItem {
  return {
    id: row.id,
    kind: row.kind === "translation" ? "translation" : "avatar",
    language: row.language ?? null,
    source: row.source ? { type: row.source.type, id: row.source.id, title: row.source.title, ...(row.source.mode ? { mode: row.source.mode } : {}) } : null,
    title: row.title,
    status: row.status,
    errorMessage: row.errorMessage,
    avatarName: row.avatarName,
    engine: row.engine,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    captions: row.captions,
    speed: row.speed,
    estimatedSeconds: row.estimatedSeconds,
    estimatedCostUsd: row.estimatedCostUsd,
    durationSeconds: row.durationSeconds,
    hasVideo: Boolean(row.videoUrl),
    hasSubtitles: Boolean(row.subtitleUrl),
    hasThumbnail: Boolean(row.thumbnailUrl),
    filesStored: row.filesStored,
    scriptId: row.scriptId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    retriedInto: row.retriedInto ?? null,
    sentToHeyGen: Boolean(row.heygenVideoId),
  };
}

/** Estado de la conexión con HeyGen (sin la key). `withBalance` consulta el saldo en vivo. */
export async function getHeyGenStatus(options: { withBalance?: boolean } = {}) {
  const me = await getCurrentUser();
  const row = await getCredentialRow();
  const base = {
    isOwner: me.role === "OWNER",
    canEdit: me.role !== "VIEWER",
    configured: Boolean(row),
    label: row?.label ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    webhookActive: Boolean(row?.webhookSecretEnc),
    webhookError: row?.webhookError ?? null,
    storageReady: blobConfigured(),
  };
  if (!row || !options.withBalance) return { ...base, balance: null, balanceError: null };
  const { balance, error } = await fetchBalance();
  return { ...base, balance, balanceError: error };
}

export async function listCloneVideos(limit = 60): Promise<CloneVideoItem[]> {
  await getCurrentUser();
  const rows = await getDb().select().from(schema.cloneVideos).orderBy(desc(schema.cloneVideos.createdAt)).limit(limit);
  return rows.map(toCloneVideoItem);
}

export async function getCloneVideoRow(id: string): Promise<CloneVideoRow | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb().select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, id)).limit(1);
  return row ?? null;
}

/** Video y título de su guion (si vino de uno). */
export async function getCloneVideoDetail(id: string): Promise<{ row: CloneVideoRow; scriptTitle: string | null } | null> {
  const row = await getCloneVideoRow(id);
  if (!row) return null;
  const [script] = row.scriptId
    ? await getDb().select({ title: schema.scripts.title }).from(schema.scripts).where(eq(schema.scripts.id, row.scriptId)).limit(1)
    : [];
  return { row, scriptTitle: script?.title ?? null };
}

export async function getCloneVideosByIds(ids: string[]): Promise<CloneVideoItem[]> {
  await getCurrentUser();
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50);
  if (valid.length === 0) return [];
  const rows = await getDb().select().from(schema.cloneVideos).where(inArray(schema.cloneVideos.id, valid));
  return rows.map(toCloneVideoItem);
}

/** Guiones que se pueden convertir en video con clon (con contenido y sin archivar), con su texto hablado. */
export async function listScriptsForClone(): Promise<{ id: string; title: string; text: string; updatedAt: string }[]> {
  await getCurrentUser();
  const rows = await getDb()
    .select({ id: schema.scripts.id, title: schema.scripts.title, content: schema.scripts.content, updatedAt: schema.scripts.updatedAt })
    .from(schema.scripts)
    .where(and(ne(schema.scripts.status, "ARCHIVED"), isNotNull(schema.scripts.content)))
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(100);
  return rows
    .filter((r) => r.content)
    .map((r) => ({ id: r.id, title: r.title, text: spokenTextFromScript(r.content!), updatedAt: r.updatedAt.toISOString() }));
}

// ─── Traducir con tu clon ─────────────────────────────────────────────────

/** Un video que se puede traducir: un render del Editor o un video con clon (o una traducción) listo. */
export type TranslationSource = {
  type: "editor" | "clone";
  id: string;
  title: string;
  /** Segundos del video (las traducciones se cobran por la duración del original). */
  seconds: number | null;
  aspectRatio: string;
  /** Miniatura lista para el navegador (firmada o por nuestra ruta protegida). */
  thumbUrl: string | null;
  createdAt: string;
  /** Lo que se dice en el video (guion del clon o transcripción final del Editor), para "Video nuevo con tu clon". */
  text: string | null;
  /** Avatar y voz con los que se grabó (solo videos con clon), para volver a grabarlo en otro idioma. */
  avatarId: string | null;
  avatarName: string | null;
  voiceId: string | null;
  engine: string | null;
  language: string | null;
};

/** Texto que queda en el video final del Editor: las palabras no cortadas, corregidas y en el orden del timeline. */
function editedText(transcript: Transcript | null, plan: EditPlan | null, media: MediaInfo | null): string | null {
  if (!transcript?.words?.length) return null;
  if (!plan) return transcript.words.map((w) => w.text).join(" ");
  try {
    const timeline = buildTimeline(transcript.words, plan, media?.duration || transcript.duration);
    return timeline.words.map((w) => w.text).join(" ").replace(/\s+([.,;:!?])/g, "$1").trim() || null;
  } catch {
    return transcript.words.map((w) => w.text).join(" ");
  }
}

async function signedPoster(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await readUrl(key);
  } catch {
    return null;
  }
}

function editorSource(r: typeof schema.videoProjects.$inferSelect, thumbUrl: string | null, withText: boolean): TranslationSource {
  const meta = (r.outputMeta ?? {}) as { duration?: number; posterKey?: string };
  return {
    type: "editor",
    id: r.id,
    title: r.title,
    seconds: typeof meta.duration === "number" ? meta.duration : null,
    aspectRatio: r.format,
    thumbUrl,
    createdAt: r.updatedAt.toISOString(),
    text: withText ? editedText(r.transcript as Transcript | null, r.plan as EditPlan | null, r.media as MediaInfo | null) : null,
    avatarId: null,
    avatarName: null,
    voiceId: null,
    engine: null,
    language: null,
  };
}

function cloneSource(r: CloneVideoRow): TranslationSource {
  return {
    type: "clone",
    id: r.id,
    title: r.title,
    seconds: r.durationSeconds ?? r.estimatedSeconds ?? null,
    aspectRatio: r.aspectRatio,
    thumbUrl: r.thumbnailUrl ? `/api/clon/${r.id}/archivo?tipo=miniatura` : null,
    createdAt: r.createdAt.toISOString(),
    text: r.kind === "translation" ? null : r.scriptText,
    avatarId: r.avatarId,
    avatarName: r.avatarName,
    voiceId: r.voiceId,
    engine: r.kind === "translation" ? null : r.engine,
    language: r.language ?? null,
  };
}

/** Videos listos para traducir: renders del Editor y videos con clon (los más recientes primero). */
export async function listTranslationSources(): Promise<{ editor: TranslationSource[]; clone: TranslationSource[] }> {
  await getCurrentUser();
  const db = getDb();
  const [projects, clones] = await Promise.all([
    db.select().from(schema.videoProjects).where(and(eq(schema.videoProjects.status, "DONE"), isNotNull(schema.videoProjects.outputKey))).orderBy(desc(schema.videoProjects.updatedAt)).limit(30),
    db.select().from(schema.cloneVideos).where(and(eq(schema.cloneVideos.status, "COMPLETED"), isNotNull(schema.cloneVideos.videoUrl))).orderBy(desc(schema.cloneVideos.createdAt)).limit(30),
  ]);
  const editor = await Promise.all(projects.map(async (p) => editorSource(p, await signedPoster((p.outputMeta as { posterKey?: string } | null)?.posterKey), true)));
  return { editor, clone: clones.map(cloneSource) };
}

/** Un video para traducir, leído de nuevo en el servidor (nunca se confía en lo que manda el navegador). */
export async function getTranslationSource(type: "editor" | "clone", id: string): Promise<(TranslationSource & { key: string | null }) | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  if (type === "editor") {
    const [p] = await db.select().from(schema.videoProjects).where(eq(schema.videoProjects.id, id)).limit(1);
    if (!p || p.status !== "DONE" || !p.outputKey) return null;
    return { ...editorSource(p, null, true), key: p.outputKey };
  }
  const [c] = await db.select().from(schema.cloneVideos).where(eq(schema.cloneVideos.id, id)).limit(1);
  if (!c || c.status !== "COMPLETED" || !c.videoUrl) return null;
  return { ...cloneSource(c), key: null };
}
