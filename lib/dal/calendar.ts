import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, isDay, todayIn } from "@/lib/calendar/dates";
import type { CalendarPlatform, CalendarStatus, LinkStatus, PlannedFormat } from "@/lib/calendar/labels";
import { candidatesForTarget } from "@/lib/calendar/linking";
import { entriesForSource, sourcePrefill, type SourceKind } from "@/lib/calendar/service";

/**
 * Lecturas del Calendario. Cada función empieza con getCurrentUser().
 * Las piezas vinculadas traen su miniatura, vistas reales y puntaje contra la mediana.
 */
export type LinkedItem = {
  id: string;
  text: string;
  thumbnail: string | null;
  day: string;
  views: number | null;
  perfScore: number | null;
  type: string;
  permalink: string | null;
};

export type CalendarTarget = {
  id: string;
  platform: CalendarPlatform;
  linkStatus: LinkStatus;
  linkScore: number | null;
  item: LinkedItem | null;
};

export type CalendarEntry = {
  id: string;
  title: string;
  notes: string | null;
  hook: string | null;
  pillar: string | null;
  format: PlannedFormat;
  status: CalendarStatus;
  scheduledDate: string | null;
  scheduledTime: string | null;
  position: number;
  source: string;
  scriptId: string | null;
  scriptTitle: string | null;
  carouselId: string | null;
  cloneVideoId: string | null;
  videoProjectId: string | null;
  targets: CalendarTarget[];
};

type Row = {
  id: string;
  title: string;
  notes: string | null;
  hook: string | null;
  pillar: string | null;
  format: PlannedFormat;
  status: CalendarStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  position: number;
  source: string;
  script_id: string | null;
  script_title: string | null;
  carousel_id: string | null;
  clone_video_id: string | null;
  video_project_id: string | null;
  targets: {
    id: string;
    platform: CalendarPlatform;
    link_status: LinkStatus;
    link_score: number | null;
    item_id: string | null;
    item_title: string | null;
    item_caption: string | null;
    thumbnail: string | null;
    day: string | null;
    views: number | null;
    perf_score: number | null;
    type: string | null;
    permalink: string | null;
  }[];
};

const platformOrder: Record<CalendarPlatform, number> = { INSTAGRAM: 0, YOUTUBE: 1, TIKTOK: 2 };

function toEntry(r: Row): CalendarEntry {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    hook: r.hook,
    pillar: r.pillar,
    format: r.format,
    status: r.status,
    scheduledDate: r.scheduled_date,
    scheduledTime: r.scheduled_time,
    position: r.position,
    source: r.source,
    scriptId: r.script_id,
    scriptTitle: r.script_title,
    carouselId: r.carousel_id,
    cloneVideoId: r.clone_video_id,
    videoProjectId: r.video_project_id,
    targets: (r.targets ?? [])
      .map((t) => ({
        id: t.id,
        platform: t.platform,
        linkStatus: t.link_status,
        linkScore: t.link_score == null ? null : Number(t.link_score),
        item:
          t.item_id && t.link_status !== "NONE"
            ? {
                id: t.item_id,
                text: (t.item_title || t.item_caption?.split("\n")[0] || "Sin texto").slice(0, 200),
                thumbnail: t.thumbnail,
                day: t.day ?? "",
                views: t.views == null ? null : Number(t.views),
                perfScore: t.perf_score == null ? null : Number(t.perf_score),
                type: t.type ?? "",
                permalink: t.permalink,
              }
            : null,
      }))
      .sort((a, b) => platformOrder[a.platform] - platformOrder[b.platform]),
  };
}

async function selectEntries(where: SQL, order: SQL = sql`e.scheduled_date nulls first, e.scheduled_time nulls first, e.position, e.created_at`, limit = 500): Promise<CalendarEntry[]> {
  const tz = env().APP_TIMEZONE;
  const result = await getDb().execute<Row>(sql`
    select e.id, e.title, e.notes, e.hook, e.pillar, e.format, e.status,
      to_char(e.scheduled_date, 'YYYY-MM-DD') as scheduled_date, e.scheduled_time, e.position, e.source,
      e.script_id, s.title as script_title, e.carousel_id, e.clone_video_id, e.video_project_id,
      coalesce((
        select json_agg(json_build_object(
          'id', t.id, 'platform', t.platform, 'link_status', t.link_status, 'link_score', t.link_score,
          'item_id', ci.id, 'item_title', ci.title, 'item_caption', ci.caption,
          'thumbnail', coalesce(ci.thumbnail_url, ci.thumbnail_source_url),
          'day', to_char((ci.published_at at time zone ${tz})::date, 'YYYY-MM-DD'),
          'views', ci.views, 'perf_score', ci.perf_score, 'type', ci.type, 'permalink', ci.permalink
        ))
        from calendar_targets t left join content_items ci on ci.id = t.content_item_id
        where t.entry_id = e.id
      ), '[]'::json) as targets
    from calendar_entries e
    left join scripts s on s.id = e.script_id
    where ${where}
    order by ${order}
    limit ${limit}
  `);
  return result.rows.map(toEntry);
}

/** Piezas de un rango de días (vista de mes o semana) y las que están "Sin fecha". */
export async function getCalendar(from: string, to: string): Promise<{ entries: CalendarEntry[]; undated: CalendarEntry[]; suggestions: number }> {
  await getCurrentUser();
  if (!isDay(from) || !isDay(to)) throw new Error("Rango de fechas no válido");
  const [entries, undated, suggestions] = await Promise.all([
    selectEntries(sql`e.scheduled_date between ${from}::date and ${to}::date`),
    selectEntries(sql`e.scheduled_date is null`, sql`e.position, e.created_at`, 200),
    getDb().execute<{ n: number }>(sql`select count(*)::int as n from calendar_targets where link_status = 'SUGGESTED'`),
  ]);
  return { entries, undated, suggestions: suggestions.rows[0]?.n ?? 0 };
}

/** Entradas con una sugerencia de vínculo pendiente ("¿Es esta?"), de cualquier fecha. */
export async function getPendingSuggestions(): Promise<CalendarEntry[]> {
  await getCurrentUser();
  return selectEntries(sql`exists (select 1 from calendar_targets t where t.entry_id = e.id and t.link_status = 'SUGGESTED')`, sql`e.scheduled_date desc`, 50);
}

export async function getEntry(id: string): Promise<CalendarEntry | null> {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [entry] = await selectEntries(sql`e.id = ${id}::uuid`);
  return entry ?? null;
}

/**
 * Lo que está programado en los próximos `days` días (incluido hoy), en orden.
 * Para Inicio ("lo que está programado"). Excluye lo ya publicado.
 */
export async function upcomingEntries(days = 7, limit = 20): Promise<CalendarEntry[]> {
  await getCurrentUser();
  const today = todayIn(env().APP_TIMEZONE);
  const until = addDays(today, Math.max(0, days - 1));
  return selectEntries(
    sql`e.scheduled_date between ${today}::date and ${until}::date and e.status <> 'PUBLISHED'`,
    sql`e.scheduled_date, e.scheduled_time nulls first, e.position`,
    limit,
  );
}

/** Buscador de guiones para vincular a una pieza. */
export async function searchScripts(q: string): Promise<{ id: string; title: string; status: string; format: string; hook: string | null; pillar: string | null }[]> {
  await getCurrentUser();
  const text = q.trim().slice(0, 100);
  const filter = text ? sql`and (s.title ilike ${`%${text}%`} or s.idea ilike ${`%${text}%`})` : sql``;
  const result = await getDb().execute<{ id: string; title: string; status: string; format: string; hook: string | null; pillar: string | null }>(sql`
    select s.id, s.title, s.status, s.format, s.pillar,
      s.content -> 'hooks' -> coalesce((s.content ->> 'selectedHook')::int, 0) ->> 'text' as hook
    from scripts s
    where s.status <> 'ARCHIVED' ${filter}
    order by s.updated_at desc
    limit 8
  `);
  return result.rows;
}

/** Piezas publicadas que se pueden vincular a mano con un destino del calendario. */
export async function linkCandidates(targetId: string) {
  await getCurrentUser();
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return [];
  return candidatesForTarget(targetId);
}

/** Datos para precargar "Nueva pieza" desde un guion, carrusel, video con clon o proyecto del editor. */
export async function getSourcePrefill(kind: SourceKind, id: string) {
  await getCurrentUser();
  const prefill = await sourcePrefill(kind, id);
  if (!prefill) return null;
  const [existing] = await entriesForSource(kind, id);
  return { ...prefill, existing: existing ? { id: existing.id, scheduledDate: existing.scheduledDate } : null };
}
