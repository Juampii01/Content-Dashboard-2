"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, Lightbulb, ScrollText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import type { CarouselSlide } from "@/lib/db/schema";
import { CAROUSEL_OBJECTIVES, type CarouselObjective } from "@/lib/carousels/labels";
import { resolveTheme, TEMPLATE_KEYS, TEMPLATES, type BrandLook, type SlideIdentity, type TemplateKey } from "@/lib/carousels/theme";
import { LIMITS } from "@/lib/carousels/validate";
import { cn } from "@/lib/utils";
import { createCarouselAction, type NewCarouselState } from "./actions";
import { ScaledSlide } from "./slide";

type Origin = "tema" | "guion" | "texto";
type ScriptOption = { id: string; title: string; beats: number };

const origins: { value: Origin; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: "tema", label: "Un tema o idea", hint: "Lo escribes en una o dos frases.", icon: <Lightbulb className="h-5 w-5" aria-hidden /> },
  { value: "guion", label: "Un guion tuyo", hint: "Convierte un guion en carrusel.", icon: <ScrollText className="h-5 w-5" aria-hidden /> },
  { value: "texto", label: "Texto pegado", hint: "Un post, notas o un artículo.", icon: <FileText className="h-5 w-5" aria-hidden /> },
];

const sample: CarouselSlide = { id: "muestra", type: "cover", kicker: "Tu nicho", headline: "Así se ve la portada de tu próximo carrusel", highlight: "próximo carrusel", body: "", cta: "", template: null };

const STEP_IDS = ["origen", "estructura", "diseno", "generar"] as const;
type StepId = (typeof STEP_IDS)[number];
const STEP_LABELS: Record<StepId, string> = { origen: "Origen", estructura: "Objetivo y estructura", diseno: "Plantilla", generar: "Generar" };

export function NewCarouselFlow({
  scripts,
  preselectedScript,
  keywords,
  look,
  aiReady,
  brandReady,
}: {
  scripts: ScriptOption[];
  preselectedScript: string | null;
  keywords: { keyword: string; offer: string }[];
  look: BrandLook & { identity: SlideIdentity };
  aiReady: boolean;
  brandReady: boolean;
}) {
  const [state, action, pending] = useActionState<NewCarouselState, FormData>(createCarouselAction, {});
  const [step, setStep] = useState<StepId>("origen");
  const [origin, setOrigin] = useState<Origin>(preselectedScript ? "guion" : "tema");
  const [topic, setTopic] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [scriptId, setScriptId] = useState(preselectedScript ?? scripts[0]?.id ?? "");
  const [objective, setObjective] = useState<CarouselObjective>(keywords.length ? "conversacion" : "guardar");
  const [count, setCount] = useState(7);
  const [keyword, setKeyword] = useState(keywords[0]?.keyword ?? "");
  const [template, setTemplate] = useState<TemplateKey>("editorial");
  const theme = useMemo(() => resolveTheme(null, look), [look]);

  const script = scripts.find((s) => s.id === scriptId) ?? null;
  const fromBeats = origin === "guion" && script && script.beats >= 2;
  const slides = fromBeats ? Math.min(LIMITS.maxSlides, script.beats + 2) : count;
  const originError =
    origin === "tema" && topic.trim().length < 8
      ? "Cuenta el tema en una o dos frases."
      : origin === "texto" && pastedText.trim().length < 40
        ? "Pega el texto de origen (al menos un par de frases)."
        : origin === "guion" && !script
          ? "Elige un guion."
          : null;

  const index = STEP_IDS.indexOf(step);
  const states = STEP_IDS.map((id, i): { id: string; label: string; state: StepState } => ({ id, label: STEP_LABELS[id], state: i < index ? "done" : i === index ? "active" : "pending" }));
  const go = (next: StepId) => {
    if (STEP_IDS.indexOf(next) > 0 && originError) return;
    setStep(next);
  };
  const next = () => go(STEP_IDS[Math.min(STEP_IDS.length - 1, index + 1)]!);
  const back = () => setStep(STEP_IDS[Math.max(0, index - 1)]!);

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <input type="hidden" name="origin" value={origin} />
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="pastedText" value={origin === "texto" ? pastedText : ""} />
      <input type="hidden" name="scriptId" value={origin === "guion" ? scriptId : ""} />
      <input type="hidden" name="objective" value={objective} />
      <input type="hidden" name="slides" value={slides} />
      <input type="hidden" name="keyword" value={objective === "conversacion" ? keyword : ""} />
      <input type="hidden" name="template" value={template} />

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Steps steps={states} onSelect={(id) => go(id as StepId)} />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {!aiReady && <Notice tone="warning">La IA todavía no está configurada en esta instalación (falta ANTHROPIC_API_KEY).</Notice>}
        {aiReady && !brandReady && step === "origen" && (
          <Notice tone="info" title="Tip: completa Mi marca primero">
            Con tu nicho, tu audiencia y tus ofertas, los carruseles suenan a ti y cierran con tu CTA.
          </Notice>
        )}
        {state.error && <Notice tone="danger">{state.error}</Notice>}

        {step === "origen" && (
          <div className="card flex flex-col gap-5 p-5 sm:p-6" key="origen">
            <div>
              <p className="eyebrow mb-1">Paso 1</p>
              <h2 className="text-lg font-semibold">¿De dónde sale el carrusel?</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Origen">
              {origins.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={origin === o.value}
                  onClick={() => setOrigin(o.value)}
                  className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition", origin === o.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                >
                  <span className="tile-icon h-9 w-9">{o.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{o.label}</span>
                    <span className="text-xs text-muted">{o.hint}</span>
                  </span>
                </button>
              ))}
            </div>

            {origin === "tema" && (
              <Field label="¿De qué trata?" htmlFor="c-topic" hint="Cuanto más concreto, mejor: un error común, una lista de pasos, una opinión, un caso.">
                <Textarea id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="!min-h-24" placeholder="Los 5 errores que hacen que un paciente no agende en la primera llamada" />
              </Field>
            )}
            {origin === "guion" &&
              (scripts.length === 0 ? (
                <Notice tone="info">Todavía no tienes guiones. Escribe uno en Guiones o elige otro origen.</Notice>
              ) : (
                <div className="flex flex-col gap-3">
                  <Field label="Guion" htmlFor="c-script">
                    <Select id="c-script" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                      {scripts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} {s.beats ? `(${s.beats} bloques)` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {fromBeats && (
                    <p className="text-sm text-muted">
                      La estructura sale del guion: portada con el gancho, un slide por cada uno de sus {Math.min(script.beats, LIMITS.maxSlides - 2)} bloques y el cierre con tu CTA.
                    </p>
                  )}
                  <Field label="Enfoque (opcional)" htmlFor="c-topic-g" hint="Si quieres cambiar el ángulo para el carrusel.">
                    <Input id="c-topic-g" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Más práctico: que se pueda guardar como guía" />
                  </Field>
                </div>
              ))}
            {origin === "texto" && (
              <>
                <Field label="Texto de origen" htmlFor="c-text" hint="Se toman las ideas y las cifras de aquí. Lo que no esté en el texto no se inventa.">
                  <Textarea id="c-text" value={pastedText} onChange={(e) => setPastedText(e.target.value)} className="!min-h-40" placeholder="Pega aquí un post, tus notas o un fragmento de un artículo." />
                </Field>
                <Field label="Enfoque (opcional)" htmlFor="c-topic-t">
                  <Input id="c-topic-t" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Lo que quieres que se lleven" />
                </Field>
              </>
            )}
          </div>
        )}

        {step === "estructura" && (
          <div className="card flex flex-col gap-5 p-5 sm:p-6" key="estructura">
            <div>
              <p className="eyebrow mb-1">Paso 2</p>
              <h2 className="text-lg font-semibold">¿Qué quieres que haga la gente?</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Objetivo">
              {(Object.keys(CAROUSEL_OBJECTIVES) as CarouselObjective[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={objective === o}
                  onClick={() => setObjective(o)}
                  className={cn("rounded-xl border px-4 py-3 text-left transition", objective === o ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                >
                  <span className="block text-sm font-semibold text-white">{CAROUSEL_OBJECTIVES[o].label}</span>
                  <span className="text-xs text-muted">{CAROUSEL_OBJECTIVES[o].hint}</span>
                </button>
              ))}
            </div>

            {fromBeats ? (
              <p className="text-sm text-muted">
                Número de slides: <strong className="text-white">{slides}</strong> (sale de los bloques del guion).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="c-count" className="flex items-center justify-between text-sm font-semibold text-white">
                  Número de slides <span className="font-mono text-accent-glow">{count}</span>
                </label>
                <input
                  id="c-count"
                  type="range"
                  min={LIMITS.minSlides}
                  max={LIMITS.maxSlides}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="range"
                  style={{ ["--pct" as string]: `${((count - LIMITS.minSlides) / (LIMITS.maxSlides - LIMITS.minSlides)) * 100}%` }}
                />
                <p className="text-xs text-muted">Portada + {count - 2} de contenido + cierre. Entre 7 y 9 suele rendir mejor.</p>
              </div>
            )}

            {objective === "conversacion" && (
              <div className="flex flex-col gap-2">
                <Field label="Palabra clave del CTA" htmlFor="c-keyword" hint="La que la gente comenta o te manda por DM. Sin espacios.">
                  <Input id="c-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value.replace(/\s+/g, "").toUpperCase())} maxLength={30} placeholder="AGENDA" className="font-mono uppercase" />
                </Field>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    De tus ofertas:
                    {keywords.map((k) => (
                      <button key={k.keyword} type="button" className="chip" aria-pressed={keyword === k.keyword.toUpperCase()} onClick={() => setKeyword(k.keyword.toUpperCase())}>
                        {k.keyword.toUpperCase()} <span className="font-normal opacity-70">· {k.offer}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "diseno" && (
          <div className="card flex flex-col gap-5 p-5 sm:p-6" key="diseno">
            <div>
              <p className="eyebrow mb-1">Paso 3</p>
              <h2 className="text-lg font-semibold">Elige la plantilla</h2>
              <p className="mt-1 text-sm text-muted">Usa los colores de Mi marca. Puedes cambiarla después, para todo el carrusel o para un slide.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" role="radiogroup" aria-label="Plantilla">
              {TEMPLATE_KEYS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={template === t}
                  onClick={() => setTemplate(t)}
                  className={cn("flex flex-col gap-2 rounded-xl border-2 p-1.5 text-left transition", template === t ? "border-accent-hi bg-accent/10" : "border-white/10 hover:border-white/25")}
                >
                  <span className="overflow-hidden rounded-lg">
                    <ScaledSlide slide={sample} index={0} total={7} template={t} theme={theme} identity={look.identity} label={`Plantilla ${TEMPLATES[t].label}`} />
                  </span>
                  <span className="px-1 pb-1">
                    <span className="block text-sm font-semibold text-white">{TEMPLATES[t].label}</span>
                    <span className="text-xs leading-snug text-muted">{TEMPLATES[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "generar" && (
          <div className="card flex flex-col gap-4 p-5 sm:p-6" key="generar">
            <div>
              <p className="eyebrow mb-1">Paso 4</p>
              <h2 className="text-lg font-semibold">Todo listo para escribir tu carrusel</h2>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Origen</dt>
                <dd className="mt-0.5 line-clamp-2 font-semibold text-white">{origin === "guion" ? `Guion: ${script?.title ?? ""}` : origin === "texto" ? "Texto pegado" : topic}</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Objetivo</dt>
                <dd className="mt-0.5 font-semibold text-white">
                  {CAROUSEL_OBJECTIVES[objective].label}
                  {objective === "conversacion" && keyword ? ` · ${keyword}` : ""}
                </dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Slides</dt>
                <dd className="mt-0.5 font-semibold text-white">{slides} en 1080 × 1350</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Plantilla</dt>
                <dd className="mt-0.5 font-semibold text-white">{TEMPLATES[template].label}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted">Te devolvemos el texto de cada slide, el caption y 5 hashtags. Después lo ajustas a mano o con IA y descargas las imágenes.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {index > 0 && (
            <Button variant="ghost" onClick={back} disabled={pending} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Atrás
            </Button>
          )}
          {step !== "generar" ? (
            <Button key="siguiente" onClick={next} disabled={Boolean(originError)} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
              Siguiente
            </Button>
          ) : (
            <Button key="enviar" type="submit" disabled={pending || !aiReady || Boolean(originError)} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
              {pending ? "Escribiendo tu carrusel…" : "Escribir carrusel"}
            </Button>
          )}
          {step === "origen" && originError && (topic || pastedText) ? <span className="text-xs text-muted">{originError}</span> : null}
          {pending && <span className="text-sm text-muted">Tarda unos 20 segundos.</span>}
        </div>
      </div>
    </form>
  );
}
