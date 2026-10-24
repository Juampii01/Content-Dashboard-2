"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { FX_CATEGORIES, FX_CATEGORY_LABELS, FX_GALLERY_ORDER, FX_INFO, searchFx, type FxCategory, type FxKind } from "@/lib/video/fx/catalog";
import type { FxBrand, FxCtx } from "@/lib/video/fx";
import { FxRenderer } from "@/lib/video/fx";
import { demoDuration, demoSpec, FX_DEMO } from "@/lib/video/fx/demo";
import { compileTransition, TRANSITION_INFO, type TransitionKind } from "@/lib/video/fx/transitions";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BROWSER_FX_FONTS, FxDemoCanvas, useFxFonts, useImages } from "./fx-canvas";

/**
 * Biblioteca de efectos y transiciones: categorías, buscador y muestras. Cada muestra se dibuja quieta (un cuadro
 * representativo) y se anima al pasar el mouse o con el foco del teclado: así 100 muestras no traban la página.
 */

/** Se monta cuando entra en pantalla (y queda montada). */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** Reloj que corre solo mientras `active` (para la muestra que se está mirando). */
function useClock(active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now;
        setT((now - start) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return active ? t : 0;
}

/** Instante quieto de cada muestra: donde se ve el efecto armado. */
function stillTime(kind: FxKind): number {
  const d = demoDuration(kind);
  if (kind === "zoom_cut") return d * 0.45;
  if (FX_INFO[kind].category === "camara") return Math.min(d * 0.3, 0.6);
  return d * 0.62;
}

export function FxTile({ kind, brand, onPick, selected, draggable, onDragStart, compact }: { kind: FxKind; brand: FxBrand; onPick?: () => void; selected?: boolean; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; compact?: boolean }) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  const [hot, setHot] = useState(false);
  const reduced = usePrefersReducedMotion();
  const clock = useClock(hot && !reduced);
  const images = useImages(seen ? { frame: FX_DEMO.frame, mask: FX_DEMO.mask } : {});
  const spec = useMemo(() => (seen ? demoSpec(kind, brand) : null), [seen, kind, brand]);
  const info = FX_INFO[kind];
  const d = demoDuration(kind);
  const time = hot && !reduced ? clock % (d + 0.4) : stillTime(kind);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      disabled={!onPick}
      draggable={draggable}
      onDragStart={onDragStart}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      title={`${info.description} ${info.when}`}
      aria-label={`${info.label}: ${info.description}`}
      aria-pressed={selected}
      className={cn(
        "group flex flex-col gap-1 rounded-xl border p-1 text-left transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-accent-hi disabled:cursor-default",
        selected ? "border-accent bg-accent/12" : "border-white/10",
      )}
    >
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-[#121a33]">
        {spec && images.frame ? <FxDemoCanvas spec={spec} time={time} frame={images.frame} mask={images.mask} reducedMotion={reduced} /> : <span className="skeleton absolute inset-0" />}
        {info.mask && <span className="absolute top-1 right-1 rounded bg-black/55 px-1 font-mono text-[8px] leading-[14px] text-white/85">recorte</span>}
      </span>
      <span className={cn("px-0.5 pb-0.5 leading-tight font-semibold text-white", compact ? "text-[10.5px]" : "text-[11px]")}>{info.label}</span>
    </button>
  );
}

/** Categorías + buscador + rejilla de efectos. `onPick` agrega; `drag` deja arrastrarlos a la línea de tiempo. */
export function FxLibraryGrid({ brand, onPick, current, dragData, cols = 3, header }: { brand: FxBrand; onPick: ((kind: FxKind) => void) | null; current?: FxKind | null; dragData?: (kind: FxKind) => string | null; cols?: 2 | 3 | 4; header?: ReactNode }) {
  const [cat, setCat] = useState<FxCategory | "todos">("todos");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => {
    const pool = cat === "todos" ? FX_GALLERY_ORDER : FX_GALLERY_ORDER.filter((k) => FX_INFO[k].category === cat);
    return searchFx(q, pool);
  }, [cat, q]);
  const counts = useMemo(() => Object.fromEntries(FX_CATEGORIES.map((c) => [c, FX_GALLERY_ORDER.filter((k) => FX_INFO[k].category === c).length])) as Record<FxCategory, number>, []);
  return (
    <div className="flex flex-col gap-2.5">
      {header}
      <SearchBox value={q} onChange={setQ} label="Buscar efectos" placeholder={`Buscar en ${formatNumber(FX_GALLERY_ORDER.length)} efectos…`} />
      <div role="tablist" aria-label="Categorías de efectos" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        <Chip active={cat === "todos"} onClick={() => setCat("todos")} label="Todos" count={FX_GALLERY_ORDER.length} />
        {FX_CATEGORIES.map((c) => (
          <Chip key={c} active={cat === c} onClick={() => setCat(c)} label={FX_CATEGORY_LABELS[c].label} count={counts[c]} title={FX_CATEGORY_LABELS[c].description} />
        ))}
      </div>
      {cat !== "todos" && !q && <p className="text-xs text-muted">{FX_CATEGORY_LABELS[cat].description}</p>}
      {kinds.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-3 text-sm text-muted">
          Ningún efecto coincide con «{q}». Prueba con otra palabra (por ejemplo: texto, flecha, vhs, zoom, marco).
        </p>
      ) : (
        <div aria-label="Efectos" className={cn("grid gap-1.5", cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-3")}>
          {kinds.map((kind) => {
            const data = dragData?.(kind) ?? null;
            return (
              <FxTile
                key={kind}
                kind={kind}
                brand={brand}
                compact={cols === 3}
                selected={current === kind}
                onPick={onPick ? () => onPick(kind) : undefined}
                draggable={Boolean(data)}
                onDragStart={
                  data
                    ? (e) => {
                        e.dataTransfer.setData("application/x-content2-studio", data);
                        e.dataTransfer.effectAllowed = "copy";
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-placeholder" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="field h-9 w-full rounded-xl !pr-8 !pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Borrar la búsqueda" className="absolute top-1/2 right-1.5 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-white/[0.07] hover:text-white">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Chip({ active, onClick, label, count, title }: { active: boolean; onClick: () => void; label: string; count?: number; title?: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={title}
      className={cn(
        "flex-none rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-accent-hi",
        active ? "border-accent bg-accent/20 text-white" : "border-white/12 text-muted hover:border-white/30 hover:text-white",
      )}
    >
      {label}
      {count != null && <span className={cn("ml-1 font-mono text-[10px]", active ? "text-accent-glow" : "text-placeholder")}>{count}</span>}
    </button>
  );
}

// ─── Transiciones ──────────────────────────────────────────────────────────

/** Segundo cuadro de la muestra (la misma persona espejada y más cálida): así se ve el "corte". */
function useSecondFrame(img: HTMLImageElement | undefined): HTMLCanvasElement | null {
  return useMemo(() => {
    if (!img || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 270;
    c.height = 480;
    const ctx = c.getContext("2d")!;
    ctx.translate(270, 0);
    ctx.scale(-1.15, 1.15);
    ctx.filter = "sepia(0.35) saturate(1.3) hue-rotate(-12deg)";
    ctx.drawImage(img, -20, -30, 270, 480);
    return c;
  }, [img]);
}

const TR_DEMO = { len: 1.2, start: 0.4 };

export function TransitionTile({ kind, brand, onPick, selected, draggable, onDragStart }: { kind: TransitionKind; brand: FxBrand; onPick?: () => void; selected?: boolean; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void }) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  const [hot, setHot] = useState(false);
  const reduced = usePrefersReducedMotion();
  const clock = useClock(hot && !reduced);
  const fonts = useFxFonts();
  const images = useImages(seen ? { frame: FX_DEMO.frame } : {});
  const second = useSecondFrame(images.frame);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(
    () =>
      new FxRenderer({
        makeCanvas: (w, h) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return { canvas: c, ctx: c.getContext("2d") as unknown as FxCtx };
        },
        fonts: BROWSER_FX_FONTS,
        reducedMotion: reduced,
      }),
    [reduced],
  );
  const info = TRANSITION_INFO[kind];
  const spec = useMemo(() => {
    const d = info.duration;
    return compileTransition({ segment: { id: `demo-${kind}`, start: 0, end: d, cut: d / 2, item: { id: `demo-${kind}`, kind, at_word: 0 } }, format: "9:16", brand, face: FX_DEMO.face });
  }, [kind, brand, info.duration]);
  // Bucle: antes, la transición y después (el cuadro cambia en el corte).
  const loop = TR_DEMO.start + spec.duration + 0.5;
  const tl = hot && !reduced ? clock % loop : TR_DEMO.start + spec.duration * 0.42;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !fonts || !images.frame || !second) return;
    const t = tl - TR_DEMO.start;
    const after = t >= spec.duration / 2;
    const frame = after ? second : images.frame;
    if (t < 0 || t > spec.duration) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    renderer.render(ctx as unknown as FxCtx, spec, t, { frame, mask: null }, 0.25);
  }, [tl, fonts, images.frame, second, spec, renderer]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      disabled={!onPick}
      draggable={draggable}
      onDragStart={onDragStart}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      aria-label={`${info.label}: ${info.description}`}
      aria-pressed={selected}
      title={info.description}
      className={cn("flex flex-col gap-1 rounded-xl border p-1 text-left transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-accent-hi disabled:cursor-default", selected ? "border-accent bg-accent/12" : "border-white/10")}
    >
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-lg bg-[#121a33]">
        {seen ? <canvas ref={canvas} width={270} height={480} className="block h-full w-full" aria-hidden /> : <span className="skeleton absolute inset-0" />}
      </span>
      <span className="px-0.5 pb-0.5 text-[10.5px] leading-tight font-semibold text-white">{info.label}</span>
    </button>
  );
}
