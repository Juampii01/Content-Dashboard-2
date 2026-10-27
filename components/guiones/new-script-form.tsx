"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { createScriptAction, type NewScriptState } from "./actions";

type Source = { id: string; label: string; text: string } | null;

const formats = [
  { value: "REEL", label: "Reel o TikTok", hint: "30 a 60 segundos" },
  { value: "SHORT", label: "YouTube Short", hint: "20 a 45 segundos" },
  { value: "YT_LONG", label: "YouTube largo", hint: "6 a 12 minutos" },
  { value: "STORY", label: "Historias", hint: "3 a 5 pantallas" },
];
const objectives = [
  { value: "alcance", label: "Llegar a gente nueva", hint: "El CTA pide compartir o guardar." },
  { value: "seguidores", label: "Ganar seguidores", hint: "El CTA invita a seguirte." },
  { value: "ventas", label: "Generar ventas", hint: "El CTA lleva a tu oferta." },
];

export function NewScriptForm({
  pillars,
  offers,
  source,
  aiReady,
  brandReady,
  initialIdea = "",
}: {
  pillars: string[];
  offers: string[];
  source: Source;
  aiReady: boolean;
  brandReady: boolean;
  initialIdea?: string;
}) {
  const [state, action, pending] = useActionState<NewScriptState, FormData>(createScriptAction, {});
  const [format, setFormat] = useState("REEL");
  const [objective, setObjective] = useState("seguidores");
  const [showRef, setShowRef] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-6">
      {!aiReady && <Notice tone="warning">La IA todavía no está configurada en esta instalación (falta ANTHROPIC_API_KEY).</Notice>}
      {aiReady && !brandReady && (
        <Notice tone="info" title="Tip: completa Mi marca primero">
          Sin perfil de marca los guiones salen correctos pero genéricos. Con tu nicho, tu audiencia y muestras de cómo hablas, suenan a ti.
        </Notice>
      )}
      {state.error && <Notice tone="danger">{state.error}</Notice>}

      {source && (
        <div className="card flex flex-col gap-2 border-accent/40 p-4">
          <p className="text-xs font-semibold text-accent-glow">Basado en tu pieza: {source.label}</p>
          <p className="line-clamp-3 text-sm text-text/90">{source.text}</p>
          <input type="hidden" name="sourceContentItemId" value={source.id} />
        </div>
      )}

      <div className="card flex flex-col gap-5 p-6">
        <Field label={source ? "¿Sobre qué quieres la nueva pieza?" : "¿De qué trata?"} htmlFor="idea" hint="Una o dos frases. Cuanto más concreta, mejor: un error, una historia, un dato, una opinión.">
          <Textarea
            id="idea"
            name="idea"
            required
            defaultValue={initialIdea}
            className="!min-h-24"
            placeholder={source ? "El mismo formato, pero sobre cómo cobrar más por el mismo servicio" : "Por qué los dueños de clínicas pierden pacientes en la primera llamada y qué decir en cambio"}
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-white">Formato</legend>
          <input type="hidden" name="format" value={format} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {formats.map((f) => (
              <button
                type="button"
                key={f.value}
                onClick={() => setFormat(f.value)}
                aria-pressed={format === f.value}
                className={`rounded-xl border px-4 py-3 text-left transition ${format === f.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25"}`}
              >
                <span className="block text-sm font-semibold text-white">{f.label}</span>
                <span className="text-xs text-muted">{f.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-white">Objetivo</legend>
          <input type="hidden" name="objective" value={objective} />
          <div className="grid gap-2 sm:grid-cols-3">
            {objectives.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => setObjective(o.value)}
                aria-pressed={objective === o.value}
                className={`rounded-xl border px-4 py-3 text-left transition ${objective === o.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25"}`}
              >
                <span className="block text-sm font-semibold text-white">{o.label}</span>
                <span className="text-xs text-muted">{o.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Pilar" htmlFor="pillar" hint={pillars.length ? undefined : "Defínelos en Mi marca."}>
            <Select id="pillar" name="pillar" defaultValue="">
              <option value="">Sin pilar</option>
              {pillars.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          {objective === "ventas" && (
            <Field label="Oferta" htmlFor="offer" hint={offers.length ? undefined : "Agrega tus ofertas en Mi marca."}>
              <Select id="offer" name="offer" defaultValue={offers[0] ?? ""}>
                <option value="">Que la IA elija</option>
                {offers.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {showRef ? (
          <div className="grid gap-4">
            <Field label="Referencia" htmlFor="reference" hint="Pega la transcripción o el texto de un video que te gustó. Se toma la estructura, nunca las frases.">
              <Textarea id="reference" name="reference" className="!min-h-32" />
            </Field>
            <Field label="Enlace de la referencia" htmlFor="sourceUrl" hint="Opcional, para tenerlo a mano.">
              <Input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://" />
            </Field>
          </div>
        ) : (
          <Button variant="subtle" size="sm" className="self-start" onClick={() => setShowRef(true)}>
            + Agregar un video de referencia
          </Button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending || !aiReady} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
          {pending ? "Escribiendo tu guion…" : "Escribir guion"}
        </Button>
        {pending && <span className="text-sm text-muted">Tarda unos 20 segundos{format === "YT_LONG" ? " (un video largo, hasta un minuto)" : ""}.</span>}
      </div>
    </form>
  );
}
