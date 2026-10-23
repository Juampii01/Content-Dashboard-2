"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AudioLines, Captions, Clapperboard, Film, Scissors, Sparkles, ZoomIn } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { clampDrag, secondsLabel, timeLabel, type CutMark, type SnappedSpan } from "@/lib/video/studio";
import { cn } from "@/lib/utils";

export type TrackKey = "video" | "captions" | "broll" | "fx" | "zoom" | "audio";

/** Lo que está elegido en el Estudio (se abre en el inspector). */
export type StudioSelection =
  | { kind: "broll"; id: string }
  | { kind: "fx"; id: string }
  | { kind: "zoom"; index: number }
  | { kind: "caption"; index: number }
  | { kind: "clip"; index: number }
  | { kind: "cut"; at: number; from: number; to: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "audio" };

export function selectionKey(sel: StudioSelection | null): string | null {
  if (!sel) return null;
  switch (sel.kind) {
    case "broll":
    case "fx":
      return `${sel.kind}:${sel.id}`;
    case "zoom":
    case "caption":
    case "clip":
      return `${sel.kind}:${sel.index}`;
    case "cut":
      return `cut:${sel.from}`;
    case "range":
      return `range:${sel.from}-${sel.to}`;
    case "audio":
      return "audio";
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
  selection: StudioSelection;
  thumb?: string | null;
};

/** Lo que se arrastra desde la Biblioteca a la línea de tiempo. */
export type LibraryDrop = { type: "fx"; kind: string } | { type: "broll" } | { type: "graphic"; template?: string } | { type: "zoom" };
export const LIBRARY_MIME = "application/x-content2-studio";

const TRACKS: { key: TrackKey; label: string; icon: ReactNode; h: number }[] = [
  { key: "video", label: "Video", icon: <Film className="h-3.5 w-3.5" aria-hidden />, h: 40 },
  { key: "captions", label: "Subtítulos", icon: <Captions className="h-3.5 w-3.5" aria-hidden />, h: 26 },
  { key: "broll", label: "Gráficos y b-roll", icon: <Clapperboard className="h-3.5 w-3.5" aria-hidden />, h: 32 },
  { key: "fx", label: "Efectos", icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />, h: 32 },
  { key: "zoom", label: "Zooms", icon: <ZoomIn className="h-3.5 w-3.5" aria-hidden />, h: 24 },
  { key: "audio", label: "Sonido", icon: <AudioLines className="h-3.5 w-3.5" aria-hidden />, h: 24 },
];

type Drag = {
  block: TimelineBlock;
  mode: "move" | "start" | "end";
  x0: number;
  moved: boolean;
  pointer: number;
};

type Ghost = { key: string; start: number; end: number; span: SnappedSpan | null; note: string | null };

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
  blocks,
  cuts,
  sfx,
  music,
  hiddenCaptions,
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
  music: { label: string } | null;
  hiddenCaptions: { start: number; end: number }[];
  selection: StudioSelection | null;
  /** Tramo elegido en la pista de video (en segundos), si hay. */
  range: { start: number; end: number } | null;
  /** Lo que no se puede pisar en cada pista además de sus propios bloques (un tramo lleva b-roll o efecto). */
  obstacles: Partial<Record<TrackKey, { start: number; end: number; label: string }[]>>;
  /** Resuelve un tramo a palabras (null si no se puede poner ahí). Con bloque: aplica sus reglas (duración). */
  snap: (t0: number, t1: number, block: TimelineBlock | null) => SnappedSpan | null;
  canEdit: boolean;
  /** Aviso corto por pista (ej. "Automáticos del estilo"). */
  notes?: Partial<Record<TrackKey, string>>;
  onSeek: (t: number) => void;
  onSelect: (sel: StudioSelection | null, block?: TimelineBlock) => void;
  onCommit: (block: TimelineBlock, span: SnappedSpan, mode: "move" | "start" | "end") => void;
  onRange: (span: SnappedSpan) => void;
  onDrop: (item: LibraryDrop, t: number) => void;
  toolbar: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  // Columna de nombres de pista (más angosta en el teléfono).
  const LABEL_W = width < 560 ? 84 : 108;
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [rangeGhost, setRangeGhost] = useState<{ start: number; end: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const selKey = selectionKey(selection);

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
    drag.current = { block, mode, x0: e.clientX, moved: false, pointer: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onBlockMove(e: ReactPointerEvent<HTMLElement>) {
    const dr = drag.current;
    if (!dr || dr.pointer !== e.pointerId) return;
    const dx = e.clientX - dr.x0;
    if (!dr.moved && Math.abs(dx) < 4) return;
    dr.moved = true;
    if (!canEdit || !dr.block.editable) return;
    const own = blocks.filter((b) => b.track === dr.block.track && b.key !== dr.block.key);
    const cross = obstacles[dr.block.track] ?? [];
    const raw = clampDrag({ mode: dr.mode, start: dr.block.start, end: dr.block.end, delta: dx / pps, duration: d, obstacles: [...own, ...cross], min: dr.block.min, max: dr.block.max });
    const span = snap(raw.start, raw.end, dr.block);
    // Si el imán cae encima de un vecino, no vale (queda donde estaba).
    const hit = span ? [...own, ...cross].find((o) => span.start < o.end - 0.02 && o.start < span.end - 0.02) : null;
    const blocker = cross.find((o) => (dr.mode !== "start" && Math.abs(raw.end - o.start) < 0.05) || (dr.mode !== "end" && Math.abs(raw.start - o.end) < 0.05));
    setGhost({
      key: dr.block.key,
      start: span?.start ?? raw.start,
      end: span?.end ?? raw.end,
      span: hit ? null : span,
      note: hit ? "Ahí ya hay otro bloque." : blocker ? `${blocker.label}: un tramo lleva b-roll o efecto, no los dos.` : !span ? "No se puede poner ahí." : null,
    });
  }
  function onBlockUp(e: ReactPointerEvent<HTMLElement>) {
    const dr = drag.current;
    if (!dr || dr.pointer !== e.pointerId) return;
    drag.current = null;
    if (dr.moved && ghost?.key === dr.block.key && ghost.span) onCommit(dr.block, ghost.span, dr.mode);
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

  // ─── Biblioteca: soltar un efecto o un gráfico ───
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canEdit || !e.dataTransfer.types.includes(LIBRARY_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDropItem(e: DragEvent<HTMLDivElement>) {
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

  const byTrack = useMemo(() => {
    const map: Record<TrackKey, TimelineBlock[]> = { video: [], captions: [], broll: [], fx: [], zoom: [], audio: [] };
    for (const b of blocks) map[b.track].push(b);
    return map;
  }, [blocks]);

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
        onDrop={onDropItem}
        data-testid="studio-timeline"
      >
        <div className="relative" style={{ width: LABEL_W + lane + 24 }}>
          {/* Regla */}
          <div className="sticky top-0 z-30 flex h-6 border-b border-white/10 bg-[#030a22]">
            <div className="sticky left-0 z-10 flex-none border-r border-white/10 bg-[#030a22]" style={{ width: LABEL_W }} />
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
            </div>
          </div>

          {TRACKS.map((track) => (
            <div key={track.key} className="flex border-b border-white/[0.06]" style={{ height: track.h }}>
              <div className="sticky left-0 z-20 flex flex-none items-center gap-1.5 border-r border-white/10 bg-[#040d2c] px-2.5 text-[11px] font-semibold text-muted" style={{ width: LABEL_W }} title={notes?.[track.key]}>
                <span className="text-accent-hi">{track.icon}</span>
                <span className="truncate">{track.label}</span>
              </div>
              <div
                className={cn("relative flex-none", track.key === "video" && canEdit && "cursor-text")}
                style={{ width: lane + 24 }}
                onPointerDown={
                  track.key === "video"
                    ? onVideoDown
                    : (e) => {
                        if (e.button !== 0 || e.target !== e.currentTarget) return;
                        onSeek(timeAt(e.clientX));
                        onSelect(null);
                      }
                }
                onPointerMove={track.key === "video" ? onVideoMove : undefined}
                onPointerUp={track.key === "video" ? onVideoUp : undefined}
                data-track={track.key}
              >
                {track.key === "captions" &&
                  hiddenCaptions.map((h, i) => <div key={`h${i}`} aria-hidden className="absolute inset-y-1 rounded bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.06)_0_4px,transparent_4px_8px)]" style={{ left: x(h.start), width: Math.max(2, x(h.end - h.start)) }} title="Sin subtítulos aquí" />)}

                {byTrack[track.key].map((b) => {
                  const g = ghost?.key === b.key ? ghost : null;
                  const s = g ? g.start : b.start;
                  const e = g ? g.end : b.end;
                  const w = Math.max(3, x(e - s));
                  const selected = selKey === selectionKey(b.selection);
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
                        "group absolute top-[3px] bottom-[3px] flex touch-none items-center overflow-hidden rounded-md border text-left text-[11px] leading-tight font-semibold text-white outline-none select-none focus-visible:ring-2 focus-visible:ring-accent-hi",
                        b.tone,
                        b.empty && "border-dashed bg-transparent text-warning",
                        b.track !== "video" && b.track !== "captions" && canEdit && b.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                        selected && "z-10 ring-2 ring-white",
                        g && "z-20 opacity-90 shadow-[0_6px_18px_rgba(0,0,0,.45)]",
                        g && !g.span && "ring-2 ring-danger",
                      )}
                      style={{ left: x(s), width: w }}
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
                    ) : (
                      <span
                        key={`c${c.at}`}
                        aria-hidden
                        className={cn("pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 -translate-x-1/2 rounded", c.kind === "gancho" ? "bg-accent-glow" : "bg-white/30")}
                        style={{ left: x(c.at) }}
                        title={c.kind === "gancho" ? "Aquí termina el gancho y sigue el video" : c.kind === "orden" ? "Aquí sigue un bloque movido" : "Pausa recortada"}
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

                {track.key === "audio" && music && (
                  <button
                    type="button"
                    className={cn("absolute inset-y-[5px] left-0 rounded border border-[#c98500]/50 bg-[#c98500]/20 px-2 text-left text-[10px] font-semibold text-[#ffd27a]", selKey === "audio" && "ring-2 ring-white")}
                    style={{ width: lane }}
                    onClick={() => onSelect({ kind: "audio" })}
                  >
                    <span className="sticky truncate" style={{ left: LABEL_W + 8 }}>{music.label}</span>
                  </button>
                )}
                {track.key === "audio" &&
                  sfx.map((c, i) => (
                    <span key={`s${i}`} aria-hidden className="pointer-events-none absolute top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning" style={{ left: x(c.at) }} />
                  ))}
                {notes?.[track.key] && byTrack[track.key].length === 0 && !(track.key === "audio" && (music || sfx.length)) && (
                  <span className="pointer-events-none sticky inline-block px-2 text-[10px] text-placeholder" style={{ lineHeight: `${track.h}px`, left: LABEL_W + 8 }}>
                    {notes[track.key]}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Cabezal */}
          <div ref={playhead} aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-0 z-40 w-0" style={{ transform: `translateX(${LABEL_W + time * pps}px)` }}>
            <div className="absolute top-0 bottom-0 -left-px w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,.6)]" />
            <div className="absolute top-0 -left-[6px] h-3 w-3 rounded-b-sm bg-white" />
          </div>

          {ghost && (
            <div className="pointer-events-none absolute top-6 z-50 -translate-x-1/2 rounded-lg border border-white/15 bg-[#081a4a] px-2 py-1 text-[11px] whitespace-nowrap text-white shadow-lg" style={{ left: LABEL_W + x((ghost.start + ghost.end) / 2) }} role="status">
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
