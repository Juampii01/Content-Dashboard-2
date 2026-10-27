import { MORE_FX_INFO, MORE_FX_KINDS, MORE_FX_MOVABLE } from "./catalog-more";

/**
 * Biblioteca de efectos del Editor: los 17 "de firma" de este archivo y 83 más (catalog-more.ts) en categorías. Cada efecto es una capa del plan sobre un tramo de palabras (como el
 * b-roll), con sus textos y su diseño dibujado por el motor de efectos (lib/video/fx/engine), el mismo en la vista
 * previa del navegador y en el worker (skia-canvas).
 *
 * Este archivo es la ficha de cada efecto: nombre, para qué sirve, qué necesita (recorte de la persona, miniaturas de
 * tus reels), duración, qué textos lleva y cuándo lo elige el director. Sin servidor.
 */

export const SIGNATURE_FX_KINDS = [
  "cover_story",
  "digital_zoom",
  "checklist",
  "glass_type",
  "iphone",
  "chart_grow",
  "headline_wall",
  "orbit",
  "couch_wall",
  "ui_world",
  "frame_break",
  "zoom_cut",
  "zoom_out",
  "green_screen",
  "paper_cut",
  "doodle_boil",
  "vertigo",
] as const;
export const FX_KINDS = [...SIGNATURE_FX_KINDS, ...MORE_FX_KINDS] as const;
export type FxKind = (typeof FX_KINDS)[number];

/** Categorías de la biblioteca (en este orden en la galería y en Mi marca). */
export const FX_CATEGORIES = ["firma", "texto", "atencion", "tarjetas", "looks", "camara", "marcos", "recorte"] as const;
export type FxCategory = (typeof FX_CATEGORIES)[number];
export const FX_CATEGORY_LABELS: Record<FxCategory, { label: string; description: string }> = {
  firma: { label: "De firma", description: "Los efectos insignia: portada, checklist, letras de vidrio y más." },
  texto: { label: "Texto", description: "Palabras y frases animadas con tu tipografía." },
  atencion: { label: "Atención", description: "Flechas, círculos, lupas, stickers y marcas para señalar." },
  tarjetas: { label: "Tarjetas", description: "Nombre, cita, cifra, listas, encuesta, comentario y más." },
  looks: { label: "Looks", description: "Color y textura: grano, VHS, glitch, duotono, cine." },
  camara: { label: "Cámara", description: "Sacudidas, zooms, paneos e inclinaciones." },
  marcos: { label: "Marcos", description: "Teléfono, foto instantánea, cuaderno, pantallas y paneles." },
  recorte: { label: "Con tu recorte", description: "Texto detrás de ti, contorno, sombra, clones y fondos." },
};

/**
 * Textos por defecto de los efectos nuevos a partir de lo que se dice (schema.defaultFx): "key" la palabra fuerte,
 * "KEY" en mayúsculas, "phrase" las primeras palabras de la frase, "sentence" la frase entera, "number" una cifra dicha
 * (o vacío: nunca se inventa), "question" la pregunta dicha, "words" palabras fuertes (ítems), "phrases" partes de lo
 * dicho (ítems), "emoji" el emoji que corresponde a lo que se dice, "yesno" SÍ/NO. `{ fixed }` un texto fijo.
 */
export type FxAuto = {
  text?: "key" | "KEY" | "phrase" | "lower-phrase" | "sentence" | "number" | "question" | "emoji" | "yesno" | "" | { fixed: string };
  items?: "words" | "phrases" | "sentence" | { fixed: string[] };
  kicker?: string;
};

export type FxField = { label: string; placeholder: string; max: number };
export type FxItemsField = FxField & { min: number; count: number };

export type FxInfo = {
  /** Categoría en la biblioteca. */
  category: FxCategory;
  /** Palabras para el buscador de la biblioteca (sin tildes). */
  keywords?: string;
  /** Textos por defecto (efectos nuevos; los de firma tienen su caso en schema.defaultFx). */
  auto?: FxAuto;
  /** Textos de la muestra animada de la galería. */
  demo?: { text?: string; items?: string[]; kicker?: string };
  /** Nombre en la galería. */
  label: string;
  /** Una frase: qué se ve. */
  description: string;
  /** Va detrás de la persona: necesita recortarla del fondo en cada cuadro. */
  mask: boolean;
  /** Usa miniaturas de tus reels (de Métricas). */
  thumbs: boolean;
  /** Duración razonable del tramo (segundos). */
  duration: { min: number; max: number };
  /** "hide": el efecto lleva su propio texto o tapa la franja de los subtítulos, que se ocultan mientras dura. */
  captions: "keep" | "hide";
  /** Texto principal (una palabra o un título), si lleva. */
  text: FxField | null;
  /** Lista de textos (ítems, titulares, tareas), si lleva. */
  items: FxItemsField | null;
  /** Texto secundario (rótulo chico), si lleva. */
  kicker: FxField | null;
  /** Cuándo usarlo (para la persona y para el director). */
  when: string;
  /** Lo hace alguien de afuera (descripción con especificación) o es diseño propio. */
  spec: "referencia" | "propio";
};

const SIGNATURE_FX_INFO: Record<(typeof SIGNATURE_FX_KINDS)[number], Omit<FxInfo, "category">> = {
  cover_story: {
    label: "Portada de revista",
    description: "Una palabra gigante en serif detrás de tu cabeza, con fecha y titular de portada.",
    mask: true,
    thumbs: false,
    duration: { min: 2, max: 6 },
    captions: "hide",
    text: { label: "Palabra de portada", placeholder: "CRECER", max: 12 },
    items: { label: "Texto de portada (dos líneas)", placeholder: "La guía para crecer", max: 32, min: 1, count: 2 },
    kicker: { label: "Fecha y número", placeholder: "OCT 2026 · N° 12", max: 24 },
    when: "Para abrir el video o presentar el tema central: el primer segundo con cara de portada.",
    spec: "referencia",
  },
  digital_zoom: {
    label: "Zoom digital",
    description: "Cortes secos de 1,3× y 1,6× hacia tu cara en las palabras fuertes, con subtítulos grandes.",
    mask: false,
    thumbs: false,
    duration: { min: 1.5, max: 8 },
    captions: "hide",
    text: null,
    items: null,
    kicker: null,
    when: "En una frase con 1 a 3 palabras clave (una cifra, un resultado, la idea central) para remarcarlas.",
    spec: "referencia",
  },
  checklist: {
    label: "Checklist",
    description: "Tarjeta de vidrio con 3 tareas que se tildan a medida que las dices.",
    mask: false,
    thumbs: false,
    duration: { min: 3, max: 12 },
    captions: "keep",
    text: { label: "Rótulo", placeholder: "TODO LO QUE TIENES QUE HACER", max: 34 },
    items: { label: "Tareas", placeholder: "Define tu cliente ideal", max: 34, min: 2, count: 3 },
    kicker: null,
    when: "Cuando enumeras pasos o requisitos (primero, segundo, tercero).",
    spec: "referencia",
  },
  glass_type: {
    label: "Letras de vidrio",
    description: "Una palabra enorme de vidrio detrás de ti, con un brillo que la cruza.",
    mask: true,
    thumbs: false,
    duration: { min: 2, max: 6 },
    captions: "keep",
    text: { label: "Palabra", placeholder: "FOCO", max: 10 },
    items: null,
    kicker: null,
    when: "Para la palabra que resume la idea (un concepto corto y fuerte).",
    spec: "referencia",
  },
  iphone: {
    label: "Teléfono con tareas",
    description: "Un teléfono entra de costado con la app «Hoy» y sus tareas tildándose, sin tapar tu cara.",
    mask: false,
    thumbs: false,
    duration: { min: 2, max: 7 },
    captions: "keep",
    text: { label: "Título de la app", placeholder: "Hoy", max: 14 },
    items: { label: "Tareas", placeholder: "Grabar el reel", max: 26, min: 2, count: 4 },
    kicker: null,
    when: "Cuando hablas de una rutina, un hábito o tareas del día.",
    spec: "referencia",
  },
  chart_grow: {
    label: "Gráfico que crece",
    description: "El video se oscurece y una línea de la semana sube fuerte hasta una pastilla «Escala ↗».",
    mask: false,
    thumbs: false,
    duration: { min: 2, max: 6 },
    captions: "keep",
    text: { label: "Pastilla", placeholder: "ESCALA", max: 14 },
    items: null,
    kicker: null,
    when: "Cuando hablas de crecimiento, resultados o un antes y después.",
    spec: "referencia",
  },
  headline_wall: {
    label: "Muro de titulares",
    description: "Cinco notas de papel con titulares, clavadas en la pared alrededor de tu cabeza.",
    mask: true,
    thumbs: false,
    duration: { min: 2.5, max: 7 },
    captions: "keep",
    text: null,
    items: { label: "Titulares", placeholder: "Nadie te lo dice", max: 40, min: 3, count: 5 },
    kicker: null,
    when: "Cuando hablas de lo que se dice de un tema, mitos o noticias.",
    spec: "referencia",
  },
  orbit: {
    label: "Giro 3D",
    description: "Tus reels anteriores giran a tu alrededor, por delante y por detrás.",
    mask: true,
    thumbs: true,
    duration: { min: 2.5, max: 7 },
    captions: "keep",
    text: null,
    items: null,
    kicker: null,
    when: "Para mostrar tu trabajo o tu experiencia (cuántos videos hiciste, tu contenido).",
    spec: "propio",
  },
  couch_wall: {
    label: "Pared de capturas",
    description: "Capturas de tus videos aparecen pegadas con cinta en la pared detrás de ti.",
    mask: true,
    thumbs: true,
    duration: { min: 2.5, max: 7 },
    captions: "keep",
    text: null,
    items: null,
    kicker: null,
    when: "Para hablar de tu historia o de tus resultados con tus propios videos de fondo.",
    spec: "propio",
  },
  ui_world: {
    label: "Ventana de tu app",
    description: "Una ventana con tu marca detrás de ti: tus clips caen adentro y se escribe un comando.",
    mask: true,
    thumbs: true,
    duration: { min: 3, max: 8 },
    captions: "keep",
    text: { label: "Comando", placeholder: "edita mis clips con mi marca", max: 40 },
    items: null,
    kicker: { label: "Nombre de la ventana", placeholder: "Tu estudio", max: 22 },
    when: "Cuando explicas un proceso, una herramienta o tu sistema de trabajo.",
    spec: "propio",
  },
  frame_break: {
    label: "Sales del cuadro",
    description: "Quedas dentro de un cuadro colgado en la pared y te sales del marco.",
    mask: true,
    thumbs: false,
    duration: { min: 2.5, max: 6 },
    captions: "keep",
    text: null,
    items: null,
    kicker: null,
    when: "Para un giro o un remate: romper con lo esperado, salir de la zona de confort.",
    spec: "propio",
  },
  zoom_cut: {
    label: "Corte con zoom",
    description: "Transición: la cámara entra en tu cara con desenfoque y sale en el clip siguiente.",
    mask: false,
    thumbs: false,
    duration: { min: 0.5, max: 1.6 },
    captions: "keep",
    text: null,
    items: null,
    kicker: null,
    when: "En el cambio entre dos ideas (justo en un corte), como máximo una o dos veces por video.",
    spec: "propio",
  },
  zoom_out: {
    label: "Zoom out",
    description: "La cámara se aleja de tu cara y revela una pantalla trabajando con tu marca.",
    mask: false,
    thumbs: false,
    duration: { min: 2.5, max: 7 },
    captions: "keep",
    text: { label: "Título de la pantalla", placeholder: "Editando tu reel", max: 28 },
    items: null,
    kicker: null,
    when: "Para mostrar que hay un sistema o un trabajo detrás (cómo lo haces, tu proceso).",
    spec: "propio",
  },
  green_screen: {
    label: "Pantalla verde",
    description: "Tu fondo cambia por una app de tareas con un temporizador gigante.",
    mask: true,
    thumbs: false,
    duration: { min: 2.5, max: 8 },
    captions: "keep",
    text: { label: "Temporizador", placeholder: "25:00", max: 5 },
    items: { label: "Tareas", placeholder: "Guion listo", max: 24, min: 0, count: 3 },
    kicker: null,
    when: "Cuando hablas de tiempo, productividad, enfoque o una cuenta regresiva.",
    spec: "propio",
  },
  paper_cut: {
    label: "Recorte de papel",
    description: "Collage de papel: letras recortadas como nota de rescate y tu figura con borde blanco.",
    mask: true,
    thumbs: false,
    duration: { min: 2, max: 6 },
    captions: "keep",
    text: { label: "Palabra recortada", placeholder: "SECRETO", max: 12 },
    items: null,
    kicker: null,
    when: "Para un secreto, una confesión o algo que «nadie dice».",
    spec: "propio",
  },
  doodle_boil: {
    label: "Garabatos",
    description: "Un contorno dibujado a mano que tiembla a tu alrededor y garabatos que aparecen a tu lado.",
    mask: true,
    thumbs: false,
    duration: { min: 2, max: 6 },
    captions: "keep",
    text: { label: "Palabra a mano", placeholder: "¡clave!", max: 14 },
    items: null,
    kicker: null,
    when: "Para algo divertido, una idea creativa o señalar algo tuyo.",
    spec: "propio",
  },
  vertigo: {
    label: "Vértigo",
    description: "El fondo se estira detrás de ti mientras quedas quieto (dolly zoom).",
    mask: true,
    thumbs: false,
    duration: { min: 1.5, max: 5 },
    captions: "keep",
    text: null,
    items: null,
    kicker: null,
    when: "Para una revelación o un momento de tensión («y ahí me di cuenta…»).",
    spec: "propio",
  },
};

export const FX_INFO: Record<FxKind, FxInfo> = {
  ...(Object.fromEntries(Object.entries(SIGNATURE_FX_INFO).map(([k, v]) => [k, { ...v, category: "firma" as const }])) as Record<(typeof SIGNATURE_FX_KINDS)[number], FxInfo>),
  ...MORE_FX_INFO,
};

/**
 * Efectos con un elemento superpuesto que se puede mover, agrandar y animar desde el lienzo de la revisión
 * (lib/video/canvas/transform.ts). Los de pantalla completa, los de cámara y los que van detrás de la persona no:
 * dependen de la cara y del cuadro entero.
 */
export const FX_MOVABLE: Partial<Record<FxKind, { label: string; rotation: boolean }>> = {
  checklist: { label: "Tarjeta de tareas", rotation: true },
  iphone: { label: "Teléfono", rotation: true },
  chart_grow: { label: "Gráfico de la semana", rotation: false },
  cover_story: { label: "Titular de portada", rotation: true },
  ...MORE_FX_MOVABLE,
};

export const isFxMovable = (kind: FxKind) => Boolean(FX_MOVABLE[kind]);

/** Orden de los de firma en la galería: primero los más versátiles. */
const SIGNATURE_ORDER: FxKind[] = [
  "digital_zoom",
  "cover_story",
  "checklist",
  "chart_grow",
  "glass_type",
  "headline_wall",
  "iphone",
  "orbit",
  "couch_wall",
  "ui_world",
  "green_screen",
  "frame_break",
  "zoom_out",
  "zoom_cut",
  "paper_cut",
  "doodle_boil",
  "vertigo",
];

/** Orden de la galería: por categoría (los de firma primero, en su orden; el resto como en la ficha). */
export const FX_GALLERY_ORDER: FxKind[] = [...SIGNATURE_ORDER, ...MORE_FX_KINDS];

/** Efectos de una categoría, en el orden de la galería. */
export const fxByCategory = (c: FxCategory): FxKind[] => FX_GALLERY_ORDER.filter((k) => FX_INFO[k].category === c);

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Buscador de la biblioteca: nombre, descripción, cuándo usarlo y palabras clave (sin tildes, todas las palabras). */
export function searchFx(query: string, kinds: readonly FxKind[] = FX_GALLERY_ORDER): FxKind[] {
  const terms = plain(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...kinds];
  return kinds.filter((k) => {
    const i = FX_INFO[k];
    const hay = plain(`${i.label} ${i.description} ${i.when} ${i.keywords ?? ""} ${FX_CATEGORY_LABELS[i.category].label} ${k.replace(/_/g, " ")}`);
    return terms.every((t) => hay.includes(t));
  });
}

export const isFxKind = (v: unknown): v is FxKind => typeof v === "string" && (FX_KINDS as readonly string[]).includes(v);

// ─── Frecuencia (Mi marca → "Cómo salen tus videos") ──────────────────────

export const FX_FREQUENCIES = ["ninguno", "pocos", "normal", "muchos"] as const;
export type FxFrequency = (typeof FX_FREQUENCIES)[number];

export const FX_FREQUENCY_LABELS: Record<FxFrequency, { label: string; description: string }> = {
  ninguno: { label: "Ninguno", description: "El director no pone efectos (tú puedes agregarlos en la revisión)." },
  pocos: { label: "Pocos", description: "Uno o dos por video, solo donde suman mucho." },
  normal: { label: "Normal", description: "Unos tres por minuto." },
  muchos: { label: "Muchos", description: "Ritmo alto: hasta cinco por minuto." },
};

/** Cuántos efectos puede poner el director en un video final de `seconds` segundos. */
export function fxBudget(frequency: FxFrequency, seconds: number): number {
  if (frequency === "ninguno") return 0;
  const perMinute = frequency === "pocos" ? 1.2 : frequency === "normal" ? 3 : 5;
  const cap = frequency === "pocos" ? 2 : frequency === "normal" ? 6 : 10;
  return Math.max(1, Math.min(cap, Math.round((seconds / 60) * perMinute)));
}

/** Separación mínima (segundos) entre dos efectos del director. */
export const FX_MIN_GAP: Record<FxFrequency, number> = { ninguno: 999, pocos: 8, normal: 4, muchos: 2 };
