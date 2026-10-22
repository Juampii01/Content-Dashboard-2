"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clapperboard, ExternalLink, Languages, Loader2, Mic, Pause, Play, RefreshCw, Sparkles, UploadCloud, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import type { TranslationSource } from "@/lib/dal/clone";
import { formatDate, formatDuration, formatNumber } from "@/lib/format";
import { aspectLabel } from "@/lib/heygen/labels";
import { CLONE_LANGUAGES, cloneLanguage, defaultLanguage, languageLabel } from "@/lib/heygen/languages";
import {
  countWords,
  describeBalance,
  ENGINE_ORDER,
  ENGINES,
  estimateCost,
  estimateTranslation,
  formatCredits,
  formatUsd,
  HEYGEN_API_USAGE_URL,
  PRICING_SOURCE_URL,
  TRANSLATION_MODE_ORDER,
  TRANSLATION_MODES,
  TRANSLATION_PRICING_UPDATED_ON,
  type BalanceLike,
  type EngineKey,
  type TranslationModeKey,
} from "@/lib/heygen/pricing";
import { MAX_SCRIPT_CHARS } from "@/lib/heygen/text";
import { cn } from "@/lib/utils";
import { createCloneVideoAction, getBalanceAction, type AvatarOption } from "./actions";
import { AvatarPicker } from "./avatar-picker";
import {
  createTranslationAction,
  listTranslationLanguagesAction,
  prepareTranslationUploadAction,
  previewVoiceAction,
  translateScriptAction,
} from "./translate-actions";

type Picked = { type: "editor" | "clone"; id: string } | null;
type Uploaded = { key: string; title: string; seconds: number; aspectRatio: "9:16" | "1:1" | "16:9"; fileName: string; size: number };
type Approach = "translate" | "regenerate";

const STEP_LABELS = ["Video", "Cómo traducir", "Idioma", "Confirmar"];
const MAX_UPLOAD = 209_715_200;

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

/** Mide duración y proporción de un video en el navegador (para estimar el costo de un archivo subido). */
function measureVideo(file: File): Promise<{ seconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const out = { seconds: video.duration, width: video.videoWidth, height: video.videoHeight };
      URL.revokeObjectURL(url);
      if (!Number.isFinite(out.seconds) || out.seconds <= 0) reject(new Error("No pudimos leer la duración del video. Prueba con un MP4."));
      else resolve(out);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Tu navegador no puede leer este video. Exporta un MP4 (H.264) y vuelve a intentarlo."));
    };
    video.src = url;
  });
}

function aspectOf(width: number, height: number): "9:16" | "1:1" | "16:9" {
  const r = width / Math.max(1, height);
  return r < 0.8 ? "9:16" : r > 1.25 ? "16:9" : "1:1";
}

function uploadLocal(file: File, key: string, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/clon/archivos/${key}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = "La subida se cortó. Vuelve a intentarlo.";
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
        } catch {}
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Se perdió la conexión durante la subida. Vuelve a intentarlo."));
    xhr.onabort = () => reject(new DOMException("Cancelada", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

async function uploadBlob(file: File, key: string, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  const { uploadPresigned } = await import("@vercel/blob/client");
  await uploadPresigned(key, file, {
    access: "private",
    handleUploadUrl: "/api/clon/subir",
    contentType: file.type || undefined,
    multipart: file.size > 100 * 1024 * 1024,
    abortSignal: signal,
    onUploadProgress: (e) => onProgress(e.loaded),
  });
}

function SourceCard({ source, selected, onSelect }: { source: TranslationSource; selected: boolean; onSelect: () => void }) {
  const vertical = source.aspectRatio === "9:16";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-2xl border text-left transition",
        selected ? "border-accent-hi bg-accent/15 ring-2 ring-accent-hi/40" : "border-white/10 bg-white/[0.02] hover:border-white/30",
      )}
    >
      <div className="relative grid aspect-video place-items-center overflow-hidden bg-black/40">
        {source.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source.thumbUrl} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full", vertical ? "object-contain" : "object-cover")} />
        ) : (
          <Clapperboard className="h-6 w-6 text-placeholder" aria-hidden />
        )}
        {selected && (
          <span className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-accent-hi text-bg">
            <Check className="h-4 w-4" aria-hidden />
          </span>
        )}
        {source.seconds != null && (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{formatDuration(source.seconds)}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="line-clamp-2 text-sm font-semibold text-white">{source.title}</span>
        <span className="text-xs text-muted">
          {aspectLabel[source.aspectRatio]?.label ?? source.aspectRatio}
          {source.language ? ` · ${languageLabel(source.language)}` : ""} · {formatDate(source.createdAt)}
        </span>
      </div>
    </button>
  );
}

export function TranslateWizard({
  sources,
  initial,
  missingSource,
  uploadMode,
  balance: initialBalance,
  balanceError: initialBalanceError,
}: {
  sources: { editor: TranslationSource[]; clone: TranslationSource[] };
  initial: Picked;
  missingSource: boolean;
  uploadMode: "blob" | "local" | null;
  balance: BalanceLike | null;
  balanceError: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"editor" | "clone" | "upload">(initial?.type ?? (sources.editor.length ? "editor" : sources.clone.length ? "clone" : "upload"));
  const [picked, setPicked] = useState<Picked>(initial);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [upload, setUpload] = useState<{ status: "idle" | "uploading" | "done" | "error"; loaded: number; total: number; name?: string; error?: string }>({ status: "idle", loaded: 0, total: 0 });
  const aborter = useRef<AbortController | null>(null);

  const [approach, setApproach] = useState<Approach>("translate");
  // Traducir el video (HeyGen)
  const [languages, setLanguages] = useState<string[] | null>(null);
  const [languagesError, setLanguagesError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [mode, setMode] = useState<TranslationModeKey>("speed");
  const [title, setTitle] = useState("");
  // Video nuevo con el clon
  const [langKey, setLangKey] = useState(CLONE_LANGUAGES[0]!.key);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [adapting, startAdapt] = useTransition();
  const [avatar, setAvatar] = useState<AvatarOption | null>(null);
  const [engine, setEngine] = useState<EngineKey | null>(null);
  const [voicePreview, setVoicePreview] = useState<{ url: string; seconds: number; costUsd: number; key: string } | null>(null);
  const [previewing, startPreview] = useTransition();
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [balance, setBalance] = useState(initialBalance);
  const [balanceError, setBalanceError] = useState(initialBalanceError);
  const [refreshing, startRefresh] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepsRef.current?.querySelector("[aria-current=step]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step]);
  useEffect(() => () => {
    aborter.current?.abort();
    audio.current?.pause();
  }, []);

  const source = useMemo<TranslationSource | null>(() => {
    if (!picked) return null;
    return (picked.type === "editor" ? sources.editor : sources.clone).find((s) => s.id === picked.id) ?? null;
  }, [picked, sources]);
  const usingUpload = tab === "upload";
  const chosen = usingUpload ? (uploaded ? { title: uploaded.title, seconds: uploaded.seconds, aspectRatio: uploaded.aspectRatio } : null) : source;
  const canRegenerate = !usingUpload && Boolean(source?.text);
  const effectiveApproach: Approach = canRegenerate ? approach : "translate";

  // Idiomas de HeyGen: se piden una sola vez, al llegar al paso de idioma.
  useEffect(() => {
    if (step !== 2 || effectiveApproach !== "translate" || languages) return;
    let cancelled = false;
    listTranslationLanguagesAction().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLanguages(res.data);
        setLanguagesError(null);
        setLanguage((prev) => prev ?? defaultLanguage(res.data));
      } else setLanguagesError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [step, effectiveApproach, languages]);

  const lang = cloneLanguage(langKey)!;
  const words = countWords(text);
  const voiceId = source?.voiceId ?? avatar?.defaultVoiceId ?? null;
  const aspect = (["9:16", "1:1", "16:9"].includes(chosen?.aspectRatio ?? "") ? chosen!.aspectRatio : "9:16") as "9:16" | "1:1" | "16:9";

  const translationEstimate = chosen?.seconds ? estimateTranslation(chosen.seconds, mode) : null;
  const regenEstimate = engine ? estimateCost({ words, speed: 1, engine, resolution: "1080p" }) : null;
  const estimate = effectiveApproach === "translate" ? translationEstimate : regenEstimate;
  const defaultTitle = chosen ? `${chosen.title} · ${effectiveApproach === "translate" ? languageLabel(language) : lang.label}` : "";
  const finalTitle = (title.trim() || defaultTitle).slice(0, 120);

  const insufficient = (() => {
    if (!estimate || !balance || balance.amount == null) return false;
    if (balance.unit === "usd") return balance.amount < estimate.usd;
    if (balance.unit === "credits") return balance.amount < estimate.credits;
    return false;
  })();

  const valid = [
    Boolean(chosen && (chosen.seconds ?? 0) > 0) && upload.status !== "uploading",
    true,
    effectiveApproach === "translate" ? Boolean(language) : Boolean(words >= 3 && text.length <= MAX_SCRIPT_CHARS && avatar && voiceId && engine && avatar.engines.includes(engine)),
    true,
  ];
  const navSteps = STEP_LABELS.map((label, i) => ({ id: String(i), label, state: (i === step ? "active" : i < step ? "done" : "pending") as StepState }));

  // ─── Acciones ───────────────────────────────────────────────────────────

  const pickFile = async (file: File) => {
    aborter.current?.abort();
    setUploaded(null);
    let measured;
    try {
      measured = await measureVideo(file);
    } catch (error) {
      setUpload({ status: "error", loaded: 0, total: file.size, name: file.name, error: error instanceof Error ? error.message : "No pudimos leer el video." });
      return;
    }
    const prepared = await prepareTranslationUploadAction({ name: file.name, size: file.size, type: file.type });
    if (!prepared.ok) {
      setUpload({ status: "error", loaded: 0, total: file.size, name: file.name, error: prepared.error });
      return;
    }
    const controller = new AbortController();
    aborter.current = controller;
    setUpload({ status: "uploading", loaded: 0, total: file.size, name: file.name });
    let last = 0;
    const onProgress = (loaded: number) => {
      const now = performance.now();
      if (now - last < 150 && loaded < file.size) return;
      last = now;
      setUpload((u) => ({ ...u, loaded }));
    };
    try {
      if (prepared.data.mode === "blob") await uploadBlob(file, prepared.data.key, controller.signal, onProgress);
      else await uploadLocal(file, prepared.data.key, controller.signal, onProgress);
      setUpload({ status: "done", loaded: file.size, total: file.size, name: file.name });
      setUploaded({
        key: prepared.data.key,
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Video subido",
        seconds: Math.round(measured.seconds * 10) / 10,
        aspectRatio: aspectOf(measured.width, measured.height),
        fileName: file.name,
        size: file.size,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUpload({ status: "idle", loaded: 0, total: 0 });
        return;
      }
      setUpload({ status: "error", loaded: 0, total: file.size, name: file.name, error: error instanceof Error ? error.message : "La subida falló. Vuelve a intentarlo." });
    }
  };

  const adapt = () =>
    startAdapt(async () => {
      if (!source) return;
      const res = await translateScriptAction({ source: { type: source.type, id: source.id }, languageKey: langKey });
      if (!res.ok) {
        toast.error("No pudimos adaptar el texto.", { description: res.error });
        return;
      }
      setText(res.data.text);
      setNotes(res.data.notes);
      if (!title.trim()) setTitle(res.data.title);
      setVoicePreview(null);
    });

  const preview = () =>
    startPreview(async () => {
      if (!voiceId) return;
      const res = await previewVoiceAction({ voiceId, text, languageKey: langKey });
      if (!res.ok) {
        toast.error("No pudimos probar la voz.", { description: res.error });
        return;
      }
      setVoicePreview({ url: res.data.audioUrl, seconds: res.data.seconds, costUsd: res.data.costUsd, key: `${voiceId}:${langKey}` });
      setPlaying(false);
    });

  const togglePlay = () => {
    if (!voicePreview) return;
    if (!audio.current || audio.current.src !== voicePreview.url) {
      audio.current?.pause();
      audio.current = new Audio(voicePreview.url);
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.play().then(() => setPlaying(true)).catch(() => toast.error("Tu navegador no pudo reproducir el audio."));
    }
  };

  const refreshBalance = () =>
    startRefresh(async () => {
      const res = await getBalanceAction();
      if (res.ok) {
        setBalance(res.data);
        setBalanceError(null);
      } else setBalanceError(res.error);
    });

  const submit = () =>
    start(async () => {
      if (!estimate || !chosen) return;
      setSubmitError(null);
      const res =
        effectiveApproach === "translate"
          ? await createTranslationAction({
              source: usingUpload && uploaded ? { type: "upload", key: uploaded.key, title: uploaded.title, seconds: uploaded.seconds, aspectRatio: uploaded.aspectRatio } : { type: picked!.type, id: picked!.id },
              title: finalTitle,
              language: language!,
              mode,
              confirmedCostUsd: estimate.usd,
            })
          : await createCloneVideoAction({
              title: finalTitle,
              text,
              avatarId: avatar!.id,
              avatarName: avatar!.name,
              voiceId: voiceId!,
              engine: engine!,
              aspectRatio: aspect,
              resolution: "1080p",
              background: null,
              speed: 1,
              captions: false,
              confirmedCostUsd: estimate.usd,
              languageKey: langKey,
              translatedFrom: { type: source!.type, id: source!.id },
            });
      setConfirmOpen(false);
      if (!res.ok) {
        setSubmitError(res.error);
        toast.error(effectiveApproach === "translate" ? "No se pudo enviar la traducción." : "No se pudo generar el video.", { description: res.error });
        return;
      }
      toast.success(effectiveApproach === "translate" ? "Listo: estamos subiendo tu video a HeyGen para traducirlo." : "Listo: tu clon ya está grabando el video.");
      router.push(`/clon/${res.data.id}`);
    });

  const balanceView = balance ? describeBalance(balance) : null;
  const sourceList = tab === "editor" ? sources.editor : tab === "clone" ? sources.clone : [];

  // ─── Pantalla ───────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div ref={stepsRef} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <Steps steps={navSteps} onSelect={(id) => setStep(Number(id))} />
      </div>

      <div key={step} className="animate-step-in flex min-w-0 flex-col gap-6 motion-reduce:animate-none">
        {step === 0 && (
          <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-video">
            <div>
              <p className="eyebrow">Paso 1</p>
              <h2 id="paso-video" className="mt-1 text-xl font-semibold">
                ¿Qué video quieres en otro idioma?
              </h2>
              <p className="mt-1 text-sm text-muted">Un video que terminaste en el Editor, uno de tu clon o uno que subas. Tiene que hablar una sola persona.</p>
            </div>
            {missingSource && <Notice tone="warning">No encontramos el video del enlace (o todavía no está listo). Elige otro.</Notice>}

            <div className="segmented self-start overflow-x-auto" role="radiogroup" aria-label="De dónde sale el video">
              {(
                [
                  ["editor", "Del Editor", sources.editor.length],
                  ["clone", "Con tu clon", sources.clone.length],
                  ["upload", "Subir un video", null],
                ] as const
              ).map(([value, label, count]) => (
                <button key={value} type="button" role="radio" aria-checked={tab === value} className="segmented-item whitespace-nowrap" onClick={() => setTab(value)}>
                  {label}
                  {count != null && <span className="ml-1.5 font-mono text-[11px] text-muted">{formatNumber(count)}</span>}
                </button>
              ))}
            </div>

            {tab !== "upload" &&
              (sourceList.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 p-8 text-center">
                  <p className="text-sm text-muted">
                    {tab === "editor" ? "Todavía no tienes videos terminados en el Editor." : "Todavía no tienes videos con tu clon listos."}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setTab("upload")} icon={<UploadCloud className="h-4 w-4" aria-hidden />}>
                    Subir un video
                  </Button>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Videos">
                  {sourceList.map((s) => (
                    <li key={s.id}>
                      <SourceCard source={s} selected={picked?.type === s.type && picked.id === s.id} onSelect={() => setPicked({ type: s.type, id: s.id })} />
                    </li>
                  ))}
                </ul>
              ))}

            {tab === "upload" &&
              (uploadMode ? (
                <div className="flex flex-col gap-3">
                  <UploadDropzone
                    onFiles={(files) => files[0] && pickFile(files[0])}
                    accept={["video/mp4", "video/webm"]}
                    acceptLabel="un video MP4 o WebM"
                    maxSize={MAX_UPLOAD}
                    status={upload.status}
                    progress={upload.total ? (upload.loaded / upload.total) * 100 : 0}
                    fileName={upload.name}
                    error={upload.status === "error" ? upload.error : null}
                    onCancel={() => aborter.current?.abort()}
                    title="Arrastra tu video aquí"
                    hint="MP4 o WebM, hasta 200 MB (el máximo que acepta HeyGen). Lo subimos a tu almacenamiento y de ahí a tu cuenta de HeyGen."
                  />
                  {uploaded && (
                    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
                      <Field label="Nombre del video" htmlFor="tr-upload-title">
                        <Input id="tr-upload-title" value={uploaded.title} maxLength={100} onChange={(e) => setUploaded({ ...uploaded, title: e.target.value })} />
                      </Field>
                      <p className="font-mono text-xs text-muted">
                        {formatDuration(uploaded.seconds)} · {aspectLabel[uploaded.aspectRatio]?.label}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <Notice tone="warning">Esta instalación no tiene almacenamiento de archivos, así que no se pueden subir videos. Usa uno del Editor o de tu clon.</Notice>
              ))}

            {chosen && !chosen.seconds && <Notice tone="warning">No sabemos cuánto dura este video, así que no podemos estimar el costo. Vuelve a renderizarlo en el Editor.</Notice>}
          </section>
        )}

        {step === 1 && chosen && (
          <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-como">
            <div>
              <p className="eyebrow">Paso 2</p>
              <h2 id="paso-como" className="mt-1 text-xl font-semibold">
                ¿Cómo lo traducimos?
              </h2>
              <p className="mt-1 text-sm text-muted">Las dos opciones usan tu voz. La primera conserva tu video tal cual; la segunda lo graba de nuevo con tu clon.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Cómo traducir">
              <OptionCard selected={effectiveApproach === "translate"} onClick={() => setApproach("translate")} className="flex flex-col gap-2 !p-5">
                <span className="flex items-center gap-2">
                  <Languages className="h-5 w-5 text-accent-hi" aria-hidden />
                  <span className="text-base font-semibold text-white">Traducir este video</span>
                  <span className="pill ml-auto !text-[11px]">Recomendado</span>
                </span>
                <span className="text-sm text-muted">HeyGen escucha tu video, clona tu voz, la pasa al otro idioma y ajusta tus labios. Es tu grabación real: tus gestos, tu ropa, tu lugar.</span>
                <span className="font-mono text-xs text-accent-glow">desde {formatUsd(TRANSLATION_MODES.audio_only.usdPerMinute)} por minuto</span>
              </OptionCard>
              <OptionCard selected={effectiveApproach === "regenerate"} disabled={!canRegenerate} onClick={() => setApproach("regenerate")} className="flex flex-col gap-2 !p-5">
                <span className="flex items-center gap-2">
                  <UserRound className="h-5 w-5 text-accent-hi" aria-hidden />
                  <span className="text-base font-semibold text-white">Grabarlo de nuevo con tu clon</span>
                </span>
                <span className="text-sm text-muted">
                  {canRegenerate
                    ? "La IA adapta tu texto al otro idioma (no palabra por palabra) y tu clon lo graba con tu voz. Puedes revisar y cambiar el texto antes."
                    : usingUpload
                      ? "No disponible para un video subido: no tenemos su texto. Usa un video del Editor o de tu clon."
                      : "Este video no tiene texto para adaptar."}
                </span>
                <span className="font-mono text-xs text-accent-glow">según el motor: desde {formatUsd(ENGINES.avatar_iii.usdPerMinute * 3)} por minuto en 1080p</span>
              </OptionCard>
            </div>
            {effectiveApproach === "regenerate" && (
              <Notice tone="info" title="Antes de pagar, escucha tu voz en el otro idioma">
                HeyGen no confirma en su documentación que una voz clonada en español hable bien otro idioma: depende de la voz. En el próximo paso puedes probarla con una frase
                (cuesta menos de un centavo). Si no te convence, usa «Traducir este video».
              </Notice>
            )}
          </section>
        )}

        {step === 2 && chosen && effectiveApproach === "translate" && (
          <section className="card flex flex-col gap-6 p-5 sm:p-6" aria-labelledby="paso-idioma">
            <div>
              <p className="eyebrow">Paso 3</p>
              <h2 id="paso-idioma" className="mt-1 text-xl font-semibold">
                Idioma y calidad
              </h2>
              <p className="mt-1 text-sm text-muted">HeyGen cobra por cada minuto del video original ({formatDuration(chosen.seconds)}), sin importar cuánto dure la traducción.</p>
            </div>
            {languagesError && (
              <Notice tone="danger">
                <p>{languagesError}</p>
                <Button variant="ghost" size="sm" className="mt-2" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={() => (setLanguagesError(null), setLanguages(null))}>
                  Reintentar
                </Button>
              </Notice>
            )}
            <Field label="Idioma de destino" htmlFor="tr-idioma" hint="La lista sale de tu cuenta de HeyGen.">
              {languages ? (
                <Select id="tr-idioma" value={language ?? ""} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {languageLabel(l)}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="skeleton h-11" aria-busy="true" aria-label="Cargando idiomas" />
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-white">Calidad</legend>
              <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Calidad">
                {TRANSLATION_MODE_ORDER.map((key) => {
                  const info = TRANSLATION_MODES[key];
                  const cost = estimateTranslation(chosen.seconds ?? 0, key);
                  return (
                    <OptionCard key={key} selected={mode === key} onClick={() => setMode(key)} className="flex flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-white">{info.label}</span>
                        <span className="text-xs text-muted">{info.lipsync ? "con labios" : "sin labios"}</span>
                      </span>
                      <span className="font-mono text-lg font-semibold text-white">≈ {formatUsd(cost.usd)}</span>
                      <span className="text-xs text-muted">{formatUsd(info.usdPerMinute)} por minuto</span>
                      <span className="text-xs text-muted">{info.hint}</span>
                    </OptionCard>
                  );
                })}
              </div>
            </fieldset>
            <Field label="Título" htmlFor="tr-titulo" hint="Para encontrarlo en tu lista y en HeyGen.">
              <Input id="tr-titulo" value={title} maxLength={120} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </section>
        )}

        {step === 2 && chosen && effectiveApproach === "regenerate" && source && (
          <>
            <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-texto">
              <div>
                <p className="eyebrow">Paso 3</p>
                <h2 id="paso-texto" className="mt-1 text-xl font-semibold">
                  El texto en el otro idioma
                </h2>
                <p className="mt-1 text-sm text-muted">La IA lo adapta con tu tono y tus palabras (no lo traduce literal). Revísalo: es lo que va a decir tu clon.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Idioma" htmlFor="tr-lang" className="sm:w-72">
                  <Select
                    id="tr-lang"
                    value={langKey}
                    onChange={(e) => {
                      setLangKey(e.target.value);
                      setVoicePreview(null);
                    }}
                  >
                    {CLONE_LANGUAGES.map((l) => (
                      <option key={l.key} value={l.key}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button onClick={adapt} disabled={adapting} icon={adapting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}>
                  {adapting ? "Adaptando…" : text ? "Adaptar de nuevo" : "Adaptar el texto"}
                </Button>
              </div>
              <Field label="Texto hablado" htmlFor="tr-texto" error={text.length > MAX_SCRIPT_CHARS ? `Máximo ${formatNumber(MAX_SCRIPT_CHARS)} caracteres.` : undefined}>
                <Textarea
                  id="tr-texto"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setVoicePreview(null);
                  }}
                  className="!min-h-56 leading-relaxed"
                  placeholder="Toca «Adaptar el texto» o escribe aquí lo que va a decir tu clon."
                />
              </Field>
              {notes.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-xl bg-white/[0.04] p-3 text-xs text-muted">
                  {notes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              )}
              <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted" aria-live="polite">
                <span>{formatNumber(words)} palabras</span>
                <span>≈ {formatDuration(estimateCost({ words, speed: 1, engine: "avatar_iii", resolution: "1080p" }).seconds)} de video</span>
                {source.seconds != null && <span>original: {formatDuration(source.seconds)}</span>}
              </p>
              <Field label="Título" htmlFor="tr-titulo-b">
                <Input id="tr-titulo-b" value={title} maxLength={120} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </section>

            <section className="card flex flex-col gap-5 p-5 sm:p-6" aria-labelledby="paso-clon">
              <div>
                <h2 id="paso-clon" className="text-lg font-semibold">
                  Tu clon y su voz
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {source.avatarId ? "Elegimos el mismo avatar del video original. Puedes cambiarlo." : "Elige tu clon de HeyGen. Se usa la voz que HeyGen clonó de tu video."}
                </p>
              </div>
              <AvatarPicker selectedId={avatar?.id ?? null} onSelect={(a) => (setAvatar(a), setVoicePreview(null), engine && !a.engines.includes(engine) && setEngine(null))} autoSelectId={source.avatarId} />
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Mic className="mt-0.5 h-5 w-5 flex-none text-accent-hi" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-white">Escucha tu voz en {lang.label.toLowerCase()}</p>
                    <p className="text-xs text-muted">
                      {voiceId
                        ? voicePreview
                          ? `Prueba de ${formatDuration(voicePreview.seconds)} (costó ≈ ${formatUsd(Math.max(0.01, voicePreview.costUsd))}).`
                          : "Dice el primer párrafo con tu voz clonada. Cuesta menos de un centavo de tu saldo."
                        : "Elige un avatar con voz propia para probarla."}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {voicePreview && (
                    <Button variant="ghost" size="sm" onClick={togglePlay} icon={playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}>
                      {playing ? "Pausar" : "Escuchar"}
                    </Button>
                  )}
                  <Button size="sm" variant={voicePreview ? "subtle" : "ghost"} onClick={preview} disabled={!voiceId || words < 3 || previewing} icon={previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : undefined}>
                    {previewing ? "Generando…" : voicePreview ? "Probar de nuevo" : "Probar la voz"}
                  </Button>
                </div>
              </div>
            </section>

            {avatar && (
              <section className="card flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="paso-motor">
                <h2 id="paso-motor" className="text-lg font-semibold">
                  Motor
                </h2>
                <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Motor">
                  {ENGINE_ORDER.map((key) => {
                    const info = ENGINES[key];
                    const allowed = avatar.engines.includes(key);
                    const cost = estimateCost({ words, speed: 1, engine: key, resolution: "1080p" });
                    return (
                      <OptionCard key={key} selected={engine === key} disabled={!allowed} onClick={() => setEngine(key)} className="flex flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-white">{info.label}</span>
                          <span className="text-xs text-muted">{info.model}</span>
                        </span>
                        <span className="font-mono text-lg font-semibold text-white">≈ {formatUsd(cost.usd)}</span>
                        <span className="text-xs text-muted">{allowed ? info.hint : "Este avatar no admite este motor."}</span>
                      </OptionCard>
                    );
                  })}
                </div>
                <p className="text-xs text-muted">En {aspectLabel[aspect]?.label.toLowerCase()} y 1080p, como el original. Sin subtítulos quemados: dáselos en el Editor.</p>
                {!engine && <p className="text-xs text-warning">Elige un motor para seguir. No elegimos uno por ti para que no te cobren de más.</p>}
              </section>
            )}
          </>
        )}

        {step === 3 && chosen && estimate && (
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
                <p className="mt-1 text-xs text-muted">≈ {formatCredits(estimate.credits)} de HeyGen</p>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  {effectiveApproach === "translate" && translationEstimate
                    ? `${formatDuration(chosen.seconds)} del original × ${formatUsd(TRANSLATION_MODES[mode].usdPerMinute)}/min (${TRANSLATION_MODES[mode].label})`
                    : regenEstimate && engine
                      ? `${formatNumber(words)} palabras ≈ ${formatDuration(regenEstimate.seconds)} · ${formatUsd(regenEstimate.ratePerMinute)}/min (${ENGINES[engine].label}) × ${regenEstimate.multiplier} (1080p)`
                      : null}
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
                  <p className="mt-1 text-xs text-muted">Después quedarían ≈ {formatUsd(Math.max(0, balance.amount - estimate.usd))}.</p>
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
                Esto cuesta unos {formatUsd(estimate.usd)} y tu saldo de API es {balanceView?.value}. Carga saldo en HeyGen (el plan web no incluye la API) y toca «Actualizar».
              </Notice>
            )}
            {!insufficient && balance && balance.amount == null && (
              <Notice tone="warning">HeyGen no informa un saldo comparable para tu tipo de cuenta. Revisa tu saldo en HeyGen antes de confirmar.</Notice>
            )}

            <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-white/10 p-5 text-sm sm:grid-cols-2">
              {(effectiveApproach === "translate"
                ? [
                    ["Título", finalTitle],
                    ["Video original", chosen.title],
                    ["Idioma", languageLabel(language)],
                    ["Calidad", `${TRANSLATION_MODES[mode].label} (${TRANSLATION_MODES[mode].lipsync ? "con labios sincronizados" : "solo audio"})`],
                    ["Voz", "La tuya, clonada del video"],
                    ["Formato", `${aspectLabel[aspect]?.label ?? aspect}, como el original`],
                  ]
                : [
                    ["Título", finalTitle],
                    ["Video original", chosen.title],
                    ["Idioma", lang.label],
                    ["Avatar", avatar?.name ?? "—"],
                    ["Voz", source?.voiceId ? "La del video original" : "La de tu avatar"],
                    ["Motor", engine ? `${ENGINES[engine].label} (${ENGINES[engine].model})` : "—"],
                  ]
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-white/5 pb-2 sm:block sm:border-0 sm:pb-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium text-white sm:text-left">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-xs leading-relaxed text-placeholder">
              Es una estimación con la tabla de precios de la API de HeyGen (actualizada el {formatDate(TRANSLATION_PRICING_UPDATED_ON)}, ver{" "}
              <a href={PRICING_SOURCE_URL} target="_blank" rel="noreferrer" className="underline hover:text-muted">
                la ayuda de HeyGen
              </a>
              ). {effectiveApproach === "translate" ? "HeyGen no publica un largo máximo para traducir: si tu video es muy largo, puede tardar más o rechazarlo." : ""} El costo real lo
              ves en tu panel de uso de HeyGen.
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
              {insufficient ? "Saldo insuficiente" : effectiveApproach === "translate" ? "Traducir video" : "Generar video"}
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !pending && setConfirmOpen(open)}
        title={`¿${effectiveApproach === "translate" ? "Traducir" : "Generar"} por ≈ ${formatUsd(estimate?.usd)}?`}
        description="Se cobra de tu saldo de API en HeyGen. Una vez enviado, HeyGen no lo cancela."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Revisar de nuevo
            </Button>
            <Button onClick={submit} disabled={pending} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
              {pending ? "Enviando a HeyGen…" : `Sí, por ≈ ${formatUsd(estimate?.usd)}`}
            </Button>
          </>
        }
      />
    </div>
  );
}
