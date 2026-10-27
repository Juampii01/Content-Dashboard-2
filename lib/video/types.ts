/**
 * Tipos compartidos del Editor de video. Este archivo no importa nada de servidor:
 * lo usan la app, la vista previa del navegador y las pruebas.
 *
 * Los tiempos de la transcripción están en segundos del video original.
 * Los del timeline final ("out") están en segundos del video editado.
 */
import type { BrollEditInput } from "./broll-edit";
import type { FxItem } from "./fx/schema";
import type { Composition } from "./compos/schema";
import type { TransitionItem } from "./fx/transitions";
import type { MusicGenSpec } from "./music-gen/spec";
import type { SoundCue } from "./sfx";
import type { AudioMix, MusicFade } from "./audio-mix";
import type { Marker } from "./markers";
import type { GraphicSpec } from "./graphics";
import type { MotionScene } from "./motion/schema";
import type { AudioPreviewMedia } from "./studio-audio";

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
  /** Muestra de "Audio de estudio" (10 s: original, Suave y Fuerte), armada al analizar. */
  audioPreview?: AudioPreviewMedia;
  /**
   * Recorte de la persona para la vista previa de los efectos (trabajo VIDEO_FX), por encuadre: los segundos del
   * original que ya tienen su tira de máscaras en `editor/<id>/fx/<clave>/m-NNNNN.png`.
   */
  fxMasks?: Record<string, FxMaskMedia>;
  /** Forma de onda de la voz para la línea de tiempo (worker/video/peaks.py, lib/video/peaks.ts). */
  peaks?: { version: number; key: string; rate: number; count: number };
};

export type FxMaskMedia = { chunks: number[]; fps: number; tile: [number, number]; at: string };

export type VideoFormat = "9:16" | "16:9";
/**
 * Subtítulos: "clasico" y "pop" (los primeros), la galería animada (lib/video/caption-styles.ts), "estilo" (copia los
 * de un video de referencia, ver lib/video/style.ts) y "ninguno".
 */
export const CAPTION_PRESET_KEYS = ["clasico", "pop", "caja", "hormozi", "karaoke", "palabra", "minimal", "resaltador", "estilo", "ninguno"] as const;
export type CaptionPresetKey = (typeof CAPTION_PRESET_KEYS)[number];

export const REMOVAL_REASONS = ["retake", "false_start", "filler", "silence", "off_topic", "bad_take", "manual"] as const;
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

export type PlanMove = { from_word: number; to_word: number; after_word: number; why: string };
/** `layer`: con zooms que se pisan, manda el de capa más alta (lib/video/effects.ts `directorZooms`). */
export type ZoomMoment = { from_word: number; to_word: number; scale: number; why: string; layer?: number };

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
  /** `transform` y `lines`: lugar y tamaño desde el lienzo de la revisión (lib/video/canvas/captions.ts). */
  captions: {
    preset: CaptionPresetKey;
    emphasis_words: number[];
    emoji?: boolean;
    hide?: { from_word: number; to_word: number; why: string }[];
    transform?: { x: number; y: number; scale: number; rotation?: number };
    lines?: Record<string, { x: number; y: number; scale: number; rotation?: number }>;
  };
  /** Texto corregido de palabras puntuales para los subtítulos (por guion o a mano). */
  corrections: Record<string, string>;
  overlays: { text: string; from_word: number; to_word: number; position: "top" | "center" }[];
  /** Tomas de b-roll sobre rangos de palabras (las propone Claude; la persona las cambia en la revisión). */
  broll: BrollItem[];
  /** Efectos "de firma" sobre rangos de palabras (lib/video/fx). Sin el campo (planes de antes), sin efectos. */
  effects?: FxItem[];
  /** Transiciones en los cortes (lib/video/fx/transitions). Sin el campo, cortes secos. */
  transitions?: TransitionItem[];
  /**
   * Composiciones: animaciones escritas por Claude (lib/video/compos), sobre rangos de palabras. En su tramo mandan
   * sobre los efectos, las transiciones y el b-roll que se pisen. Sin el campo, ninguna.
   */
  compositions?: Composition[];
  /** Zooms y punch-ins del estilo (se calculan en cada render a partir del timeline; aquí solo si van o no). */
  zooms_enabled?: boolean;
  /**
   * Bloques movidos por el director (lib/video/director): el rango de palabras pasa a ir después de `after_word`
   * (-1 = al principio, después del gancho). Sin cambiar el sentido; la persona puede deshacerlo en la revisión.
   */
  moves?: PlanMove[];
  /**
   * Orden de las partes que eligió la persona a mano (lib/video/sequence.ts): tramos de palabras del original en el
   * orden en que salen. Manda sobre `moves`. La IA nunca lo cambia. Sin el campo, el video sale como se grabó.
   */
  sequence?: { from_word: number; to_word: number }[];
  /** Zooms que decidió el director (énfasis o ritmo), si no hay un estilo con sus propios zooms. */
  zoom_moments?: ZoomMoment[];
  /**
   * Ritmo (lib/video/rhythm.ts): la densidad elegida para este video y lo que agregó el relleno de ritmo después del
   * director (punch-ins, gráficos simples, efecto de apertura, resaltados y muletillas), cada cosa con su "por qué".
   * Sin el campo (planes de antes), la densidad sale del formato.
   */
  rhythm?: { density: "sobria" | "normal" | "reels"; added: { kind: "zoom" | "grafico" | "efecto" | "resaltado" | "corte" | "pausas"; from_word: number; to_word: number; why: string }[] };
  /** Lo armó el director de edición (con ojos): ritmo elegido y versión del director. */
  director?: { version: 1; pace: "calm" | "normal" | "fast" };
  /** Pausa máxima que queda entre palabras (la tolerancia de silencios del estilo). Sin estilo, la de TIMING. */
  /**
   * Silencios: más largos que `long_pause` se recortan, salvo los que la persona dejó completos en la revisión
   * (`keep`: id de la palabra que sigue a la pausa) o todos (`keep_all`, "Sin recortes automáticos").
   */
  pacing?: { long_pause: number; keep?: number[]; keep_all?: boolean };
  /**
   * Divisiones del video hechas en la revisión («Dividir» o la tecla C): id de la palabra con la que empieza cada parte.
   * Solo marcan partes en la línea de tiempo para poder elegirlas y quitarlas; no cambian el render.
   */
  splits?: number[];
  /** Estilo con el que se armó el plan (id de video_styles), si hay. */
  style_id?: string | null;
  /**
   * `music_asset_id`: pista de Biblioteca → Música (music_tracks.id), `music_db`: su volumen respecto de la voz.
   * `sfx`: efectos de sonido (lib/video/sfx.ts); sin el campo (planes viejos), sin efectos.
   * `cues`: sonidos de la biblioteca puestos a mano en la pista de Sonido (anclados a palabras).
   * `music_gen`: música generada de la biblioteca (estilo, semilla y tempo); manda sobre `music_asset_id`.
   */
  audio: { music_asset_id: string | null; music_db: number; target_lufs: number; sfx?: "off" | "subtle" | "strong"; /** «Volumen de los efectos» (dB sobre todos). */ sfx_db?: number; studio?: "off" | "soft" | "strong"; cues?: SoundCue[]; music_gen?: MusicGenSpec | null; /** Volumen de la voz (dB, lib/video/audio-mix.ts). */ voice_db?: number; /** Pistas silenciadas y en solo. */ mix?: AudioMix; /** Fundidos de la música (s). */ music_fade?: MusicFade };
  /** Marcadores con nota (lib/video/markers.ts), anclados a palabras. No cambian el render. */
  markers?: Marker[];
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
  /** Biblioteca: "image" para una imagen (b-roll fijo); sin el campo, video. */
  kind?: "video" | "image";
  /**
   * Biblioteca: el tramo del clip que mejor muestra lo que se busca (de su ficha). Al elegirlo, el b-roll se ve desde
   * su inicio (`edit.clip_start`).
   */
  moment?: { start: number; end: number; what: string } | null;
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
  /**
   * Cómo se ve en el video: ubicación, encuadre, look y tiempo (lib/video/broll-edit.ts). Sin esto (planes guardados
   * antes), pantalla completa recortada al centro con fundido, como siempre.
   */
  edit?: BrollEditInput;
  /** Capa (orden de dibujo con lo que se superpone): más alta, más arriba. Sin el campo, 0. */
  layer?: number;
};

/** Un tramo del video original que queda en el video final, en cuadros de 30 fps. */
export type Clip = { startFrame: number; endFrame: number; role: "hook" | "body"; firstWord: number; lastWord: number };

/** Palabra en el video final. `stop` = cierra una frase (para cortar los bloques de subtítulos). */
export type TimedWord = { id: number; text: string; start: number; end: number; emphasis: boolean; stop: boolean };

export type CaptionBlock = {
  start: number;
  end: number;
  words: TimedWord[];
  /** Lugar desde el lienzo de la revisión (lib/video/canvas/captions.ts). Sin esto, el del estilo. */
  place?: { x: number; y: number; scale: number };
};

export const FPS = 30;
