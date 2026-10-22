"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Ban, Check, ChevronDown, Loader2, PenLine, SlidersHorizontal, Sparkles, Undo2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { defaultGraphic, GRAPHIC_MODES, type GraphicLook } from "@/lib/video/graphics";
import { sceneSchema, type ComponentLayer, type MotionScene } from "@/lib/video/motion/schema";
import {
  brollGraphicOption,
  checkScene,
  componentPropProblems,
  graphicKindLabel,
  isMotionScene,
  sceneFields,
  setSceneField,
  unsupportedSceneNumbers,
  type BrollGraphic,
} from "@/lib/video/motion-graphics";
import type { BrollOption, VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { GraphicCanvas, measurer, useGraphicFonts } from "./graphic-canvas";
import { GraphicEditor } from "./graphic-editor";
import { requestGraphicAction } from "./motion-actions";

/** Ejemplos para empezar (se copian a la caja y se pueden cambiar antes de pedir). */
export const GRAPHIC_EXAMPLES = [
  "Un embudo Seguidores → Conversaciones → Clientes que se llena",
  "Una notificación de DM que diga 'Quiero info del programa'",
  "Barras que suben de 2 a 10 clientes por mes",
  "Un checklist que se tilda: Contenido, Conversación, Cierre",
  "La palabra ANUNCIOS tachada y abajo SISTEMA en azul",
];

const ADJUST_EXAMPLES = ["Más grande", "Ponlo arriba", "Pantalla completa", "Sobre mi video"];

const LIMITS = ["Personas o caras", "Fotos o video realistas", "Logos de otras marcas", "Cifras que no dices"];

const FAKE_VIDEO = "bg-[radial-gradient(ellipse_at_50%_42%,#b9a48f_0%,#6d655c_38%,#2f2b27_100%)]";

type Feedback = { tone: "info" | "warning" | "danger"; title?: string; text: string; alternative?: string } | null;

/**
 * Gráfico con tu marca para un tramo: "Pide tu gráfico" (la persona lo describe y Claude lo arma con el motor),
 * "Ajustar" (otra frase que cambia el actual), deshacer, y la edición a mano de los textos, el modo y la posición.
 * Los gráficos v1 de planes viejos se siguen editando con su editor de plantillas.
 */
export function GraphicStudio({
  projectId,
  range,
  initial,
  format,
  duration,
  spokenText,
  look,
  onUse,
  current,
  autoFocus,
}: {
  projectId: string;
  range: { from: number; to: number };
  initial: BrollGraphic | null;
  format: VideoFormat;
  duration: number;
  spokenText: string;
  look: GraphicLook;
  onUse: (option: BrollOption) => void;
  /** Ya es el gráfico elegido del tramo. */
  current: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [graphic, setGraphic] = useState<BrollGraphic | null>(initial);
  const [history, setHistory] = useState<BrollGraphic[]>([]);
  const [request, setRequest] = useState("");
  const [adjust, setAdjust] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();
  const [pendingKind, setPendingKind] = useState<"pedido" | "ajuste" | null>(null);
  const [version, setVersion] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  function replace(next: BrollGraphic) {
    if (graphic) setHistory((h) => [...h.slice(-19), graphic]);
    setGraphic(next);
    setVersion((v) => v + 1);
  }

  function undo() {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) {
        setGraphic(prev);
        setVersion((v) => v + 1);
      }
      return h.slice(0, -1);
    });
    setFeedback(null);
  }

  function ask(kind: "pedido" | "ajuste", text: string) {
    const clean = text.trim();
    if (clean.length < 3) {
      setFeedback({ tone: "warning", text: kind === "ajuste" ? "Escribe qué quieres cambiar." : "Describe el gráfico que quieres." });
      return;
    }
    setFeedback(null);
    setPendingKind(kind);
    start(async () => {
      const r = await requestGraphicAction({ projectId, fromWord: range.from, toWord: range.to, request: clean, kind, current: kind === "ajuste" ? graphic : undefined, format });
      setPendingKind(null);
      if (r.ok) {
        replace(r.scene);
        setAsked((a) => [...a, clean]);
        if (kind === "ajuste") setAdjust("");
        const notes = [r.note, ...r.warnings].filter(Boolean);
        setFeedback(notes.length ? { tone: r.simplified ? "warning" : "info", text: notes.join(" ") } : null);
      } else if ("refusal" in r) {
        setFeedback({ tone: "warning", title: "Eso no se puede hacer en un gráfico", text: r.refusal, ...(r.alternative ? { alternative: r.alternative } : {}) });
      } else setFeedback({ tone: "danger", text: r.error });
    });
  }

  const allowed = `${spokenText} ${asked.join(" ")}`;

  const askSection = (
      <section aria-labelledby={`${id}-ask`} className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
        <div className="flex items-start gap-3">
          <span className="tile-icon grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent/20 text-accent-hi" aria-hidden>
            <Wand2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 id={`${id}-ask`} className="text-sm font-semibold text-white">
              Pide tu gráfico
            </h3>
            <p className="text-xs text-muted">Descríbelo como se lo pedirías a un editor. Se arma con los colores y la fuente de tu marca.</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            ask("pedido", request);
          }}
        >
          <label htmlFor={`${id}-request`} className="sr-only">
            Describe el gráfico que quieres
          </label>
          <Textarea
            id={`${id}-request`}
            ref={box}
            value={request}
            maxLength={400}
            rows={2}
            placeholder="Describe el gráfico que quieres"
            className="!min-h-[72px] flex-1"
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask("pedido", request);
              }
            }}
          />
          <Button type="submit" disabled={pending} className="sm:self-stretch" icon={pendingKind === "pedido" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}>
            {pendingKind === "pedido" ? "Creando…" : graphic ? "Crear otro" : "Crear gráfico"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5" aria-label="Ejemplos de pedidos">
          {GRAPHIC_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setRequest(ex);
                box.current?.focus();
              }}
              className="rounded-full border border-white/12 bg-white/[0.03] px-3 py-1 text-left text-xs text-muted transition hover:border-accent/60 hover:text-white focus-visible:outline-2 focus-visible:outline-accent-hi"
            >
              {ex}
            </button>
          ))}
        </div>
        <details className="group text-xs text-muted">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md hover:text-text focus-visible:outline-2 focus-visible:outline-accent-hi">
            <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden />
            Qué no puede llevar un gráfico
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>Se arman con textos, íconos, cifras y formas. Para lo demás, usa una toma de stock o de tu biblioteca.</p>
            <ul className="flex flex-wrap gap-1.5">
              {LIMITS.map((l) => (
                <li key={l} className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1">
                  <Ban className="h-3 w-3 text-placeholder" aria-hidden /> {l}
                </li>
              ))}
            </ul>
            <p>Las cifras salen de lo que dices en el tramo o de lo que escribes en tu pedido; si no, te avisamos.</p>
          </div>
        </details>
        {pendingKind === "pedido" && <p className="text-xs text-accent-glow" aria-live="polite">Armando tu gráfico… tarda unos segundos.</p>}
      </section>
  );
  const feedbackNode = feedback && (
        <Notice tone={feedback.tone} {...(feedback.title ? { title: feedback.title } : {})}>
          <span>{feedback.text}</span>
          {feedback.alternative && (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted">Puedes probar:</span>
              <button
                type="button"
                className="rounded-full border border-accent/50 px-3 py-1 text-xs font-semibold text-accent-hi hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent-hi"
                onClick={() => {
                  setRequest(feedback.alternative!);
                  ask("pedido", feedback.alternative!);
                }}
              >
                {feedback.alternative}
              </button>
            </span>
          )}
        </Notice>
      );
  const adjustSection = graphic ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <SlidersHorizontal className="h-4 w-4 text-accent-hi" aria-hidden /> Ajustar
                <span className="font-normal text-muted">· {graphicKindLabel(graphic)}</span>
              </h3>
              <Button type="button" size="sm" variant="ghost" disabled={!history.length || pending} onClick={undo} icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />}>
                Deshacer
              </Button>
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                ask("ajuste", adjust);
              }}
            >
              <label htmlFor={`${id}-adjust`} className="sr-only">
                Qué quieres cambiar del gráfico
              </label>
              <Input id={`${id}-adjust`} value={adjust} maxLength={300} placeholder="Por ejemplo: más grande el número" onChange={(e) => setAdjust(e.target.value)} />
              <Button type="submit" variant="ghost" disabled={pending} icon={pendingKind === "ajuste" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}>
                {pendingKind === "ajuste" ? "Ajustando…" : "Ajustar"}
              </Button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {ADJUST_EXAMPLES.map((ex) => (
                <button key={ex} type="button" disabled={pending} onClick={() => ask("ajuste", ex)} className="rounded-full border border-white/12 px-2.5 py-0.5 text-[11px] text-muted transition hover:border-accent/60 hover:text-white focus-visible:outline-2 focus-visible:outline-accent-hi disabled:opacity-50">
                  {ex}
                </button>
              ))}
            </div>
          </div>
  ) : null;

  if (graphic && isMotionScene(graphic)) {
    return (
      <SceneEditor
        key={version}
        scene={graphic}
        format={format}
        duration={duration}
        allowed={allowed}
        current={current}
        busy={pending}
        onUse={(sc) => onUse(brollGraphicOption(sc))}
        top={
          <>
            {askSection}
            {feedbackNode}
            {adjustSection}
          </>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {askSection}
      {feedbackNode}
      {graphic ? (
        <>
          {adjustSection}
          <GraphicEditor key={version} initial={graphic} current={current} format={format} duration={duration} spokenText={spokenText} onUse={(spec) => onUse(brollGraphicOption(spec))} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-white/15 p-4 text-sm text-muted">
          <p>Pide un gráfico arriba o, si prefieres, ármalo a mano con una plantilla.</p>
          <Button type="button" size="sm" variant="ghost" icon={<PenLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => replace(defaultGraphic(spokenText, look))}>
            Crearlo a mano
          </Button>
        </div>
      )}
    </div>
  );
}

/** Vista previa animada de una escena v2 y edición a mano de sus textos, modo y posición. */
function SceneEditor({
  scene: initial,
  format,
  duration,
  allowed,
  current,
  busy,
  onUse,
  top,
}: {
  top?: ReactNode;
  scene: MotionScene;
  format: VideoFormat;
  duration: number;
  allowed: string;
  current: boolean;
  busy: boolean;
  onUse: (scene: MotionScene) => void;
}) {
  const id = useId();
  const [scene, setScene] = useState<MotionScene>(initial);
  const fontsReady = useGraphicFonts();
  const fields = useMemo(() => sceneFields(scene), [scene]);
  const parsed = useMemo(() => sceneSchema.safeParse({ ...scene, format, duration }), [scene, format, duration]);
  const blocking = useMemo(() => {
    if (!parsed.success) return ["Completa los textos del gráfico."];
    return (parsed.data.layers.filter((l) => l.type === "component") as ComponentLayer[]).flatMap(componentPropProblems);
  }, [parsed]);
  const check = useMemo(() => (parsed.success && fontsReady ? checkScene(parsed.data, { allowed, measure: measurer() }) : null), [parsed, fontsReady, allowed]);
  const missing = useMemo(() => (parsed.success ? unsupportedSceneNumbers(parsed.data, allowed) : []), [parsed, allowed]);
  const overflow = check?.issues.filter((i) => i.code === "overflow" && i.severity === "error").map((i) => i.message) ?? [];
  const problems = [...blocking, ...overflow];
  const advice = (check?.issues ?? []).filter((i) => i.code !== "overflow" && i.code !== "schema").map((i) => i.message).slice(0, 2);
  const preview = parsed.success && !blocking.length ? parsed.data : null;
  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:grid-cols-[minmax(0,250px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2 sm:sticky sm:top-0 sm:self-start">
        <div className={cn("relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-[#6d655c]", format === "9:16" ? "aspect-[9/16] max-w-[170px] sm:max-w-none" : "aspect-video")}>
          {scene.mode === "overlay" && <div aria-hidden className={cn("absolute inset-0", FAKE_VIDEO)} />}
          {preview ? (
            <GraphicCanvas spec={preview} format={format} duration={duration} scale={0.4} className="relative" label={`Vista previa del gráfico: ${graphicKindLabel(preview)}`} />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-bg/80 p-4 text-center text-xs text-muted">Completa los textos para ver el gráfico.</div>
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-bg/60 backdrop-blur-[1px]" aria-hidden>
              <Loader2 className="h-6 w-6 animate-spin text-accent-hi" />
            </div>
          )}
        </div>
        <p className="text-center text-[11px] text-muted">
          Dura {duration.toFixed(1).replace(".", ",")} s, como el tramo. Colores y fuente de <span className="text-text">Mi marca</span>.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {top}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-white">Dónde va</span>
          <SegmentedControl
            label="Dónde va el gráfico"
            size="sm"
            value={scene.mode}
            onValueChange={(mode) => setScene((s) => ({ ...s, mode }))}
            options={[
              { value: "full", label: GRAPHIC_MODES.full.label },
              { value: "overlay", label: GRAPHIC_MODES.overlay.label },
            ]}
          />
          {scene.mode === "overlay" && (
            <SegmentedControl
              label="Altura del gráfico sobre el video"
              size="sm"
              value={scene.position}
              onValueChange={(position) => setScene((s) => ({ ...s, position }))}
              options={[
                { value: "top", label: "Arriba" },
                { value: "bottom", label: "Abajo" },
                // En horizontal, el gráfico a un lado y tú al otro (los altos, como un embudo, se ven más grandes).
                ...(format === "16:9"
                  ? [
                      { value: "left" as const, label: "Izquierda" },
                      { value: "right" as const, label: "Derecha" },
                    ]
                  : []),
              ]}
            />
          )}
          <p className="text-xs text-muted">
            {scene.mode === "overlay" && format === "16:9" && (scene.position === "left" || scene.position === "right")
              ? "El gráfico ocupa esa mitad y tú pasas a la otra. Ideal para embudos, listas y pasos."
              : GRAPHIC_MODES[scene.mode].hint}
          </p>
        </div>

        {groups.map((group) => (
          <fieldset key={group} className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold text-white">Textos · {group}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields
                .filter((f) => f.group === group)
                .map((f) => (
                  <Field key={f.id} label={f.label} htmlFor={`${id}-${f.id}`} className={cn(f.long && "sm:col-span-2")}>
                    {f.long ? (
                      <Textarea id={`${id}-${f.id}`} className="!min-h-16" value={String(f.value)} onChange={(e) => setScene((s) => setSceneField(s, f.id, e.target.value))} />
                    ) : (
                      <Input
                        id={`${id}-${f.id}`}
                        type={f.kind === "number" ? "number" : "text"}
                        inputMode={f.kind === "number" ? "decimal" : undefined}
                        value={String(f.value)}
                        onChange={(e) => setScene((s) => setSceneField(s, f.id, f.kind === "number" ? Number(e.target.value || 0) : e.target.value))}
                      />
                    )}
                  </Field>
                ))}
            </div>
          </fieldset>
        ))}

        {missing.length > 0 && (
          <Notice tone="warning">
            {missing.length === 1 ? "Esta cifra no aparece" : "Estas cifras no aparecen"} en lo que dices en este tramo ({missing.map((n) => formatNumber(n)).join(", ")}). Revísala para no mostrar un dato que no dijiste.
          </Notice>
        )}
        {problems.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-warning">
            {problems.slice(0, 3).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {!problems.length && advice.length > 0 && <p className="text-xs text-muted">Sugerencia: {advice.join(" ")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={Boolean(problems.length) || !preview || busy} onClick={() => preview && onUse(preview)} icon={<Check className="h-4 w-4" aria-hidden />}>
            {current ? "Guardar cambios" : "Usar este gráfico"}
          </Button>
        </div>
      </div>
    </div>
  );
}
