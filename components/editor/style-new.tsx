"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { VIDEO_ACCEPT } from "./constants";
import { completeStyleUploadAction, createStyleLinkAction, createStyleUploadAction } from "./media-actions";
import { putFile } from "./upload-manager";

const MAX_REFERENCE = 1024 ** 3;

const nameFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || "Mi estilo";

/**
 * Nuevo estilo desde un video de referencia: se sube el archivo (directo al almacenamiento, como el original
 * de un proyecto) o se pega un link de Instagram, TikTok o YouTube que baja el worker.
 */
export function NewStyle({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<"upload" | "link">("upload");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const abort = useRef<AbortController | null>(null);

  function reset() {
    setName("");
    setLink("");
    setFile(null);
    setProgress(null);
  }

  function submit() {
    setError(null);
    start(async () => {
      if (source === "link") {
        const result = await createStyleLinkAction({ name: name.trim() || "Estilo de referencia", link });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success("Estamos analizando el video. Puedes salir y volver.");
        reset();
        router.refresh();
        return;
      }
      if (!file) {
        setError("Elige el video de referencia.");
        return;
      }
      const created = await createStyleUploadAction({ name: name.trim() || nameFromFile(file.name), fileName: file.name, fileType: file.type, fileSize: file.size });
      if (!created.ok || !created.data) {
        setError(created.ok ? "No pudimos preparar la subida." : created.error);
        return;
      }
      const controller = new AbortController();
      abort.current = controller;
      setProgress(0);
      try {
        await putFile({ file, key: created.data.key, mode: created.data.mode, clientPayload: `estilo:${created.data.id}`, signal: controller.signal, onProgress: (loaded) => setProgress((loaded / file.size) * 100) });
      } catch (e) {
        setProgress(null);
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error && /[áéíóú]|subida|archivo/i.test(e.message) ? e.message : "La subida falló. Vuelve a intentarlo.");
        return;
      }
      const done = await completeStyleUploadAction(created.data.id);
      if (!done.ok) {
        setError(done.error);
        setProgress(null);
        return;
      }
      toast.success("Estamos analizando el video. Puedes salir y volver.");
      reset();
      router.refresh();
    });
  }

  const uploading = progress != null;
  return (
    <section aria-labelledby="new-style-title" className="card flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1.5">Edita como este</p>
          <h2 id="new-style-title" className="text-lg font-semibold">
            Crea un estilo a partir de un video que te guste
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Medimos el ritmo de cortes, los zooms, el b-roll y cómo son los subtítulos. Copiamos el estilo, nunca el contenido: el video se borra después del análisis.
          </p>
        </div>
        <SegmentedControl
          label="Origen del video"
          value={source}
          onValueChange={(v) => {
            setSource(v);
            setError(null);
          }}
          options={[
            { value: "upload", label: "Subir un video", icon: <Upload className="h-3.5 w-3.5" aria-hidden /> },
            { value: "link", label: "Pegar un link", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />
      </div>

      {source === "upload" ? (
        <UploadDropzone
          accept={VIDEO_ACCEPT}
          acceptLabel="un video MP4, MOV, WEBM o MKV"
          maxSize={MAX_REFERENCE}
          disabled={!canEdit || pending}
          status={uploading ? "uploading" : file ? "done" : "idle"}
          progress={progress ?? undefined}
          fileName={file?.name}
          error={error}
          onCancel={uploading ? () => abort.current?.abort() : undefined}
          onFiles={([f]) => {
            if (!f) return;
            setFile(f);
            setError(null);
            if (!name.trim()) setName(nameFromFile(f.name));
          }}
          title="Arrastra el video de referencia"
          hint="Un reel, un TikTok o un short que te guste cómo está editado. Hasta 1 GB."
        />
      ) : (
        <Field label="Link del video" htmlFor="style-link" hint="De Instagram, TikTok o YouTube. Si el link es privado o pide iniciar sesión, descarga el video y súbelo." error={error ?? undefined}>
          <Input id="style-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" disabled={!canEdit || pending} />
        </Field>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nombre del estilo" htmlFor="style-name" className="min-w-0 flex-1">
          <Input id="style-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Por ejemplo: Reels rápidos con zooms" disabled={!canEdit || pending} />
        </Field>
        <Button onClick={submit} disabled={!canEdit || pending || (source === "upload" ? !file : link.trim().length < 8)} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
          {uploading ? `Subiendo ${Math.round(progress ?? 0)} %…` : pending ? "Enviando…" : "Analizar estilo"}
        </Button>
      </div>
      {source === "upload" && error && !file && <Notice tone="danger">{error}</Notice>}
      {!canEdit && <Notice tone="warning">Tu usuario es de solo lectura: puedes ver los estilos, pero no crear nuevos.</Notice>}
    </section>
  );
}
