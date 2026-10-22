/**
 * Tipos compartidos del Editor de video. Este archivo no importa nada de servidor:
 * lo usan la app, la vista previa del navegador y las pruebas.
 *
 * Los tiempos de la transcripción están en segundos del video original.
 * Los del timeline final ("out") están en segundos del video editado.
 */
import type { GraphicSpec } from "./graphics";
import type { MotionScene } from "./motion/schema";

/** Una palabra con su id (posición en la transcripción), su texto tal como se dijo y sus bordes. */
export type Word = {
  id: number;
  text: string;
  start: number;
  end: number;
  /** Confianza del proveedor (0 a 1), si la da. */
  conf?: number;
  /** El proveedor la marcó como muletilla (Deepgram con filler_words). */
  filler?: boolean;
};

export type Transcript = {
  version: 1;
  provider: string;
  language: string;
  /** Duración del audio en segundos. */
  duration: number;
  words: Word[];
};

/** Datos técnicos que deja la ingesta del worker. */
export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  /** Lo que se leyó del original con ffprobe. */
  source?: { width: number; height: number; fps: number; vfr: boolean; hdr: boolean; rotation: number; codec: string; hasAudio: boolean };
  /** Mezzanine: 1080p a 30 cuadros fijos, SDR. */
  mezzanine?: { width: number; height: number; fps: number };
  proxyKey?: string;
  proxyWidth?: number;
  proxyHeight?: number;
  posterKey?: string;
};

export type VideoFormat = "9:16" | "16:9";
/**
 * Subtítulos: "clasico" y "pop" (los primeros), la galería animada (lib/video/caption-styles.ts), "estilo" (copia los
 * de un video de referencia, ver lib/video/style.ts) y "ninguno".
 */
export const CAPTION_PRESET_KEYS = ["clasico", "pop", "caja", "hormozi", "karaoke", "palabra", "minimal", "resaltador", "estilo", "ninguno"] as const;
export type CaptionPresetKey = (typeof CAPTION_PRESET_KEYS)[number];

export const REMOVAL_REASONS = ["retake", "false_start", "filler", "silence", "off_topic", "manual"] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export type Removal = {
  from_word: number;
  to_word: number;
  reason: RemovalReason;
  confidence: number;
  /** auto: detector sin IA · ai: lo propuso Claude · user: lo marcó la persona. */
  source: "auto" | "ai" | "user";
  note?: string;
};

export type HookCandidate = { from_word: number; to_word: number; score: number; why: string };

export type PlanSegment = { id: string; from_word: number; to_word: number; role: "hook" | "body" | "cta" };

/** Plan de edición v2: todo se expresa en ids de palabras; el modelo nunca escribe segundos. */
export type EditPlan = {
  version: 2;
  format: VideoFormat;
  segments: PlanSegment[];
  order: string[];
  removals: Removal[];
  /** La propuesta original (detector + IA), para "Volver a la propuesta". */
  proposed_removals: Removal[];
  hook_candidates: HookCandidate[];
  /** Índice del gancho elegido en hook_candidates, o null si va sin gancho. */
  selected_hook: number | null;
  /** `emoji`: emojis encima de las palabras clave (solo en los estilos de la galería). */
  captions: { preset: CaptionPresetKey; emphasis_words: number[]; emoji?: boolean };
  /** Texto corregido de palabras puntuales para los subtítulos (por guion o a mano). */
  corrections: Record<string, string>;
  overlays: { text: string; from_word: number; to_word: number; position: "top" | "center" }[];
  /** Tomas de b-roll sobre rangos de palabras (las propone Claude; la persona las cambia en la revisión). */
  broll: BrollItem[];
  /** Zooms y punch-ins del estilo (se calculan en cada render a partir del timeline; aquí solo si van o no). */
  zooms_enabled?: boolean;
  /** Pausa máxima que queda entre palabras (la tolerancia de silencios del estilo). Sin estilo, la de TIMING. */
  pacing?: { long_pause: number };
  /** Estilo con el que se armó el plan (id de video_styles), si hay. */
  style_id?: string | null;
  /**
   * `music_asset_id`: pista de Biblioteca → Música (music_tracks.id), `music_db`: su volumen respecto de la voz.
   * `sfx`: efectos de sonido (lib/video/sfx.ts); sin el campo (planes viejos), sin efectos.
   */
  audio: { music_asset_id: string | null; music_db: number; target_lufs: number; sfx?: "off" | "subtle" | "strong" };
  /** Recorte para 16:9 → 9:16. offset_x va de -1 (izquierda) a 1 (derecha); 0 es el centro. */
  framing: { mode: "center" | "manual"; offset_x: number };
  /** Palabras que no están en el guion (se marcan, no se cortan). */
  off_script: number[];
  summary: string;
  warning: string;
  /** "ai" si lo armó Claude, "auto" si se armó sin IA (la IA no respondió). */
  planned_by: "ai" | "auto";
};

/**
 * Una alternativa de b-roll: un video de stock (Pixabay o Pexels), un clip de la biblioteca del cliente o un
 * gráfico animado con la marca ("graphic", ver lib/video/graphics.ts).
 */
export type BrollOption = {
  source: "pixabay" | "pexels" | "library" | "graphic";
  /** Id en su fuente (id en Pixabay o Pexels, id del clip en broll_clips o hash del gráfico). */
  id: string;
  duration: number;
  width: number;
  height: number;
  /** Stock: miniatura pública, video liviano para la vista previa y archivo para el render. */
  thumb?: string | null;
  preview?: string | null;
  file?: string | null;
  /** Autor y página del video de stock (Pexels pide atribución; en Pixabay es cortesía). */
  credit?: { name: string; url: string; page: string } | null;
  /** Biblioteca: claves privadas (se firman al mostrarlas). */
  key?: string | null;
  thumbKey?: string | null;
  title?: string | null;
  /**
   * Gráfico: una escena v2 del motor de motion graphics (lib/video/motion) o, en planes guardados antes, un spec v1
   * (plantilla, textos, colores de marca y modo). Los dos se dibujan con el motor.
   */
  graphic?: GraphicSpec | MotionScene | null;
};

export type BrollItem = {
  id: string;
  from_word: number;
  to_word: number;
  /** Qué buscar en Pexels (en inglés) y palabras clave para la biblioteca. */
  query_en: string;
  keywords: string[];
  why?: string;
  /** La elegida (null = sin clip: no se renderiza) y las alternativas para "Cambiar". */
  choice: BrollOption | null;
  options: BrollOption[];
};

/** Un tramo del video original que queda en el video final, en cuadros de 30 fps. */
export type Clip = { startFrame: number; endFrame: number; role: "hook" | "body"; firstWord: number; lastWord: number };

/** Palabra en el video final. `stop` = cierra una frase (para cortar los bloques de subtítulos). */
export type TimedWord = { id: number; text: string; start: number; end: number; emphasis: boolean; stop: boolean };

export type CaptionBlock = { start: number; end: number; words: TimedWord[] };

export const FPS = 30;
