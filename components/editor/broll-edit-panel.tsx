"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Move, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";
import {
  CARD_POSITIONS,
  DEFAULT_EDIT,
  LAYOUT_LABELS,
  layoutsFor,
  LOOK_PRESETS,
  lookMatrix,
  matchingPreset,
  presetLook,
  svgMatrixValues,
  TRANSITION_LABELS,
  TRANSITIONS,
  type BrollEdit,
  type BrollLayout,
  type CardPosition,
} from "@/lib/video/broll-edit";
import type { VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { BrollLayer, personStyle, type BrollMedia } from "./broll-layer";
import { brollAlpha, brollGeometry, clipAspectOf, graphicSideGeometry } from "@/lib/video/broll-edit";
import type { BrollGraphic } from "@/lib/video/motion-graphics";
import { GraphicCanvas } from "./graphic-canvas";

type Group = "ubicacion" | "encuadre" | "look" | "tiempo";

/**
 * "Editar b-roll": ubicación, encuadre, look y tiempo de una toma, con vista previa en vivo (arrastrar sobre el clip
 * corre el encuadre). Los cambios se aplican al momento (y se guardan solos, como el resto de la revisión).
 * En un gráfico solo se edita el tiempo: su ubicación se elige en "Pide tu gráfico".
 */
type BrollEditProps = {
  edit: BrollEdit;
  onChange: (edit: BrollEdit) => void;
  /** Copia el look de esta toma a todos los b-roll de video. */
  onApplyLookToAll: () => void;
  /** Cuántos otros b-roll de video hay (para el botón de "aplicar a todos"). */
  otherVideos: number;
  format: VideoFormat;
  media: BrollMedia;
  /** Cuadro de tu video (la persona) para la vista previa. */
  poster: string | null;
  accent: string;
  ground: string;
  focusY: number;
  /** Tramo actual en el video final (con la entrada y la salida ya corridas). */
  span: { start: number; end: number } | null;
  clipDuration: number;
  isGraphic: boolean;
  /** El gráfico del tramo (se dibuja en la vista previa del panel). */
  graphic?: BrollGraphic | null;
  /** Cómo entra tu video en el cuadro: recortado (con el encuadre horizontal de la revisión) o entero con fondo desenfocado. */
  posterFit?: "cover" | "contain";
  posterX?: number;
  title: string;
};

export function BrollEditPanel(props: BrollEditProps & { open: boolean; onClose: () => void }) {
  const { open, onClose, edit, onChange, isGraphic, title } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isGraphic ? "Tiempo del gráfico" : "Editar b-roll"}
      description={isGraphic ? `“${title}”. Cuándo entra, cuándo sale y cómo aparece.` : `“${title}”. Dónde va, qué parte del clip se ve y con qué color. Los cambios se guardan solos.`}
      className="max-w-4xl"
      footer={
        <>
          <Button variant="subtle" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => onChange(DEFAULT_EDIT)}>
            Restablecer
          </Button>
          <Button icon={<Check className="h-4 w-4" aria-hidden />} onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      {open && <BrollEditBody {...props} edit={edit} />}
    </Dialog>
  );
}

/**
 * Los controles de "Editar b-roll" sin la ventana: en el diálogo (vista previa a la izquierda) o en el inspector del
 * Estudio (`inline`: una columna, la vista previa chica arriba y "Restablecer" al pie).
 */
export function BrollEditBody({
  edit,
  onChange,
  onApplyLookToAll,
  otherVideos,
  format,
  media,
  poster,
  accent,
  ground,
  focusY,
  span,
  clipDuration,
  isGraphic,
  graphic = null,
  posterFit = "cover",
  posterX = 0,
  inline = false,
}: BrollEditProps & { inline?: boolean }) {
  // El cuadro de la vista previa se mide al montarse (en el diálogo, al abrirse).
  const open = true;
  const [group, setGroup] = useState<Group>(isGraphic ? "tiempo" : "ubicacion");
  const [replay, setReplay] = useState<number | null>(null);
  // "Ver la entrada": 1,2 s de un clip; un gráfico se ve entero (con su salida).
  const replayLength = isGraphic ? Math.min(8, span ? span.end - span.start : 3) : 1.2;
  const frame = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(0);
  const H = format === "9:16" ? 1920 : 1080;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setFrameH(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Reproduce la entrada cuadro a cuadro.
  useEffect(() => {
    if (replay == null) return;
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > replayLength) return setReplay(null);
      setReplay(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay == null]);

  const set = (patch: Partial<BrollEdit>) => onChange({ ...edit, ...patch });
  const setLook = (patch: Partial<BrollEdit["look"]>) => onChange({ ...edit, look: { ...edit.look, ...patch } });
  const setFrame = (patch: Partial<BrollEdit["frame"]>) => onChange({ ...edit, frame: { ...edit.frame, ...patch } });
  const person = isGraphic
    ? graphicSideGeometry(format, graphic?.mode, (graphic as { position?: string } | null)?.position)
    : brollGeometry(edit, format, clipAspectOf(media.width, media.height), focusY).person;
  const preset = matchingPreset(edit.look);
  const duration = span ? span.end - span.start : 3;
  const layouts = layoutsFor(format);
  const layout: BrollLayout = format === "9:16" && edit.layout === "side" ? "split" : edit.layout;

  const groups: { value: Group; label: string }[] = isGraphic
    ? [{ value: "tiempo", label: "Tiempo" }]
    : [
        { value: "ubicacion", label: "Ubicación" },
        { value: "encuadre", label: "Encuadre" },
        { value: "look", label: "Look" },
        { value: "tiempo", label: "Tiempo" },
      ];

  return (
      <div className={cn("grid gap-5", !inline && "md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]")}>
        {/* En el teléfono la vista previa queda fija arriba mientras se mueven los controles. */}
        <div className={cn(inline ? "flex flex-col gap-2" : "sticky -top-5 z-10 -mx-6 -mt-5 flex flex-col gap-2 border-b border-white/10 bg-[#06143a] px-6 pt-4 pb-3 md:top-0 md:m-0 md:self-start md:border-0 md:bg-transparent md:p-0")}>
          <div
            ref={frame}
            className={cn("relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-black", format === "9:16" ? (inline ? "aspect-[9/16] max-w-[140px]" : "aspect-[9/16] max-w-[130px] md:max-w-none") : inline ? "aspect-video max-w-[260px]" : "aspect-video max-w-[300px] md:max-w-none")}
          >
            {person && <div aria-hidden className="absolute inset-0" style={{ background: ground }} />}
            {poster && (
              <div className="absolute inset-0 overflow-hidden" style={personStyle(person, format)}>
                {posterFit === "contain" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" draggable={false} />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={poster}
                  alt=""
                  className={cn("absolute inset-0 h-full w-full", posterFit === "contain" ? "object-contain" : "object-cover")}
                  style={posterFit === "cover" ? { objectPosition: `${50 + posterX * 50}% 50%` } : undefined}
                  draggable={false}
                />
              </div>
            )}
            {isGraphic && graphic && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ opacity: replay != null ? brollAlpha({ transition: edit.transition === "cut" ? "cut" : "fade" }, replay, duration) : 1 }}
              >
                <GraphicCanvas spec={graphic} format={format} duration={duration} time={replay != null ? Math.min(replay, duration) : Math.min(duration * 0.75, duration - 0.3)} scale={0.35} />
              </div>
            )}
            {!isGraphic && (
              <BrollLayer
                edit={edit}
                format={format}
                media={media}
                accent={accent}
                time={replay ?? 99}
                duration={replay != null ? 99 : 999}
                fades={replay != null}
                pxScale={frameH / H}
                loop
                onFrameDrag={(f) => setFrame(f)}
              />
            )}
          </div>
          {!isGraphic && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
              <Move className="h-3 w-3" aria-hidden /> Arrastra el clip para elegir qué parte se ve.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {groups.length > 1 && <SegmentedControl label="Qué editar" size="sm" className="max-w-full self-start overflow-x-auto" value={group} onValueChange={setGroup} options={groups} />}

          {group === "ubicacion" && (
            <div className="flex flex-col gap-4">
              <div role="radiogroup" aria-label="Ubicación del clip" className={cn("grid gap-2", layouts.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
                {layouts.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={layout === l}
                    onClick={() => set({ layout: l })}
                    className={cn("flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center transition", layout === l ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}
                  >
                    <LayoutIcon layout={l} format={format} />
                    <span className="text-xs font-semibold text-white">{LAYOUT_LABELS[l].label}</span>
                  </button>
                ))}
              </div>
              <p className="-mt-2 text-xs text-muted">{LAYOUT_LABELS[layout].hint}</p>

              {layout === "split" && (
                <>
                  <Row label="El clip va">
                    <SegmentedControl
                      label="Dónde va el clip"
                      size="sm"
                      value={edit.split_clip}
                      onValueChange={(v) => set({ split_clip: v, layout: "split" })}
                      options={[
                        { value: "top", label: "Arriba" },
                        { value: "bottom", label: "Abajo" },
                      ]}
                    />
                  </Row>
                  <Slider label="Alto del clip" value={edit.split_ratio} min={0.3} max={0.7} step={0.05} onChange={(v) => set({ split_ratio: v })} text={`${Math.round(edit.split_ratio * 100)} %`} />
                </>
              )}
              {layout === "side" && (
                <>
                  <Row label="El clip va">
                    <SegmentedControl
                      label="De qué lado va el clip"
                      size="sm"
                      value={edit.side_clip}
                      onValueChange={(v) => set({ side_clip: v })}
                      options={[
                        { value: "left", label: "Izquierda" },
                        { value: "right", label: "Derecha" },
                      ]}
                    />
                  </Row>
                  <Slider label="Ancho del clip" value={edit.split_ratio} min={0.3} max={0.7} step={0.05} onChange={(v) => set({ split_ratio: v })} text={`${Math.round(edit.split_ratio * 100)} %`} />
                </>
              )}
              {layout === "card" && (
                <>
                  <Row label="Posición">
                    <div role="radiogroup" aria-label="Posición de la tarjeta" className="grid w-[132px] grid-cols-3 gap-1.5">
                      {(["top-left", "top-center", "top-right", "bottom-left", null, "bottom-right"] as (CardPosition | null)[]).map((p, i) =>
                        p ? (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={edit.card_position === p}
                            aria-label={CARD_LABELS[p]}
                            title={CARD_LABELS[p]}
                            onClick={() => set({ card_position: p })}
                            className={cn("grid h-9 place-items-center rounded-lg border transition", edit.card_position === p ? "border-accent bg-accent/25" : "border-white/10 hover:border-white/25")}
                          >
                            <span className={cn("h-2.5 w-3.5 rounded-[3px]", edit.card_position === p ? "bg-accent-hi" : "bg-white/30")} />
                          </button>
                        ) : (
                          <span key={`gap-${i}`} aria-hidden />
                        ),
                      )}
                    </div>
                  </Row>
                  <Slider label="Tamaño" value={edit.card_size} min={0.3} max={0.85} step={0.05} onChange={(v) => set({ card_size: v })} text={`${Math.round(edit.card_size * 100)} %`} />
                  <Row label="Forma">
                    <SegmentedControl
                      label="Forma de la tarjeta"
                      size="sm"
                      className="max-w-full overflow-x-auto"
                      value={edit.card_shape}
                      onValueChange={(v) => set({ card_shape: v })}
                      options={[
                        { value: "auto", label: "Como el clip" },
                        { value: "horizontal", label: "16:9" },
                        { value: "square", label: "1:1" },
                        { value: "vertical", label: "4:5" },
                      ]}
                    />
                  </Row>
                </>
              )}
            </div>
          )}

          {group === "encuadre" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">Si el clip se corta donde no quieres, muévelo o acércalo. También puedes arrastrarlo en la vista previa.</p>
              <Slider label="Horizontal" value={edit.frame.x} min={-1} max={1} step={0.05} onChange={(v) => setFrame({ x: v })} text={edit.frame.x === 0 ? "Centro" : edit.frame.x < 0 ? "Izquierda" : "Derecha"} />
              <Slider label="Vertical" value={edit.frame.y} min={-1} max={1} step={0.05} onChange={(v) => setFrame({ y: v })} text={edit.frame.y === 0 ? "Centro" : edit.frame.y < 0 ? "Arriba" : "Abajo"} />
              <Slider label="Zoom" value={edit.frame.zoom} min={1} max={2.5} step={0.05} onChange={(v) => setFrame({ zoom: v })} text={`${edit.frame.zoom.toFixed(2).replace(".", ",")}×`} />
              <Button size="sm" variant="ghost" className="self-start" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => setFrame(DEFAULT_EDIT.frame)} disabled={JSON.stringify(edit.frame) === JSON.stringify(DEFAULT_EDIT.frame)}>
                Centrar
              </Button>
            </div>
          )}

          {group === "look" && (
            <div className="flex flex-col gap-4">
              <div role="radiogroup" aria-label="Look del clip" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {LOOK_PRESETS.map((p) => {
                  const look = presetLook(p.id);
                  const m = lookMatrix(look, accent);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={preset === p.id}
                      onClick={() => setLook({ ...look, opacity: edit.look.opacity })}
                      className={cn("flex flex-col gap-1.5 rounded-xl border p-1.5 text-center transition", preset === p.id ? "border-accent bg-accent/12" : "border-white/10 hover:border-white/25")}
                    >
                      <span className="relative block aspect-square w-full overflow-hidden rounded-lg bg-black/40">
                        {m && (
                          <svg aria-hidden width="0" height="0" className="absolute">
                            <filter id={`preset-${p.id}`} colorInterpolationFilters="sRGB">
                              <feColorMatrix type="matrix" values={svgMatrixValues(m)} />
                            </filter>
                          </svg>
                        )}
                        {media.thumbUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={media.thumbUrl} alt="" className="h-full w-full object-cover" style={{ filter: m ? `url(#preset-${p.id})` : undefined }} />
                        )}
                      </span>
                      <span className="text-[11px] font-semibold text-white">{p.label}</span>
                    </button>
                  );
                })}
              </div>
              {edit.look.filter !== "none" && (
                <Slider label="Intensidad" value={edit.look.strength} min={0} max={1} step={0.05} onChange={(v) => setLook({ strength: v })} text={`${Math.round(edit.look.strength * 100)} %`} />
              )}
              <Slider label="Opacidad" value={edit.look.opacity} min={0.2} max={1} step={0.05} onChange={(v) => setLook({ opacity: v })} text={`${Math.round(edit.look.opacity * 100)} %`} />
              <Slider label="Brillo" value={edit.look.brightness} min={-0.3} max={0.3} step={0.02} onChange={(v) => setLook({ brightness: v })} text={signed(edit.look.brightness / 0.3)} />
              <Slider label="Contraste" value={edit.look.contrast} min={-0.5} max={0.5} step={0.02} onChange={(v) => setLook({ contrast: v })} text={signed(edit.look.contrast / 0.5)} />
              <Slider label="Saturación" value={edit.look.saturation} min={-1} max={1} step={0.05} onChange={(v) => setLook({ saturation: v })} text={signed(edit.look.saturation)} />
              <div className="flex flex-col gap-1.5 border-t border-white/10 pt-4">
                <Button size="sm" variant="ghost" className="self-start" icon={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={onApplyLookToAll} disabled={otherVideos === 0}>
                  Aplicar este look a todos los b-roll
                </Button>
                <p className="text-xs text-muted">{otherVideos === 0 ? "No hay otros clips de video en este proyecto." : "Así todos los clips se ven de la misma familia. Los gráficos ya usan los colores de tu marca."}</p>
              </div>
            </div>
          )}

          {group === "tiempo" && (
            <div className="flex flex-col gap-4">
              <p className="font-mono text-xs text-muted">{span ? `Se ve de ${formatDuration(span.start)} a ${formatDuration(span.end)} (${duration.toFixed(1).replace(".", ",")} s)` : "Este tramo cae sobre palabras cortadas."}</p>
              <Slider label="Entra" value={edit.start_delta} min={-3} max={3} step={0.1} onChange={(v) => set({ start_delta: v })} text={secs(edit.start_delta, "antes", "después")} />
              <Slider label="Sale" value={edit.end_delta} min={-3} max={3} step={0.1} onChange={(v) => set({ end_delta: v })} text={secs(edit.end_delta, "antes", "después")} />
              {!isGraphic && clipDuration > duration + 0.2 && (
                <Slider
                  label="Parte del clip"
                  value={Math.min(edit.clip_start, Math.max(0, clipDuration - duration))}
                  min={0}
                  max={Math.max(0.1, Math.floor((clipDuration - duration) * 10) / 10)}
                  step={0.1}
                  onChange={(v) => set({ clip_start: v })}
                  text={`desde ${formatDuration(edit.clip_start)}`}
                />
              )}
              <Row label="Transición">
                <SegmentedControl
                  label="Transición de entrada y salida"
                  size="sm"
                  className="max-w-full overflow-x-auto"
                  value={isGraphic && edit.transition === "zoom" ? "fade" : edit.transition}
                  onValueChange={(v) => {
                    set({ transition: v });
                    setReplay(0);
                  }}
                  options={TRANSITIONS.filter((t) => !isGraphic || t !== "zoom").map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))}
                />
              </Row>
              <Button size="sm" variant="ghost" className="self-start" icon={<Play className="h-3.5 w-3.5" aria-hidden />} onClick={() => setReplay(0)}>
                {isGraphic ? "Ver el gráfico" : "Ver la entrada"}
              </Button>
            </div>
          )}
          {inline && (
            <Button size="sm" variant="subtle" className="self-start" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={() => onChange(DEFAULT_EDIT)}>
              Restablecer este b-roll
            </Button>
          )}
        </div>
      </div>
  );
}

const CARD_LABELS: Record<CardPosition, string> = {
  "top-left": "Arriba a la izquierda",
  "top-center": "Arriba al centro",
  "top-right": "Arriba a la derecha",
  "bottom-left": "Abajo a la izquierda",
  "bottom-right": "Abajo a la derecha",
};
void CARD_POSITIONS;

const signed = (n: number) => (Math.abs(n) < 0.005 ? "Normal" : `${n > 0 ? "+" : "−"}${Math.round(Math.abs(n) * 100)}`);
const secs = (n: number, before: string, after: string) => (Math.abs(n) < 0.05 ? "Con la palabra" : `${Math.abs(n).toFixed(1).replace(".", ",")} s ${n < 0 ? before : after}`);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-semibold text-white">{label}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, text }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; text: string }) {
  const id = `s-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
        {label}
        <span className="font-mono text-xs font-medium text-muted tabular-nums">{text}</span>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(min < 0 && max > 0 ? 0 : value)}
        style={{ ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }}
        aria-valuetext={text}
      />
    </div>
  );
}

/** Dibujito de cada ubicación (el clip en azul, la persona en gris). */
function LayoutIcon({ layout, format }: { layout: BrollLayout; format: VideoFormat }) {
  const v = format === "9:16";
  const clip = "rounded-[3px] bg-accent-hi/80";
  return (
    <span className={cn("relative block overflow-hidden rounded-md border border-white/20 bg-white/10", v ? "h-14 w-8" : "h-9 w-16")} aria-hidden>
      <span className="absolute bottom-0 left-1/2 h-[45%] w-[45%] -translate-x-1/2 rounded-t-full bg-white/35" />
      {layout === "full" && <span className={cn("absolute inset-0", clip)} />}
      {layout === "split" && <span className={cn("absolute inset-x-0 top-0 h-1/2", clip)} />}
      {layout === "side" && <span className={cn("absolute inset-y-0 left-0 w-1/2", clip)} />}
      {layout === "card" && <span className={cn("absolute top-[10%] right-[8%] h-[26%] w-[55%] shadow-md", clip)} />}
    </span>
  );
}
