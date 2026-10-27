import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { defaultPlatformsFor, type CalendarPlatform, type CalendarStatus, type PlannedFormat } from "./labels";
import { calendarStatusFromScript, initialStatusForScript, syncScriptFromEntry, type ScriptStatus } from "./status";

/**
 * Lógica del Calendario: crear, editar, mover y borrar piezas planeadas, y crearlas desde otros módulos
 * (guion, carrusel, video con clon, editor de video). Las acciones (components/calendario/actions.ts)
 * validan la sesión y los datos; aquí se asume que ya llegan validados.
 */
export type SourceKind = "guion" | "carrusel" | "clon" | "editor";

export type EntryInput = {
  title: string;
  notes: string | null;
  hook: string | null;
  pillar: string | null;
  format: PlannedFormat;
  status: CalendarStatus;
  platforms: CalendarPlatform[];
  scheduledDate: string | null;
  scheduledTime: string | null;
  scriptId: string | null;
  carouselId?: string | null;
  cloneVideoId?: string | null;
  videoProjectId?: string | null;
  source?: string;
  demo?: boolean;
};

export class CalendarError extends Error {}

/** Siguiente posición libre al final de un día (o de "Sin fecha"). */
async function nextPosition(date: string | null, excludeId?: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ max: sql<number | null>`max(${schema.calendarEntries.position})` })
    .from(schema.calendarEntries)
    .where(
      and(
        date ? eq(schema.calendarEntries.scheduledDate, date) : isNull(schema.calendarEntries.scheduledDate),
        excludeId ? sql`${schema.calendarEntries.id} <> ${excludeId}::uuid` : undefined,
      ),
    );
  return (row?.max ?? -1) + 1;
}

async function scriptStatus(scriptId: string | null): Promise<ScriptStatus | null> {
  if (!scriptId) return null;
  const [s] = await getDb().select({ status: schema.scripts.status }).from(schema.scripts).where(eq(schema.scripts.id, scriptId)).limit(1);
  if (!s) throw new CalendarError("Ese guion ya no existe.");
  return s.status;
}

export async function createEntry(input: EntryInput, userId: string | null): Promise<string> {
  const db = getDb();
  const fromScript = await scriptStatus(input.scriptId);
  // Si el guion ya va más adelantado, la entrada arranca en su estado.
  const status = fromScript ? calendarStatusFromScript(input.status, fromScript) : input.status;
  const [row] = await db
    .insert(schema.calendarEntries)
    .values({
      title: input.title,
      notes: input.notes,
      hook: input.hook,
      pillar: input.pillar,
      format: input.format,
      status,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledDate ? input.scheduledTime : null,
      position: await nextPosition(input.scheduledDate),
      source: input.source ?? "manual",
      scriptId: input.scriptId,
      carouselId: input.carouselId ?? null,
      cloneVideoId: input.cloneVideoId ?? null,
      videoProjectId: input.videoProjectId ?? null,
      demo: input.demo ?? false,
      createdBy: userId,
    })
    .returning({ id: schema.calendarEntries.id });
  const id = row!.id;
  const platforms = [...new Set(input.platforms)];
  if (platforms.length) await db.insert(schema.calendarTargets).values(platforms.map((platform) => ({ entryId: id, platform })));
  await syncScriptFromEntry(input.scriptId, status);
  return id;
}

export async function updateEntry(id: string, input: EntryInput): Promise<void> {
  const db = getDb();
  const [current] = await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, id)).limit(1);
  if (!current) throw new CalendarError("Esa pieza ya no está en el calendario.");

  let status = input.status;
  if (input.scriptId && input.scriptId !== current.scriptId) {
    const s = await scriptStatus(input.scriptId);
    if (s) status = calendarStatusFromScript(status, s);
  }
  const dateChanged = input.scheduledDate !== current.scheduledDate;
  await db
    .update(schema.calendarEntries)
    .set({
      title: input.title,
      notes: input.notes,
      hook: input.hook,
      pillar: input.pillar,
      format: input.format,
      status,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledDate ? input.scheduledTime : null,
      ...(dateChanged ? { position: await nextPosition(input.scheduledDate, id) } : {}),
      scriptId: input.scriptId,
    })
    .where(eq(schema.calendarEntries.id, id));

  // Redes: se agregan las nuevas y se quitan las que ya no están (con su vínculo, si lo tenían).
  const platforms = [...new Set(input.platforms)];
  if (platforms.length) {
    await db.delete(schema.calendarTargets).where(and(eq(schema.calendarTargets.entryId, id), notInArray(schema.calendarTargets.platform, platforms)));
    await db
      .insert(schema.calendarTargets)
      .values(platforms.map((platform) => ({ entryId: id, platform })))
      .onConflictDoNothing();
  } else {
    await db.delete(schema.calendarTargets).where(eq(schema.calendarTargets.entryId, id));
  }
  if (status !== current.status || input.scriptId !== current.scriptId) await syncScriptFromEntry(input.scriptId, status);
}

/** Cambia el día (o lo manda a "Sin fecha") y, si se indica, la hora. Queda al final de ese día. */
export async function moveEntry(id: string, date: string | null, time: string | null | undefined): Promise<void> {
  const db = getDb();
  const [current] = await db
    .select({ id: schema.calendarEntries.id, scheduledDate: schema.calendarEntries.scheduledDate, scheduledTime: schema.calendarEntries.scheduledTime })
    .from(schema.calendarEntries)
    .where(eq(schema.calendarEntries.id, id))
    .limit(1);
  if (!current) throw new CalendarError("Esa pieza ya no está en el calendario.");
  const nextTime = date === null ? null : time === undefined ? current.scheduledTime : time;
  const sameDay = current.scheduledDate === date;
  await db
    .update(schema.calendarEntries)
    .set({ scheduledDate: date, scheduledTime: nextTime, ...(sameDay ? {} : { position: await nextPosition(date, id) }) })
    .where(eq(schema.calendarEntries.id, id));
}

export async function setEntryStatus(id: string, status: CalendarStatus): Promise<void> {
  const [row] = await getDb().update(schema.calendarEntries).set({ status }).where(eq(schema.calendarEntries.id, id)).returning({ scriptId: schema.calendarEntries.scriptId });
  if (!row) throw new CalendarError("Esa pieza ya no está en el calendario.");
  await syncScriptFromEntry(row.scriptId, status);
}

/** Borra la pieza planeada. Nunca toca el guion, el carrusel ni las métricas vinculadas. */
export async function deleteEntry(id: string): Promise<void> {
  await getDb().delete(schema.calendarEntries).where(eq(schema.calendarEntries.id, id));
}

// ─── Desde otros módulos ───────────────────────────────────────────────────

const scriptFormatToPlanned: Record<string, PlannedFormat> = { REEL: "REEL", SHORT: "SHORT", YT_LONG: "VIDEO", STORY: "STORY" };

export type SourcePrefill = {
  kind: SourceKind;
  sourceId: string;
  sourceTitle: string;
  title: string;
  hook: string | null;
  pillar: string | null;
  format: PlannedFormat;
  platforms: CalendarPlatform[];
  status: CalendarStatus;
  scriptId: string | null;
  scriptTitle: string | null;
  carouselId: string | null;
  cloneVideoId: string | null;
  videoProjectId: string | null;
};

const firstSentence = (text: string | null | undefined) => {
  const t = (text ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(.{10,220}?[.!?¿¡])(\s|$)/);
  return (m ? m[1]! : t.slice(0, 220)).trim();
};

async function scriptBits(scriptId: string | null) {
  if (!scriptId) return null;
  const [s] = await getDb()
    .select({ id: schema.scripts.id, title: schema.scripts.title, format: schema.scripts.format, pillar: schema.scripts.pillar, platform: schema.scripts.platform, status: schema.scripts.status, content: schema.scripts.content })
    .from(schema.scripts)
    .where(eq(schema.scripts.id, scriptId))
    .limit(1);
  if (!s) return null;
  return { ...s, hook: s.content ? (s.content.hooks[s.content.selectedHook]?.text ?? null) : null };
}

/** Datos para precargar una pieza nueva a partir de un guion, carrusel, video con clon o proyecto del editor. */
export async function sourcePrefill(kind: SourceKind, id: string): Promise<SourcePrefill | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const empty = { carouselId: null, cloneVideoId: null, videoProjectId: null };

  if (kind === "guion") {
    const s = await scriptBits(id);
    if (!s) return null;
    const format = scriptFormatToPlanned[s.format] ?? "REEL";
    return {
      kind,
      sourceId: id,
      sourceTitle: s.title,
      title: s.title,
      hook: s.hook,
      pillar: s.pillar,
      format,
      platforms: s.platform ? [s.platform] : defaultPlatformsFor[format],
      status: initialStatusForScript(s.status),
      scriptId: s.id,
      scriptTitle: s.title,
      ...empty,
    };
  }

  if (kind === "carrusel") {
    const [c] = await db
      .select({ id: schema.carousels.id, title: schema.carousels.title, slides: schema.carousels.slides, scriptId: schema.carousels.scriptId, status: schema.carousels.status })
      .from(schema.carousels)
      .where(eq(schema.carousels.id, id))
      .limit(1);
    if (!c) return null;
    const s = await scriptBits(c.scriptId);
    return {
      kind,
      sourceId: id,
      sourceTitle: c.title,
      title: c.title,
      hook: c.slides[0]?.headline || s?.hook || null,
      pillar: s?.pillar ?? null,
      format: "CAROUSEL",
      platforms: ["INSTAGRAM"],
      status: c.status === "READY" || c.status === "EXPORTED" ? "READY" : "PRODUCTION",
      scriptId: s?.id ?? null,
      scriptTitle: s?.title ?? null,
      ...empty,
      carouselId: id,
    };
  }

  if (kind === "clon") {
    const [v] = await db
      .select({ id: schema.cloneVideos.id, title: schema.cloneVideos.title, scriptText: schema.cloneVideos.scriptText, scriptId: schema.cloneVideos.scriptId, status: schema.cloneVideos.status, aspectRatio: schema.cloneVideos.aspectRatio })
      .from(schema.cloneVideos)
      .where(eq(schema.cloneVideos.id, id))
      .limit(1);
    if (!v) return null;
    const s = await scriptBits(v.scriptId);
    return {
      kind,
      sourceId: id,
      sourceTitle: v.title,
      title: v.title,
      hook: s?.hook ?? firstSentence(v.scriptText),
      pillar: s?.pillar ?? null,
      format: "CLONE_VIDEO",
      platforms: v.aspectRatio === "16:9" ? ["YOUTUBE"] : defaultPlatformsFor.CLONE_VIDEO,
      status: v.status === "COMPLETED" ? "READY" : "PRODUCTION",
      scriptId: s?.id ?? null,
      scriptTitle: s?.title ?? null,
      ...empty,
      cloneVideoId: id,
    };
  }

  const [p] = await db
    .select({ id: schema.videoProjects.id, title: schema.videoProjects.title, format: schema.videoProjects.format, scriptId: schema.videoProjects.scriptId, status: schema.videoProjects.status })
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .limit(1);
  if (!p) return null;
  const s = await scriptBits(p.scriptId);
  const format: PlannedFormat = p.format === "16:9" ? "VIDEO" : "REEL";
  return {
    kind,
    sourceId: id,
    sourceTitle: p.title,
    title: s?.title ?? p.title,
    hook: s?.hook ?? null,
    pillar: s?.pillar ?? null,
    format,
    platforms: defaultPlatformsFor[format],
    status: p.status === "DONE" ? "READY" : "PRODUCTION",
    scriptId: s?.id ?? null,
    scriptTitle: s?.title ?? null,
    ...empty,
    videoProjectId: id,
  };
}

const sourceColumn = {
  guion: schema.calendarEntries.scriptId,
  carrusel: schema.calendarEntries.carouselId,
  clon: schema.calendarEntries.cloneVideoId,
  editor: schema.calendarEntries.videoProjectId,
} as const;

/** Entradas que ya están vinculadas a ese guion, carrusel, video o proyecto. */
export async function entriesForSource(kind: SourceKind, id: string) {
  return getDb()
    .select({ id: schema.calendarEntries.id, scheduledDate: schema.calendarEntries.scheduledDate, status: schema.calendarEntries.status })
    .from(schema.calendarEntries)
    .where(eq(sourceColumn[kind], id));
}

/**
 * Programa en el calendario un guion, carrusel, video con clon o proyecto del editor.
 * Si ya hay una pieza con esa fuente, no crea otra: devuelve la existente (`created: false`).
 * Pensada para el botón "Enviar a Calendario" de los otros módulos (ver `scheduleFromSourceAction`).
 */
export async function scheduleFromSource(input: {
  kind: SourceKind;
  id: string;
  date?: string | null;
  time?: string | null;
  platforms?: CalendarPlatform[];
  userId: string | null;
}): Promise<{ entryId: string; created: boolean; scheduledDate: string | null }> {
  const existing = await entriesForSource(input.kind, input.id);
  if (existing[0]) return { entryId: existing[0].id, created: false, scheduledDate: existing[0].scheduledDate };
  const prefill = await sourcePrefill(input.kind, input.id);
  if (!prefill) throw new CalendarError("No encontramos lo que quieres programar. Puede que se haya borrado.");
  const date = input.date ?? null;
  const entryId = await createEntry(
    {
      title: prefill.title,
      notes: null,
      hook: prefill.hook,
      pillar: prefill.pillar,
      format: prefill.format,
      status: prefill.status,
      platforms: input.platforms?.length ? input.platforms : prefill.platforms,
      scheduledDate: date,
      scheduledTime: date ? (input.time ?? null) : null,
      scriptId: prefill.scriptId,
      carouselId: prefill.carouselId,
      cloneVideoId: prefill.cloneVideoId,
      videoProjectId: prefill.videoProjectId,
      source: input.kind,
    },
    input.userId,
  );
  return { entryId, created: true, scheduledDate: date };
}

/** Crea varias ideas a la vez (plan semanal con IA). */
export async function createIdeas(
  ideas: { title: string; hook: string | null; pillar: string | null; format: PlannedFormat; platforms: CalendarPlatform[]; scheduledDate: string | null; notes: string | null }[],
  userId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const idea of ideas) {
    ids.push(await createEntry({ ...idea, status: "IDEA", scheduledTime: null, scriptId: null, source: "plan" }, userId));
  }
  return ids;
}

