/**
 * Tipos de las herramientas de YouTube ("Dónde se fue la gente" y "Títulos y miniaturas").
 * Sin dependencias de servidor: los usan el esquema, la capa de datos, las pantallas y las pruebas.
 */

/** Un punto de la curva de retención de YouTube Analytics (`elapsedVideoTimeRatio` de 0,01 a 1). */
export type RetentionPoint = {
  /** Parte del video transcurrida (0 a 1). */
  at: number;
  /** `audienceWatchRatio`: parte del público que mira ese punto (puede pasar de 1 si lo repiten). */
  ratio: number;
  /** `relativeRetentionPerformance` (0 a 1): cómo retiene contra videos de YouTube de duración parecida. */
  relative?: number | null;
};

/** Un tramo dicho en el video, con sus tiempos en el video publicado (segundos). */
export type TranscriptSegment = { start: number; end: number; text: string };

/** De dónde salió la transcripción de una pieza. */
export type TranscriptSource = "editor" | "subtitulos" | "youtube";

/** Una caída fuerte de la curva. */
export type RetentionDrop = {
  /** Tramo del video donde cae (0 a 1). */
  fromAt: number;
  toAt: number;
  /** El mismo tramo en segundos (si se sabe la duración). */
  startSec: number | null;
  endSec: number | null;
  /** Puntos porcentuales del público inicial que se fueron en ese tramo (18 = "se fue el 18 %"). */
  lostPct: number;
  /** Cuántas veces más rápido cae que el ritmo normal del video. */
  steepness: number;
  /** true si es la caída de los primeros segundos (la más importante en YouTube). */
  intro: boolean;
};

/** Explicación con IA de las caídas, guardada para no volver a pagarla. */
export type RetentionExplanation = {
  summary: string;
  drops: { n: number; why: string; change: string }[];
  keep: string;
};

// ─── Títulos y miniaturas ────────────────────────────────────────────────

export const TITLE_ANGLES = ["curiosidad", "resultado", "contraste", "pregunta", "lista", "historia", "error"] as const;
export type TitleAngle = (typeof TITLE_ANGLES)[number];

export type TitleOption = { id: string; text: string; why: string };
export type TitleGroup = { angle: TitleAngle; options: TitleOption[] };

/** Base con la que se escribieron los títulos: qué métrica se usó y los ejemplos que mejor rindieron. */
export type TitleBasis = {
  /** "ctr" si la API diera el CTR de impresiones; hoy siempre "vistas" (contra la mediana del canal). */
  metric: "ctr" | "vistas";
  note: string;
  examples: { title: string; ratio: number; type: "VIDEO" | "SHORT" }[];
};

export type ThumbnailLayoutKind = "texto-izquierda" | "texto-derecha" | "texto-centro";

export type ThumbnailConcept = {
  id: string;
  name: string;
  /** Qué ve la persona en la miniatura, en una frase. */
  idea: string;
  /** Texto grande de 2 a 4 palabras. */
  text: string;
  /** Palabra (o palabras seguidas) del texto que va en el color de acento. */
  highlight: string;
  /** Escena del fondo (sin texto ni personas), editable. */
  scene: string;
  layout: ThumbnailLayoutKind;
  /** Foto del personaje (clave en Mi marca) o null = sin foto. */
  photoKey: string | null;
  backgroundKey: string | null;
  backgroundStatus: "none" | "pending" | "ready" | "failed";
  backgroundError?: string | null;
  backgroundProvider?: string | null;
};
