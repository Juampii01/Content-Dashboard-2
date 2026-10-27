/**
 * Modelos de Claude que usa la app (sin nada de servidor: lo usan el cliente de IA, los planes de costo y las pruebas).
 */
export const MODELS = {
  /** Generación principal (guiones, perfil de marca). */
  main: "claude-sonnet-5-5",
  /** Ediciones chicas sobre un campo (acortar, otro gancho, otro beat). */
  fast: "claude-haiku-5-5",
  /** Tareas que piden más criterio (adaptar un guion a otro formato, el director de edición). */
  deep: "claude-opus-5-5",
} as const;

export type ModelKey = keyof typeof MODELS;
