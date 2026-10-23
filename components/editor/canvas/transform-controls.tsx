"use client";

import { useEffect, useState } from "react";
import { Move, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/tabs";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { cn } from "@/lib/utils";
import { ANIM_KINDS, ANIM_LABELS, ANIM_LIMITS, animState, DEFAULT_ANIM, IDENTITY_TRANSFORM, TRANSFORM_LIMITS, type Anim, type AnimKind, type Transform } from "@/lib/video/canvas/transform";
import { clampTransform } from "./transform-overlay";

/**
 * Controles del inspector para lo que está elegido en el lienzo: posición, tamaño, rotación (si gira) y la animación de
 * entrada y salida con su duración, con una muestra de cada animación. "Restablecer" vuelve al lugar y la animación de
 * siempre. Independiente del plan: recibe valores y avisa cambios.
 */

export type ControlsTarget = {
  id: string;
  kind: "graphic" | "effect" | "caption";
  label: string;
  transform: Transform;
  rotatable: boolean;
  /** Animación propia (null = la de siempre). Sin `animatable`, no se muestra (subtítulos: la decide el estilo). */
  anim: Anim | null;
  animatable: boolean;
  /** Cómo es la entrada "de siempre" de este elemento (para el texto del botón). */
  defaultAnimLabel?: string;
};

export function TransformControls({
  target,
  onTransform,
  onAnim,
  onReset,
  scope,
  onScope,
  className,
}: {
  target: ControlsTarget;
  onTransform: (next: Transform) => void;
  onAnim?: (next: Anim | null) => void;
  onReset: () => void;
  /** Subtítulos: mover todos o solo esta línea. */
  scope?: "all" | "line";
  onScope?: (scope: "all" | "line") => void;
  className?: string;
}) {
  const t = target.transform;
  const set = (patch: Partial<Transform>) => onTransform(clampTransform({ ...t, ...patch }, target.rotatable));
  const anim = target.anim;
  const L = TRANSFORM_LIMITS;
  const touched = t.x !== 0 || t.y !== 0 || t.scale !== 1 || Boolean(t.rotation) || Boolean(anim);
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border border-line bg-white/[0.03] p-4", className)} aria-label={`Lugar y animación: ${target.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <Move className="h-3.5 w-3.5" aria-hidden /> Lugar y animación
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{target.label}</p>
        </div>
        <Button size="sm" variant="ghost" className="!h-8 shrink-0 !px-2.5" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />} onClick={onReset} disabled={!touched}>
          Restablecer
        </Button>
      </div>

      {target.kind === "caption" && onScope && (
        <SegmentedControl
          label="Qué subtítulos mover"
          size="sm"
          value={scope ?? "all"}
          onValueChange={onScope}
          options={[
            { value: "all", label: "Todos los subtítulos" },
            { value: "line", label: "Solo esta línea" },
          ]}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="Horizontal" value={t.x} min={-L.offset} max={L.offset} step={0.005} text={pct(t.x)} onChange={(x) => set({ x })} />
        <Slider label="Vertical" value={t.y} min={-L.offset} max={L.offset} step={0.005} text={pct(t.y)} onChange={(y) => set({ y })} />
        <Slider label="Tamaño" value={t.scale} min={L.scaleMin} max={L.scaleMax} step={0.01} text={`${Math.round(t.scale * 100)} %`} onChange={(scale) => set({ scale })} reset={1} />
        {target.rotatable && <Slider label="Rotación" value={t.rotation ?? 0} min={-L.rotation} max={L.rotation} step={1} text={`${Math.round(t.rotation ?? 0)}°`} onChange={(rotation) => set({ rotation })} reset={0} />}
      </div>

      {target.animatable && onAnim ? (
        <AnimPicker anim={anim} defaultLabel={target.defaultAnimLabel} onAnim={onAnim} />
      ) : (
        <p className="text-xs text-muted">Las palabras entran como dice el estilo de subtítulos que elegiste.</p>
      )}
      <p className="text-[11px] text-muted">En la vista previa: arrastra para mover, las esquinas cambian el tamaño y doble clic edita el texto. Alt suelta el imán.</p>
    </section>
  );
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;

function Slider({ label, value, min, max, step, onChange, text, reset = 0 }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; text: string; reset?: number }) {
  const id = `tc-${label.toLowerCase()}`;
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
        onDoubleClick={() => onChange(reset)}
        style={{ ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }}
        aria-valuetext={text}
      />
    </div>
  );
}

/** Entrada y salida: una muestra por animación y la duración de cada una. */
function AnimPicker({ anim, defaultLabel, onAnim }: { anim: Anim | null; defaultLabel?: string; onAnim: (next: Anim | null) => void }) {
  const current = anim ?? DEFAULT_ANIM;
  const set = (patch: Partial<Anim>) => onAnim({ ...current, ...patch });
  return (
    <div className="flex flex-col gap-3">
      {(["in", "out"] as const).map((side) => (
        <fieldset key={side} className="flex flex-col gap-2">
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-white">
            {side === "in" ? "Entrada" : "Salida"}
            {!anim && defaultLabel && side === "in" && <span className="text-[11px] font-normal text-muted">Ahora: {defaultLabel}</span>}
          </legend>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={side === "in" ? "Cómo entra" : "Cómo sale"}>
            {ANIM_KINDS.map((kind) => {
              const on = Boolean(anim) && current[side] === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={ANIM_LABELS[kind].hint}
                  onClick={() => set({ [side]: kind } as Partial<Anim>)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[11px] font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi",
                    on ? "border-accent-hi bg-accent/15 text-white" : "border-white/10 text-muted hover:border-white/25 hover:text-white",
                  )}
                >
                  <AnimSample kind={kind} side={side} />
                  <span className="text-center leading-tight">{ANIM_LABELS[kind].label}</span>
                </button>
              );
            })}
          </div>
          {anim && current[side] !== "ninguna" && (
            <DurationSlider side={side} value={side === "in" ? current.inDur : current.outDur} onChange={(v) => set(side === "in" ? { inDur: v } : { outDur: v })} />
          )}
        </fieldset>
      ))}
      {anim && (
        <button type="button" className="self-start text-xs font-semibold text-accent-hi hover:underline" onClick={() => onAnim(null)}>
          Volver a la animación de siempre
        </button>
      )}
    </div>
  );
}

function DurationSlider({ side, value, onChange }: { side: "in" | "out"; value: number; onChange: (v: number) => void }) {
  const id = `tc-dur-${side}`;
  const min = 0.1;
  const max = 1.5;
  const text = `${value.toFixed(2).replace(".", ",")} s`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-16 shrink-0 text-xs text-muted">
        Duración
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={0.05}
        value={Math.max(min, Math.min(max, value))}
        onChange={(e) => onChange(Math.max(ANIM_LIMITS.min, Math.min(ANIM_LIMITS.max, Number(e.target.value))))}
        style={{ ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }}
        aria-valuetext={text}
      />
      <span className="w-12 shrink-0 text-right font-mono text-xs text-muted tabular-nums">{text}</span>
    </div>
  );
}

/**
 * Muestra en bucle de una animación sobre una tarjetita (las mismas cuentas que el motor: `animState`). Con "reducir
 * movimiento", quieta a mitad de la animación.
 */
function AnimSample({ kind, side }: { kind: AnimKind; side: "in" | "out" }) {
  const reduced = usePrefersReducedMotion();
  const [t, setT] = useState(0.35);
  const dur = 1.6;
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(((now - start) / 1000) % (dur + 0.5));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  const anim: Anim = { in: side === "in" ? kind : "ninguna", out: side === "out" ? kind : "ninguna", inDur: 0.5, outDur: 0.5 };
  const time = reduced ? (side === "in" ? 0.15 : dur - 0.15) : side === "in" ? Math.min(t, dur) : Math.min(dur, t + 0.4);
  const st = time >= dur ? null : animState(anim, time, dur);
  const style = st
    ? { opacity: st.alpha, transform: `translate(${st.dx * 220}%, ${st.dy * 320}%) scale(${st.scale})`, clipPath: st.reveal < 1 ? `inset(0 ${(1 - st.reveal) * 100}% 0 0)` : undefined }
    : { opacity: 0 };
  return (
    <span aria-hidden className="relative block h-8 w-12 overflow-hidden rounded-md bg-black/40">
      <span className="absolute inset-x-2 top-2 flex flex-col gap-1" style={style}>
        <span className="h-1.5 w-full rounded-full bg-accent-hi" />
        <span className="h-1.5 w-2/3 rounded-full bg-white/70" />
      </span>
    </span>
  );
}

export { IDENTITY_TRANSFORM };
