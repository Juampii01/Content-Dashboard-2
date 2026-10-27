export const statusLabel = {
  IDEA: "Idea",
  DRAFT: "Borrador",
  READY: "Listo para grabar",
  RECORDED: "Grabado",
  PUBLISHED: "Publicado",
  ARCHIVED: "Archivado",
} as const;
export type ScriptStatus = keyof typeof statusLabel;

export const statusTone: Record<ScriptStatus, "neutral" | "info" | "success" | "warning"> = {
  IDEA: "neutral",
  DRAFT: "warning",
  READY: "info",
  RECORDED: "info",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export const formatLabel = { REEL: "Reel / TikTok", SHORT: "Short", YT_LONG: "YouTube largo", STORY: "Historias" } as const;

export const hookTypeLabel: Record<string, string> = {
  contraste: "Contraste",
  curiosidad: "Curiosidad",
  dolor: "Dolor",
  resultado: "Resultado",
  historia: "Historia",
  pregunta: "Pregunta",
  lista: "Lista",
};

export const actionLabel: Record<string, string> = {
  generar: "Generado",
  ganchos: "Ganchos nuevos",
  acortar: "Acortado",
  directo: "Más directo",
  beat: "Bloque reescrito",
  cta: "CTA nuevo",
  editar: "Editado a mano",
  restaurar: "Versión restaurada",
  adaptar: "Adaptado de otro guion",
  jugo: "Sacado de otro contenido",
};
