"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { toast } from "@/components/ui/toast";
import { formatDate, formatDuration, formatNumber } from "@/lib/format";
import { aspectLabel } from "@/lib/heygen/labels";
import {
  countWords,
  describeBalance,
  ENGINE_ORDER,
  ENGINES,
  estimateCost,
  formatCredits,
  formatUsd,
  HEYGEN_API_USAGE_URL,
  PRICING_CHECKED_ON,
  PRICING_SOURCE_URL,
  RESOLUTION_MULTIPLIER,
  WORDS_PER_MINUTE,
  type BalanceLike,
  type EngineKey,
  type ResolutionKey,
} from "@/lib/heygen/pricing";
import { MAX_SCRIPT_CHARS } from "@/lib/heygen/text";
import { cn } from "@/lib/utils";
import { createCloneVideoAction, getBalanceAction, type AvatarOption, type VoiceOption } from "./actions";
import { AvatarPicker } from "./avatar-picker";
import { VoicePicker } from "./voice-picker";

type ScriptOption = { id: string; title: string; text: string; updatedAt: string };
type Aspect = "9:16" | "1:1" | "16:9";

const STEP_LABELS = ["Texto", "Avatar y voz", "Ajustes", "Confirmar"];

function OptionCard({ selected, disabled, onClick, children, className }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
        selected ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function NewCloneVideoWizard({
  scripts,
  initialScriptId,
  missingScript,
  brandColor,
  balance: initialBalance,
  balanceError: initialBalanceError,
}: {
  scripts: ScriptOption[];
  initialScriptId: string | null;
  missingScript: boolean;
  brandColor: string | null;
  balance: BalanceLike | null;
  balanceError: string | null;
}) {
  const router = useRouter();
  const initialScript = scripts.find((s) => s.id === initialScriptId) ?? null;

  const [step, setStep] = useState(0);
  const [source, setSource] = useState<"script" | "text">(initialScript || scripts.length > 0 ? "script" : "text");
  const [scriptId, setScriptId] = useState<string | null>(initialScript?.id ?? null);
  const [title, setTitle] = useState(initialScript?.title ?? "");
  const [text, setText] = useState(initialScript?.text ?? "");

  const [avatar, setAvatar] = useState<AvatarOption | null>(null);
  const [voiceMode, setVoiceMode] = useState<"default" | "custom">("default");
  const [voice, setVoice] = useState<VoiceOption | null>(null);

  const [engine, setEngine] = useState<EngineKey | null>(null);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [resolution, setResolution] = useState<ResolutionKey>("1080p");
  const [bgMode, setBgMode] = useState<"none" | "brand" | "custom">("none");
  const [customColor, setCustomColor] = useState("#0b1a44");
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState(false);

  const [balance, setBalance] = useState(initialBalance);
  const [balanceError, setBalanceError] = useState(initialBalanceError);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  // En el teléfono la ruta de pasos es una fila con scroll: se mantiene visible el paso actual.
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepsRef.current?.querySelector("[aria-current=step]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step]);

  const words = useMemo(() => countWords(text), [text]);
  const voiceId = voiceMode === "default" ? (avatar?.defaultVoiceId ?? null) : (voice?.id ?? null);
  const engineAllowed = engine && avatar ? avatar.engines.includes(engine) : false;
  const estimate = engine ? estimateCost({ words, speed, engine, resolution }) : null;

  const valid = [
    title.trim().length > 0 && words >= 3 && text.length <= MAX_SCRIPT_CHARS,
    Boolean(avatar && voiceId),
    Boolean(engine && engineAllowed),
    true,
  ];
  // Hacia atrás se navega desde la ruta de pasos; hacia adelante, con "Siguiente" (que exige el paso válido).
  const navSteps = STEP_LABELS.map((label, i) => ({ id: String(i), label, state: (i === step ? "active" : i < step ? "done" : "pending") as StepState }));

  const insufficient = (() => {
    if (!estimate || !balance || balance.amount == null) return false;
    if (balance.unit === "usd") return balance.amount < estimate.usd;
    if (balance.unit === "credits") return balance.amount < estimate.credits;
    return false;
  })();

  const pickScript = (id: string) => {
    const script = scripts.find((s) => s.id === id);
    setScriptId(script?.id ?? null);
    if (script) {
      setTitle(script.title);
      setText(script.text);
    }
  };

  const pickAvatar = (next: AvatarOption) => {
    setAvatar(next);
    if (!next.defaultVoiceId) setVoiceMode("custom");
    if (engine && !next.engines.includes(engine)) setEngine(null);
  };

  const refreshBalance = () =>
    startRefresh(async () => {
      const res = await getBalanceAction();
      if (res.ok) {
        setBalance(res.data);
        setBalanceError(null);
      } else setBalanceError(res.error);
    });

  const background = bgMode === "brand" && brandColor ? { type: "color" as const, value: brandColor } : bgMode === "custom" ? { type: "color" as const, value: customColor } : null;

  const submit = () =>
    start(async () => {
      if (!avatar || !voiceId || !engine || !estimate) return;
      setSubmitError(null);
      const res = await createCloneVideoAction({
        scriptId: source === "script" ? scriptId : null,
        title: title.trim(),
        text,
        avatarId: avatar.id,
        avatarName: avatar.name,
        voiceId,
        engine,
        aspectRatio: aspect,
        resolution,
        background,
        speed,
        captions,
        confirmedCostUsd: estimate.usd,
      });
      setConfirmOpen(false);
      if (!res.ok) {
        setSubmitError(res.error);
        toast.error("No se pudo generar el video.", { description: res.error });
        return;
      }
      toast.success("Listo: HeyGen ya está generando tu video.");
      router.push(`/clon/${res.data.id}`);
    });

  const balanceView = balance ? describeBalance(balance) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div ref={stepsRef} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <Steps steps={navSteps} onSelect={(id) => setStep(Number(id))} />
      </div>

      <div key={step} className="animate-step-in flex min-w-0 flex-col gap-6 motion-reduce:animate-none">
        {step === 0 && (
          <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-texto">
            <div>
              <p className="eyebrow">Paso 1</p>
              <h2 id="paso-texto" className="mt-1 text-xl font-semibold">
                ¿Qué va a decir tu clon?
              </h2>
              <p className="mt-1 text-sm text-muted">Usa uno de tus guiones (el gancho elegido, lo hablado de cada bloque y el CTA) o pega un texto. Puedes editarlo.</p>
            </div>
            {missingScript && <Notice tone="warning">No encontramos el guion que venía en el enlace. Elige otro o pega el texto.</Notice>}

            <div className="segmented self-start" role="radiogroup" aria-label="Origen del texto">
              <button type="button" role="radio" aria-checked={source === "script"} className="segmented-item" onClick={() => setSource("script")} disabled={scripts.length === 0}>
                Desde un guion
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={source === "text"}
                className="segmented-item"
                onClick={() => {
                  setSource("text");
                  setScriptId(null);
                }}
              >
                Pegar texto
              </button>
            </div>

            {source === "script" && (
              <Field label="Guion" htmlFor="clon-guion" hint={scripts.length === 0 ? "Todavía no tienes guiones. Pega el texto o crea uno en Guiones." : undefined}>
                <Select id="clon-guion" value={scriptId ?? ""} onChange={(e) => pickScript(e.target.value)}>
                  <option value="" disabled>
                    Elige un guion
                  </option>
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {formatDate(s.updatedAt)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Título del video" htmlFor="clon-titulo" hint="Solo para encontrarlo en tu lista y en HeyGen.">
              <Input id="clon-titulo" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Por qué tu primera llamada pierde pacientes" />
            </Field>

            <Field
              label="Texto hablado"
              htmlFor="clon-texto"
              error={text.length > MAX_SCRIPT_CHARS ? `Máximo ${formatNumber(MAX_SCRIPT_CHARS)} caracteres. Divídelo en dos videos.` : undefined}
            >
              <Textarea id="clon-texto" value={text} onChange={(e) => setText(e.target.value)} className="!min-h-56 leading-relaxed" placeholder="Escribe o pega lo que va a decir tu clon, tal cual." />
            </Field>
            <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted" aria-live="polite">
              <span>{formatNumber(words)} palabras</span>
              <span>≈ {formatDuration(estimateCost({ words, speed, engine: "avatar_iii", resolution }).seconds)} de video</span>
              <span>{formatNumber(text.length)} / {formatNumber(MAX_SCRIPT_CHARS)} caracteres</span>
            </p>
          </section>
        )}

        {step === 1 && (
          <>
            <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-avatar">
              <div>
                <p className="eyebrow">Paso 2</p>
                <h2 id="paso-avatar" className="mt-1 text-xl font-semibold">
                  Elige tu clon
                </h2>
                <p className="mt-1 text-sm text-muted">Son los avatares de tu cuenta de HeyGen. Si creaste tu clon en la web de HeyGen, aparece en «Mis avatares».</p>
              </div>
              <AvatarPicker selectedId={avatar?.id ?? null} onSelect={pickAvatar} />
            </section>

            {avatar && (
              <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="paso-voz">
                <h2 id="paso-voz" className="text-lg font-semibold">
                  Voz
                </h2>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Qué voz usar">
                  <OptionCard selected={voiceMode === "default"} disabled={!avatar.defaultVoiceId} onClick={() => setVoiceMode("default")}>
                    <span className="block text-sm font-semibold text-white">La voz de este avatar</span>
                    <span className="text-xs text-muted">
                      {avatar.defaultVoiceId ? "En un clon, es la voz que HeyGen clonó de tu video." : "Este avatar no tiene voz propia: elige una."}
                    </span>
                  </OptionCard>
                  <OptionCard selected={voiceMode === "custom"} onClick={() => setVoiceMode("custom")}>
                    <span className="block text-sm font-semibold text-white">Elegir otra voz</span>
                    <span className="text-xs text-muted">Tus voces clonadas o las de HeyGen. Escucha la muestra antes.</span>
                  </OptionCard>
                </div>
                {voiceMode === "custom" && <VoicePicker selectedId={voice?.id ?? null} onSelect={setVoice} />}
              </section>
            )}
          </>
        )}

        {step === 2 && avatar && (
          <section className="card flex flex-col gap-6 p-5 sm:p-6" aria-labelledby="paso-ajustes">
            <div>
              <p className="eyebrow">Paso 3</p>
              <h2 id="paso-ajustes" className="mt-1 text-xl font-semibold">
                Motor y formato
              </h2>
              <p className="mt-1 text-sm text-muted">El motor define la calidad y el precio. Elígelo a conciencia: entre el económico y el premium hay 12 veces de diferencia.</p>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-white">Motor</legend>
              <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Motor">
                {ENGINE_ORDER.map((key) => {
                  const info = ENGINES[key];
                  const allowed = avatar.engines.includes(key);
                  const cost = estimateCost({ words, speed, engine: key, resolution });
                  return (
                    <OptionCard key={key} selected={engine === key} disabled={!allowed} onClick={() => setEngine(key)} className="flex flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-white">{info.label}</span>
                        <span className="text-xs text-muted">{info.model}</span>
                      </span>
                      <span className="font-mono text-lg font-semibold text-white">≈ {formatUsd(cost.usd)}</span>
                      <span className="text-xs text-muted">
                        {formatUsd(info.usdPerMinute * RESOLUTION_MULTIPLIER[resolution])} por minuto en {resolution}
                      </span>
                      <span className="text-xs text-muted">{allowed ? info.hint : "Este avatar no admite este motor."}</span>
                    </OptionCard>
                  );
                })}
              </div>
              {!engine && <p className="mt-2 text-xs text-warning">Elige un motor para seguir. No elegimos uno por ti para que no te cobren de más.</p>}
            </fieldset>

            <div className="grid gap-6 md:grid-cols-2">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-white">Formato</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Formato">
                  {(["9:16", "1:1", "16:9"] as const).map((value) => (
                    <OptionCard key={value} selected={aspect === value} onClick={() => setAspect(value)} className="flex items-center justify-between gap-3 !py-2.5">
                      <span className="text-sm font-semibold text-white">{aspectLabel[value]!.label}</span>
                      <span className="text-xs text-muted">{aspectLabel[value]!.hint}</span>
                    </OptionCard>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-white">Resolución</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Resolución">
                  <OptionCard selected={resolution === "1080p"} onClick={() => setResolution("1080p")} className="!py-2.5">
                    <span className="block text-sm font-semibold text-white">1080p · recomendada</span>
                    <span className="text-xs text-muted">Nítida en el teléfono. HeyGen la cobra al triple.</span>
                  </OptionCard>
                  <OptionCard selected={resolution === "720p"} onClick={() => setResolution("720p")} className="!py-2.5">
                    <span className="block text-sm font-semibold text-white">720p · más barata</span>
                    <span className="text-xs text-muted">Para pruebas o borradores.</span>
                  </OptionCard>
                </div>
              </fieldset>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-white">Fondo</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Fondo">
                  <OptionCard selected={bgMode === "none"} onClick={() => setBgMode("none")} className="!py-2.5">
                    <span className="block text-sm font-semibold text-white">El del avatar</span>
                    <span className="text-xs text-muted">Como lo grabaste.</span>
                  </OptionCard>
                  {brandColor && (
                    <OptionCard selected={bgMode === "brand"} onClick={() => setBgMode("brand")} className="flex items-center gap-3 !py-2.5">
                      <span aria-hidden className="h-6 w-6 flex-none rounded-md border border-white/20" style={{ background: brandColor }} />
                      <span>
                        <span className="block text-sm font-semibold text-white">Color de tu marca</span>
                        <span className="font-mono text-xs text-muted">{brandColor}</span>
                      </span>
                    </OptionCard>
                  )}
                  <OptionCard selected={bgMode === "custom"} onClick={() => setBgMode("custom")} className="flex items-center gap-3 !py-2.5">
                    <span aria-hidden className="h-6 w-6 flex-none rounded-md border border-white/20" style={{ background: customColor }} />
                    <span className="block text-sm font-semibold text-white">Otro color</span>
                  </OptionCard>
                  {bgMode === "custom" && (
                    <label className="flex items-center gap-3 text-sm text-muted">
                      <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded-lg border border-white/15 bg-transparent" aria-label="Color de fondo" />
                      <span className="font-mono">{customColor}</span>
                    </label>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted">El color reemplaza el fondo si tu avatar lo permite (en HeyGen, los clones grabados con fondo limpio).</p>
              </fieldset>

              <div className="flex flex-col gap-6">
                <div>
                  <label htmlFor="clon-velocidad" className="mb-2 flex items-baseline justify-between text-sm font-semibold text-white">
                    Velocidad de la voz <span className="font-mono text-accent-glow">{formatNumber(speed, { digits: 2 })}×</span>
                  </label>
                  <input
                    id="clon-velocidad"
                    type="range"
                    min={0.8}
                    max={1.25}
                    step={0.05}
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="range"
                    style={{ ["--pct" as string]: `${((speed - 0.8) / 0.45) * 100}%` }}
                  />
                  <p className="mt-2 text-xs text-muted">Más rápido = video más corto y más barato. Entre 1× y 1.1× suena natural.</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4 transition hover:border-white/25">
                  <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block text-sm font-semibold text-white">Quemar subtítulos en el video</span>
                    <span className="text-xs text-muted">Siempre recibes el archivo SRT. Si lo vas a pasar por el editor, mejor sin quemar: allí les das tu estilo.</span>
                  </span>
                </label>
              </div>
            </div>
          </section>
        )}

        {step === 3 && avatar && engine && estimate && (
          <section className="card flex flex-col gap-6 p-5 sm:p-6" aria-labelledby="paso-confirmar">
            <div>
              <p className="eyebrow">Paso 4</p>
              <h2 id="paso-confirmar" className="mt-1 text-xl font-semibold">
                Revisa antes de gastar saldo
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
                <p className="eyebrow">Costo estimado</p>
                <p className="mt-1 font-mono text-4xl font-bold text-white tabular-nums">≈ {formatUsd(estimate.usd)}</p>
                {balance?.unit === "credits" && <p className="mt-1 text-xs text-muted">≈ {formatCredits(estimate.credits)} de tu saldo</p>}
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  {formatNumber(words)} palabras ÷ {WORDS_PER_MINUTE} por minuto{speed !== 1 ? ` ÷ ${formatNumber(speed, { digits: 2 })}×` : ""} ≈ {formatDuration(estimate.seconds)} ·{" "}
                  {formatUsd(estimate.ratePerMinute)}/min ({ENGINES[engine].label}) × {estimate.multiplier} ({resolution})
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="eyebrow">Tu saldo de API</p>
                  <Button variant="subtle" size="sm" onClick={refreshBalance} disabled={refreshing} icon={<RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />}>
                    Actualizar
                  </Button>
                </div>
                <p className={cn("mt-1 flex items-center gap-2 font-mono text-2xl font-semibold tabular-nums", insufficient ? "text-danger" : "text-white")}>
                  <Wallet className="h-5 w-5 text-accent-hi" aria-hidden />
                  {balanceView?.value ?? "—"}
                </p>
                {balance?.unit === "usd" && balance.amount != null && !insufficient && (
                  <p className="mt-1 text-xs text-muted">Después de este video quedarían ≈ {formatUsd(Math.max(0, balance.amount - estimate.usd))}.</p>
                )}
                {balanceView?.note && <p className="mt-1 text-xs text-muted">{balanceView.note}</p>}
                <a href={HEYGEN_API_USAGE_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-hi hover:underline">
                  Cargar saldo en HeyGen
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              </div>
            </div>

            {balanceError && <Notice tone="danger">{balanceError}</Notice>}
            {insufficient && (
              <Notice tone="danger" title="Tu saldo no alcanza">
                Este video cuesta unos {formatUsd(estimate.usd)} y tu saldo de API es {balanceView?.value}. Carga saldo en HeyGen (el plan web no incluye la API), elige
                un motor más económico o una resolución menor, y toca «Actualizar».
              </Notice>
            )}
            {!insufficient && balance && balance.amount == null && (
              <Notice tone="warning">No pudimos comparar con tu saldo porque HeyGen no lo informa para tu tipo de cuenta. Revisa tu saldo en HeyGen antes de generar.</Notice>
            )}

            <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-white/10 p-5 text-sm sm:grid-cols-2">
              {[
                ["Título", title],
                ["Avatar", avatar.name],
                ["Voz", voiceMode === "default" ? "La voz del avatar" : (voice?.name ?? "—")],
                ["Motor", `${ENGINES[engine].label} (${ENGINES[engine].model})`],
                ["Formato", `${aspectLabel[aspect]!.label} · ${resolution}`],
                ["Fondo", background ? background.value : "El del avatar"],
                ["Velocidad", `${formatNumber(speed, { digits: 2 })}×`],
                ["Subtítulos", captions ? "Quemados en el video + SRT" : "Solo archivo SRT"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-white/5 pb-2 sm:block sm:border-0 sm:pb-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium text-white sm:text-left">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-xs leading-relaxed text-placeholder">
              Es una estimación: HeyGen cobra por segundo generado según la duración real del audio. Tarifas de pago por uso revisadas el{" "}
              {formatDate(PRICING_CHECKED_ON)} en{" "}
              <a href={PRICING_SOURCE_URL} target="_blank" rel="noreferrer" className="underline hover:text-muted">
                la ayuda de HeyGen
              </a>
              . El costo real lo ves en tu panel de uso de HeyGen.
            </p>

            {submitError && <Notice tone="danger">{submitError}</Notice>}
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
            Atrás
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!valid[step]}>
              Siguiente
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={pending || insufficient || !estimate} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
              {insufficient ? "Saldo insuficiente" : "Generar video"}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !pending && setConfirmOpen(open)}
        title={`¿Generar este video por ≈ ${formatUsd(estimate?.usd)}?`}
        description="Se cobra de tu saldo de API en HeyGen según la duración real. Una vez enviado, HeyGen no lo cancela."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Revisar de nuevo
            </Button>
            <Button onClick={submit} disabled={pending} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
              {pending ? "Enviando a HeyGen…" : `Sí, generar por ≈ ${formatUsd(estimate?.usd)}`}
            </Button>
          </>
        }
      />
    </div>
  );
}
