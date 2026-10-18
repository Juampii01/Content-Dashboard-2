"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { VoiceTest } from "./voice-test";
import { Notice } from "@/components/ui/feedback";
import { toast } from "@/components/ui/toast";
import { LANGUAGES } from "@/lib/ai/language";
import type { BrandDraft } from "@/lib/ai/prompts/marca";
import { draftBrandAction, saveBrandAction, type BrandInput } from "./actions";

type Suggestion = { id: string; label: string; text: string };

const lines = (v: string[]) => v.join("\n");
const fromLines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

/** Editor del perfil de marca. Todo lo que se guarda aquí alimenta guiones, carruseles y clon. */
export function BrandEditor({ initial, suggestions, aiReady, canEdit }: { initial: BrandInput; suggestions: Suggestion[]; aiReady: boolean; canEdit: boolean }) {
  const [brand, setBrand] = useState<BrandInput>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const [wizardOpen, setWizardOpen] = useState(!initial.niche && !initial.audience && canEdit);

  const set = <K extends keyof BrandInput>(key: K, value: BrandInput[K]) => {
    setBrand((b) => ({ ...b, [key]: value }));
    setDirty(true);
  };

  const save = () =>
    startSaving(async () => {
      const res = await saveBrandAction(brand);
      if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
      else {
        setDirty(false);
        toast.success("Perfil de marca guardado. Los próximos guiones ya lo usan.");
      }
    });

  const applyDraft = (draft: BrandDraft) => {
    setBrand((b) => ({
      ...b,
      niche: draft.niche,
      whatYouSell: draft.whatYouSell,
      differentiator: draft.differentiator,
      audience: draft.audience,
      audiencePains: draft.audiencePains,
      audienceDesires: draft.audienceDesires,
      objections: draft.objections,
      beliefs: draft.beliefs,
      tone: draft.tone,
      signaturePhrases: draft.signaturePhrases,
      bannedWords: draft.bannedWords,
      emojiPolicy: draft.emojiPolicy,
      pillars: draft.pillars.map((p) => ({ ...p, share: Math.round(p.share) })),
      offers: draft.offers.map((o) => ({ ...o, keyword: o.keyword || undefined })),
    }));
    setDirty(true);
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      {canEdit && (
        <div className="card hero-panel flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="tile-hero flex-none">
              <Wand2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{initial.niche ? "Rehacer el perfil con IA" : "Arma tu perfil en 2 minutos"}</h2>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Respondes 4 preguntas, pegas cómo hablas y la IA arma el perfil completo. Después lo revisas y lo guardas.
              </p>
            </div>
          </div>
          <Button onClick={() => setWizardOpen(true)} icon={<Sparkles className="h-4 w-4" aria-hidden />} disabled={!aiReady}>
            {initial.niche ? "Rehacer con IA" : "Empezar"}
          </Button>
        </div>
      )}
      {!aiReady && <Notice tone="warning">La IA todavía no está configurada en esta instalación. Puedes completar el perfil a mano.</Notice>}

      <Section title="Identidad" description="Quién eres y qué vendes.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre o marca" htmlFor="b-name">
            <Input id="b-name" value={brand.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Usuario principal" htmlFor="b-handle" hint="Por ejemplo @tumarca.">
            <Input id="b-handle" value={brand.handle} onChange={(e) => set("handle", e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label="Nicho" htmlFor="b-niche" className="md:col-span-2">
            <Input id="b-niche" value={brand.niche} onChange={(e) => set("niche", e.target.value)} disabled={!canEdit} placeholder="Asesoría de marketing para clínicas dentales en Estados Unidos" />
          </Field>
          <Field label="Qué vendes" htmlFor="b-sell">
            <Textarea id="b-sell" value={brand.whatYouSell} onChange={(e) => set("whatYouSell", e.target.value)} disabled={!canEdit} className="!min-h-20" />
          </Field>
          <Field label="Qué te diferencia" htmlFor="b-diff">
            <Textarea id="b-diff" value={brand.differentiator} onChange={(e) => set("differentiator", e.target.value)} disabled={!canEdit} className="!min-h-20" />
          </Field>
        </div>
      </Section>

      <Section title="Audiencia" description="A quién le hablas. Uno por línea, con las palabras que usaría esa persona.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Cliente ideal" htmlFor="b-aud" className="md:col-span-2">
            <Textarea id="b-aud" value={brand.audience} onChange={(e) => set("audience", e.target.value)} disabled={!canEdit} className="!min-h-20" />
          </Field>
          <Field label="Dolores" htmlFor="b-pains">
            <Textarea id="b-pains" value={lines(brand.audiencePains)} onChange={(e) => set("audiencePains", e.target.value.split("\n"))} onBlur={(e) => set("audiencePains", fromLines(e.target.value))} disabled={!canEdit} />
          </Field>
          <Field label="Deseos" htmlFor="b-desires">
            <Textarea id="b-desires" value={lines(brand.audienceDesires)} onChange={(e) => set("audienceDesires", e.target.value.split("\n"))} onBlur={(e) => set("audienceDesires", fromLines(e.target.value))} disabled={!canEdit} />
          </Field>
          <Field label="Objeciones para comprar" htmlFor="b-obj">
            <Textarea id="b-obj" value={lines(brand.objections)} onChange={(e) => set("objections", e.target.value.split("\n"))} onBlur={(e) => set("objections", fromLines(e.target.value))} disabled={!canEdit} />
          </Field>
          <Field label="Tus creencias contra la corriente" htmlFor="b-bel" hint="Sirven para los ganchos de contraste.">
            <Textarea id="b-bel" value={lines(brand.beliefs)} onChange={(e) => set("beliefs", e.target.value.split("\n"))} onBlur={(e) => set("beliefs", fromLines(e.target.value))} disabled={!canEdit} />
          </Field>
        </div>
      </Section>

      <Section title="Voz" description="Cómo hablas. Es lo que más cambia el resultado de los guiones.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tono" htmlFor="b-tone" className="md:col-span-2">
            <Textarea id="b-tone" value={brand.tone} onChange={(e) => set("tone", e.target.value)} disabled={!canEdit} className="!min-h-16" placeholder="Directo, con humor seco, frases cortas, ejemplos de clientes reales." />
          </Field>
          <Field label="Frases propias" htmlFor="b-sig" hint="Una por línea. Se usan con moderación.">
            <Textarea id="b-sig" value={lines(brand.signaturePhrases)} onChange={(e) => set("signaturePhrases", e.target.value.split("\n"))} onBlur={(e) => set("signaturePhrases", fromLines(e.target.value))} disabled={!canEdit} className="!min-h-20" />
          </Field>
          <Field label="Palabras prohibidas" htmlFor="b-ban" hint="Una por línea. Nunca aparecen en lo que se genere.">
            <Textarea id="b-ban" value={lines(brand.bannedWords)} onChange={(e) => set("bannedWords", e.target.value.split("\n"))} onBlur={(e) => set("bannedWords", fromLines(e.target.value))} disabled={!canEdit} className="!min-h-20" />
          </Field>
          <Field label="Idioma" htmlFor="b-lang">
            <Select id="b-lang" value={brand.language} onChange={(e) => set("language", e.target.value as BrandInput["language"])} disabled={!canEdit}>
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Emojis" htmlFor="b-emoji">
            <Select id="b-emoji" value={brand.emojiPolicy} onChange={(e) => set("emojiPolicy", e.target.value as BrandInput["emojiPolicy"])} disabled={!canEdit}>
              <option value="ninguno">Ninguno</option>
              <option value="pocos">Pocos, solo en el caption</option>
              <option value="libres">Los que quieras</option>
            </Select>
          </Field>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Muestras de cómo hablas</h3>
            {canEdit && brand.voiceSamples.length < 8 && (
              <Button variant="subtle" size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => set("voiceSamples", [...brand.voiceSamples, { source: "Pegado", text: "" }])}>
                Agregar muestra
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">Transcripciones o textos tuyos, tal cual, con muletillas incluidas. Con 3 o más los guiones suenan mucho más a ti.</p>
          {brand.voiceSamples.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Textarea
                aria-label={`Muestra ${i + 1}`}
                value={s.text}
                onChange={(e) => set("voiceSamples", brand.voiceSamples.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                disabled={!canEdit}
                className="!min-h-24 flex-1"
              />
              {canEdit && (
                <Button variant="subtle" size="sm" aria-label="Quitar muestra" onClick={() => set("voiceSamples", brand.voiceSamples.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Pilares de contenido" description="Los temas que alternas. El porcentaje es cuánto del mes ocupa cada uno.">
        <div className="flex flex-col gap-3">
          {brand.pillars.map((p, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_90px_auto]">
              <Input aria-label={`Pilar ${i + 1}`} value={p.name} placeholder="Nombre" onChange={(e) => set("pillars", brand.pillars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!canEdit} />
              <Input aria-label={`Descripción del pilar ${i + 1}`} value={p.description} placeholder="De qué trata" onChange={(e) => set("pillars", brand.pillars.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} disabled={!canEdit} />
              <Input aria-label={`Porcentaje del pilar ${i + 1}`} type="number" min={0} max={100} value={p.share} onChange={(e) => set("pillars", brand.pillars.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) || 0 } : x)))} disabled={!canEdit} />
              {canEdit && (
                <Button variant="subtle" size="sm" aria-label="Quitar pilar" onClick={() => set("pillars", brand.pillars.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}
          {canEdit && brand.pillars.length < 8 && (
            <Button variant="subtle" size="sm" className="self-start" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => set("pillars", [...brand.pillars, { name: "", description: "", share: 0 }])}>
              Agregar pilar
            </Button>
          )}
        </div>
      </Section>

      <Section title="Ofertas y llamados a la acción" description="Lo que vendes y cómo lo pides al final de un video.">
        <div className="flex flex-col gap-4">
          {brand.offers.map((o, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-white/10 p-4 md:grid-cols-2">
              <Input aria-label={`Oferta ${i + 1}`} value={o.name} placeholder="Nombre de la oferta" onChange={(e) => set("offers", brand.offers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!canEdit} />
              <Input aria-label={`Palabra clave de la oferta ${i + 1}`} value={o.keyword ?? ""} placeholder="Palabra clave para DM (ej. AGENDA)" onChange={(e) => set("offers", brand.offers.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))} disabled={!canEdit} />
              <Input aria-label={`Promesa de la oferta ${i + 1}`} value={o.promise} placeholder="Qué promete" className="md:col-span-2" onChange={(e) => set("offers", brand.offers.map((x, j) => (j === i ? { ...x, promise: e.target.value } : x)))} disabled={!canEdit} />
              <Input aria-label={`CTA de la oferta ${i + 1}`} value={o.cta} placeholder="Cómo se pide en el video" className="md:col-span-2" onChange={(e) => set("offers", brand.offers.map((x, j) => (j === i ? { ...x, cta: e.target.value } : x)))} disabled={!canEdit} />
              {canEdit && (
                <Button variant="subtle" size="sm" className="justify-self-start" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => set("offers", brand.offers.filter((_, j) => j !== i))}>
                  Quitar oferta
                </Button>
              )}
            </div>
          ))}
          {canEdit && brand.offers.length < 6 && (
            <Button variant="subtle" size="sm" className="self-start" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => set("offers", [...brand.offers, { name: "", promise: "", cta: "" }])}>
              Agregar oferta
            </Button>
          )}
        </div>
      </Section>

      <Section title="Notas para la IA" description="Cualquier cosa más que deba saber quien escribe tus guiones.">
        <Textarea aria-label="Notas para la IA" value={brand.extraContext} onChange={(e) => set("extraContext", e.target.value)} disabled={!canEdit} />
      </Section>

      <VoiceTest dirty={dirty} canEdit={canEdit} aiReady={aiReady} />

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-bg/90 px-4 py-3 backdrop-blur-xl lg:left-64">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <span className="text-sm text-muted" role="status">
              {dirty ? "Tienes cambios sin guardar." : "Todo guardado."}
            </span>
            <Button onClick={save} disabled={saving || !dirty} icon={<Save className="h-4 w-4" aria-hidden />}>
              {saving ? "Guardando…" : "Guardar perfil"}
            </Button>
          </div>
        </div>
      )}

      <BrandWizard open={wizardOpen} onOpenChange={setWizardOpen} suggestions={suggestions} language={brand.language} name={brand.name} onDraft={applyDraft} />
    </div>
  );
}

function BrandWizard({
  open,
  onOpenChange,
  suggestions,
  language,
  name,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: Suggestion[];
  language: string;
  name: string;
  onDraft: (draft: BrandDraft) => void;
}) {
  const [answers, setAnswers] = useState({ name, whatYouSell: "", audience: "", differentiator: "", neverSay: "" });
  const [picked, setPicked] = useState<string[]>(suggestions.slice(0, 3).map((s) => s.id));
  const [pasted, setPasted] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      const samples = [
        ...suggestions.filter((s) => picked.includes(s.id)).map((s) => ({ source: s.label, text: s.text })),
        ...(pasted.trim() ? [{ source: "Pegado", text: pasted.trim() }] : []),
      ];
      const res = await draftBrandAction({ ...answers, language, samples });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDraft(res.draft);
      onOpenChange(false);
      toast.success("Listo. Revisa el perfil, ajusta lo que quieras y guárdalo.");
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Arma tu perfil de marca"
      description="Cuanto más concreto, mejor. Puedes dejar en blanco lo que no sepas."
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={run} disabled={pending} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
            {pending ? "Armando tu perfil…" : "Armar mi perfil"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="¿Qué vendes?" htmlFor="w-sell">
          <Textarea id="w-sell" value={answers.whatYouSell} onChange={(e) => setAnswers({ ...answers, whatYouSell: e.target.value })} className="!min-h-16" placeholder="Mentoría de 8 semanas para…" />
        </Field>
        <Field label="¿A quién se lo vendes?" htmlFor="w-aud">
          <Textarea id="w-aud" value={answers.audience} onChange={(e) => setAnswers({ ...answers, audience: e.target.value })} className="!min-h-16" placeholder="Dueños de… que quieren…" />
        </Field>
        <Field label="¿Qué te diferencia?" htmlFor="w-diff">
          <Textarea id="w-diff" value={answers.differentiator} onChange={(e) => setAnswers({ ...answers, differentiator: e.target.value })} className="!min-h-16" />
        </Field>
        <Field label="¿Qué nunca dirías?" htmlFor="w-never" hint="Frases, promesas o palabras que no van con tu marca.">
          <Input id="w-never" value={answers.neverSay} onChange={(e) => setAnswers({ ...answers, neverSay: e.target.value })} />
        </Field>
        {suggestions.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-white">Tus piezas que mejor funcionaron (para aprender tu voz)</legend>
            {suggestions.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-3 text-sm hover:border-white/20">
                <input type="checkbox" className="mt-1" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                <span className="min-w-0">
                  <span className="block text-xs text-muted">{s.label}</span>
                  <span className="line-clamp-2 text-text">{s.text}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Pega cómo hablas" htmlFor="w-paste" hint="La transcripción de uno de tus mejores videos, tal cual.">
          <Textarea id="w-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
