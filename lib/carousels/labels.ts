export const carouselStatusLabel = {
  DRAFT: "Borrador",
  READY: "Listo",
  EXPORTED: "Exportado",
  ARCHIVED: "Archivado",
} as const;
export type CarouselStatus = keyof typeof carouselStatusLabel;

export const carouselStatusTone: Record<CarouselStatus, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "warning",
  READY: "info",
  EXPORTED: "success",
  ARCHIVED: "neutral",
};

export const CAROUSEL_OBJECTIVES = {
  guardar: { label: "Que lo guarden", hint: "Contenido de referencia: pasos, listas, plantillas." },
  compartir: { label: "Que lo compartan", hint: "Una idea fuerte o una verdad incómoda del nicho." },
  conversacion: { label: "Comentarios o DM", hint: "Cierra con tu oferta y una palabra clave." },
} as const;
export type CarouselObjective = keyof typeof CAROUSEL_OBJECTIVES;
