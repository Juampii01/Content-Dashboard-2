import "server-only";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { startOfWeek, todayIn } from "@/lib/calendar/dates";
import { getDb, schema } from "@/lib/db";
import type { ScriptContent } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fileDriver } from "@/lib/storage";
import { getEditorDefaults, type EditorDefaultsView } from "./editor-defaults";

/**
 * Datos de "Grabar" (Editor → grabar en el navegador con teleprompter) y del "Día de grabación": los guiones que se
 * van a grabar (con lo que se dice, en párrafos), los que se pueden elegir (de Guiones y de "Tu semana lista") y los
 * valores por defecto del editor que usa cada proyecto que sale de una toma.
 */

export type RecordingScript = {
  id: string;
  title: string;
  format: string;
  status: string;
  estimatedSeconds: number | null;
  /** Lo que se dice, en orden: gancho elegido, cada bloque y el llamado a la acción. Sin indicaciones. */
  paragraphs: string[];
  /** Último proyecto del Editor grabado desde este guion, si hay. */
  lastTake: { projectId: string; status: string } | null;
};

export type ScriptChoice = { id: string; title: string; format: string; status: string; estimatedSeconds: number | null; recorded: boolean };

export type RecordingView = {
  /** Guiones elegidos para esta sesión, en el orden en que se graban. */
  session: RecordingScript[];
  /** Para elegir: la semana del autopiloto (si hay) y el resto de los guiones. */
  week: { weekStart: string; scripts: ScriptChoice[] } | null;
  scripts: ScriptChoice[];
  /** Pidió una semana o guiones que ya no existen. */
  missing: number;
  editor: EditorDefaultsView;
  storageReady: boolean;
  uploadMode: "blob" | "local";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function spokenParagraphs(content: ScriptContent | null): string[] {
  if (!content) return [];
  return [content.hooks[content.selectedHook]?.text ?? content.hooks[0]?.text ?? "", ...content.beats.map((b) => b.spoken), content.cta?.spoken ?? ""]
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** La semana del autopiloto que corresponde: la pedida (YYYY-MM-DD) o la más reciente que todavía no terminó. */
async function weekScripts(requested: string | null): Promise<{ weekStart: string; ids: string[] } | null> {
  const db = getDb();
  const today = todayIn(env().APP_TIMEZONE);
  const [pack] = await db
    .select({ weekStart: schema.weeklyPacks.weekStart })
    .from(schema.weeklyPacks)
    .where(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? eq(schema.weeklyPacks.weekStart, requested) : gte(schema.weeklyPacks.weekStart, startOfWeek(today)))
    .orderBy(desc(schema.weeklyPacks.weekStart))
    .limit(1);
  if (!pack) return null;
  const items = await db
    .select({ scriptId: schema.weeklyPackItems.scriptId })
    .from(schema.weeklyPackItems)
    .where(and(eq(schema.weeklyPackItems.weekStart, pack.weekStart), ne(schema.weeklyPackItems.decision, "discarded")))
    .orderBy(schema.weeklyPackItems.scheduledDate, schema.weeklyPackItems.position);
  return { weekStart: pack.weekStart, ids: items.map((i) => i.scriptId).filter((v): v is string => Boolean(v)) };
}

export async function getRecordingView(params: { guion?: string | null; guiones?: string | null; semana?: string | null }): Promise<RecordingView> {
  await getCurrentUser();
  const db = getDb();
  const week = await weekScripts(params.semana && params.semana !== "1" ? params.semana : null);
  const requested = [params.guion, ...(params.guiones?.split(",") ?? [])].map((s) => s?.trim() ?? "").filter((s) => UUID.test(s));
  const sessionIds = [...new Set(params.semana ? (week?.ids ?? []) : requested)].slice(0, 20);

  const rows = await db
    .select({
      id: schema.scripts.id,
      title: schema.scripts.title,
      format: schema.scripts.format,
      status: schema.scripts.status,
      estimatedSeconds: schema.scripts.estimatedSeconds,
      updatedAt: schema.scripts.updatedAt,
    })
    .from(schema.scripts)
    .where(ne(schema.scripts.status, "ARCHIVED"))
    .orderBy(desc(schema.scripts.updatedAt))
    .limit(100);
  const contents = sessionIds.length
    ? await db.select({ id: schema.scripts.id, content: schema.scripts.content }).from(schema.scripts).where(inArray(schema.scripts.id, sessionIds))
    : [];
  const takes = await db
    .select({ id: schema.videoProjects.id, scriptId: schema.videoProjects.scriptId, status: schema.videoProjects.status })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.origin, "recorder"))
    .orderBy(desc(schema.videoProjects.createdAt))
    .limit(200);
  const lastTake = new Map<string, { projectId: string; status: string }>();
  for (const t of takes) if (t.scriptId && !lastTake.has(t.scriptId)) lastTake.set(t.scriptId, { projectId: t.id, status: t.status });

  const choice = (r: (typeof rows)[number]): ScriptChoice => ({
    id: r.id,
    title: r.title,
    format: r.format,
    status: r.status,
    estimatedSeconds: r.estimatedSeconds,
    recorded: r.status === "RECORDED" || r.status === "PUBLISHED" || lastTake.has(r.id),
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const session: RecordingScript[] = [];
  for (const id of sessionIds) {
    const r = byId.get(id);
    const content = contents.find((c) => c.id === id)?.content ?? null;
    if (!r) continue;
    session.push({ ...choice(r), paragraphs: spokenParagraphs(content), lastTake: lastTake.get(id) ?? null });
  }
  const weekIds = new Set(week?.ids ?? []);
  return {
    session,
    week: week && week.ids.length ? { weekStart: week.weekStart, scripts: week.ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => Boolean(r)).map(choice) } : null,
    scripts: rows.filter((r) => !weekIds.has(r.id)).map(choice),
    missing: Math.max(0, sessionIds.length - session.length),
    editor: await getEditorDefaults(),
    storageReady: fileDriver() !== null,
    uploadMode: fileDriver() === "blob" ? "blob" : "local",
  };
}
