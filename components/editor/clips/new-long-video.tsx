"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Scissors, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/tabs";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { MAX_VIDEO_BYTES_CLIENT, VIDEO_ACCEPT } from "../constants";
import { createLongLinkAction, createLongUploadAction } from "./actions";
import { startLongUpload } from "./upload-store";

const nameFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 100) || "Mi video largo";

/** Paso 1: subir el video largo (directo al almacenamiento privado) o pegar un link que baja el worker. */
export function NewLongVideo({ canEdit, storageReady }: { canEdit: boolean; storageReady: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<"upload" | "link">("upload");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const disabled = !canEdit || !storageReady || pending;

  function submit() {
    setError(null);
    start(async () => {
      if (source === "link") {
        const result = await createLongLinkAction({ title: title.trim() || "Video de YouTube", link });
        if (!result.ok || !result.data) {
          setError(result.ok ? "No pudimos empezar." : result.error);
          return;
        }
        router.push(`/editor/clips/${result.data.id}`);
        return;
      }
      if (!file) {
        setError("Elige el video.");
        return;
      }
      const created = await createLongUploadAction({ title: title.trim() || nameFromFile(file.name), fileName: file.name, fileType: file.type, fileSize: file.size });
      if (!created.ok || !created.data) {
        setError(created.ok ? "No pudimos preparar la subida." : created.error);
        return;
      }
      const { id, key, mode } = created.data;
      startLongUpload({ id, key, mode, file, onDone: () => router.refresh() });
      router.push(`/editor/clips/${id}`);
    });
  }

  return (
    <section aria-labelledby="new-long-title" className="card flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5">Paso 1 · Sube el video</p>
          <h2 id="new-long-title" className="text-lg font-semibold">
            Un podcast, un live o un video de YouTube
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">De 10 a 120 minutos. Buscamos los momentos que se entienden solos, los recortamos a vertical siguiendo tu cara y te los dejamos listos para editar o exportar.</p>
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
          maxSize={MAX_VIDEO_BYTES_CLIENT}
          disabled={disabled}
          status={file ? "done" : "idle"}
          fileName={file?.name}
          error={error}
          onFiles={([f]) => {
            if (!f) return;
            setFile(f);
            setError(null);
            if (!title.trim()) setTitle(nameFromFile(f.name));
          }}
          title="Arrastra el video largo"
          hint="Hasta 8 GB. La subida sigue aunque vayas a otra sección de la app (no cierres la pestaña)."
        />
      ) : (
        <Field label="Link del video" htmlFor="long-link" hint="De YouTube (también Instagram o TikTok). Si el video es privado o pide iniciar sesión, descárgalo y súbelo." error={error ?? undefined}>
          <Input id="long-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={disabled} />
        </Field>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Nombre" htmlFor="long-title" className="min-w-0 flex-1">
          <Input id="long-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Por ejemplo: Podcast #12 con Ana" disabled={disabled} />
        </Field>
        <Button className="w-full sm:w-auto" onClick={submit} disabled={disabled || (source === "upload" ? !file : link.trim().length < 8)} icon={<Scissors className="h-4 w-4" aria-hidden />}>
          {pending ? "Enviando…" : "Buscar clips"}
        </Button>
      </div>
      {source === "upload" && error && !file && <Notice tone="danger">{error}</Notice>}
      {!canEdit && <Notice tone="warning">Tu usuario es de solo lectura: puedes ver los clips, pero no subir videos nuevos.</Notice>}
    </section>
  );
}
