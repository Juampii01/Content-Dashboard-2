import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export type ScriptListItem = {
  id: string;
  title: string;
  format: "REEL" | "SHORT" | "YT_LONG" | "STORY";
  status: "IDEA" | "DRAFT" | "READY" | "RECORDED" | "PUBLISHED" | "ARCHIVED";
  pillar: string | null;
  hook: string | null;
  estimatedSeconds: number | null;
  updatedAt: Date;
};

export async function listScripts(status: string | null): Promise<ScriptListItem[]> {
  await getCurrentUser();
  const valid = (schema.scriptStatusEnum.enumValues as readonly string[]).includes(status ?? "");
  const where = status && valid ? eq(schema.scripts.status, status as ScriptListItem["status"]) : ne(schema.scripts.status, "ARCHIVED");
  const rows = await getDb()
    .select({
      id: schema.scripts.id,
      title: schema.scripts.title,
      format: schema.scripts.format,
      status: schema.scripts.status,
      pillar: schema.scripts.pillar,
      content: schema.scripts.content,
      estimatedSeconds: schema.scripts.estimatedSeconds,
      updatedAt: schema.scripts.updatedAt,
    })
    .from(schema.scripts)
    .where(where)
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(200);
  return rows.map((r) => ({ ...r, hook: r.content ? (r.content.hooks[r.content.selectedHook]?.text ?? null) : null }));
}

export async function countScriptsByStatus(): Promise<Record<string, number>> {
  await getCurrentUser();
  const rows = await getDb().select({ status: schema.scripts.status, n: sql<number>`count(*)::int` }).from(schema.scripts).groupBy(schema.scripts.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function getScript(id: string) {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [script] = await getDb().select().from(schema.scripts).where(eq(schema.scripts.id, id)).limit(1);
  if (!script) return null;
  const versions = await getDb()
    .select({ id: schema.scriptVersions.id, action: schema.scriptVersions.action, createdAt: schema.scriptVersions.createdAt })
    .from(schema.scriptVersions)
    .where(eq(schema.scriptVersions.scriptId, id))
    .orderBy(desc(schema.scriptVersions.createdAt))
    .limit(30);
  const [parent] = script.parentId
    ? await getDb().select({ id: schema.scripts.id, title: schema.scripts.title }).from(schema.scripts).where(eq(schema.scripts.id, script.parentId)).limit(1)
    : [];
  return { script, versions, parent: parent ?? null };
}

/** Datos de una pieza propia para usarla como punto de partida de un guion ("crear uno parecido"). */
export async function getSourcePiece(id: string) {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [item] = await getDb()
    .select({
      id: schema.contentItems.id,
      platform: schema.contentItems.platform,
      type: schema.contentItems.type,
      title: schema.contentItems.title,
      caption: schema.contentItems.caption,
      views: schema.contentItems.views,
      perfScore: schema.contentItems.perfScore,
      permalink: schema.contentItems.permalink,
    })
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.id, id)))
    .limit(1);
  return item ?? null;
}
