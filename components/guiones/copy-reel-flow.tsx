"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Link2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { completeCopyUploadAction, createCopyLinkAction, createCopyUploadAction } from "./copy-actions";
import { uploadReel } from "./copy-upload";

const VIDEO_ACCEPT = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-m4v", ".mp4", ".mov", ".webm", ".mkv", ".m4v"];
const MAX_BYTES = 1024 ** 3;

const objectives = [
  { value: "alcance", label: "Llegar a gente nueva", hint: "El CTA pide compartir o guardar." },
  { value: "seguidores", label: "Ganar seguidores", hint: "El CTA invita a seguirte." },
  { value: "ventas", label: "Generar ventas", hint: "El CTA lleva a tu oferta." },
] as const;
type Objective = (typeof objectives)[number]["value"];

const STEPS = [
  { id: "reel", label: "El reel" },
  { id: "version", label: "Tu versión" },
  { id: "analisis", label: "Analizamos" },
  { id: "resultado", label: "Tu guion y tu estilo" },
];

/** Plataformas que sabemos bajar (lo mismo que valida el servidor). */
function platformOf(link: string): string | null {
  try {
    const host = new URL(link.trim()).hostname.replace(/^www\.|^m\./, "");
    if (host.endsWith("instagram.com")) return "Instagram";
    if (host.endsWith("tiktok.com")) return "TikTok";
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "YouTube";
  } catch {}
  return null;
}

/**
 * "Copia este reel": 1) el reel (link o archivo), 2) el tema y el objetivo de la versión propia. Al enviar se abre la
 * página de la copia, que muestra el progreso real (pasos 3 y 4) y se puede dejar corriendo.
 */
export function CopyReelFlow({
  pillars,
  aiReady,
  brandReady,
  canEdit,
  initialLink = "",
  initialSource = "link",
}: {
  pillars: string[];
  aiReady: boolean;
  brandReady: boolean;
  canEdit: boolean;
  initialLink?: string;
  initialSource?: "link" | "upload";
}) {
  const router = useRouter();
  const [step, setStep] = useState<"reel" | "version">("reel");
  const [source, setSource] = useState<"link" | "upload">(initialSource);
  const [link, setLink] = useState(initialLink);
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState<Objective>("seguidores");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const abort = useRef<AbortController | null>(null);

  // La página puede quedar viva en segundo plano al navegar: al terminar se vuelve al paso 1 vacío.
  function reset() {
    setStep("reel");
    setLink("");
    setFile(null);
    setTopic("");
    setProgress(null);
  }

  const platform = platformOf(link);
  const reelReady = source === "link" ? Boolean(platform) : Boolean(file);
  const disabled = !canEdit || !aiReady || pending;

  const states: StepState[] = step === "reel" ? ["active", "pending", "pending", "pending"] : ["done", "active", "pending", "pending"];

  function next() {
    setError(null);
    if (source === "link" && !platform) {
      setError("Pega el link de un reel de Instagram, un TikTok o un short de YouTube (empieza con https://).");
      return;
    }
    if (source === "upload" && !file) {
      setError("Elige el archivo del video.");
      return;
    }
    setStep("version");
  }

  function submit() {
    setError(null);
    start(async () => {
      if (source === "link") {
        const result = await createCopyLinkAction({ link, topic, objective });
        if (!result.ok || !result.data) {
          setError(result.ok ? "No pudimos empezar la copia." : result.error);
          return;
        }
        toast.success("Estamos analizando el reel. Puedes salir y volver.");
        reset();
        router.push(`/guiones/copiar/${result.data.id}`);
        return;
      }
      if (!file) return;
      const created = await createCopyUploadAction({ fileName: file.name, fileType: file.type, fileSize: file.size, topic, objective });
      if (!created.ok || !created.data) {
        setError(created.ok ? "No pudimos preparar la subida." : created.error);
        return;
      }
      const controller = new AbortController();
      abort.current = controller;
      setProgress(0);
      try {
        await uploadReel({ file, key: created.data.key, styleId: created.data.styleId, mode: created.data.mode, signal: controller.signal, onProgress: (loaded) => setProgress((loaded / file.size) * 100) });
      } catch (e) {
        setProgress(null);
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message) ? e.message : "La subida falló. Vuelve a intentarlo.");
        return;
      }
      const done = await completeCopyUploadAction(created.data.id);
      if (!done.ok) {
        setProgress(null);
        setError(done.error);
        return;
      }
      toast.success("Estamos analizando el reel. Puedes salir y volver.");
      reset();
      router.push(`/guiones/copiar/${created.data.id}`);
    });
  }

  const uploading = progress != null;
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <Steps steps={STEPS.map((s, i) => ({ ...s, state: states[i]! }))} onSelect={(id) => id === "reel" && !pending && setStep("reel")} />
      </aside>

      <div className="flex min-w-0 flex-col gap-5">
        {!aiReady && <Notice tone="warning">La IA todavía no está configurada en esta instalación (falta ANTHROPIC_API_KEY). Avísale a soporte.</Notice>}
        {!canEdit && <Notice tone="warning">Tu usuario es de solo lectura: puedes ver las copias, pero no crear nuevas.</Notice>}

        {step === "reel" ? (
          <section aria-labelledby="copy-step-reel" className="card animate-step-in flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow mb-1.5">Paso 1</p>
                <h2 id="copy-step-reel" className="text-lg font-semibold">
                  ¿Qué video quieres copiar?
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-muted">Un reel, un TikTok o un short hablado que funcionó muy bien, de cualquier cuenta. Hasta 3 minutos.</p>
              </div>
              <SegmentedControl
                label="Origen del video"
                value={source}
                onValueChange={(v) => {
                  setSource(v);
                  setError(null);
                }}
                options={[
                  { value: "link", label: "Pegar un link", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
                  { value: "upload", label: "Subir el archivo", icon: <Upload className="h-3.5 w-3.5" aria-hidden /> },
                ]}
              />
            </div>

            {source === "link" ? (
              <Field
                label="Link del video"
                htmlFor="copy-link"
                hint={platform ? `Video de ${platform}. ${platform === "Instagram" ? "Si Instagram pide iniciar sesión, te vamos a pedir el archivo." : ""}` : "De Instagram, TikTok o YouTube Shorts. Si es privado o pide iniciar sesión, descarga el video y súbelo."}
                error={error ?? undefined}
              >
                <Input id="copy-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" disabled={disabled} />
              </Field>
            ) : (
              <UploadDropzone
                accept={VIDEO_ACCEPT}
                acceptLabel="un video MP4, MOV, WEBM o MKV"
                maxSize={MAX_BYTES}
                disabled={disabled}
                status={file ? "done" : "idle"}
                fileName={file?.name}
                error={error}
                onFiles={([f]) => {
                  if (!f) return;
                  setFile(f);
                  setError(null);
                }}
                title="Arrastra el video que quieres copiar"
                hint="El archivo del reel, TikTok o short. Hasta 1 GB."
              />
            )}

            <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-accent-hi" aria-hidden />
              <span>
                Copiamos la estructura y el estilo de edición, nunca el contenido. El video se analiza y se borra al terminar: no lo guardamos ni lo volvemos a mostrar.
              </span>
            </p>

            <div className="flex justify-end">
              <Button className="w-full sm:w-auto" onClick={next} disabled={disabled || !reelReady} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                Siguiente
              </Button>
            </div>
          </section>
        ) : (
          <section aria-labelledby="copy-step-version" className="card animate-step-in flex flex-col gap-5 p-5 sm:p-6">
            <div>
              <p className="eyebrow mb-1.5">Paso 2</p>
              <h2 id="copy-step-version" className="text-lg font-semibold">
                ¿Sobre qué quieres tu versión?
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">Usamos la misma estructura del original con tu tema y tu voz. Si lo dejas vacío, elegimos el tema según tu marca.</p>
            </div>

            {!brandReady && (
              <Notice tone="info" title="Tip: completa Mi marca">
                Sin perfil de marca la versión sale correcta pero genérica. Con tu nicho y cómo hablas, suena a ti.
              </Notice>
            )}

            <Field label="Tu tema" htmlFor="copy-topic" hint="Opcional. Una o dos frases: el problema, la idea o la historia que quieres contar.">
              <Textarea id="copy-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} className="!min-h-20" placeholder="Por ejemplo: cómo conseguir los primeros clientes de una agencia sin pagar anuncios" disabled={disabled} />
            </Field>
            {pillars.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted">O parte de uno de tus pilares:</span>
                <div className="flex flex-wrap gap-1.5">
                  {pillars.map((p) => (
                    <button key={p} type="button" className="pill transition hover:!text-white" aria-pressed={topic === p} onClick={() => setTopic(p)} disabled={disabled}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-white">Objetivo</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {objectives.map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => setObjective(o.value)}
                    aria-pressed={objective === o.value}
                    disabled={disabled}
                    className={`rounded-xl border px-4 py-3 text-left transition ${objective === o.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25"}`}
                  >
                    <span className="block text-sm font-semibold text-white">{o.label}</span>
                    <span className="text-xs text-muted">{o.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <Notice tone="danger">{error}</Notice>}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("reel")} disabled={pending} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
                Cambiar el video
              </Button>
              <div className="flex flex-col gap-2 sm:items-end">
                <Button onClick={submit} disabled={disabled} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
                  {uploading ? `Subiendo ${Math.round(progress ?? 0)} %…` : pending ? "Enviando…" : "Copiar la estructura"}
                </Button>
                {uploading && (
                  <button type="button" className="text-xs text-muted underline-offset-2 hover:text-white hover:underline" onClick={() => abort.current?.abort()}>
                    Cancelar la subida
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
