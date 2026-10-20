"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Images, Link2, ScanSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice, Progress } from "@/components/ui/feedback";
import { Steps, type StepState } from "@/components/ui/steps";
import { SegmentedControl } from "@/components/ui/tabs";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { cn } from "@/lib/utils";
import { analyzeTemplateAction, startTemplateAction } from "./template-actions";
import { downscaleImage, uploadImage } from "./upload";

type Source = "upload" | "link";
type Picked = { id: string; file: File; url: string };
const MIN = 2;
const MAX = 20;
const LINK_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/?(\?.*)?$/;

/**
 * Copiar el estilo de un carrusel: las imágenes (o el link) solo sirven para el análisis y se borran al terminar.
 * Paso 1: referencia. Paso 2: subir y analizar (sigue en la página de la plantilla, se puede salir y volver).
 */
export function NewTemplateFlow({ storageReady }: { storageReady: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("upload");
  const [files, setFiles] = useState<Picked[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"referencia" | "analizar">("referencia");
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Las miniaturas locales (blob:) se liberan al quitar una imagen y al salir de la página.
  const urls = useRef<string[]>([]);
  useEffect(() => {
    urls.current = files.map((f) => f.url);
  }, [files]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (list: File[]) => {
    setError(null);
    setFiles((current) => {
      const next = [...current, ...list.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) }))];
      next.sort((a, b) => a.file.name.localeCompare(b.file.name, "es", { numeric: true }));
      if (next.length > MAX) setError(`Se usan las primeras ${MAX} imágenes.`);
      return next.slice(0, MAX);
    });
  };
  const removeFile = (id: string) =>
    setFiles((current) => {
      const gone = current.find((f) => f.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((f) => f.id !== id);
    });

  const linkOk = LINK_RE.test(url.trim());
  const ready = source === "upload" ? files.length >= MIN : linkOk;
  const states = (["referencia", "analizar"] as const).map((id, i): { id: string; label: string; state: StepState } => ({
    id,
    label: i === 0 ? "Referencia" : "Copiar el estilo",
    state: id === step ? "active" : step === "analizar" && id === "referencia" ? "done" : "pending",
  }));

  async function run() {
    setError(null);
    setBusy({ done: 0, total: source === "upload" ? files.length : 1, label: "Preparando" });
    try {
      const created = await startTemplateAction(source === "link" ? { source: "link", url: url.trim(), name } : { source: "upload", name });
      if (!created.ok || !created.data) throw new Error(created.ok ? "No pudimos crear la plantilla." : created.error);
      const id = created.data;
      if (source === "upload") {
        const keys: string[] = [];
        for (let i = 0; i < files.length; i++) {
          setBusy({ done: i, total: files.length, label: `Subiendo ${i + 1} de ${files.length}` });
          const blob = await downscaleImage(files[i]!.file, 1600);
          const res = await uploadImage(`/api/carruseles/subir?tipo=referencia&plantilla=${id}&n=${i + 1}`, blob);
          keys.push(res.key);
        }
        setBusy({ done: files.length, total: files.length, label: "Empezando el análisis" });
        const analyzed = await analyzeTemplateAction(id, keys);
        if (!analyzed.ok) throw new Error(analyzed.error);
      }
      router.push(`/carruseles/plantillas/${id}`);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Algo salió mal. Prueba de nuevo.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <Steps steps={states} onSelect={(id) => !busy && setStep(id as typeof step)} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {!storageReady && <Notice tone="warning">Falta configurar el almacenamiento de archivos en esta instalación. Avísale a soporte.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {step === "referencia" && (
          <div className="card flex flex-col gap-5 p-5 sm:p-6">
            <div>
              <p className="eyebrow mb-1">Paso 1</p>
              <h2 className="text-lg font-semibold">¿Qué carrusel quieres copiar?</h2>
              <p className="mt-1 text-sm text-muted">Copiamos su diseño (colores, letra, composición y adornos), nunca sus textos, fotos ni logos. Las imágenes se borran después del análisis.</p>
            </div>
            <SegmentedControl
              label="De dónde sale la referencia"
              value={source}
              onValueChange={(v) => (setSource(v), setError(null))}
              options={[
                { value: "upload", label: "Subir imágenes", icon: <Images className="h-4 w-4" aria-hidden /> },
                { value: "link", label: "Pegar link", icon: <Link2 className="h-4 w-4" aria-hidden /> },
              ]}
            />
            {source === "upload" ? (
              <div className="flex flex-col gap-3">
                <UploadDropzone
                  onFiles={addFiles}
                  multiple
                  accept={["image/jpeg", "image/png", "image/webp", ".jpg", ".jpeg", ".png", ".webp"]}
                  acceptLabel="imágenes JPG, PNG o WebP"
                  maxSize={25 * 1024 * 1024}
                  title="Arrastra aquí los slides del carrusel"
                  hint="De 2 a 20 imágenes, en orden (se ordenan por nombre de archivo)."
                  disabled={Boolean(busy)}
                />
                {files.length > 0 && (
                  <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8" aria-label="Imágenes elegidas">
                    {files.map((f, i) => (
                      <li key={f.id} className="relative overflow-hidden rounded-lg border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) que no sale del navegador */}
                        <img src={f.url} alt={`Slide ${i + 1}`} className="aspect-[4/5] w-full object-cover" />
                        <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 font-mono text-[10px] font-bold text-white">{i + 1}</span>
                        <button type="button" onClick={() => removeFile(f.id)} disabled={Boolean(busy)} aria-label={`Quitar la imagen ${i + 1}`} className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black">
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className={cn("text-xs", files.length && files.length < MIN ? "text-warning" : "text-muted")}>
                  {files.length === 0 ? "Todavía no elegiste imágenes." : files.length < MIN ? "Sube al menos 2 slides para copiar el estilo." : `${files.length} slides listos.`}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Field label="Link del carrusel de Instagram" htmlFor="ref-url" hint="Si Instagram no nos deja bajarlo, te pedimos que subas las imágenes.">
                  <Input id="ref-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/…" inputMode="url" autoComplete="off" />
                </Field>
                {url.trim() && !linkOk && <p className="text-xs text-warning">Ese link no parece de una publicación de Instagram (instagram.com/p/…).</p>}
              </div>
            )}
            <Field label="Nombre de la plantilla (opcional)" htmlFor="ref-name" hint="Puedes cambiarlo después.">
              <Input id="ref-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Editorial crema, Tweet limpio…" />
            </Field>
          </div>
        )}

        {step === "analizar" && (
          <div className="card flex flex-col gap-4 p-5 sm:p-6">
            <div>
              <p className="eyebrow mb-1">Paso 2</p>
              <h2 className="text-lg font-semibold">Copiar el estilo</h2>
              <p className="mt-1 text-sm text-muted">
                Medimos los textos, los colores y la composición de cada slide, y la IA arma tu plantilla. Tarda menos de un minuto; puedes salir y volver.
              </p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Referencia</dt>
                <dd className="mt-0.5 truncate font-semibold text-white">{source === "upload" ? `${files.length} imágenes` : url.trim()}</dd>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <dt className="text-xs text-muted">Nombre</dt>
                <dd className="mt-0.5 truncate font-semibold text-white">{name.trim() || "Lo ponemos nosotros (puedes cambiarlo)"}</dd>
              </div>
            </dl>
            {busy && <Progress value={(busy.done / Math.max(1, busy.total)) * 100} label={busy.label} />}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {step === "analizar" && (
            <Button variant="ghost" onClick={() => setStep("referencia")} disabled={Boolean(busy)} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
              Atrás
            </Button>
          )}
          {step === "referencia" ? (
            <Button onClick={() => setStep("analizar")} disabled={!ready || !storageReady} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
              Siguiente
            </Button>
          ) : (
            <Button onClick={() => void run()} disabled={!ready || Boolean(busy) || !storageReady} icon={<ScanSearch className="h-4 w-4" aria-hidden />}>
              {busy ? "Preparando…" : "Copiar estilo"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
