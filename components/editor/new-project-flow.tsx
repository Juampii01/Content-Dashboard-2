"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Ban, Bot, Clapperboard, Library, Monitor, Palette, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { CAPTION_PRESETS } from "@/lib/video/captions";
import { describePreset, type StylePreset } from "@/lib/video/style";
import type { CaptionPresetKey, VideoFormat } from "@/lib/video/types";
import { cn } from "@/lib/utils";
import { createFromCloneAction, createProjectAction, discardDraftAction } from "./actions";
import { CaptionOverlay } from "./caption-overlay";
import { MAX_VIDEO_BYTES_CLIENT, VIDEO_ACCEPT } from "./constants";
import { cancelUpload, startUpload, submitUpload, useUpload } from "./upload-manager";

type ScriptOption = { id: string; title: string; status: string };
type CloneSource = { id: string; title: string; aspectRatio: string; ready: boolean } | null;
export type StyleOption = { id: string; name: string; thumbUrl: string | null; preset: StylePreset; aspect: string };
type BrollAvailability = { stock: boolean; libraryClips: number };

const STEPS = [
  { id: "video", label: "Tu video" },
  { id: "formato", label: "Formato" },
  { id: "estilo", label: "Estilo y b-roll" },
  { id: "subtitulos", label: "Subtítulos" },
  { id: "guion", label: "Guion (opcional)" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Video sin título";

/** Lee ancho y alto del video en el navegador (sin subirlo) para sugerir el formato. */
function readOrientation(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (value: { w: number; h: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    v.onloadedmetadata = () => done(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

export function NewProjectFlow({
  scripts,
  initialScriptId,
  clone,
  styles = [],
  initialStyleId = null,
  broll = { stock: false, libraryClips: 0 },
}: {
  scripts: ScriptOption[];
  initialScriptId: string | null;
  clone: CloneSource;
  styles?: StyleOption[];
  initialStyleId?: string | null;
  broll?: BrollAvailability;
}) {
  const router = useRouter();
  const [step, setStep] = useState<StepId>("video");
  const [visited, setVisited] = useState<Set<StepId>>(new Set(["video"]));
  const [project, setProject] = useState<{ id: string; key: string; mode: "blob" | "local" } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [title, setTitle] = useState(clone?.title ?? "");
  const [format, setFormat] = useState<VideoFormat>(clone?.aspectRatio === "16:9" ? "16:9" : "9:16");
  const [formatTouched, setFormatTouched] = useState(false);
  const [orientation, setOrientation] = useState<"landscape" | "portrait" | null>(clone ? (clone.aspectRatio === "16:9" ? "landscape" : "portrait") : null);
  const initialStyle = styles.find((st) => st.id === initialStyleId) ?? null;
  const [styleId, setStyleId] = useState<string | null>(initialStyle?.id ?? null);
  const [preset, setPreset] = useState<CaptionPresetKey>(initialStyle?.preset.captions ? "estilo" : "clasico");
  const [presetTouched, setPresetTouched] = useState(false);
  // Siempre hay b-roll posible: aunque no haya stock ni clips propios, la IA arma gráficos con tu marca.
  const clipsReady = broll.stock || broll.libraryClips > 0;
  const [brollMode, setBrollMode] = useState<"auto" | "off">("auto");
  const style = styles.find((st) => st.id === styleId) ?? null;
  const presetKeys = (Object.keys(CAPTION_PRESETS) as CaptionPresetKey[]).filter((k) => k !== "estilo" || Boolean(style?.preset.captions));

  function chooseStyle(id: string | null) {
    setStyleId(id);
    const next = styles.find((st) => st.id === id);
    // Al elegir un estilo con subtítulos, se usan los suyos (salvo que la persona ya eligió otros).
    if (!presetTouched) setPreset(next?.preset.captions ? "estilo" : "clasico");
    else if (preset === "estilo" && !next?.preset.captions) setPreset("clasico");
  }
  const [scriptId, setScriptId] = useState<string | null>(initialScriptId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const upload = useUpload(project?.id ?? "");
  const formatTouchedRef = useRef(formatTouched);
  useEffect(() => {
    formatTouchedRef.current = formatTouched;
  }, [formatTouched]);

  const hasSource = Boolean(clone?.ready || project);
  const index = STEPS.findIndex((s) => s.id === step);
  const go = (id: StepId) => {
    setStep(id);
    setVisited((v) => new Set(v).add(id));
  };
  const steps = STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    state: (s.id === step ? "active" : visited.has(s.id) && hasSource ? "done" : "pending") as StepState,
  }));

  async function onFile(file: File) {
    setError(null);
    if (project) {
      cancelUpload(project.id);
      void discardDraftAction(project.id);
      setProject(null);
    }
    setFileName(file.name);
    const nextTitle = title.trim() ? title : titleFromFile(file.name);
    setTitle(nextTitle);
    const dims = await readOrientation(file);
    let nextFormat = format;
    if (dims) {
      const o = dims.w > dims.h ? "landscape" : "portrait";
      setOrientation(o);
      if (!formatTouchedRef.current) {
        nextFormat = "9:16"; // Reels y TikTok primero; un horizontal se recorta y se puede mover el encuadre.
        setFormat(nextFormat);
      }
    }
    const result = await createProjectAction({ title: nextTitle, fileName: file.name, fileType: file.type, fileSize: file.size, format: nextFormat, preset, scriptId, styleId, brollMode });
    if (!result.ok || !result.data) {
      setError(result.ok ? "No pudimos preparar la subida." : result.error);
      return;
    }
    setProject(result.data);
    startUpload({ file, projectId: result.data.id, key: result.data.key, mode: result.data.mode });
  }

  function process() {
    startSubmit(async () => {
      if (clone) {
        const result = await createFromCloneAction(clone.id, format, preset, { styleId, brollMode });
        if (result && !result.ok) toast.error(result.error);
        return;
      }
      if (!project) return;
      const result = await submitUpload(project.id, { title: title.trim() || "Video sin título", format, preset, scriptId, styleId, brollMode });
      if (!result.ok && result.error) {
        toast.error(result.error);
        return;
      }
      router.push(`/editor/${project.id}`);
    });
  }

  const uploadPct = upload?.total ? (upload.loaded / upload.total) * 100 : 0;
  const uploadStatus = !upload ? "idle" : upload.status === "uploading" ? "uploading" : upload.status === "error" ? "error" : "done";

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="lg:pt-2">
        <Steps steps={steps} onSelect={(id) => go(id as StepId)} />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div key={step} className="card animate-step-in flex flex-col gap-5 p-5 sm:p-7">
          {step === "video" && (
            <>
              <div>
                <h2 className="text-lg font-semibold">Sube tu video crudo</h2>
                <p className="mt-1 text-sm text-muted">Un video donde hablas a cámara, tal como lo grabaste. Mientras sube, puedes seguir con los pasos.</p>
              </div>
              {clone ? (
                <div className="flex items-center gap-4 rounded-2xl border border-accent/40 bg-accent/10 p-4">
                  <div className="tile-icon h-11 w-11">
                    <Bot className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-accent-glow">Video con clon</p>
                    <p className="truncate text-sm font-semibold text-white">{clone.title}</p>
                    {!clone.ready && <p className="text-xs text-warning">Todavía se está generando en HeyGen. Vuelve cuando esté listo.</p>}
                  </div>
                </div>
              ) : (
                <UploadDropzone
                  accept={VIDEO_ACCEPT}
                  acceptLabel="un video MP4, MOV, WEBM o MKV"
                  maxSize={MAX_VIDEO_BYTES_CLIENT}
                  status={uploadStatus}
                  progress={uploadPct}
                  fileName={fileName ?? undefined}
                  error={error ?? (upload?.status === "error" ? upload.error : null)}
                  onCancel={
                    project
                      ? () => {
                          cancelUpload(project.id);
                          void discardDraftAction(project.id);
                          setProject(null);
                          setFileName(null);
                        }
                      : undefined
                  }
                  onFiles={([file]) => file && void onFile(file)}
                  title="Arrastra tu video aquí"
                  hint="MP4, MOV, WEBM o MKV, hasta 8 GB y 20 minutos"
                />
              )}
              <Field label="Nombre" htmlFor="title" hint="Para encontrarlo después. No aparece en el video.">
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Por ejemplo: El error de la primera llamada" />
              </Field>
            </>
          )}

          {step === "formato" && (
            <>
              <div>
                <h2 className="text-lg font-semibold">¿Dónde lo vas a publicar?</h2>
                <p className="mt-1 text-sm text-muted">Puedes cambiarlo después, en la revisión.</p>
              </div>
              <div role="radiogroup" aria-label="Formato" className="grid gap-3 sm:grid-cols-2">
                {[
                  { value: "9:16" as const, label: "Vertical 9:16", hint: "Reels, TikTok y Shorts", icon: Smartphone },
                  { value: "16:9" as const, label: "Horizontal 16:9", hint: "YouTube", icon: Monitor },
                ].map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={format === f.value}
                    onClick={() => {
                      setFormat(f.value);
                      setFormatTouched(true);
                    }}
                    className={cn("flex items-center gap-4 rounded-2xl border p-4 text-left transition", format === f.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                  >
                    <span className="tile-icon h-11 w-11">
                      <f.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-white">{f.label}</span>
                      <span className="text-xs text-muted">{f.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              {orientation === "landscape" && format === "9:16" && (
                <Notice tone="info">Tu video es horizontal: lo recortamos al centro y en la revisión puedes mover el encuadre para que quedes bien.</Notice>
              )}
              {orientation === "portrait" && format === "16:9" && <Notice tone="info">Tu video es vertical: queda al centro, sobre un fondo desenfocado del mismo video.</Notice>}
            </>
          )}

          {step === "estilo" && (
            <>
              <div>
                <h2 className="text-lg font-semibold">¿Lo editamos como algún video que te guste?</h2>
                <p className="mt-1 text-sm text-muted">
                  Un estilo copia el ritmo de cortes, los zooms, el b-roll y los subtítulos de un video de referencia.{" "}
                  <Link href="/editor/estilos" className="font-semibold text-accent-hi hover:underline">
                    Crear un estilo
                  </Link>
                </p>
              </div>
              <div role="radiogroup" aria-label="Estilo de edición" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <button
                  type="button"
                  role="radio"
                  aria-checked={styleId == null}
                  onClick={() => chooseStyle(null)}
                  className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition", styleId == null ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                >
                  <span className="tile-icon h-11 w-11 flex-none">
                    <Ban className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">Sin estilo</span>
                    <span className="text-xs text-muted">Cortes y subtítulos de siempre, con tu marca.</span>
                  </span>
                </button>
                {styles.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    role="radio"
                    aria-checked={styleId === st.id}
                    onClick={() => chooseStyle(st.id)}
                    className={cn("flex gap-3 rounded-2xl border p-3 text-left transition", styleId === st.id ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                  >
                    <span className={cn("relative flex-none overflow-hidden rounded-lg bg-black/40", st.aspect === "16:9" ? "aspect-video w-20 self-center" : "aspect-[9/16] w-12")}>
                      {st.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={st.thumbUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Palette className="m-auto h-5 w-5 text-placeholder" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{st.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">{describePreset(st.preset).join(" · ")}</span>
                    </span>
                  </button>
                ))}
              </div>
              {styles.length === 0 && (
                <Notice tone="info">
                  Todavía no tienes estilos. Crea uno en{" "}
                  <Link href="/editor/estilos" className="font-semibold text-accent-hi hover:underline">
                    Estilos
                  </Link>{" "}
                  subiendo un reel que te guste o pegando su link.
                </Notice>
              )}

              <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
                <div>
                  <h3 className="text-base font-semibold">B-roll</h3>
                  <p className="mt-1 text-sm text-muted">
                    Tomas de apoyo y gráficos animados con tu marca que tapan unos segundos mientras tu voz sigue. Los elige la IA según lo que dices
                    {style?.preset.broll.enabled ? ", con la cadencia del estilo" : ""}; en la revisión puedes cambiarlas o quitarlas.
                  </p>
                </div>
                <div role="radiogroup" aria-label="B-roll" className="grid gap-3 sm:grid-cols-2">
                  {[
                    { value: "auto" as const, label: "Agregar b-roll", hint: ["Gráficos con tu marca", broll.libraryClips ? `${broll.libraryClips} clips de tu biblioteca` : null, broll.stock ? "videos de stock" : null].filter(Boolean).join(", "), icon: Clapperboard },
                    { value: "off" as const, label: "Sin b-roll", hint: "Solo tú en cámara.", icon: Ban },
                  ].map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={brollMode === o.value}
                      onClick={() => setBrollMode(o.value)}
                      className={cn("flex items-center gap-4 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50", brollMode === o.value ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                    >
                      <span className="tile-icon h-11 w-11 flex-none">
                        <o.icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-white">{o.label}</span>
                        <span className="text-xs text-muted">{o.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {!clipsReady && (
                  <p className="text-xs text-muted">
                    <Library className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                    Por ahora el b-roll será de gráficos. Para sumar tomas de video, sube tus clips a la{" "}
                    <Link href="/editor/biblioteca" className="font-semibold text-accent-hi hover:underline">
                      biblioteca de b-roll
                    </Link>
                    .
                  </p>
                )}
              </div>
            </>
          )}

          {step === "subtitulos" && (
            <>
              <div>
                <h2 className="text-lg font-semibold">Estilo de subtítulos</h2>
                <p className="mt-1 text-sm text-muted">
                  {style?.preset.captions ? "Puedes usar los del estilo que elegiste o los de tu marca." : "Usan el color de acento de Mi marca."} Siempre recibes también el archivo SRT.
                </p>
              </div>
              <div role="radiogroup" aria-label="Estilo de subtítulos" className={cn("grid gap-3", presetKeys.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-3")}>
                {presetKeys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={preset === k}
                    onClick={() => {
                      setPreset(k);
                      setPresetTouched(true);
                    }}
                    className={cn("flex flex-col gap-3 rounded-2xl border p-3 text-left transition", preset === k ? "border-accent bg-accent/15" : "border-white/10 hover:border-white/25")}
                  >
                    <PresetSample preset={k} captionStyle={style?.preset.captions ?? null} />
                    <span className="px-1">
                      <span className="block text-sm font-semibold text-white">{CAPTION_PRESETS[k].label}</span>
                      <span className="text-xs text-muted">{CAPTION_PRESETS[k].description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "guion" && (
            <>
              <div>
                <h2 className="text-lg font-semibold">¿Lo grabaste con un guion?</h2>
                <p className="mt-1 text-sm text-muted">Con el guion detectamos mejor las tomas repetidas y corregimos cómo se escriben las palabras en los subtítulos.</p>
              </div>
              <Field label="Guion" htmlFor="script" hint={scripts.length ? undefined : "Todavía no tienes guiones. Puedes seguir sin guion."}>
                <Select id="script" value={scriptId ?? ""} onChange={(e) => setScriptId(e.target.value || null)}>
                  <option value="">Sin guion</option>
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" disabled={index === 0} icon={<ArrowLeft className="h-4 w-4" aria-hidden />} onClick={() => go(STEPS[Math.max(0, index - 1)]!.id)}>
            Atrás
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {upload?.status === "uploading" && <span className="text-xs text-muted">Subiendo {Math.round(uploadPct)} %…</span>}
            {index < STEPS.length - 1 && (
              <Button variant="ghost" disabled={!hasSource} onClick={() => go(STEPS[index + 1]!.id)}>
                Siguiente <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            )}
            <Button onClick={process} disabled={!hasSource || submitting || upload?.status === "error" || (clone ? !clone.ready : false)} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
              {submitting ? "Enviando…" : "Procesar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetSample({ preset, captionStyle }: { preset: CaptionPresetKey; captionStyle?: StylePreset["captions"] }) {
  const block = {
    start: 0,
    end: 2,
    words: [
      { id: 1, text: "Esto", start: 0, end: 0.4, emphasis: false, stop: false },
      { id: 2, text: "cambia", start: 0.4, end: 0.9, emphasis: preset === "pop", stop: false },
      ...(preset === "pop" || (preset === "estilo" && (captionStyle?.wordsPerBlock ?? 3) < 3) ? [] : [{ id: 3, text: "todo", start: 0.9, end: 1.4, emphasis: false, stop: true }]),
    ],
  };
  return (
    <div className="relative aspect-[9/12] w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#1b2b55] via-[#0c1838] to-[#050b20]">
      <div className="absolute top-[18%] left-1/2 h-[38%] w-[46%] -translate-x-1/2 rounded-[45%] bg-white/10" aria-hidden />
      {preset === "ninguno" ? (
        <span className="absolute inset-x-0 bottom-[22%] text-center text-xs text-muted">Sin texto en pantalla</span>
      ) : (
        <CaptionOverlay block={block} time={0.5} preset={preset} format="9:16" accent="#FFD84D" height={430} captionStyle={captionStyle} />
      )}
    </div>
  );
}
