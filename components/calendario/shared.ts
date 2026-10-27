import type { CalendarView } from "@/lib/calendar/dates";
import { CALENDAR_STATUSES, PLATFORMS, type CalendarPlatform, type CalendarStatus, type PlannedFormat } from "@/lib/calendar/labels";
import { FEATURES } from "@/lib/features";

/** Tipos y utilidades compartidas por los componentes del Calendario (cliente y servidor). */
export type { CalendarEntry, CalendarTarget, LinkedItem } from "@/lib/dal/calendar";

export type Filters = { platforms: CalendarPlatform[]; statuses: CalendarStatus[] };

/** Valores con los que se abre el diálogo de "Nueva pieza". */
export type CreateDefaults = {
  title?: string;
  hook?: string | null;
  pillar?: string | null;
  format?: PlannedFormat;
  platforms?: CalendarPlatform[];
  status?: CalendarStatus;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scriptId?: string | null;
  scriptTitle?: string | null;
  carouselId?: string | null;
  cloneVideoId?: string | null;
  videoProjectId?: string | null;
  source?: "manual" | "guion" | "carrusel" | "clon" | "editor";
  /** Si la fuente ya está en el calendario, se avisa antes de crear otra pieza. */
  existing?: { id: string; scheduledDate: string | null } | null;
  sourceLabel?: string | null;
};

const statusSlug: Record<CalendarStatus, string> = {
  IDEA: "idea",
  SCRIPTING: "guion",
  PRODUCTION: "produccion",
  READY: "listo",
  PUBLISHED: "publicado",
};

export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const list = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v.join(",") : (v ?? ""))
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const platforms = PLATFORMS.filter((p) => list(params.red).includes(p.toLowerCase()));
  const statuses = CALENDAR_STATUSES.filter((s) => list(params.estado).includes(statusSlug[s]));
  return { platforms, statuses };
}

export function calendarUrl(view: CalendarView, anchor: string, filters?: Filters): string {
  const q = new URLSearchParams({ vista: view, fecha: anchor });
  if (filters?.platforms.length) q.set("red", filters.platforms.map((p) => p.toLowerCase()).join(","));
  if (filters?.statuses.length) q.set("estado", filters.statuses.map((s) => statusSlug[s]).join(","));
  return `/calendario?${q.toString()}`;
}

/** Enlaces a lo que está vinculado con la pieza (aunque el módulo todavía no exista en esta instalación). */
export function sourceLinks(e: { scriptId: string | null; scriptTitle?: string | null; carouselId: string | null; cloneVideoId: string | null; videoProjectId: string | null }) {
  const links: { href: string; label: string }[] = [];
  if (e.scriptId) links.push({ href: `/guiones/${e.scriptId}`, label: "Abrir guion" });
  if (e.carouselId) links.push({ href: `/carruseles/${e.carouselId}`, label: "Abrir carrusel" });
  if (e.cloneVideoId && FEATURES.clone) links.push({ href: `/clon/${e.cloneVideoId}`, label: "Abrir video con clon" });
  if (e.videoProjectId) links.push({ href: `/editor/${e.videoProjectId}`, label: "Abrir en el editor" });
  return links;
}

/** Identificadores de las zonas donde se puede soltar una pieza. */
export const dropId = {
  day: (day: string) => `day:${day}`,
  slot: (day: string, hour: number | null) => `slot:${day}:${hour == null ? "none" : String(hour).padStart(2, "0")}`,
  undated: "undated",
};

export type DropTarget = { date: string | null; hour: number | null | undefined };

/** Traduce el id de la zona a fecha y hora. `hour: undefined` = no cambia la hora (vista de mes). */
export function parseDropId(id: string): DropTarget | null {
  if (id === "undated") return { date: null, hour: null };
  const [kind, day, hour] = id.split(":");
  if (kind === "day" && day) return { date: day, hour: undefined };
  if (kind === "slot" && day) return { date: day, hour: hour === "none" ? null : Number(hour) };
  return null;
}
