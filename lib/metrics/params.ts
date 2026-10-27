/**
 * Filtros de Métricas leídos de la URL. Funciones puras: sirven en el servidor y en el cliente.
 * La URL es la fuente de verdad, así un filtro se puede compartir o guardar como marcador.
 */
import type { ContentType, Platform } from "@/lib/social/types";

export const PLATFORM_PARAM: Record<string, Platform> = { instagram: "INSTAGRAM", youtube: "YOUTUBE", tiktok: "TIKTOK" };
export const TYPE_PARAM: Record<string, ContentType> = { reel: "REEL", carrusel: "CAROUSEL", post: "IMAGE", video: "VIDEO", short: "SHORT" };

export const SORT_KEYS = ["fecha", "views", "alcance", "likes", "comentarios", "compartidos", "guardados", "interaccion", "retencion", "puntaje"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type RangePreset = "7d" | "28d" | "90d" | "365d" | "month" | "custom";

export type MetricsFilters = {
  preset: RangePreset;
  from: string; // YYYY-MM-DD (día local de la marca)
  to: string;
  platforms: Platform[]; // vacío = todas
  types: ContentType[]; // vacío = todos
  q: string;
  minViews: number | null;
  maxViews: number | null;
  sort: SortKey;
  dir: "asc" | "desc";
  view: "tabla" | "cuadricula";
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(",") : (v ?? ""))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
// Fecha real (rechaza 2026-02-31) y razonable (desde el año 2005, cuando nacieron estas redes).
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= "2005-01-01" && !Number.isNaN(Date.parse(s)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
/** Rango máximo que se puede pedir (para no armar gráficos de miles de días). */
const MAX_RANGE_DAYS = 3 * 366;
const intOrNull = (s: string) => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** "Hoy" en la zona horaria de la marca, como YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): { from: string; to: string } {
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  const days = Number.parseInt(preset, 10);
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Periodo anterior de la misma duración, para comparar. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to);
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export function parseFilters(params: Params, timeZone: string): MetricsFilters {
  const today = todayIn(timeZone);
  const presetRaw = one(params.rango);
  let preset: RangePreset = (["7d", "28d", "90d", "365d", "month"] as const).includes(presetRaw as never) ? (presetRaw as RangePreset) : "28d";
  let { from, to } = presetRange(preset === "custom" ? "28d" : (preset as Exclude<RangePreset, "custom">), today);

  const desde = one(params.desde);
  const hasta = one(params.hasta);
  if (isDay(desde) && isDay(hasta) && desde <= hasta) {
    preset = "custom";
    to = hasta > today ? today : hasta;
    from = daysBetween(desde, to) > MAX_RANGE_DAYS ? addDays(to, -(MAX_RANGE_DAYS - 1)) : desde;
  }

  const sortRaw = one(params.orden) as SortKey;
  const page = Math.max(1, Math.min(500, intOrNull(one(params.pagina)) ?? 1));

  return {
    preset,
    from,
    to,
    platforms: [...new Set(list(params.red).map((p) => PLATFORM_PARAM[p]).filter((p): p is Platform => Boolean(p)))],
    types: [...new Set(list(params.tipo).map((t) => TYPE_PARAM[t]).filter((t): t is ContentType => Boolean(t)))],
    q: one(params.q).trim().slice(0, 100),
    minViews: intOrNull(one(params.min)),
    maxViews: intOrNull(one(params.max)),
    sort: SORT_KEYS.includes(sortRaw) ? sortRaw : "fecha",
    dir: one(params.dir) === "asc" ? "asc" : "desc",
    view: one(params.vista) === "cuadricula" ? "cuadricula" : "tabla",
    page,
  };
}

/** Arma la URL de Métricas con los filtros dados (solo incluye lo que no es el valor por defecto). */
export function filtersToSearch(f: Partial<MetricsFilters>): string {
  const p = new URLSearchParams();
  const platformKey = Object.fromEntries(Object.entries(PLATFORM_PARAM).map(([k, v]) => [v, k]));
  const typeKey = Object.fromEntries(Object.entries(TYPE_PARAM).map(([k, v]) => [v, k]));
  if (f.preset === "custom" && f.from && f.to) {
    p.set("desde", f.from);
    p.set("hasta", f.to);
  } else if (f.preset && f.preset !== "28d") p.set("rango", f.preset);
  if (f.platforms?.length) p.set("red", f.platforms.map((x) => platformKey[x]).join(","));
  if (f.types?.length) p.set("tipo", f.types.map((x) => typeKey[x]).join(","));
  if (f.q) p.set("q", f.q);
  if (f.minViews != null) p.set("min", String(f.minViews));
  if (f.maxViews != null) p.set("max", String(f.maxViews));
  if (f.sort && f.sort !== "fecha") p.set("orden", f.sort);
  if (f.dir && f.dir !== "desc") p.set("dir", f.dir);
  if (f.view && f.view !== "tabla") p.set("vista", f.view);
  if (f.page && f.page > 1) p.set("pagina", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
