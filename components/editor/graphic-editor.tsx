"use client";

import { useId, useMemo, useState } from "react";
import { ArrowLeftRight, Check, Hash, Highlighter, ListOrdered, Plus, Quote, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import {
  GRAPHIC_LIMITS as L,
  GRAPHIC_MODES,
  GRAPHIC_TEMPLATE_KEYS,
  GRAPHIC_TEMPLATES,
  graphicSpecSchema,
  numbersSupported,
  switchTemplate,
  writtenNumbers,
  type GraphicSpec,
  type GraphicTemplate,
} from "@/lib/video/graphics";
import { formatNumber } from "@/lib/format";
import type { VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { GraphicCanvas } from "./graphic-canvas";

const ICONS: Record<GraphicTemplate, typeof Hash> = { number: Hash, list: ListOrdered, quote: Quote, keyword: Highlighter, compare: ArrowLeftRight, flow: Workflow };

/** Valida el gráfico con el mismo esquema que el servidor y devuelve el primer problema, en palabras simples. */
function problem(spec: GraphicSpec): string | null {
  const parsed = graphicSpecSchema.safeParse(spec);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  if (path.startsWith("items")) return "Cada punto necesita un texto (entre 2 y 4 puntos).";
  if (path.startsWith("steps")) return "Escribe los tres pasos.";
  if (path === "value") return "Escribe una cifra (por ejemplo x2, +40% o 10K).";
  if (path.startsWith("left") || path.startsWith("right")) return "Completa los dos lados de la comparación.";
  return "Completa el texto principal del gráfico.";
}

/**
 * Editor de un gráfico del b-roll: plantilla, modo (pantalla completa o sobre el video) y textos, con la vista
 * previa animada al lado. Los colores y la fuente salen de Mi marca.
 */
export function GraphicEditor({
  initial,
  format,
  duration,
  spokenText,
  onUse,
  current,
}: {
  initial: GraphicSpec;
  format: VideoFormat;
  /** Duración del tramo (la vista previa dura lo mismo que en el video). */
  duration: number;
  /** Lo que se dice en el tramo: para revisar que las cifras sean las que dijiste. */
  spokenText: string;
  onUse: (spec: GraphicSpec) => void;
  /** Es el gráfico que ya está elegido para el tramo. */
  current?: boolean;
}) {
  const [spec, setSpec] = useState<GraphicSpec>(initial);
  const id = useId();
  const error = problem(spec);
  const unsupported = useMemo(() => {
    if (numbersSupported(spec, spokenText)) return [];
    return writtenNumbers(spec);
  }, [spec, spokenText]);
  const preview = useMemo(() => (error ? null : (graphicSpecSchema.parse(spec) as GraphicSpec)), [spec, error]);
  const set = (patch: Partial<GraphicSpec>) => setSpec((prev) => ({ ...prev, ...patch }) as GraphicSpec);

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className={cn("relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-[#6d655c]", format === "9:16" ? "aspect-[9/16] max-w-[220px] sm:max-w-none" : "aspect-video")}>
          {spec.mode === "overlay" && (
            // Fondo neutro que simula tu video (el gráfico va encima con su velo).
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,#b9a48f_0%,#6d655c_38%,#2f2b27_100%)]" />
          )}
          {preview ? (
            <GraphicCanvas spec={preview} format={format} duration={duration} scale={0.4} className="relative" label={`Vista previa del gráfico: ${GRAPHIC_TEMPLATES[spec.template].label}`} />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-bg/80 p-4 text-center text-xs text-muted">Completa los textos para ver el gráfico.</div>
          )}
        </div>
        <p className="text-center text-[11px] text-muted">
          Dura {duration.toFixed(1).replace(".", ",")} s, como el tramo. Colores y fuente de <span className="text-text">Mi marca</span>.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-white">Plantilla</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Plantilla del gráfico">
            {GRAPHIC_TEMPLATE_KEYS.map((key) => {
              const Icon = ICONS[key];
              const active = spec.template === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={GRAPHIC_TEMPLATES[key].hint}
                  onClick={() => setSpec((prev) => switchTemplate(prev, key, spokenText))}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-hi",
                    active ? "border-accent bg-accent/15 text-white" : "border-white/10 text-muted hover:border-white/25 hover:text-text",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-accent-hi" : "")} aria-hidden />
                  {GRAPHIC_TEMPLATES[key].label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">{GRAPHIC_TEMPLATES[spec.template].hint}</p>
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-white">Dónde va</span>
          <SegmentedControl
            label="Dónde va el gráfico"
            size="sm"
            value={spec.mode}
            onValueChange={(mode) => set({ mode })}
            options={[
              { value: "full", label: GRAPHIC_MODES.full.label },
              { value: "overlay", label: GRAPHIC_MODES.overlay.label },
            ]}
          />
          {spec.mode === "overlay" && (
            <SegmentedControl
              label="Altura del gráfico sobre el video"
              size="sm"
              value={spec.position}
              onValueChange={(position) => set({ position })}
              options={[
                { value: "top", label: "Arriba" },
                { value: "bottom", label: "A la altura del pecho" },
              ]}
            />
          )}
          <p className="text-xs text-muted">{GRAPHIC_MODES[spec.mode].hint}</p>
        </div>

        <Fields spec={spec} id={id} onChange={setSpec} />

        {unsupported.length > 0 && (
          <Notice tone="warning">
            {unsupported.length === 1 ? "Esta cifra no aparece" : "Estas cifras no aparecen"} en lo que dices en este tramo ({unsupported.map((n) => formatNumber(n)).join(", ")}). Revísala para no mostrar un dato que no dijiste.
          </Notice>
        )}
        {error && <p className="text-xs text-warning">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={Boolean(error)} onClick={() => onUse(graphicSpecSchema.parse(spec) as GraphicSpec)} icon={<Check className="h-4 w-4" aria-hidden />}>
            {current ? "Guardar cambios" : "Usar este gráfico"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Campos de texto de cada plantilla, con los mismos límites que el esquema. */
function Fields({ spec, id, onChange }: { spec: GraphicSpec; id: string; onChange: (spec: GraphicSpec) => void }) {
  const f = (name: string) => `${id}-${name}`;
  switch (spec.template) {
    case "number":
      return (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
          <Field label="Cifra" htmlFor={f("value")} hint="Como la dices: x2, +40%, 10K.">
            <Input id={f("value")} value={spec.value} maxLength={L.value} onChange={(e) => onChange({ ...spec, value: e.target.value })} />
          </Field>
          <Field label="Qué significa" htmlFor={f("label")} hint="Opcional. Pocas palabras.">
            <Input id={f("label")} value={spec.label} maxLength={L.label} onChange={(e) => onChange({ ...spec, label: e.target.value })} />
          </Field>
        </div>
      );
    case "list":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Título" htmlFor={f("title")} hint="Opcional.">
            <Input id={f("title")} value={spec.title} maxLength={L.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold text-white">Puntos (2 a 4)</legend>
            {spec.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent/20 font-mono text-xs text-accent-glow" aria-hidden>
                  {i + 1}
                </span>
                <label htmlFor={f(`item${i}`)} className="sr-only">
                  Punto {i + 1}
                </label>
                <Input id={f(`item${i}`)} value={item} maxLength={L.item} onChange={(e) => onChange({ ...spec, items: spec.items.map((x, k) => (k === i ? e.target.value : x)) })} />
                <Button
                  type="button"
                  size="sm"
                  variant="subtle"
                  className="!h-9 !w-9 flex-none !p-0"
                  disabled={spec.items.length <= 2}
                  onClick={() => onChange({ ...spec, items: spec.items.filter((_, k) => k !== i) })}
                  aria-label={`Quitar el punto ${i + 1}`}
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                />
              </div>
            ))}
            {spec.items.length < 4 && (
              <Button type="button" size="sm" variant="ghost" className="self-start" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => onChange({ ...spec, items: [...spec.items, ""] })}>
                Agregar un punto
              </Button>
            )}
          </fieldset>
        </div>
      );
    case "quote":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Frase" htmlFor={f("text")} hint={`Hasta ${L.quote} caracteres. Aparece palabra por palabra.`}>
            <Textarea id={f("text")} className="!min-h-20" value={spec.text} maxLength={L.quote} onChange={(e) => onChange({ ...spec, text: e.target.value })} />
          </Field>
          <Field label="Palabra resaltada" htmlFor={f("highlight")} hint="Opcional. Una a tres palabras de la frase.">
            <Input id={f("highlight")} value={spec.highlight} maxLength={L.highlight} onChange={(e) => onChange({ ...spec, highlight: e.target.value })} />
          </Field>
        </div>
      );
    case "keyword":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Palabra clave" htmlFor={f("text")} hint={`Hasta ${L.keyword} caracteres.`}>
              <Input id={f("text")} value={spec.text} maxLength={L.keyword} onChange={(e) => onChange({ ...spec, text: e.target.value })} />
            </Field>
            <Field label="Rótulo" htmlFor={f("label")} hint="Opcional, va encima en pequeño.">
              <Input id={f("label")} value={spec.label} maxLength={L.label} onChange={(e) => onChange({ ...spec, label: e.target.value })} />
            </Field>
          </div>
          <SegmentedControl
            label="Énfasis de la palabra clave"
            size="sm"
            value={spec.emphasis}
            onValueChange={(emphasis) => onChange({ ...spec, emphasis })}
            options={[
              { value: "highlight", label: "Resaltado" },
              { value: "underline", label: "Subrayado" },
            ]}
          />
        </div>
      );
    case "compare":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["left", "right"] as const).map((side) => (
            <fieldset key={side} className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
              <legend className="px-1 text-xs font-semibold text-muted">{side === "left" ? "Primero (lo que no funciona)" : "Después (lo que sí)"}</legend>
              <Field label="Rótulo" htmlFor={f(`${side}-label`)}>
                <Input id={f(`${side}-label`)} value={spec[side].label} maxLength={L.sideLabel} onChange={(e) => onChange({ ...spec, [side]: { ...spec[side], label: e.target.value } })} />
              </Field>
              <Field label="Texto" htmlFor={f(`${side}-text`)}>
                <Input id={f(`${side}-text`)} value={spec[side].text} maxLength={L.side} onChange={(e) => onChange({ ...spec, [side]: { ...spec[side], text: e.target.value } })} />
              </Field>
            </fieldset>
          ))}
        </div>
      );
    case "flow":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Título" htmlFor={f("title")} hint="Opcional.">
            <Input id={f("title")} value={spec.title} maxLength={L.title} onChange={(e) => onChange({ ...spec, title: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-3">
            {spec.steps.map((step, i) => (
              <Field key={i} label={`Paso ${i + 1}`} htmlFor={f(`step${i}`)}>
                <Input id={f(`step${i}`)} value={step} maxLength={L.step} onChange={(e) => onChange({ ...spec, steps: spec.steps.map((x, k) => (k === i ? e.target.value : x)) })} />
              </Field>
            ))}
          </div>
        </div>
      );
  }
}
