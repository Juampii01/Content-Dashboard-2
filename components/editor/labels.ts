import type { StatusTone } from "@/components/ui/badges";
import type { RemovalReason } from "@/lib/video/types";

export type ProjectStatus = "UPLOADING" | "PROCESSING" | "AWAITING_REVIEW" | "RENDERING" | "DONE" | "FAILED";

export const statusLabel: Record<ProjectStatus, string> = {
  UPLOADING: "Subiendo",
  PROCESSING: "Preparando",
  AWAITING_REVIEW: "Para revisar",
  RENDERING: "Renderizando",
  DONE: "Listo",
  FAILED: "Con error",
};

export const statusTone: Record<ProjectStatus, StatusTone> = {
  UPLOADING: "neutral",
  PROCESSING: "info",
  AWAITING_REVIEW: "warning",
  RENDERING: "info",
  DONE: "success",
  FAILED: "danger",
};

export const reasonLabel: Record<RemovalReason, string> = {
  retake: "Toma repetida",
  false_start: "Arranque en falso",
  filler: "Muletilla",
  silence: "Pausa",
  off_topic: "Fuera de tema",
  manual: "Cortado a mano",
};

/** Etapas que ve la persona, con el tramo de la barra de progreso que ocupa cada una (lo escribe el worker). */
export const ANALYZE_STAGES = [
  { label: "Preparando el video", until: 55, match: ["Bajando el video", "Preparando el video", "Preparando la vista previa"] },
  { label: "Transcribiendo palabra por palabra", until: 85, match: ["Transcribiendo"] },
  { label: "Armando el plan de edición", until: 100, match: ["Armando el plan de edición"] },
];

export const RENDER_STAGES = [
  { label: "Preparando", until: 10, match: ["Bajando el video", "Preparando el video"] },
  { label: "Cortando las tomas", until: 35, match: ["Cortando las tomas"] },
  { label: "Mezclando el audio", until: 45, match: ["Mezclando el audio"] },
  { label: "Renderizando con subtítulos", until: 90, match: ["Renderizando"] },
  { label: "Revisando la calidad", until: 95, match: ["Revisando la calidad"] },
  { label: "Guardando el video", until: 100, match: ["Guardando el video"] },
];

/**
 * "Hazlo por mí": una sola barra para todo el camino (análisis + plan + render). El análisis ocupa la primera mitad
 * de la barra y el render la segunda; cada etapa dice de qué trabajo y de qué tramo de su progreso sale.
 */
export const AUTO_STAGES = [
  { label: "Preparando el video", phase: "analyze", until: 55 },
  { label: "Transcribiendo palabra por palabra", phase: "analyze", until: 85 },
  { label: "Armando la edición: cortes, gancho, gráficos y b-roll", phase: "analyze", until: 101 },
  { label: "Cortando las tomas y limpiando el audio", phase: "render", until: 45 },
  { label: "Renderizando con subtítulos", phase: "render", until: 90 },
  { label: "Revisando la calidad y guardando", phase: "render", until: 101 },
] as const;
