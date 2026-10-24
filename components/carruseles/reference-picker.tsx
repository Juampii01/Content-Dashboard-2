"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { cn } from "@/lib/utils";
import { downscaleImage, uploadImage } from "./upload";

export type PickedImage = { id: string; file: File; url: string };
export const PICK_MIN = 2;
export const PICK_MAX = 20;

/** Agrega archivos a la lista (ordenados por nombre, como vienen de Instagram), hasta 20. */
export function addPicked(current: PickedImage[], list: File[]): PickedImage[] {
  const next = [...current, ...list.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) }))];
  next.sort((a, b) => a.file.name.localeCompare(b.file.name, "es", { numeric: true }));
  for (const gone of next.slice(PICK_MAX)) URL.revokeObjectURL(gone.url);
  return next.slice(0, PICK_MAX);
}

/** Sube los slides en orden a la URL que arma `urlFor(n)` y devuelve sus claves. */
export async function uploadPicked(files: PickedImage[], urlFor: (n: number) => string, onProgress: (done: number, total: number) => void): Promise<string[]> {
  const keys: string[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress(i, files.length);
    const blob = await downscaleImage(files[i]!.file, 1600);
    const res = await uploadImage(urlFor(i + 1), blob);
    keys.push(res.key);
  }
  onProgress(files.length, files.length);
  return keys;
}

/**
 * Los slides de un carrusel elegidos desde la computadora o el teléfono, con su miniatura local (no sale del navegador
 * hasta que se suben). Las miniaturas se liberan al quitar una imagen y al salir.
 */
export function ReferencePicker({ files, onChange, disabled, title }: { files: PickedImage[]; onChange: (next: PickedImage[]) => void; disabled?: boolean; title?: string }) {
  const urls = useRef<string[]>([]);
  useEffect(() => {
    urls.current = files.map((f) => f.url);
  }, [files]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const remove = (id: string) => {
    const gone = files.find((f) => f.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    onChange(files.filter((f) => f.id !== id));
  };

  return (
    <div className="flex flex-col gap-3">
      <UploadDropzone
        onFiles={(list) => onChange(addPicked(files, list))}
        multiple
        accept={["image/jpeg", "image/png", "image/webp", ".jpg", ".jpeg", ".png", ".webp"]}
        acceptLabel="imágenes JPG, PNG o WebP"
        maxSize={25 * 1024 * 1024}
        title={title ?? "Arrastra aquí los slides del carrusel"}
        hint="De 2 a 20 imágenes, en orden (se ordenan por nombre de archivo)."
        disabled={disabled}
      />
      {files.length > 0 && (
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8" aria-label="Slides elegidos">
          {files.map((f, i) => (
            <li key={f.id} className="relative overflow-hidden rounded-lg border border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) que no sale del navegador */}
              <img src={f.url} alt={`Slide ${i + 1}`} className="aspect-[4/5] w-full object-cover" />
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 font-mono text-[10px] font-bold text-white">{i + 1}</span>
              <button type="button" onClick={() => remove(f.id)} disabled={disabled} aria-label={`Quitar la imagen ${i + 1}`} className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className={cn("text-xs", files.length && files.length < PICK_MIN ? "text-warning" : "text-muted")}>
        {files.length === 0 ? "Todavía no elegiste imágenes." : files.length < PICK_MIN ? "Sube al menos 2 slides." : `${files.length} slides listos.`}
      </p>
    </div>
  );
}
