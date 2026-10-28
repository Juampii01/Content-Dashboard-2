"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AudioLines, Captions, Clapperboard, Film, Flag, Mic, Music, Pause, Scissors, Sparkles, WandSparkles, ZoomIn } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { laneLayout } from "@/lib/video/layers";
import { clampDrag, secondsLabel, timeLabel, type CutMark, type SnappedSpan } from "@/lib/video/studio";
import { cn } from "@/lib/utils";
import { ViewportWave } from "./waveform";
import type { SignedOption } from "@/lib/dal/editor-media";

/** Pistas. `audio` es la de los efectos de sonido (A3); `voice` y `music`, la voz (A1) y la música (A2). */
export type TrackKey = "video" | "captions" | "broll" | "fx" | "anim" | "zoom" | "voice" | "music" | "audio" | "layers";

/** Pistas de lo que se superpone al video: en la vista por capas van todas juntas, una pista por capa (V2, V3…). */
const VISUAL: TrackKey[] = ["broll", "fx", "anim"];

/** Lo que está elegido en el Estudio (se abre en el inspector). */
export type StudioSelection =
  | { kind: "broll"; id: string }
  | { kind: "fx"; id: string }
  /** Una animación a medida (composición). */
  | { kind: "compos"; id: string }
  | { kind: "zoom"; index: number }
  | { kind: "caption"; index: number }
  | { kind: "clip"; index: number }
  | { kind: "cut"; at: number; from: number; to: number }
  /** Una pausa larga (antes de la palabra `word`): acortada o completa. */
  | { kind: "pause"; word: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "audio" }
  /** Un corte del video final (la primera palabra del tramo que entra): su transición o el lugar para poner una. */
  | { kind: "transition"; word: number; id?: string }
  /** Un sonido puesto a mano en la pista de Sonido. */
  | { kind: "sound"; id: string }
  /** Un pedido de animación en curso (bloque fantasma en la pista Animaciones). */
  | { kind: "request"; id: string }
  /** Un marcador con nota (tecla M). */
  | { kind: "marker"; id: string };

export function selectionKey(sel: StudioSelection | null): string | null {
  if (!sel) return null;
  switch (sel.kind) {
    case "broll":
    case "fx":
    case "compos":
      return `${sel.kind}:${sel.id}`;
    case "zoom":
    case "caption":
    case "clip":
      return `${sel.kind}:${sel.index}`;
    case "cut":
      return `cut:${sel.from}`;
    case "pause":
      return `pause:${sel.word}`;
    case "range":
      return `range:${sel.from}-${sel.to}`;
    case "audio":
      return "audio";
    case "transition":
      return sel.id ? `transition:${sel.id}` : `transition:${sel.word}`;
    case "sound":
      return `sound:${sel.id}`;
    case "request":
      return `request:${sel.id}`;
    case "marker":
      return `marker:${sel.id}`;
  }
}

export type TimelineBlock = {
  key: string;
  track: TrackKey;
  start: number;
  end: number;
  label: string;
  /** Segunda línea (el texto que se dice, el estado). */
  detail?: string;
  /** Clases de color del bloque. */
  tone: string;
  /** Lo puso la IA y todavía no lo aceptaste. */
  ai?: boolean;
  /** Se puede mover y estirar. */
  editable?: boolean;
  /** Duración mínima y máxima (segundos) al estirarlo. */
  min?: number;
  max?: number;
  /** B-roll sin clip elegido (no sale en el video). */
  empty?: boolean;
  /** Se mueve en segundos, sin imán a las palabras (una transición en cualquier punto). */
  free?: boolean;
  /** Orden de dibujo (más alto = encima): con bloques superpuestos, define el carril (arriba = encima). */
  z?: number;
  /** Fantasma: algo que se está creando (un pedido de animación en curso). No se mueve. */
  pending?: boolean;
  selection: StudioSelection;
  thumb?: string | null;
  /**
   * Fundidos (s) del bloque, con manijas arriba en las esquinas para estirarlos (`onFade`). `max`: lo más que puede
   * durar cada uno. Solo en los de audio.
   */
  fades?: { in: number; out: number; max: number };
  /** Lo que se dibuja dentro del bloque, detrás del nombre (la forma de onda de un sonido). */
  wave?: ReactNode;
  /** El bloque no se escucha (su pista está silenciada o fuera del solo): se ve apagado. */
  dim?: boolean;
};

/** Marcador en la regla: número por orden en el video, segundo y nota. */
export type TimelineMarker = { id: string; number: number; at: number; note: string };

/** Lo que se arrastra desde la Biblioteca a la línea de tiempo. */
export type LibraryDrop =
  | { type: "fx"; kind: string }
  | { type: "broll" }
  | { type: "graphic"; template?: string }
  | { type: "zoom" }
  | { type: "transition"; kind: string }
  | { type: "sound"; name: string }
  /** Un efecto de Mis efectos (animación guardada): va a la pista Animaciones con su duración típica. */
  | { type: "mine"; id: string; name: string; duration: number }
  /** Un clip o una imagen de tu biblioteca: va a la pista B-roll con su largo (las imágenes, 3 s). */
  | { type: "clip"; option: SignedOption }
  /** Un texto a mano con su estilo (lib/video/text-presets.ts): va a la pista B-roll, 2,5 s ajustado a palabras. */
  | { type: "text"; preset: string };
export const LIBRARY_MIME = "application/x-content2-studio";

/** Lo que se está arrastrando desde la Biblioteca (para dibujar su sombra mientras se arrastra: el navegador no deja leer los datos antes de soltar). */
let libraryDragging: LibraryDrop | null = null;

/** Empieza a arrastrar algo de la Biblioteca hacia la línea de tiempo. */
export function startLibraryDrag(e: DragEvent<Element> | { dataTransfer: DataTransfer }, item: LibraryDrop) {
  e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "copy";
  libraryDragging = item;
}

/** Sombra de lo que se va a soltar: en qué pista, de dónde a dónde (ya ajustado a palabras) y su nombre. */
export type DropPreview = { track: TrackKey; start: number; end: number; label: string };

/**
 * Pistas. `lane`: alto de cada carril (con bloques superpuestos la pista crece: un carril por capa, arriba lo que se
 * dibuja encima); `extra`: lo fijo de abajo (la música y los puntos de los sonidos automáticos).
 */
type TrackDef = { key: TrackKey; label: string; code?: string; icon: ReactNode; lane: number; extra: number; lanes: boolean };
const TRACKS: TrackDef[] = [
  { key: "video", label: "Video", code: "V1", icon: <Film className="h-3.5 w-3.5" aria-hidden />, lane: 40, extra: 0, lanes: false },
  { key: "captions", label: "Subtítulos", icon: <Captions className="h-3.5 w-3.5" aria-hidden />, lane: 26, extra: 0, lanes: false },
  { key: "broll", label: "Gráficos y b-roll", icon: <Clapperboard className="h-3.5 w-3.5" aria-hidden />, lane: 32, extra: 0, lanes: true },
  { key: "fx", label: "Efectos", icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />, lane: 32, extra: 0, lanes: true },
  { key: "anim", label: "Animaciones", icon: <WandSparkles className="h-3.5 w-3.5" aria-hidden />, lane: 32, extra: 0, lanes: true },
  { key: "zoom", label: "Zooms", icon: <ZoomIn className="h-3.5 w-3.5" aria-hidden />, lane: 24, extra: 0, lanes: true },
  { key: "voice", label: "Voz", code: "A1", icon: <Mic className="h-3.5 w-3.5" aria-hidden />, lane: 36, extra: 0, lanes: false },
  { key: "music", label: "Música", code: "A2", icon: <Music className="h-3.5 w-3.5" aria-hidden />, lane: 30, extra: 0, lanes: false },
  { key: "audio", label: "Efectos de sonido", code: "A3", icon: <AudioLines className="h-3.5 w-3.5" aria-hidden />, lane: 30, extra: 12, lanes: true },
];

/** Vista por capas: lo que se superpone al video (gráficos, b-roll, efectos, transiciones y animaciones) en pistas V2, V3…, de abajo hacia arriba en el orden en que se dibuja. */
const LAYERS_TRACK: TrackDef = { key: "layers", label: "Capas", icon: null, lane: 32, extra: 0, lanes: true };

/** Altura de las pistas: compacta, normal o grande (se elige en la barra de la línea de tiempo). */
export type TrackSize = "s" | "m" | "l";
export const TRACK_SIZE_SCALE: Record<TrackSize, number> = { s: 0.78, m: 1, l: 1.4 };

/** Pistas de audio que se dibujan con forma de onda (las arma el Estudio). */
export type WaveTrack = { columns: (t0: number, t1: number, n: number) => Float32Array; version: string; color: string; marks?: number[] };

type Drag = {
  block: TimelineBlock;
  mode: "move" | "start" | "end" | "fade-in" | "fade-out";
  x0: number;
  y0: number;
  moved: boolean;
  pointer: number;
};

/** `lane`: carril donde va a caer (0 = arriba); `order`: lugar entre los que se le superponen (0 = encima de todos). */
type Ghost = { key: string; start: number; end: number; span: SnappedSpan | null; note: string | null; lane: number; order: number };

/**
 * Línea de tiempo del Estudio, en segundos del video final: cabezal que se arrastra, pistas con bloques que se eligen,
 * se mueven y se estiran (con imán a las palabras, que resuelve `snap`), selección de un tramo en la pista de video y
 * zoom horizontal. No guarda nada: avisa al Estudio con `onCommit`, `onRange`, `onSelect` y `onSeek`.
 */
export function StudioTimeline({
  duration,
  time,
  playing,
  zoom,
  onZoom,
  blocks: blocks0,
  cuts,
  sfx,
  hiddenCaptions,
  captionHides = [],
  onShowCaptions,
  selection,
  range,
  obstacles,
  snap,
  canEdit,
  notes,
  onSeek,
  onSelect,
  onCommit,
  onRange,
  onDrop,
  toolbar,
  transitionSlots = [],
  dropPreview,
  multi = [],
  onMarquee,
  onGroupMove,
  onAddAt,
  heads = {},
  waves = {},
  trackSize = "m",
  markers = [],
  onFade,
  layerView = false,
}: {
  duration: number;
  time: number;
  playing: boolean;
  /** Zoom horizontal (1 = todo el video a la vista). */
  zoom: number;
  onZoom: (z: number) => void;
  blocks: TimelineBlock[];
  cuts: CutMark[];
  sfx: { at: number }[];
  hiddenCaptions: { start: number; end: number }[];
  /** Tramos sin subtítulos que se pueden volver a mostrar (los que quitó la persona o el director). */
  captionHides?: { start: number; end: number; index: number }[];
  onShowCaptions?: (index: number) => void;
  selection: StudioSelection | null;
  /** Tramo elegido en la pista de video (en segundos), si hay. */
  range: { start: number; end: number } | null;
  /**
   * Lo que hay en otras pistas en el mismo tramo (convive en capas): no bloquea ni se quita,
   * solo se avisa en la etiqueta del arrastre.
   */
  obstacles: Partial<Record<TrackKey, { start: number; end: number; label: string }[]>>;
  /** Resuelve un tramo a palabras (null si no se puede poner ahí). Con bloque: aplica sus reglas (duración). */
  snap: (t0: number, t1: number, block: TimelineBlock | null) => SnappedSpan | null;
  canEdit: boolean;
  /** Aviso corto por pista (ej. "Automáticos del estilo"). */
  notes?: Partial<Record<TrackKey, string>>;
  onSeek: (t: number) => void;
  onSelect: (sel: StudioSelection | null, block?: TimelineBlock) => void;
  /** `order`: dónde quedó entre los bloques de su pista que se le superponen (0 = encima de todos). */
  onCommit: (block: TimelineBlock, span: SnappedSpan, mode: "move" | "start" | "end", order: number) => void;
  onRange: (span: SnappedSpan) => void;
  onDrop: (item: LibraryDrop, t: number) => void;
  toolbar: ReactNode;
  /** Cortes sin transición donde se puede poner una (un rombo chico en la pista de efectos). */
  transitionSlots?: { at: number; word: number }[];
  /** La sombra de lo que se arrastra desde la Biblioteca en el segundo `t` (con su largo real), o null. */
  dropPreview?: (item: LibraryDrop, t: number) => DropPreview | null;
  /** Bloques elegidos juntos (arrastrando un rectángulo sobre lo vacío). */
  multi?: string[];
  onMarquee?: (keys: string[]) => void;
  /** Mueve juntos los bloques elegidos `delta` segundos. */
  onGroupMove?: (keys: string[], delta: number) => void;
  /** Doble clic o clic derecho en un lugar vacío de una pista: menú «Agregar aquí» en el segundo `t`. */
  onAddAt?: (t: number, at: { x: number; y: number }) => void;
  /** Controles del encabezado de cada pista (silenciar y solo en las de audio). */
  heads?: Partial<Record<TrackKey, ReactNode>>;
  /** Formas de onda de las pistas de audio largas (voz y música). */
  waves?: Partial<Record<TrackKey, WaveTrack>>;
  /** Altura de las pistas. */
  trackSize?: TrackSize;
  /** Marcadores con nota, en la regla y como una línea fina en todas las pistas. */
  markers?: TimelineMarker[];
  /** Fundido de un bloque de audio estirado con su manija (segundos). */
  onFade?: (block: TimelineBlock, which: "in" | "out", seconds: number) => void;
  /** Vista por capas: b-roll, efectos y animaciones juntos, una pista por capa (V2, V3…) como en un editor de video. */
  layerView?: boolean;
}) {
  const scale = TRACK_SIZE_SCALE[trackSize];
  const tracks = useMemo(() => {
    const list = layerView ? [...TRACKS.filter((t) => t.key === "video" || t.key === "captions"), LAYERS_TRACK, ...TRACKS.filter((t) => t.key !== "video" && t.key !== "captions" && !VISUAL.includes(t.key))] : TRACKS;
    return list.map((t) => ({ ...t, lane: Math.round(t.lane * scale) }));
  }, [scale, layerView]);
  const blocks = useMemo(() => (layerView ? blocks0.map((b) => (VISUAL.includes(b.track) ? { ...b, track: "layers" as const } : b)) : blocks0), [blocks0, layerView]);
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  // Columna de nombres de pista (más angosta en el teléfono).
  const LABEL_W = width < 560 ? 96 : 136;
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [rangeGhost, setRangeGhost] = useState<{ start: number; end: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const selKey = selectionKey(selection);
  const content = useRef<HTMLDivElement>(null);
  const multiSet = useMemo(() => new Set(multi), [multi]);
  // Arrastre de varios elegidos: cuánto se corrieron (en segundos), para dibujarlos juntos.
  const [groupDx, setGroupDx] = useState<number | null>(null);
  // Rectángulo de selección sobre lo vacío (en coordenadas del contenido).
  const marq = useRef<{ x0: number; y0: number; pointer: number; moved: boolean; t: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (clientX: number, clientY: number) => {
    const r = content.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : { x: 0, y: 0 };
  };
  function onEmptyDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const p = local(e.clientX, e.clientY);
    marq.current = { x0: p.x, y0: p.y, pointer: e.pointerId, moved: false, t: timeAt(e.clientX) };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onEmptyMove(e: ReactPointerEvent<HTMLDivElement>) {
    const m = marq.current;
    if (!m || m.pointer !== e.pointerId) return;
    const p = local(e.clientX, e.clientY);
    if (!m.moved && Math.abs(p.x - m.x0) < 5 && Math.abs(p.y - m.y0) < 5) return;
    m.moved = true;
    setBox({ x0: m.x0, y0: m.y0, x1: p.x, y1: p.y });
  }
  function onEmptyUp(e: ReactPointerEvent<HTMLDivElement>) {
    const m = marq.current;
    if (!m || m.pointer !== e.pointerId) return;
    marq.current = null;
    if (!m.moved) {
      setBox(null);
      onSeek(m.t);
      onSelect(null);
      return;
    }
    // Lo que toca el rectángulo (menos el video y los subtítulos, que se eligen de otra forma).
    const r = content.current?.getBoundingClientRect();
    const b = box;
    setBox(null);
    if (!r || !b) return;
    const left = r.left + Math.min(b.x0, b.x1);
    const right = r.left + Math.max(b.x0, b.x1);
    const top = r.top + Math.min(b.y0, b.y1);
    const bottom = r.top + Math.max(b.y0, b.y1);
    const keys: string[] = [];
    content.current?.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => {
      if (el.dataset.track === "video" || el.dataset.track === "captions") return;
      const q = el.getBoundingClientRect();
      if (q.right > left && q.left < right && q.bottom > top && q.top < bottom) keys.push(el.dataset.block!);
    });
    onMarquee?.(keys);
  }
  const byTrack = useMemo(() => {
    const map: Record<TrackKey, TimelineBlock[]> = { video: [], captions: [], broll: [], fx: [], anim: [], zoom: [], voice: [], music: [], audio: [], layers: [] };
    for (const b of blocks) map[b.track].push(b);
    return map;
  }, [blocks]);
  // Carriles: con bloques superpuestos, uno por capa (arriba = lo que se dibuja encima).
  const layout = useMemo(() => {
    const out = {} as Record<TrackKey, { lanes: Map<string, number>; count: number }>;
    for (const t of tracks) out[t.key] = t.lanes ? laneLayout(byTrack[t.key].map((b) => ({ key: b.key, start: b.start, end: b.end, z: b.z ?? 0 }))) : { lanes: new Map(), count: 1 };
    return out;
  }, [byTrack, tracks]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const d = Math.max(0.5, duration);
  const fit = Math.max(4, (width - LABEL_W - 24) / d);
  const pps = fit * zoom;
  const lane = d * pps;
  const x = useCallback((t: number) => t * pps, [pps]);

  // Cabezal: se mueve con requestAnimationFrame entre los avisos de la vista previa (llegan ~10 veces por segundo).
  const base = useRef({ t: time, at: 0 });
  useEffect(() => {
    base.current = { t: time, at: performance.now() };
    if (!playing && playhead.current) playhead.current.style.transform = `translateX(${LABEL_W + time * pps}px)`;
  }, [time, playing, pps, LABEL_W]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const t = Math.min(d, base.current.t + (performance.now() - base.current.at) / 1000);
      const px = LABEL_W + t * pps;
      if (playhead.current) playhead.current.style.transform = `translateX(${px}px)`;
      // Sigue al cabezal si se sale de la vista.
      const el = scroller.current;
      if (el && (px > el.scrollLeft + el.clientWidth - 40 || px < el.scrollLeft + LABEL_W)) el.scrollLeft = px - LABEL_W - 40;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, pps, d, LABEL_W]);

  // Al cambiar el zoom, el cabezal queda a la vista.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const px = LABEL_W + base.current.t * pps;
    if (px > el.scrollLeft + el.clientWidth - 40 || px < el.scrollLeft + LABEL_W) el.scrollLeft = Math.max(0, px - el.clientWidth / 2);
  }, [pps, LABEL_W]);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scroller.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(d, (clientX - r.left + el.scrollLeft - LABEL_W) / pps));
    },
    [d, pps, LABEL_W],
  );

  // ─── Cabezal y regla ───
  const scrubbing = useRef(false);
  const scrubRaf = useRef(0);
  function scrubTo(clientX: number) {
    const t = timeAt(clientX);
    cancelAnimationFrame(scrubRaf.current);
    scrubRaf.current = requestAnimationFrame(() => onSeek(t));
    if (playhead.current) playhead.current.style.transform = `translateX(${LABEL_W + t * pps}px)`;
  }
  function onRulerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  }

  // ─── Bloques ───
  function onBlockDown(e: ReactPointerEvent<HTMLElement>, block: TimelineBlock, mode: Drag["mode"]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { block, mode, x0: e.clientX, y0: e.clientY, moved: false, pointer: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  // Manija de un fundido: cuánto dura mientras se arrastra (s).
  const [fadeGhost, setFadeGhost] = useState<{ key: string; which: "in" | "out"; value: number } | null>(null);
  function onBlockMove(e: ReactPointerEvent<HTMLElement>) {
    const dr = drag.current;
    if (!dr || dr.pointer !== e.pointerId) return;
    const dx = e.clientX - dr.x0;
    if (dr.mode === "fade-in" || dr.mode === "fade-out") {
      if (!dr.moved && Math.abs(dx) < 2) return;
      dr.moved = true;
      const f = dr.block.fades;
      if (!f || !canEdit) return;
      const which = dr.mode === "fade-in" ? "in" : "out";
      const base = which === "in" ? f.in : f.out;
      const value = Math.max(0, Math.min(f.max, base + (which === "in" ? dx : -dx) / pps));
      setFadeGhost({ key: dr.block.key, which, value: Math.round(value * 100) / 100 });
      return;
    }
    // Hacia un lado o hacia arriba/abajo (cambiar de carril) cuenta como arrastre.
    if (!dr.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - dr.y0) < 6) return;
    dr.moved = true;
    if (!canEdit || !dr.block.editable) return;
    // Varios elegidos: se mueven juntos.
    if (dr.mode === "move" && multiSet.size > 1 && multiSet.has(dr.block.key)) {
      setGroupDx(dx / pps);
      return;
    }
    // Se suelta en cualquier lado y convive con lo que haya (en capas). Arrastrar hacia arriba o abajo cambia el carril.
    const track = tracks.find((t) => t.key === dr.block.track)!;
    const own = blocks.filter((b) => b.track === dr.block.track && b.key !== dr.block.key);
    const cross = obstacles[dr.block.track] ?? [];
    const raw = clampDrag({ mode: dr.mode, start: dr.block.start, end: dr.block.end, delta: dx / pps, duration: d, obstacles: [], min: dr.block.min, max: dr.block.max });
    const span = dr.block.free ? { from: 0, to: 0, start: raw.start, end: raw.end } : snap(raw.start, raw.end, dr.block);
    const lanes = layout[dr.block.track];
    const myLane = lanes.lanes.get(dr.block.key) ?? 0;
    const lane = track.lanes && dr.block.track !== "audio" ? Math.max(0, Math.min(lanes.count, myLane + Math.round((e.clientY - dr.y0) / track.lane))) : myLane;
    const at = span ?? raw;
    const over = own.filter((o) => o.track !== "audio" && at.start < o.end - 0.02 && o.start < at.end - 0.02).sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
    // Lugar entre los que se superponen: los que están en un carril de arriba del de destino quedan encima.
    // Bajando hasta el carril de otro, va debajo de ese; subiendo, encima.
    const order = over.filter((o) => {
      const l = lanes.lanes.get(o.key) ?? 0;
      return l < lane || (l === lane && lane > myLane);
    }).length;
    const crossOver = cross.filter((o) => at.start < o.end - 0.02 && o.start < at.end - 0.02).map((o) => o.label);
    const note = !span
      ? "No se puede poner ahí."
      : over.length
        ? order === 0
          ? `Encima de «${over[0]!.label}»`
          : `Debajo de «${over[order - 1]!.label}»`
        : crossOver.length
          ? `Junto con «${crossOver[0]}»`
          : null;
    setGhost({ key: dr.block.key, start: at.start, end: at.end, span, note, lane: over.length ? order : lane, order });
  }
  function onBlockUp(e: ReactPointerEvent<HTMLElement>) {
    const dr = drag.current;
    if (!dr || dr.pointer !== e.pointerId) return;
    drag.current = null;
    if (dr.mode === "fade-in" || dr.mode === "fade-out") {
      if (dr.moved && fadeGhost?.key === dr.block.key) onFade?.(dr.block, fadeGhost.which, fadeGhost.value);
      else if (!dr.moved) onSelect(dr.block.selection, dr.block);
      setFadeGhost(null);
      return;
    }
    if (dr.moved && groupDx != null) {
      if (Math.abs(groupDx) > 0.02) onGroupMove?.([...multiSet], groupDx);
      setGroupDx(null);
      return;
    }
    if (dr.moved && ghost?.key === dr.block.key && ghost.span) onCommit(dr.block, ghost.span, dr.mode, ghost.order);
    else if (!dr.moved) onSelect(dr.block.selection, dr.block);
    setGhost(null);
  }

  // ─── Tramo en la pista de video ───
  const ranging = useRef<{ t0: number; pointer: number; moved: boolean; x0: number } | null>(null);
  function onVideoDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    ranging.current = { t0: timeAt(e.clientX), pointer: e.pointerId, moved: false, x0: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onVideoMove(e: ReactPointerEvent<HTMLDivElement>) {
    const r = ranging.current;
    if (!r || r.pointer !== e.pointerId) return;
    if (!r.moved && Math.abs(e.clientX - r.x0) < 4) return;
    r.moved = true;
    const t = timeAt(e.clientX);
    const span = snap(Math.min(r.t0, t), Math.max(r.t0, t), null);
    setRangeGhost(span ? { start: span.start, end: span.end } : { start: Math.min(r.t0, t), end: Math.max(r.t0, t) });
  }
  function onVideoUp(e: ReactPointerEvent<HTMLDivElement>) {
    const r = ranging.current;
    if (!r || r.pointer !== e.pointerId) return;
    ranging.current = null;
    const t = timeAt(e.clientX);
    setRangeGhost(null);
    if (r.moved) {
      const span = snap(Math.min(r.t0, t), Math.max(r.t0, t), null);
      if (span) onRange(span);
      return;
    }
    // Clic: el tramo del video que está ahí.
    const clip = blocks.find((b) => b.track === "video" && t >= b.start && t < b.end);
    onSeek(t);
    if (clip) onSelect(clip.selection, clip);
  }

  // ─── Biblioteca: soltar un efecto o un gráfico (con su sombra del largo real mientras se arrastra) ───
  const [dropGhost, setDropGhost] = useState<DropPreview | null>(null);
  useEffect(() => {
    // Lo que se arrastra desde cualquier lugar de la Biblioteca (en dragstart sí se pueden leer los datos).
    const start = (e: globalThis.DragEvent) => {
      const raw = e.dataTransfer?.getData(LIBRARY_MIME);
      if (!raw) return;
      try {
        libraryDragging = JSON.parse(raw) as LibraryDrop;
      } catch {
        libraryDragging = null;
      }
    };
    const end = () => {
      libraryDragging = null;
      setDropGhost(null);
    };
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
    };
  }, []);
  const ghostRaf = useRef(0);
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canEdit || !e.dataTransfer.types.includes(LIBRARY_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const item = libraryDragging;
    if (!item || !dropPreview) return;
    const t = timeAt(e.clientX);
    cancelAnimationFrame(ghostRaf.current);
    ghostRaf.current = requestAnimationFrame(() => setDropGhost(dropPreview(item, t)));
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    cancelAnimationFrame(ghostRaf.current);
    setDropGhost(null);
  }
  function onDropItem(e: DragEvent<HTMLDivElement>) {
    cancelAnimationFrame(ghostRaf.current);
    setDropGhost(null);
    libraryDragging = null;
    const raw = e.dataTransfer.getData(LIBRARY_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      onDrop(JSON.parse(raw) as LibraryDrop, timeAt(e.clientX));
    } catch {
      /* nada que soltar */
    }
  }

  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * pps >= 70) ?? 120;
    const out: number[] = [];
    for (let t = 0; t <= d + 0.001; t += step) out.push(Math.round(t * 100) / 100);
    return { step, list: out };
  }, [pps, d]);


  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain [scrollbar-width:thin]"
        onWheel={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          onZoom(Math.max(1, Math.min(40, zoom * (e.deltaY < 0 ? 1.25 : 0.8))));
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDropItem}
        data-testid="studio-timeline"
      >
        <div ref={content} className="relative" style={{ width: LABEL_W + lane + 24 }}>
          {/* Regla */}
          <div className="sticky top-0 z-30 flex h-6 border-b border-white/10 bg-card">
            <div className="sticky left-0 z-10 flex-none border-r border-white/10 bg-card" style={{ width: LABEL_W }} />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Cabezal: posición en el video final"
              aria-valuemin={0}
              aria-valuemax={Math.round(d * 10) / 10}
              aria-valuenow={Math.round(time * 10) / 10}
              aria-valuetext={`${timeLabel(time)} de ${formatDuration(d)}`}
              className="relative cursor-ew-resize touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-accent-hi focus-visible:ring-inset"
              style={{ width: lane + 24 }}
              onPointerDown={onRulerDown}
              onPointerMove={(e) => scrubbing.current && scrubTo(e.clientX)}
              onPointerUp={() => (scrubbing.current = false)}
              onPointerCancel={() => (scrubbing.current = false)}
              data-testid="studio-ruler"
            >
              {ticks.list.map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-white/15 pl-1 font-mono text-[10px] leading-6 text-placeholder tabular-nums" style={{ left: x(t) }}>
                  {ticks.step < 1 ? timeLabel(t) : formatDuration(t)}
                </span>
              ))}
              {cuts.map((c) => (
                <span key={`r${c.at}`} aria-hidden className="absolute bottom-0 h-1.5 w-px bg-danger/70" style={{ left: x(c.at) }} />
              ))}
              {markers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-marker={m.number}
                  className={cn(
                    "absolute top-0 z-10 flex h-[18px] -translate-x-[3px] items-center gap-0.5 rounded-r-md rounded-bl-none border-l-2 border-accent bg-accent/15 pr-1 pl-0.5 font-mono text-[10px] leading-none font-semibold text-accent outline-none hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-accent-hi",
                    selKey === `marker:${m.id}` && "bg-accent text-paper",
                  )}
                  style={{ left: x(m.at) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(m.at);
                    onSelect({ kind: "marker", id: m.id });
                  }}
                  title={m.note ? `Marcador ${m.number}: ${m.note}` : `Marcador ${m.number} (sin nota)`}
                  aria-label={`Marcador ${m.number} en ${timeLabel(m.at)}${m.note ? `: ${m.note}` : ""}`}
                >
                  <Flag className="h-2.5 w-2.5" aria-hidden />
                  {m.number}
                </button>
              ))}
            </div>
          </div>

          {tracks.map((track) => {
            const lanes = layout[track.key].count + (ghost && track.lanes && blocks.find((b) => b.key === ghost.key)?.track === track.key && ghost.lane >= layout[track.key].count ? 1 : 0);
            const h = lanes * track.lane + track.extra;
            return (
            <div key={track.key} className="flex border-b border-white/[0.06]" style={{ height: h }} data-lanes={layout[track.key].count}>
              <div
                className={cn("sticky left-0 z-20 flex flex-none items-center gap-1.5 border-r border-white/10 bg-card px-2 text-[11px] font-semibold text-muted", (track.key === "voice" || track.key === "music" || track.key === "audio") && "bg-[#f9f9f7]")}
                style={{ width: LABEL_W }}
                title={notes?.[track.key] ?? track.label}
                data-head={track.key}
              >
                {track.key === "layers" ? (
                  // Una etiqueta por capa: arriba la más alta (lo que se dibuja encima), abajo V2 (justo sobre el video).
                  Array.from({ length: lanes }, (_, k) => (
                    <span key={k} className="absolute left-2 flex items-center gap-1.5" style={{ top: k * track.lane, height: track.lane }}>
                      <span className="rounded bg-white/[0.06] px-1 font-mono text-[9px] leading-[14px] text-muted">V{lanes - k + 1}</span>
                      {k === 0 && <span className="truncate">{lanes > 1 ? "Encima" : "Capas"}</span>}
                    </span>
                  ))
                ) : (
                  <>
                    {track.code ? <span className="flex-none rounded bg-white/[0.06] px-1 font-mono text-[9px] leading-[14px] text-muted">{track.code}</span> : <span className="flex-none text-accent-hi">{track.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{track.label}</span>
                  </>
                )}
                {heads[track.key]}
              </div>
              <div
                className={cn("relative flex-none", track.key === "video" && canEdit && "cursor-text")}
                style={{ width: lane + 24 }}
                onPointerDown={track.key === "video" ? onVideoDown : onEmptyDown}
                onPointerMove={track.key === "video" ? onVideoMove : onEmptyMove}
                onPointerUp={track.key === "video" ? onVideoUp : onEmptyUp}
                onPointerCancel={() => ((marq.current = null), setBox(null))}
                onDoubleClick={(e) => {
                  if (!canEdit || !onAddAt || (e.target !== e.currentTarget && track.key !== "video")) return;
                  onAddAt(timeAt(e.clientX), { x: e.clientX, y: e.clientY });
                }}
                onContextMenu={(e) => {
                  if (!canEdit || !onAddAt || e.target !== e.currentTarget) return;
                  e.preventDefault();
                  onAddAt(timeAt(e.clientX), { x: e.clientX, y: e.clientY });
                }}
                data-track={track.key}
              >
                {waves[track.key] && <ViewportWave scroller={scroller} labelWidth={LABEL_W} pps={pps} duration={d} height={track.lane} columns={waves[track.key]!.columns} version={waves[track.key]!.version} color={waves[track.key]!.color} marks={waves[track.key]!.marks} />}
                {track.key === "captions" &&
                  hiddenCaptions.map((h, i) => <div key={`h${i}`} aria-hidden className="absolute inset-y-1 rounded bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.06)_0_4px,transparent_4px_8px)]" style={{ left: x(h.start), width: Math.max(2, x(h.end - h.start)) }} title="Sin subtítulos aquí" />)}
                {track.key === "captions" &&
                  onShowCaptions &&
                  captionHides.map((h) => (
                    <button
                      key={`s${h.index}`}
                      type="button"
                      onClick={() => onShowCaptions(h.index)}
                      className="group/show absolute inset-y-1 z-[1] grid place-items-center overflow-hidden rounded border border-dashed border-white/20 text-[10px] font-semibold text-transparent transition hover:border-accent-hi hover:bg-accent/15 hover:text-accent-glow focus-visible:text-accent-glow focus-visible:outline-2 focus-visible:outline-accent-hi"
                      style={{ left: x(h.start), width: Math.max(6, x(h.end - h.start)) }}
                      title="Volver a mostrar los subtítulos aquí"
                      aria-label={`Volver a mostrar los subtítulos de ${timeLabel(h.start)} a ${timeLabel(h.end)}`}
                    >
                      Mostrar
                    </button>
                  ))}

                {lanes > 1 &&
                  Array.from({ length: lanes - 1 }, (_, k) => <div key={`lane${k}`} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/[0.06]" style={{ top: (k + 1) * track.lane }} />)}
                {byTrack[track.key].map((b) => {
                  const g = ghost?.key === b.key ? ghost : null;
                  const s = g ? g.start : b.start;
                  const e = g ? g.end : b.end;
                  const lane = g && track.lanes && track.key !== "audio" ? g.lane : (layout[track.key].lanes.get(b.key) ?? 0);
                  const w = Math.max(3, x(e - s));
                  const inGroup = multiSet.has(b.key);
                  const selected = selKey === selectionKey(b.selection) || inGroup;
                  const shift = inGroup && groupDx != null ? x(groupDx) : 0;
                  const handles = canEdit && b.editable && w >= 18;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      data-block={b.key}
                      data-track={b.track}
                      aria-pressed={selected}
                      aria-label={`${b.label}${b.detail ? `: ${b.detail}` : ""}, de ${timeLabel(b.start)} a ${timeLabel(b.end)}${b.ai ? ". Lo puso la IA" : ""}`}
                      title={`${b.label}${b.detail ? ` · ${b.detail}` : ""}`}
                      className={cn(
                        "group absolute flex touch-none items-center overflow-hidden rounded-md border text-left text-[11px] leading-tight font-semibold text-white outline-none select-none focus-visible:ring-2 focus-visible:ring-accent-hi",
                        b.tone,
                        b.empty && "border-dashed bg-transparent text-warning",
                        b.pending && "border-dashed bg-[#8b5cf6]/15 text-[#3d2a9a] animate-pulse motion-reduce:animate-none",
                        b.track !== "video" && b.track !== "captions" && canEdit && b.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        selected && "z-10 ring-2 ring-white",
                        b.dim && "opacity-45 saturate-0",
                        g && "z-20 opacity-90 shadow-[0_6px_18px_rgba(0,0,0,.45)]",
                        g && !g.span && "ring-2 ring-danger",
                      )}
                      style={{ left: x(s), width: w, top: lane * track.lane + 3, height: track.lane - 6, ...(shift ? { transform: `translateX(${shift}px)` } : {}) }}
                      data-lane={lane}
                      onPointerDown={(ev) => {
                        if (b.track === "video") return; // la pista de video elige tramos
                        onBlockDown(ev, b, "move");
                      }}
                      onPointerMove={onBlockMove}
                      onPointerUp={onBlockUp}
                      onPointerCancel={() => {
                        drag.current = null;
                        setGhost(null);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") onSelect(b.selection, b);
                      }}
                    >
                      {b.wave && <span className="pointer-events-none absolute inset-0 flex items-center opacity-70">{b.wave}</span>}
                      {b.fades && (
                        <FadeShades
                          width={w}
                          duration={e - s}
                          fadeIn={fadeGhost?.key === b.key && fadeGhost.which === "in" ? fadeGhost.value : b.fades.in}
                          fadeOut={fadeGhost?.key === b.key && fadeGhost.which === "out" ? fadeGhost.value : b.fades.out}
                        />
                      )}
                      {b.thumb && w > 40 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.thumb} alt="" className="h-full w-6 flex-none object-cover opacity-80" draggable={false} />
                      )}
                      <span className={cn("min-w-0 flex-1 truncate px-1.5", w < 26 && "sr-only")}>
                        {b.label}
                        {b.detail && w > 120 && <span className="ml-1 font-normal text-white/70">{b.detail}</span>}
                      </span>
                      {b.ai && w > 46 && <span className="mr-1 flex-none rounded bg-white/20 px-1 font-mono text-[9px] leading-[14px] text-white">IA</span>}
                      {b.ai && w <= 46 && <span aria-hidden className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-white/85" />}
                      {b.fades && canEdit && w >= 30 && (
                        <>
                          <span
                            aria-hidden
                            title="Fundido de entrada: arrástralo"
                            data-fade="in"
                            className="absolute top-0 z-[2] h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-white bg-paper shadow"
                            style={{ left: Math.min(w - 6, Math.max(6, x(fadeGhost?.key === b.key && fadeGhost.which === "in" ? fadeGhost.value : b.fades.in))) }}
                            onPointerDown={(ev) => onBlockDown(ev, b, "fade-in")}
                          />
                          <span
                            aria-hidden
                            title="Fundido de salida: arrástralo"
                            data-fade="out"
                            className="absolute top-0 z-[2] h-2.5 w-2.5 translate-x-1/2 cursor-ew-resize rounded-full border border-white bg-paper shadow"
                            style={{ right: Math.min(w - 6, Math.max(6, x(fadeGhost?.key === b.key && fadeGhost.which === "out" ? fadeGhost.value : b.fades.out))) }}
                            onPointerDown={(ev) => onBlockDown(ev, b, "fade-out")}
                          />
                        </>
                      )}
                      {handles && (
                        <>
                          <span
                            aria-hidden
                            className={cn("absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 transition hover:bg-white/30", selected && "bg-white/25")}
                            onPointerDown={(ev) => onBlockDown(ev, b, "start")}
                            data-handle="start"
                          />
                          <span
                            aria-hidden
                            className={cn("absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 transition hover:bg-white/30", selected && "bg-white/25")}
                            onPointerDown={(ev) => onBlockDown(ev, b, "end")}
                            data-handle="end"
                          />
                        </>
                      )}
                    </button>
                  );
                })}

                {track.key === "video" &&
                  cuts.map((c) =>
                    c.kind === "corte" ? (
                      <button
                        key={`c${c.at}`}
                        type="button"
                        className="absolute top-0 bottom-0 z-10 grid w-3 -translate-x-1/2 place-items-center text-danger"
                        style={{ left: x(c.at) }}
                        aria-label={`Corte en ${timeLabel(c.at)}: ver lo que se sacó`}
                        title="Corte: tócalo para ver o restaurar lo que se sacó"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (c.removed) onSelect({ kind: "cut", at: c.at, from: c.removed.from, to: c.removed.to });
                          onSeek(c.at);
                        }}
                      >
                        <span className="block h-full w-0.5 rounded bg-danger" />
                        <Scissors className="absolute top-0.5 h-2.5 w-2.5" aria-hidden />
                      </button>
                    ) : c.kind === "pausa" ? (
                      <button
                        key={`c${c.at}`}
                        type="button"
                        data-pause-mark={c.word}
                        className={cn("group/pause absolute top-0 bottom-0 z-10 grid w-3 -translate-x-1/2 place-items-center outline-none", selKey === `pause:${c.word}` && "z-20")}
                        style={{ left: x(c.at) }}
                        aria-label={`Pausa acortada en ${timeLabel(c.at)}: dejarla completa`}
                        title="Pausa acortada: tócala para dejarla completa"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect({ kind: "pause", word: c.word });
                          onSeek(Math.max(0, c.at - 0.6));
                        }}
                      >
                        <span className={cn("block h-full w-0.5 rounded bg-white/45 transition group-hover/pause:bg-accent-hi group-focus-visible/pause:bg-accent-hi", selKey === `pause:${c.word}` && "bg-white")} />
                        <span
                          aria-hidden
                          className={cn(
                            "absolute top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-white/45 bg-card text-paper/80 transition group-hover/pause:scale-125 group-hover/pause:border-accent-hi group-hover/pause:text-accent-glow group-focus-visible/pause:border-accent-hi",
                            selKey === `pause:${c.word}` && "border-white text-white",
                          )}
                        >
                          <Pause className="h-2 w-2" />
                        </span>
                      </button>
                    ) : (
                      <span
                        key={`c${c.at}`}
                        aria-hidden
                        className={cn("pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 -translate-x-1/2 rounded", c.kind === "gancho" ? "bg-accent-glow" : "bg-white/30")}
                        style={{ left: x(c.at) }}
                        title={c.kind === "gancho" ? "Aquí termina el gancho y sigue el video" : "Aquí sigue un bloque movido"}
                      />
                    ),
                  )}

                {track.key === "video" && (rangeGhost ?? range) && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 z-20 rounded-md border-2 border-accent-hi bg-accent/25"
                    style={{ left: x((rangeGhost ?? range)!.start), width: Math.max(2, x((rangeGhost ?? range)!.end - (rangeGhost ?? range)!.start)) }}
                  />
                )}

                {(track.key === "fx" || track.key === "layers") &&
                  canEdit &&
                  transitionSlots.map((c) => (
                    <button
                      key={`ts${c.word}`}
                      type="button"
                      className="group/slot absolute top-1/2 z-[5] grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm text-transparent outline-none hover:text-accent-glow focus-visible:text-accent-glow"
                      style={{ left: x(c.at) }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: "transition", word: c.word });
                      }}
                      aria-label={`Poner una transición en el corte de ${timeLabel(c.at)}`}
                      title="Poner una transición en este corte"
                      data-transition-slot={c.word}
                    >
                      <span aria-hidden className="block h-2 w-2 rotate-45 rounded-[2px] border border-white/30 bg-card transition group-hover/slot:scale-150 group-hover/slot:border-accent-hi group-hover/slot:bg-accent/40 group-focus-visible/slot:scale-150 group-focus-visible/slot:border-accent-hi" />
                    </button>
                  ))}

                {track.key === "audio" &&
                  sfx.map((c, i) => (
                    <span key={`s${i}`} aria-hidden className="pointer-events-none absolute bottom-[3px] z-10 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-warning/80" style={{ left: x(c.at) }} />
                  ))}
                {notes?.[track.key] && byTrack[track.key].length === 0 && !waves[track.key] && !(track.key === "audio" && sfx.length) && (
                  <span className="pointer-events-none sticky inline-block px-2 text-[10px] text-placeholder" style={{ lineHeight: `${track.lane}px`, left: LABEL_W + 8 }}>
                    {notes[track.key]}
                  </span>
                )}
                {dropGhost && (layerView && VISUAL.includes(dropGhost.track) ? "layers" : dropGhost.track) === track.key && (
                  // Sombra de lo que se va a soltar: su largo real (ajustado a palabras), arriba (va encima de lo que haya).
                  <div
                    aria-hidden
                    data-testid="drop-ghost"
                    title={`${dropGhost.label} · ${secondsLabel(dropGhost.end - dropGhost.start)}`}
                    className="pointer-events-none absolute z-30 rounded-md border border-dashed border-accent-glow/80 bg-accent-hi/25 shadow-[0_0_14px_rgba(77,163,255,.45)] backdrop-blur-[2px]"
                    style={{ left: x(dropGhost.start), width: Math.max(3, x(dropGhost.end - dropGhost.start)), top: 3, height: track.lane - 6 }}
                  >
                  </div>
                )}
                {dropGhost && (layerView && VISUAL.includes(dropGhost.track) ? "layers" : dropGhost.track) === track.key && (
                  // Su nombre y cuánto dura, siempre a la vista (aunque el bloque sea angosto).
                  <span
                    data-testid="drop-ghost-label"
                    className="pointer-events-none absolute z-40 rounded-md border border-accent-hi/60 bg-card px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-paper shadow-lg"
                    style={{ left: x(dropGhost.start), top: -18 }}
                  >
                    {dropGhost.label} · {secondsLabel(dropGhost.end - dropGhost.start)}
                  </span>
                )}
              </div>
            </div>
            );
          })}

          {box && (
            <div
              aria-hidden
              data-testid="marquee"
              className="pointer-events-none absolute z-50 rounded-md border border-accent-hi bg-accent/15"
              style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
            />
          )}

          {/* Cabezal */}
          <div ref={playhead} aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-0 z-40 w-0" style={{ transform: `translateX(${LABEL_W + time * pps}px)` }}>
            <div className="absolute top-0 bottom-0 -left-px w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,.6)]" />
            <div className="absolute top-0 -left-[6px] h-3 w-3 rounded-b-sm bg-white" />
          </div>

          {ghost && (
            <div className="pointer-events-none absolute top-6 z-50 -translate-x-1/2 rounded-lg border border-white/15 bg-card px-2 py-1 text-[11px] whitespace-nowrap text-paper shadow-lg" style={{ left: LABEL_W + x((ghost.start + ghost.end) / 2) }} role="status">
              <span className="font-mono tabular-nums">
                {timeLabel(ghost.start)} – {timeLabel(ghost.end)} · {secondsLabel(ghost.end - ghost.start)}
              </span>
              {ghost.note && <span className="ml-2 text-warning">{ghost.note}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sombra de los fundidos de un bloque de audio: rampa de entrada y de salida sobre el bloque. */
function FadeShades({ width, duration, fadeIn, fadeOut }: { width: number; duration: number; fadeIn: number; fadeOut: number }) {
  if (duration <= 0 || (fadeIn <= 0 && fadeOut <= 0)) return null;
  const a = Math.min(100, (fadeIn / duration) * 100);
  const b = Math.max(0, 100 - (fadeOut / duration) * 100);
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full" style={{ width }}>
      {fadeIn > 0 && <polygon points={`0,0 ${a},0 0,100`} fill="rgba(22,23,27,.28)" />}
      {fadeOut > 0 && <polygon points={`${b},0 100,0 100,100`} fill="rgba(22,23,27,.28)" />}
      <polyline points={`0,100 ${a},2 ${b},2 100,100`} fill="none" stroke="rgba(255,255,255,.95)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
