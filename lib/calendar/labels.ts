/**
 * Etiquetas y colores del Calendario. Sin dependencias de servidor: se usan en componentes cliente.
 */
export const CALENDAR_STATUSES = ["IDEA", "SCRIPTING", "PRODUCTION", "READY", "PUBLISHED"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const PLANNED_FORMATS = ["REEL", "CAROUSEL", "VIDEO", "SHORT", "STORY", "POST", "CLONE_VIDEO"] as const;
export type PlannedFormat = (typeof PLANNED_FORMATS)[number];

export const PLATFORMS = ["INSTAGRAM", "YOUTUBE", "TIKTOK"] as const;
export type CalendarPlatform = (typeof PLATFORMS)[number];

export type LinkStatus = "NONE" | "SUGGESTED" | "LINKED";

export const calendarStatusLabel: Record<CalendarStatus, string> = {
  IDEA: "Idea",
  SCRIPTING: "En guion",
  PRODUCTION: "En producción",
  READY: "Listo",
  PUBLISHED: "Publicado",
};

export const calendarStatusHint: Record<CalendarStatus, string> = {
  IDEA: "Solo la idea, sin guion todavía.",
  SCRIPTING: "Escribiendo el guion o los textos.",
  PRODUCTION: "Grabando, editando o diseñando.",
  READY: "Terminada, lista para publicar.",
  PUBLISHED: "Ya está en la red.",
};

/**
 * Un color por estado. Siempre va acompañado del nombre del estado (leyenda, texto oculto para
 * lectores de pantalla y el diálogo): el color ayuda a escanear, no es la única señal.
 */
export const calendarStatusColor: Record<CalendarStatus, string> = {
  IDEA: "#8a9bb8",
  SCRIPTING: "#e8b93a",
  PRODUCTION: "#4da3ff",
  READY: "#b18cff",
  PUBLISHED: "#3ddc97",
};

export const plannedFormatLabel: Record<PlannedFormat, string> = {
  REEL: "Reel",
  CAROUSEL: "Carrusel",
  VIDEO: "Video",
  SHORT: "Short",
  STORY: "Historias",
  POST: "Post",
  CLONE_VIDEO: "Video con clon",
};

export const platformLabel: Record<CalendarPlatform, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
};

/** Redes que tienen sentido por defecto para cada formato (el usuario puede cambiarlas). */
export const defaultPlatformsFor: Record<PlannedFormat, CalendarPlatform[]> = {
  REEL: ["INSTAGRAM", "TIKTOK"],
  CAROUSEL: ["INSTAGRAM"],
  VIDEO: ["YOUTUBE"],
  SHORT: ["YOUTUBE"],
  STORY: ["INSTAGRAM"],
  POST: ["INSTAGRAM"],
  CLONE_VIDEO: ["INSTAGRAM", "TIKTOK"],
};

export const sourceLabel: Record<string, string> = {
  manual: "Creada a mano",
  guion: "Desde Guiones",
  carrusel: "Desde Carruseles",
  clon: "Desde Videos con clon",
  editor: "Desde el Editor de video",
  plan: "Plan semanal con IA",
  estratega: "Desde el Estratega",
};
