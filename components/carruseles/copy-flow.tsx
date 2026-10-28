"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Images, Link2, Palette, ScanSearch, Sparkles, UserRound, UserRoundCheck, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { SegmentedControl } from "@/components/ui/tabs";
import { traitsLabel, type CharacterPhoto } from "@/lib/carousels/character";
import { TEMPLATE_KEYS, TEMPLATES, customRef } from "@/lib/carousels/theme";
import { cn } from "@/lib/utils";
import { CharacterPhotoUpload } from "./character-panel";
import { analyzeCopyAction, startCopyAction } from "./copy-actions";
import { PICK_MIN, ReferencePicker, uploadPicked, type PickedImage } from "./reference-picker";
import { userMessage } from "@/lib/user-message";

type Source = "link" | "upload";
type CharacterMode = "auto" | "siempre" | "nunca";
const LINK_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/?(\?.*)?$/;
const STEP_IDS = ["original", "version", "copiar"] as const;
type StepId = (typeof STEP_IDS)[number];
const STEP_LABELS: Record<StepId, string> = { original: "El original", version: "Tu versión", copiar: "Copiar" };

const CHARACTER_OPTIONS: { value: CharacterMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: "auto", label: "Como el original", hint: "Sales donde el original muestra a una persona (y siempre en el cierre).", icon: <UserRoundCheck className="h-5 w-5" aria-hidden /> },
  { value: "siempre", label: "En todos los slides", hint: "Tu cara en cada slide, con poses distintas.", icon: <UserRound className="h-5 w-5" aria-hidden /> },
  { value: "nunca", label: "Sin mi cara", hint: "Las imágenes van sin personas.", icon: <UserRoundX className="h-5 w-5" aria-hidden /> },
];

/**
 * Copiar un carrusel (lo principal de carrusel-creator-pro): 1. el original (link o slides), 2. tu versión (CTA, tu
 * personaje y el diseño), 3. copiar. La lectura sigue en /carruseles/copiar/<id> (se puede salir y volver) y termina
 * en el editor del carrusel nuevo, con la ficha lista para revisar.
 */
export function CopyFlow({
  photos,
  keywords,
  templates,
  storageReady,
  aiReady,
  initialUrl,
}: {
  photos: CharacterPhoto[];
  keywords: { keyword: string; offer: string }[];
  templates: { id: string; name: string }[];
  storageReady: boolean;
  aiReady: boolean;
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<StepId>("original");
  const [source, setSource] = useState<Source>("link");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [files, setFiles] = useState<PickedImage[]>([]);
  const [keyword, setKeyword] = useState(keywords[0]?.keyword.toUpperCase() ?? "");
  const [character, setCharacter] = useState<CharacterMode>(photos.length ? "auto" : "nunca");
  const [design, setDesign] = useState<"original" | "plantilla">("original");
  const [template, setTemplate] = useState<string>("foto");
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkOk = LINK_RE.test(url.trim());
  const originOk = source === "link" ? linkOk : files.length >= PICK_MIN;
  const index = STEP_IDS.indexOf(step);
  const states = STEP_IDS.map((id, i): { id: string; label: string; state: StepState } => ({ id, label: STEP_LABELS[id], state: i < index ? "done" : i === index ? "active" : "pending" }));
  const go = (next: StepId) => {
    if (STEP_IDS.indexOf(next) > 0 && !originOk) return;
    setError(null);
    setStep(next);
  };
  const templateLabel = design === "original" ? "Igual al original" : (TEMPLATES[template as keyof typeof TEMPLATES]?.label ?? templates.find((t) => customRef(t.id) === template)?.name ?? "Plantilla");

  async function run() {
    setError(null);
    setBusy({ done: 0, total: source === "upload" ? files.length : 1, label: "Preparando" });
    try {
      const options = { keyword, character, design, template: design === "plantilla" ? template : "" };
      const created = await startCopyAction(source === "link" ? { source: "link", url: url.trim(), options } : { source: "upload", options });
      if (!created.ok || !created.data) throw new Error(created.ok ? "No pudimos empezar la copia." : created.error);
      const id = created.data;
      if (source === "upload") {
        const keys = await uploadPicked(files, (n) => `/api/carruseles/subir?tipo=copia&copia=${id}&n=${n}`, (done, total) => setBusy({ done, total, label: done < total ? `Subiendo ${done + 1} de ${total}` : "Empezando a leer" }));
        const analyzed = await analyzeCopyAction(id, keys);
        if (!analyzed.ok) throw new Error(analyzed.error);
      }
      router.push(`/carruseles/copiar/${id}`);
    } catch (e) {
      setBusy(null);
      setError(userMessage(e, "Algo salió mal. Prueba de nuevo."));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <Steps steps={states} onSelect={(id) => !busy && go(id as StepId)} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {!storageReady && <Notice tone="warning">Falta configurar el almacenamiento de archivos en esta instalación. Avísale a soporte.</Notice>}
        {!aiReady && <Notice tone="warning">La IA todavía no está configurada en esta instalación (falta ANTHROPIC_API_KEY).</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {step === "original" && (
          <div className="card flex flex-col gap-5 p-5 sm:p-6" key="original">
            <div>
              <p className="eyebrow mb-1">Paso 1</p>
              <h2 className="text-lg font-semibold">¿Qué carrusel quieres copiar?</h2>
              <p className="mt-1 text-sm text-muted">Leemos cada slide (gancho, estructura, textos y recursos visuales) y escribimos tu versión con tu marca. Copiamos la idea y la estructura, nunca sus frases, su @ ni sus imágenes.</p>
            </div>
            <SegmentedControl
              label="De dónde sale el carrusel"
              value={source}
              onValueChange={(v) => (setSource(v), setError(null))}
              options={[
                { value: "link", label: "Pegar link", icon: <Link2 className="h-4 w-4" aria-hidden /> },
                { value: "upload", label: "Subir los slides", icon: <Images className="h-4 w-4" aria-hidden /> },
              ]}
            />
            {source === "link" ? (
              <div className="flex flex-col gap-2">
                <Field label="Link del carrusel de Instagram" htmlFor="copy-url" hint="Si Instagram no nos deja bajarlo, te pedimos que subas las imágenes (no pierdes lo que elegiste).">
                  <Input id="copy-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/…" inputMode="url" autoComplete="off" />
                </Field>
                {url.trim() && !linkOk && <p className="text-xs text-warning">Ese link no parece de una publicación de Instagram (instagram.com/p/…).</p>}
              </div>
            ) : (
              <ReferencePicker files={files} onChange={setFiles} disabled={Boolean(busy)} />
            )}
          </div>
        )}

        {step === "version" && (
          <div className="card flex flex-col gap-6 p-5 sm:p-6" key="version">
            <div>
              <p className="eyebrow mb-1">Paso 2</p>
              <h2 className="text-lg font-semibold">Cómo quieres tu versión</h2>
              <p className="mt-1 text-sm text-muted">El texto sale con tu tono y tu ángulo de Mi marca. Todo se puede cambiar después, slide por slide.</p>
            </div>

            <div className="flex flex-col gap-2">
              <Field label="Palabra que la gente comenta (CTA)" htmlFor="copy-keyword" hint="Si la dejas vacía, usamos la del original traducida (si pide comentar una).">
                <Input id="copy-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value.replace(/\s+/g, "").toUpperCase())} maxLength={30} placeholder="GUIA" className="font-mono uppercase" />
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

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold text-white">¿Sale tu cara en los slides?</legend>
              {photos.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-white/15 p-4">
                  <p className="text-sm text-white">Para poner tu cara, sube de 1 a 3 fotos tuyas.</p>
                  <p className="text-xs text-muted">Nítidas, con buena luz y la cara completa (una de frente y otra de tres cuartos funcionan mejor). Se guardan en Mi marca y sirven para todos tus carruseles. Sin fotos, las imágenes van sin personas.</p>
                  <CharacterPhotoUpload variant="primary" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {photos.slice(0, 6).map((p, i) =>
                      p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- foto privada servida por la app con sesión
                        <img key={p.key} src={p.url} alt={`Tu foto ${i + 1}: ${traitsLabel(p.traits)}`} title={traitsLabel(p.traits)} className="h-14 w-11 rounded-lg border border-white/10 object-cover" />
                      ) : null,
                    )}
                    <span className="text-xs text-muted">
                      {photos.length === 1 ? "1 foto tuya" : `${photos.length} fotos tuyas`} en Mi marca.{photos.length < 2 ? " Con 2 o 3 la cara sale más parecida." : ""}
                    </span>
                    {photos.length < 3 && <CharacterPhotoUpload label="Sumar" />}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tu personaje">
                    {CHARACTER_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={character === o.value}
                        onClick={() => setCharacter(o.value)}
                        className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition", character === o.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                      >
                        <span className="tile-icon h-9 w-9 flex-none">{o.icon}</span>
                        <span>
                          <span className="block text-sm font-semibold text-white">{o.label}</span>
                          <span className="text-xs text-muted">{o.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold text-white">Diseño</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Diseño">
                <button
                  type="button"
                  role="radio"
                  aria-checked={design === "original"}
                  onClick={() => setDesign("original")}
                  className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition", design === "original" ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                >
                  <span className="tile-icon h-9 w-9 flex-none">
                    <ScanSearch className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">Igual al original (recomendado)</span>
                    <span className="text-xs text-muted">Copiamos su composición, jerarquía, colores y letra en una plantilla nueva. Las imágenes van sin texto: el texto lo pone la plantilla.</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={design === "plantilla"}
                  onClick={() => setDesign("plantilla")}
                  className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition", design === "plantilla" ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                >
                  <span className="tile-icon h-9 w-9 flex-none">
                    <Palette className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">Con una plantilla mía</span>
                    <span className="text-xs text-muted">Usa los colores de tu marca o un estilo que ya copiaste.</span>
                  </span>
                </button>
              </div>
              {design === "plantilla" && (
                <Field label="Plantilla" htmlFor="copy-template">
                  <Select id="copy-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
                    <optgroup label="De fábrica">
                      {TEMPLATE_KEYS.map((t) => (
                        <option key={t} value={t}>
                          {TEMPLATES[t].label}
                          {t === "foto" ? " (recomendada con tu cara)" : ""}
                        </option>
                      ))}
                    </optgroup>
                    {templates.length > 0 && (
                      <optgroup label="Tus plantillas">
                        {templates.map((t) => (
                          <option key={t.id} value={customRef(t.id)}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </Field>
              )}
            </fieldset>
          </div>
        )}

        {step === "copiar" && (
          <div className="card flex flex-col gap-4 p-5 sm:p-6" key="copiar">
            <div>
              <p className="eyebrow mb-1">Paso 3</p>
              <h2 className="text-lg font-semibold">Todo listo para copiar</h2>
              <p className="mt-1 text-sm text-muted">Bajamos los slides, la IA lee cada uno y escribe tu versión. Tarda uno o dos minutos: puedes salir y volver.</p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Original</dt>
                <dd className="mt-0.5 truncate font-semibold text-white">{source === "upload" ? `${files.length} slides subidos` : url.trim()}</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">CTA</dt>
                <dd className="mt-0.5 font-mono font-semibold text-white">{keyword || "La del original"}</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Tu cara</dt>
                <dd className="mt-0.5 font-semibold text-white">{photos.length ? CHARACTER_OPTIONS.find((o) => o.value === character)!.label : "Sin fotos: va sin personas"}</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Diseño</dt>
                <dd className="mt-0.5 font-semibold text-white">{templateLabel}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted">Las imágenes del original se usan solo para leerlo y se borran al terminar. Después generas las imágenes de tu versión desde el editor, con tu clave de API de OpenAI.</p>
            {busy && <Progress value={(busy.done / Math.max(1, busy.total)) * 100} label={busy.label} />}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {index > 0 && (
            <Button variant="ghost" onClick={() => setStep(STEP_IDS[index - 1]!)} disabled={Boolean(busy)} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Atrás
            </Button>
          )}
          {step !== "copiar" ? (
            <Button key="siguiente" onClick={() => go(STEP_IDS[index + 1]!)} disabled={!originOk || !storageReady} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
              Siguiente
            </Button>
          ) : (
            <Button key="copiar" onClick={() => void run()} disabled={!originOk || Boolean(busy) || !storageReady || !aiReady} icon={busy ? <Sparkles className="h-4 w-4 animate-pulse" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>
              {busy ? "Preparando…" : "Copiar carrusel"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
