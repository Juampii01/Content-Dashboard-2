"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { safeMargins, snapBox, TRANSFORM_LIMITS, type PlacedBox, type SnapGuide, type Transform } from "@/lib/video/canvas/transform";
import type { VideoFormat } from "@/lib/video/types";

/**
 * Lienzo de la revisión: se monta encima de la vista previa y deja tocar lo que se ve en el instante actual (gráficos,
 * el elemento movible de un efecto, los subtítulos). Al tocar un elemento aparece su recuadro con manijas:
 * - arrastrar mueve (se imanta al centro y a los márgenes seguros; Alt lo suelta),
 * - las esquinas cambian el tamaño, la manija de arriba gira (si el elemento gira; Mayús de a 15°),
 * - doble clic (o Enter) edita el texto en el lugar,
 * - flechas mueven 1 % (Mayús 5 %), + y − cambian el tamaño, Esc suelta la selección.
 *
 * No sabe de planes: recibe las cajas ya calculadas (en píxeles del video final, con las mismas funciones de layout que
 * dibujan los motores) y avisa los cambios con `onChange` / `onTextChange`.
 */

export type CanvasText = { id: string; label: string; value: string; max: number };

export type CanvasElement = {
  /** Único en el lienzo ("graphic:b3", "effect:fx1", "caption:12"). */
  id: string;
  kind: "graphic" | "effect" | "caption";
  /** Nombre corto para la etiqueta y los lectores de pantalla ("Gráfico · Embudo"). */
  label: string;
  /** Caja ya movida y escalada (sin animación), en píxeles del video final. */
  box: PlacedBox;
  /** Transformación actual (la identidad si no se movió). */
  transform: Transform;
  rotatable: boolean;
  /** Textos que se pueden editar en el lugar (doble clic). */
  texts?: CanvasText[];
  /** Título del editor de textos ("Corrige una palabra"). */
  textsTitle?: string;
};

type Drag = {
  mode: "move" | "scale" | "rotate";
  id: string;
  startX: number;
  startY: number;
  t0: Transform;
  box0: PlacedBox;
  /** Centro de la caja en px de la pantalla (para escalar y girar). */
  cx: number;
  cy: number;
};

const OUT = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 } } as const;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function clampTransform(t: Transform, rotatable: boolean): Transform {
  const L = TRANSFORM_LIMITS;
  const out: Transform = { x: r4(clamp(t.x, -L.offset, L.offset)), y: r4(clamp(t.y, -L.offset, L.offset)), scale: r4(clamp(t.scale, L.scaleMin, L.scaleMax)) };
  const rot = rotatable ? r4(clamp(t.rotation ?? 0, -L.rotation, L.rotation)) : 0;
  if (rot) out.rotation = rot;
  return out;
}

export function TransformOverlay({
  format,
  elements,
  selectedId,
  onSelect,
  onChange,
  onTextChange,
  onInteract,
  disabled = false,
  className,
}: {
  format: VideoFormat;
  /** Lo que se ve en el instante actual, con su caja. */
  elements: CanvasElement[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Nueva transformación (mientras se arrastra, en cada movimiento). */
  onChange: (id: string, next: Transform) => void;
  onTextChange?: (id: string, textId: string, value: string) => void;
  /** Al empezar a tocar un elemento (la vista previa se pausa). */
  onInteract?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const out = OUT[format];

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const k = size.w ? size.w / out.w : 0;
  // Esc suelta lo elegido aunque el foco esté en otro lado (por ejemplo, después de "Listo" en el editor de textos).
  useEffect(() => {
    if (!selectedId || editing) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, editing, onSelect]);

  // Si el elemento deja de verse (el video siguió), su editor de textos no se muestra.
  const editingEl = editing ? elements.find((e) => e.id === editing) : null;

  function begin(e: ReactPointerEvent, el: CanvasElement, mode: Drag["mode"]) {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onInteract?.();
    if (selectedId !== el.id) onSelect(el.id);
    const rect = root.current!.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode, id: el.id, startX: e.clientX, startY: e.clientY, t0: el.transform, box0: el.box, cx: rect.left + el.box.cx * k, cy: rect.top + el.box.cy * k });
  }

  function move(e: ReactPointerEvent) {
    if (!drag || !k) return;
    const el = elements.find((x) => x.id === drag.id);
    if (!el) return;
    const { t0, box0 } = drag;
    if (drag.mode === "move") {
      const dx = (e.clientX - drag.startX) / k;
      const dy = (e.clientY - drag.startY) / k;
      let nx = t0.x + dx / out.w;
      let ny = t0.y + dy / out.h;
      let shown: SnapGuide[] = [];
      if (!e.altKey) {
        // Imán: centro del cuadro y márgenes seguros (sobre la caja ya movida).
        const snap = snapBox({ cx: (box0.cx + dx) / out.w, cy: (box0.cy + dy) / out.h, w: box0.w / out.w, h: box0.h / out.h }, format, 6 / Math.max(1, size.w));
        nx += snap.dx;
        ny += snap.dy;
        shown = snap.guides;
      }
      setGuides(shown);
      onChange(el.id, clampTransform({ ...t0, x: nx, y: ny }, el.rotatable));
    } else if (drag.mode === "scale") {
      const d0 = Math.hypot(drag.startX - drag.cx, drag.startY - drag.cy) || 1;
      const d1 = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
      onChange(el.id, clampTransform({ ...t0, scale: t0.scale * (d1 / d0) }, el.rotatable));
    } else {
      const a0 = Math.atan2(drag.startY - drag.cy, drag.startX - drag.cx);
      const a1 = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      let deg = (t0.rotation ?? 0) + ((a1 - a0) * 180) / Math.PI;
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.abs(deg) < 2.5 ? 0 : deg;
      onChange(el.id, clampTransform({ ...t0, rotation: deg }, el.rotatable));
    }
  }

  function end() {
    setDrag(null);
    setGuides([]);
  }

  function onKey(e: KeyboardEvent, el: CanvasElement) {
    if (disabled) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const t = el.transform;
    let next: Transform | null = null;
    if (e.key === "ArrowLeft") next = { ...t, x: t.x - step };
    else if (e.key === "ArrowRight") next = { ...t, x: t.x + step };
    else if (e.key === "ArrowUp") next = { ...t, y: t.y - step };
    else if (e.key === "ArrowDown") next = { ...t, y: t.y + step };
    else if (e.key === "+" || e.key === "=") next = { ...t, scale: t.scale * 1.05 };
    else if (e.key === "-" || e.key === "_") next = { ...t, scale: t.scale / 1.05 };
    else if (e.key === "Enter" && el.texts?.length) {
      e.preventDefault();
      setEditing(el.id);
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      onSelect(null);
      return;
    } else if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      onInteract?.();
      onSelect(el.id);
      return;
    }
    if (!next) return;
    e.preventDefault();
    onInteract?.();
    if (selectedId !== el.id) onSelect(el.id);
    onChange(el.id, clampTransform(next, el.rotatable));
  }

  const margins = safeMargins(format);
  return (
    <div ref={root} className={cn("pointer-events-none absolute inset-0 z-10 select-none", className)}>
      {/* Márgenes seguros mientras se arrastra. */}
      {drag && (
        <div
          aria-hidden
          className="absolute rounded-md border border-dashed border-white/25"
          style={{ left: `${margins.left * 100}%`, top: `${margins.top * 100}%`, width: `${(margins.right - margins.left) * 100}%`, height: `${(margins.bottom - margins.top) * 100}%` }}
        />
      )}
      {guides.map((g, i) => (
        <div
          key={`${g.axis}-${g.at}-${i}`}
          aria-hidden
          className={cn("absolute", g.kind === "center" ? "bg-accent-glow" : "bg-warning")}
          style={g.axis === "x" ? { left: `${g.at * 100}%`, top: 0, bottom: 0, width: 1 } : { top: `${g.at * 100}%`, left: 0, right: 0, height: 1 }}
        />
      ))}
      {k > 0 &&
        elements.map((el) => {
          const active = el.id === selectedId;
          const w = Math.max(24, el.box.w * k);
          const h = Math.max(18, el.box.h * k);
          const hint = `Arrastra para mover, flechas para mover un 1 % (con Mayús, 5 %), + y − para el tamaño${el.texts?.length ? ", Enter o doble clic para editar el texto" : ""}.`;
          return (
            <div
              key={el.id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${el.label}. ${hint}`}
              aria-pressed={active}
              className={cn(
                "group pointer-events-auto absolute touch-none rounded-[6px] outline-none",
                disabled ? "cursor-default" : drag?.id === el.id && drag.mode === "move" ? "cursor-grabbing" : "cursor-grab",
                active ? "ring-2 ring-accent-hi" : "ring-1 ring-transparent hover:ring-white/60 focus-visible:ring-2 focus-visible:ring-accent-hi",
              )}
              style={{ left: el.box.cx * k, top: el.box.cy * k, width: w, height: h, transform: `translate(-50%, -50%) rotate(${el.box.rotation}deg)` }}
              onPointerDown={(e) => begin(e, el, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (el.texts?.length && !disabled) setEditing(el.id);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => onKey(e, el)}
            >
              <span
                className={cn(
                  "pointer-events-none absolute -top-6 left-0 max-w-[14rem] truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white transition-opacity",
                  active ? "bg-accent opacity-100" : "bg-black/70 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                )}
                style={{ transform: `rotate(${-el.box.rotation}deg)`, transformOrigin: "left bottom" }}
              >
                {el.label}
              </span>
              {active && !disabled && (
                <>
                  {(["nw", "ne", "sw", "se"] as const).map((c) => (
                    <span
                      key={c}
                      aria-hidden
                      className={cn(
                        "absolute h-3.5 w-3.5 rounded-full border-2 border-accent-hi bg-white shadow",
                        c[0] === "n" ? "-top-[7px]" : "-bottom-[7px]",
                        c[1] === "w" ? "-left-[7px]" : "-right-[7px]",
                        c === "nw" || c === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize",
                      )}
                      onPointerDown={(e) => begin(e, el, "scale")}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                  ))}
                  {el.rotatable && (
                    <>
                      <span aria-hidden className="pointer-events-none absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-accent-hi" />
                      <span
                        aria-hidden
                        title="Girar (Mayús: de a 15°)"
                        className="absolute -top-9 left-1/2 h-4 w-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-accent-hi bg-bg"
                        onPointerDown={(e) => begin(e, el, "rotate")}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      {editingEl && editingEl.texts?.length && k > 0 && (
        <TextEditor
          el={editingEl}
          k={k}
          frame={size}
          onChange={(textId, value) => onTextChange?.(editingEl.id, textId, value)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Editor de textos en el lugar: una tarjeta junto a la caja, con un campo por texto. */
function TextEditor({ el, k, frame, onChange, onClose }: { el: CanvasElement; k: number; frame: { w: number; h: number }; onChange: (textId: string, value: string) => void; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const width = Math.min(260, frame.w - 16);
  const below = el.box.cy * k < frame.h / 2;
  const top = below ? Math.min(frame.h - 8, (el.box.cy + el.box.h / 2) * k + 10) : Math.max(8, (el.box.cy - el.box.h / 2) * k - 10);
  const left = clamp(el.box.cx * k - width / 2, 8, Math.max(8, frame.w - width - 8));
  useEffect(() => {
    card.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [el.id]);
  return (
    <div
      ref={card}
      role="dialog"
      aria-label={el.textsTitle ?? `Editar el texto de ${el.label}`}
      className="pointer-events-auto absolute z-20 flex max-h-[60%] flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-card/95 p-3 shadow-2xl backdrop-blur"
      style={{ left, width, top, transform: below ? undefined : "translateY(-100%)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="text-xs font-semibold text-white">{el.textsTitle ?? "Edita el texto"}</p>
      {el.texts!.map((t) => (
        <label key={t.id} className="flex flex-col gap-1 text-[11px] text-muted">
          {t.label}
          <input className="field !px-2.5 !py-1.5 !text-sm" value={t.value} maxLength={t.max} onChange={(e) => onChange(t.id, e.target.value)} />
        </label>
      ))}
      <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onClose}>
        Listo
      </button>
    </div>
  );
}
