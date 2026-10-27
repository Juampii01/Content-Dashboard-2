import type { RefImage } from "@/lib/video/compos/schema";
import type { ReactNode } from "react";
import type { DirectorView } from "@/lib/dal/video";
import type { FxContext } from "@/lib/dal/video-fx";
import type { OutputBroll, OutputZoom } from "@/lib/video/effects";
import type { FxSegment, FxBrand } from "@/lib/video/fx/compile";
import type { ComposSegment } from "@/lib/video/compos/schema";
import type { WorkView } from "@/lib/video/compos/work";
import type { ComposRequest, LiveRequest } from "../compos/use-compos-work";
import type { TransitionItem, TransitionSegment } from "@/lib/video/fx/transitions";
import type { SfxName } from "@/lib/video/sfx-library";
import type { FxKind } from "@/lib/video/fx/catalog";
import type { GraphicLook } from "@/lib/video/graphics";
import type { BrollGraphic } from "@/lib/video/motion-graphics";
import type { Density, RhythmScore } from "@/lib/video/rhythm";
import type { BrollEdit } from "@/lib/video/broll-edit";
import type { AudioPreview } from "@/lib/video/studio-audio";
import type { CaptionStyle, StylePreset } from "@/lib/video/style";
import type { PauseInfo, Timeline } from "@/lib/video/timeline";
import type { BrollItem, BrollOption, CaptionBlock, CaptionPresetKey, EditPlan, RemovalReason, Word } from "@/lib/video/types";
import type { WordSpan } from "@/lib/video/studio";
import type { PickerTab, SignedOption } from "../broll-panel";
import type { TrackItem } from "../music-manager";
import type { StudioSelection } from "./studio-timeline";
import type { StudioState, StudioUpdate } from "./use-studio-state";

export type StudioStyle = { id: string; name: string; zoom: StylePreset["zoom"]; captions: CaptionStyle | null; focusY: number } | null;

export type StudioProps = {
  projectId: string;
  plan: EditPlan;
  words: Word[];
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  proxyUrl: string | null;
  posterUrl: string | null;
  accent: string;
  canEdit: boolean;
  /** URLs listas para el navegador de cada alternativa de b-roll (clave "fuente:id"). */
  signedBroll?: Record<string, SignedOption>;
  /** Estilo con el que se armó el plan (nombre, zooms y subtítulos), si hay. */
  style?: StudioStyle;
  /** Colores y fuente de Mi marca para los gráficos nuevos del b-roll. */
  graphicLook: GraphicLook;
  /** Pistas de música listas de la biblioteca. */
  tracks?: TrackItem[];
  /** Catálogos de música conectados en Ajustes (Jamendo). */
  musicCatalog?: { jamendo: boolean } | null;
  /** Muestra de 10 s de "Audio de estudio" (antes y después), si ya está. */
  audioPreview?: AudioPreview | null;
  /** Director de edición: lo que entendió, la segunda mirada, el brief, los pedidos y las versiones. */
  director?: DirectorView | null;
  /** Efectos: la cara medida, las miniaturas de tus reels y el recorte de la persona para la vista previa. */
  fxContext?: FxContext | null;
  /** Efectos que permite Mi marca (el ritmo "Editor de reels" puede abrir con uno). */
  rhythmFx?: FxKind[];
  /** Subtítulos de Mi marca (los que pone «Subtitular» en la pestaña Transcripción). */
  captionDefault?: CaptionPresetKey;
  /** El proyecto se subió como audio solo (MP3, M4A o WAV): no hay cara para mostrar. */
  audioOnly?: boolean;
  /** Nombre del proyecto (barra superior). */
  title?: string;
  /** Acciones extra de la barra superior (por ejemplo, borrar el proyecto). */
  menu?: ReactNode;
  /** Aviso del proyecto (por ejemplo, "No lo exportamos solo"). */
  notice?: ReactNode;
  /**
   * Controles de posición, tamaño y animación de entrada y salida para lo elegido (gráfico, efecto o subtítulo). Los
   * agrega el lienzo: el inspector los muestra en su sección "Posición y animación".
   */
  transformControls?: (selection: StudioSelection) => ReactNode;
  /** Capa para manipular lo elegido sobre la vista previa (la agrega el lienzo). Va encima del cuadro del video. */
  stageOverlay?: ReactNode;
};

/** Lo que el inspector y los paneles necesitan del Estudio: el estado, lo calculado y las acciones. */
export type StudioApi = {
  props: StudioProps;
  state: StudioState;
  update: StudioUpdate;
  removedSet: Set<number>;
  selection: StudioSelection | null;
  select: (sel: StudioSelection | null) => void;
  timeline: Timeline;
  segments: OutputBroll[];
  fxSegs: FxSegment[];
  /** Animaciones a medida (composiciones) en el video final. */
  composSegs: ComposSegment[];
  /**
   * Pedidos de animaciones del Estudio (varios a la vez: en cola, en curso y fallidos sin cerrar), cómo pedir otra,
   * cancelar o cerrar el aviso de uno; `legacy`: el taller del director (Copiar edición, "Edítalo así").
   */
  compos: {
    requests: LiveRequest[];
    legacy: WorkView | null;
    sending: boolean;
    error: string | null;
    request: (req: ComposRequest) => Promise<boolean>;
    cancel: (id: string) => Promise<void>;
    dismiss: (id: string) => Promise<void>;
    /** Vuelve a consultar los pedidos (por ejemplo, después de aplicar lo de «Mira este video»). */
    refresh: () => Promise<void>;
    imageUrls: Record<string, string>;
  };
  /** Transiciones que se dibujan (en su corte) y todos los cortes del video final. */
  trSegs: TransitionSegment[];
  cutList: { at: number; word: number; index: number }[];
  zooms: OutputZoom[];
  captions: CaptionBlock[];
  /** Palabras que la persona quitó de los subtítulos (el video no se corta). */
  subsHidden: Set<number>;
  rhythm: RhythmScore;
  fxBrand: FxBrand;
  thumbsCount: number;
  maskMissing: Set<string>;
  masks: { pending: boolean; failed: boolean };
  reasons: Map<number, RemovalReason>;
  /** Pausas largas entre palabras que quedan (las acortadas y las que quedan completas). */
  pauses: PauseInfo[];
  /** ¿Lo elegido (b-roll, efecto o transición) se superpone con otra cosa visual? */
  overlaps: (sel: StudioSelection) => boolean;
  /** ¿Lo cortado (palabras o pausas) es distinto de la propuesta? */
  changedFromProposal: boolean;
  styleZooms: boolean;
  showFraming: boolean;
  time: number;
  /** Texto de un rango de palabras (con las correcciones). */
  textOf: (from: number, to: number, max?: number) => string;
  humanize: (text: string | null | undefined) => string;
  signedOf: (o: BrollItem["choice"]) => SignedOption | null;
  /** Controles de posición y animación de lo elegido (los del lienzo), o null si no se puede mover. */
  transformControls: (selection: StudioSelection) => ReactNode;
  /** Lo que ejecutan el chat con la IA y los asistentes: las mismas herramientas de la pestaña Edición. */
  tools: {
    animationAt: (range: WordSpan, prompt: string, refs?: RefImage[]) => void;
    graphicAt: (range: WordSpan, prompt: string) => void;
    clipAt: (range: WordSpan, option: SignedOption) => void;
    wholeVideo: (notes?: string) => void;
    subtitle: () => void;
    /** Recortar todo el video (silencios, tomas repetidas, arranques en falso). Devuelve cuántas palabras cortó. */
    trim: () => Promise<{ ok: true; removed: number } | { ok: false; error: string }>;
  };
  actions: {
    seek: (t: number, play?: boolean) => void;
    listenFrom: (wordId: number) => void;
    /** Elige el gancho y lo reproduce desde el principio. */
    listenHook: (index: number) => void;
    cut: (ids: number[], cut: boolean) => void;
    cutSpan: (span: WordSpan) => void;
    addBroll: (span: WordSpan, ask?: boolean) => void;
    openPicker: (id: string, tab?: PickerTab) => void;
    openGallery: (span: WordSpan | null, replace: string | null) => void;
    addFx: (kind: FxKind, span: WordSpan, replace: string | null) => void;
    addZoom: (span: WordSpan) => void;
    openPhraseFix: (span: WordSpan) => void;
    removeSelection: () => void;
    split: () => void;
    /** Divide el video en el cabezal (solo el video: subtítulos, b-roll y animaciones quedan igual). */
    splitVideo: () => void;
    /** Quita palabras de los subtítulos (o las vuelve a mostrar) sin cortar el video. */
    setSubsHidden: (ids: number[], hidden: boolean) => void;
    accept: (sel: StudioSelection) => void;
    setBrollEdit: (id: string, edit: BrollEdit) => void;
    applyLookToAll: (id: string) => void;
    setGraphic: (id: string, graphic: BrollGraphic) => void;
    changeDensity: (d: Density) => void;
    pickOption: (id: string, option: SignedOption | BrollOption) => void;
    /**
     * Pone, cambia o quita (null) una transición: la de un corte (primera palabra del tramo que entra) o, con `id`, una
     * libre (en cualquier punto). Va encima de lo que haya (en capas).
     */
    setTransition: (word: number, patch: Partial<TransitionItem> | null, id?: string) => void;
    /** Pone o mueve un sonido para que su punto fuerte caiga en `hit` (segundos del video final). */
    placeSound: (id: string | null, name: SfxName, hit: number, gain?: number) => void;
    /** Deja completa (o vuelve a acortar) la pausa que va antes de la palabra `word`. */
    setPause: (word: number, keep: boolean) => void;
    /** "Sin recortes automáticos": todas las palabras y las pausas completas. */
    restoreAll: () => void;
    /** Solo las pausas completas (las palabras cortadas siguen cortadas). */
    restorePauses: () => void;
    /** Vuelve a lo que propuso el editor (cortes y pausas). */
    backToProposal: () => void;
    /** Lleva lo elegido al frente o atrás entre lo que se le superpone (orden de capas). */
    restack: (sel: StudioSelection, where: "front" | "back") => void;
  };
};

/** Marca de los zooms que puso o aceptó la persona (los del ritmo empiezan con "Ritmo:" y se recalculan). */
export const USER_TAG = "Tuyo:";
