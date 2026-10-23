"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, Loader2, PenLine, Play, Scissors, Sparkles, Trash2, UserRound, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { formatDuration } from "@/lib/format";
import { FX_GALLERY_ORDER, FX_INFO, type FxKind } from "@/lib/video/fx/catalog";
import type { FxBrand, FxSegment } from "@/lib/video/fx/compile";
import { demoDuration, demoSpec, FX_DEMO } from "@/lib/video/fx/demo";
import type { FxItem } from "@/lib/video/fx/schema";
import type { Word } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { FxDemoCanvas, useImages } from "./fx-canvas";

/** Reloj compartido de las muestras: corre solo si se ven y si no se pidió reducir movimiento. */
function useLoop(active: boolean, reduced: boolean): number {
  const [t, setT] = useState(1.6);
  useEffect(() => {
    if (!active || reduced) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - last > 40) {
        last = now;
        setT((now - start) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);
  return t;
}

function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(Boolean(e?.isIntersecting)), { rootMargin: "60px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

/** Instante de una muestra en el bucle (con una pausa corta al final); quieta en un momento de lectura si hay que reducir movimiento. */
function demoTime(kind: FxKind, clock: number, reduced: boolean): number {
  const d = demoDuration(kind);
  if (reduced) return kind === "zoom_cut" ? d * 0.2 : d * 0.72;
  return Math.min(d, clock % (d + 0.5));
}

/** Muestra animada de un efecto (la persona de muestra con su recorte). */
export function FxSample({ kind, brand, clock, reduced, label }: { kind: FxKind; brand: FxBrand; clock: number; reduced: boolean; label?: string }) {
  const images = useImages({ frame: FX_DEMO.frame, mask: FX_DEMO.mask });
  const spec = useMemo(() => demoSpec(kind, brand), [kind, brand]);
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-[#1a1f2e]">
      <FxDemoCanvas spec={spec} time={demoTime(kind, clock, reduced)} frame={images.frame} mask={images.mask} reducedMotion={reduced} label={label} />
    </div>
  );
}

function Badges({ kind }: { kind: FxKind }) {
  const info = FX_INFO[kind];
  return (
    <span className="flex flex-wrap gap-1">
      {info.mask && (
        <span className="pill !gap-1 !px-2 !py-0.5 text-[10px]">
          <UserRound className="h-3 w-3" aria-hidden /> Te recorta
        </span>
      )}
      {info.thumbs && (
        <span className="pill !gap-1 !px-2 !py-0.5 text-[10px]">
          <Layers className="h-3 w-3" aria-hidden /> Tus reels
        </span>
      )}
      {kind === "zoom_cut" && (
        <span className="pill !gap-1 !px-2 !py-0.5 text-[10px]">
          <Scissors className="h-3 w-3" aria-hidden /> Transición
        </span>
      )}
    </span>
  );
}

/**
 * Galería de los 17 efectos: muestras en bucle (como las de subtítulos). Con un tramo elegido, tocar uno lo agrega ahí;
 * sin tramo, sirve para conocerlos.
 */
export function FxGallery({ open, onClose, brand, onPick, rangeText, current }: { open: boolean; onClose: () => void; brand: FxBrand; onPick: ((kind: FxKind) => void) | null; rangeText: string | null; current?: FxKind | null }) {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const clock = useLoop(open && inView, reduced);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={onPick ? (current ? "Cambiar el efecto" : "Elige un efecto") : "Efectos de firma"}
      description={
        rangeText ? (
          <>
            Va sobre <span className="font-semibold text-white">“{rangeText}”</span>. Después puedes cambiar sus textos.
          </>
        ) : (
          "Selecciona unas palabras en la transcripción y toca «Poner un efecto aquí» para usar uno."
        )
      }
      className="max-w-5xl"
    >
      <div ref={ref} role={onPick ? "listbox" : "list"} aria-label="Efectos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {FX_GALLERY_ORDER.map((kind) => {
          const info = FX_INFO[kind];
          const body = (
            <>
              <FxSample kind={kind} brand={brand} clock={clock} reduced={reduced} />
              <span className="flex flex-col gap-1 px-1 pb-1">
                <span className="text-sm font-semibold text-white">{info.label}</span>
                <span className="line-clamp-3 text-xs text-muted">{info.description}</span>
                <Badges kind={kind} />
              </span>
            </>
          );
          return onPick ? (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={current === kind}
              onClick={() => onPick(kind)}
              className={cn("flex flex-col gap-2 rounded-2xl border p-2 text-left transition hover:border-white/30 focus-visible:outline-2 focus-visible:outline-accent-hi", current === kind ? "border-accent bg-accent/12" : "border-white/10")}
            >
              {body}
            </button>
          ) : (
            <div key={kind} role="listitem" className="flex flex-col gap-2 rounded-2xl border border-white/10 p-2">
              {body}
            </div>
          );
        })}
      </div>
      {reduced && <p className="mt-3 text-xs text-muted">Tienes activado «reducir movimiento»: las muestras se ven quietas.</p>}
    </Dialog>
  );
}

export type FxMaskStatus = { pending: boolean; failed: boolean; missing: Set<string> };

/** Lista de efectos de la revisión: cada uno con su muestra, el texto que acompaña, su tiempo y sus acciones. */
export function FxPanel({
  items,
  segments,
  words,
  corrections,
  canEdit,
  activeId,
  brand,
  maskStatus,
  noThumbs,
  onActivate,
  onEdit,
  onRemove,
  onGallery,
}: {
  items: FxItem[];
  segments: FxSegment[];
  words: Word[];
  corrections: Record<string, string>;
  canEdit: boolean;
  activeId: string | null;
  brand: FxBrand;
  maskStatus: FxMaskStatus;
  /** No hay miniaturas de tus reels en Métricas: los efectos que las usan van con tarjetas de tu marca. */
  noThumbs: boolean;
  onActivate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onGallery: () => void;
}) {
  const usesThumbs = items.some((i) => FX_INFO[i.kind].thumbs);
  return (
    <section aria-labelledby="fx-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="fx-title" className="text-base font-semibold">
            Efectos
          </h2>
          <p className="text-sm text-muted">Efectos de firma sobre lo que dices: portada de revista, zoom digital, checklist y 14 más. Se dibujan con tu marca.</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />} onClick={onGallery}>
          Ver los 17
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          Este video no tiene efectos. Selecciona unas palabras en la transcripción y toca <span className="font-semibold text-white">Poner un efecto aquí</span>.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const info = FX_INFO[item.kind];
            const seg = segments.find((s) => s.id === item.id);
            const text = words.slice(item.from_word, item.to_word + 1).map((w) => corrections[String(w.id)] ?? w.text).join(" ");
            const waiting = info.mask && maskStatus.missing.has(item.id);
            return (
              <li key={item.id}>
                <div className={cn("card flex h-full gap-3 p-3 transition", activeId === item.id && "!border-accent bg-accent/10")}>
                  <button type="button" onClick={() => onActivate(item.id)} className="relative w-14 flex-none self-start overflow-hidden rounded-lg" aria-label={`Ver «${info.label}» en la vista previa`}>
                    <FxSample kind={item.kind} brand={brand} clock={0} reduced />
                    <span className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition hover:opacity-100">
                      <Play className="h-4 w-4 text-white" aria-hidden />
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                      {info.label}
                      {item.source === "director" && <span className="pill !px-1.5 !py-0 text-[10px]">Director</span>}
                    </p>
                    <p className="line-clamp-2 text-xs text-text/90">“{text}”</p>
                    <p className="font-mono text-[11px] text-muted">{seg ? `${formatDuration(seg.start)}–${formatDuration(seg.end)}` : "Cae sobre palabras cortadas"}</p>
                    {waiting && (
                      <p className="flex items-center gap-1 text-xs text-accent-glow" aria-live="polite">
                        {maskStatus.pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <UserRound className="h-3 w-3" aria-hidden />}
                        {maskStatus.pending
                          ? "Recortándote del fondo para la vista previa…"
                          : maskStatus.failed
                            ? "No pudimos recortarte para la vista previa. Al renderizar se vuelve a intentar."
                            : "La vista previa todavía no tiene tu recorte."}
                      </p>
                    )}
                    {item.why && (
                      <p className="line-clamp-2 text-xs text-text/80">
                        <span className="font-semibold text-accent-glow">Por qué: </span>
                        {item.why}
                      </p>
                    )}
                    {canEdit && (
                      <div className="mt-auto flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="ghost" className="!h-8 !px-2.5" icon={<PenLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => onEdit(item.id)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="subtle" className="!h-8 !w-8 !px-0" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => onRemove(item.id)} aria-label={`Quitar «${info.label}»`} title="Quitar este efecto" />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {usesThumbs && noThumbs && <p className="text-xs text-muted">No encontramos miniaturas de tus reels en Métricas: «Giro 3D», «Pared de capturas» y «Ventana de tu app» usan tarjetas con tu marca. Conecta Instagram o TikTok para que salgan tus reels.</p>}
    </section>
  );
}

/** Edición de un efecto: sus textos (según su ficha), las palabras fuertes del zoom digital, cambiar de efecto o quitarlo. */
export function FxEditor({
  item,
  words,
  corrections,
  onChange,
  onClose,
  onReplace,
  onRemove,
  maskNote,
}: {
  item: FxItem | null;
  words: Word[];
  corrections: Record<string, string>;
  onChange: (next: FxItem) => void;
  onClose: () => void;
  onReplace: () => void;
  onRemove: () => void;
  maskNote: string | null;
}) {
  if (!item) return null;
  const info = FX_INFO[item.kind];
  const range = words.slice(item.from_word, item.to_word + 1);
  const strong = new Set(item.words ?? []);
  const items = [...(item.items ?? [])];
  while (info.items && items.length < info.items.count) items.push("");
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={info.label}
      description={info.description}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button variant="subtle" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={onRemove}>
            Quitar
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" icon={<Wand2 className="h-4 w-4" aria-hidden />} onClick={onReplace}>
              Cambiar de efecto
            </Button>
            <Button onClick={onClose}>Listo</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm text-text/90">
          Sobre: “{range.map((w) => corrections[String(w.id)] ?? w.text).join(" ")}”
        </p>
        {info.text && (
          <Field label={info.text.label} htmlFor="fx-text" hint={`Hasta ${info.text.max} caracteres.`}>
            <Input id="fx-text" value={item.text ?? ""} maxLength={info.text.max} placeholder={info.text.placeholder} onChange={(e) => onChange({ ...item, text: e.target.value })} />
          </Field>
        )}
        {info.kicker && (
          <Field label={info.kicker.label} htmlFor="fx-kicker" hint={`Hasta ${info.kicker.max} caracteres.`}>
            <Input id="fx-kicker" value={item.kicker ?? ""} maxLength={info.kicker.max} placeholder={info.kicker.placeholder} onChange={(e) => onChange({ ...item, kicker: e.target.value })} />
          </Field>
        )}
        {info.items && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-white">{info.items.label}</legend>
            {items.slice(0, info.items.count).map((value, i) => (
              <Input
                key={i}
                value={value}
                maxLength={info.items!.max}
                placeholder={info.items!.placeholder}
                aria-label={`${info.items!.label} ${i + 1}`}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange({ ...item, items: next });
                }}
              />
            ))}
            {item.kind === "checklist" && <p className="text-xs text-muted">Cada tarea se tilda cuando la dices (si no la encontramos en lo que dices, se reparten en el tramo).</p>}
          </fieldset>
        )}
        {item.kind === "digital_zoom" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-white">Palabras fuertes (hasta 5)</legend>
            <p className="text-xs text-muted">En la primera palabra fuerte de una frase, corte seco a 1,3×; en la segunda, a 1,6×; al terminar la frase, de vuelta a 1×.</p>
            <div className="flex flex-wrap gap-1.5">
              {range.map((w) => {
                const on = strong.has(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = new Set(strong);
                      if (on) next.delete(w.id);
                      else if (next.size < 5) next.add(w.id);
                      onChange({ ...item, words: [...next].sort((a, b) => a - b) });
                    }}
                    className={cn("rounded-lg border px-2 py-1 text-sm transition", on ? "border-accent bg-accent/20 text-white" : "border-white/10 text-text hover:border-white/30")}
                  >
                    {corrections[String(w.id)] ?? w.text}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <p className="text-xs text-muted">Colores y tipografías de Mi marca{info.text || info.items ? " (los titulares en Instrument Serif)" : ""}. {info.when}</p>
        {maskNote && (
          <p className="flex items-start gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent-glow">
            <UserRound className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden /> {maskNote}
          </p>
        )}
      </div>
    </Sheet>
  );
}

