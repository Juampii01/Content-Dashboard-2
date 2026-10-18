import "server-only";
import { and, desc, eq, inArray, ne, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { blobConfigured } from "@/lib/storage/copy";
import { fetchBalance, getCredentialRow, type CloneVideoRow } from "@/lib/heygen/service";
import { spokenTextFromScript } from "@/lib/heygen/text";

/** Lo que la interfaz necesita de un video con clon (sin URLs: los archivos se sirven por /api/clon/[id]/archivo). */
export type CloneVideoItem = {
  id: string;
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
};

export function toCloneVideoItem(row: CloneVideoRow): CloneVideoItem {
  return {
    id: row.id,
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
