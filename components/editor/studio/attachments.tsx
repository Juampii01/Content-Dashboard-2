"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RefImage } from "@/lib/video/compos/schema";
import { uploadRefImageAction } from "../compos-actions";
import { clipOptionAction } from "../edit-actions";
import { completeClipUploadAction, createClipUploadAction } from "../media-actions";
import { mentionLibraryAction, type LibraryPick } from "../library-mention-actions";
import { putFile } from "../upload-manager";
import { VIDEO_ACCEPT } from "../constants";
import type { SignedOption } from "../broll-panel";

/**
 * Adjuntos para pedirle cosas a Claude en el Estudio: videos (van a tu biblioteca de b-roll y se ponen en el momento
 * que dices) e imágenes (referencia de estilo o para usar dentro de una animación). Se suben apenas se eligen.
 */
export type Attachment = {
  id: string;
  /** A1, A2…: cómo los nombra el pedido. */
  ref: string;
  kind: "video" | "image";
  name: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  /** Vista local (miniatura) mientras dura la sesión. */
  localUrl?: string;
  /** Imagen: la referencia guardada en el proyecto y cómo se usa. */
  image?: Omit<RefImage, "use" | "note">;
  use?: RefImage["use"];
  /** Video: la alternativa de b-roll lista para poner en un tramo. */
  clip?: SignedOption;
  duration?: number;
  /** De tu biblioteca (nombrada con @): su id, y en un video sus hojas de cuadros (para usarlo como referencia). */
  libraryId?: string;
  sheets?: Omit<RefImage, "use" | "note">[];
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
const MAX_IMAGES = 4;
const MAX_VIDEOS = 3;

/** Achica la imagen en el navegador (lado mayor 1568 px, WebP) para que suba rápido; el servidor la vuelve a validar. */
async function shrinkImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const q of [0.88, 0.78, 0.66, 0.55]) {
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", q));
      if (blob && blob.size < 900_000) return blob;
    }
  } catch {
    // Un formato que el navegador no abre (HEIC en algunos): se manda tal cual y el servidor decide.
  }
  return file;
}

/**
 * Duración y tamaño de un video local (para ponerlo antes de que el servidor termine de prepararlo). Si el navegador no
 * puede leerlo (HEVC en algunos equipos), sigue sin esos datos: el servidor los mide igual.
 */
function videoMeta(url: string): Promise<{ duration: number; width: number; height: number }> {
  const unknown = { duration: 0, width: 1080, height: 1920 };
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const timer = setTimeout(() => resolve(unknown), 8000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve({
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 1080,
        height: v.videoHeight || 1920,
      });
    };
    v.onerror = () => {
      clearTimeout(timer);
      resolve(unknown);
    };
    v.src = url;
  });
}

let seq = 0;

export function useAttachments(projectId: string, opts: { video: boolean }) {
  const [list, setList] = useState<Attachment[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const patch = useCallback((id: string, p: Partial<Attachment>) => setList((cur) => cur.map((a) => (a.id === id ? { ...a, ...p } : a))), []);

  const current = useRef<Attachment[]>([]);
  useEffect(() => {
    current.current = list;
  }, [list]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const next = [...current.current];
      const started: [Attachment, File][] = [];
      for (const file of [...files]) {
        const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name);
        const isImage = file.type.startsWith("image/");
        if ((!isVideo && !isImage) || (isVideo && !opts.video)) continue;
        if (isVideo && next.filter((a) => a.kind === "video").length >= MAX_VIDEOS) continue;
        if (isImage && next.filter((a) => a.kind === "image").length >= MAX_IMAGES) continue;
        const localUrl = URL.createObjectURL(file);
        urls.current.push(localUrl);
        const used = new Set(next.map((a) => a.ref));
        let n = 1;
        while (used.has(`A${n}`)) n++;
        const a: Attachment = {
          id: `at${Date.now().toString(36)}${seq++}`,
          ref: `A${n}`,
          kind: isVideo ? "video" : "image",
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "archivo",
          status: "uploading",
          progress: 0,
          localUrl,
          ...(isImage ? { use: "style" as const } : {}),
        };
        next.push(a);
        started.push([a, file]);
      }
      current.current = next;
      setList(next);
      for (const [a, file] of started) void (a.kind === "video" ? uploadVideo(a, file) : uploadImage(a, file));

      async function uploadImage(a: Attachment, file: File) {
        const form = new FormData();
        const blob = await shrinkImage(file);
        form.set("file", blob instanceof File ? blob : new File([blob], `${a.name}.webp`, { type: "image/webp" }));
        const r = await uploadRefImageAction(projectId, form).catch(() => ({
          ok: false as const,
          error: "No pudimos subir la imagen. Prueba de nuevo.",
        }));
        if (!r.ok) patch(a.id, { status: "error", error: r.error });
        else patch(a.id, { status: "ready", progress: 100, image: r.ref });
      }

      async function uploadVideo(a: Attachment, file: File) {
        try {
          const meta = await videoMeta(a.localUrl!);
          const created = await createClipUploadAction({
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
          });
          if (!created.ok || !created.data) throw new Error(created.ok ? "No pudimos preparar la subida." : created.error);
          const { id, key, mode } = created.data;
          await putFile({
            file,
            key,
            mode,
            clientPayload: `clip:${id}`,
            signal: new AbortController().signal,
            onProgress: (loaded) =>
              patch(a.id, {
                progress: Math.min(99, (loaded / file.size) * 100),
              }),
          });
          const done = await completeClipUploadAction(id);
          if (!done.ok) throw new Error(done.error);
          const opt = await clipOptionAction(id, meta);
          if (!opt.ok) throw new Error(opt.error);
          patch(a.id, {
            status: "ready",
            progress: 100,
            clip: opt.option,
            duration: opt.option.duration || undefined,
          });
        } catch (error) {
          patch(a.id, {
            status: "error",
            error: error instanceof Error && /[áéíóú]|subida|archivo|video|clip/i.test(error.message) ? error.message : "La subida falló. Vuelve a intentarlo.",
          });
        }
      }
    },
    [projectId, opts.video, patch],
  );

  /** Algo de tu biblioteca, nombrado con @: queda como adjunto (A1, A2…) con su ficha, sus cuadros y listo para b-roll. */
  const addLibrary = useCallback(
    (pick: LibraryPick): string | null => {
      const cur = current.current;
      const existing = cur.find((a) => a.libraryId === pick.id);
      if (existing) return existing.ref;
      if (cur.length >= MAX_IMAGES + MAX_VIDEOS) return null;
      const used = new Set(cur.map((a) => a.ref));
      let n = 1;
      while (used.has(`A${n}`)) n++;
      const a: Attachment = {
        id: `at${Date.now().toString(36)}${seq++}`,
        ref: `A${n}`,
        kind: pick.kind,
        name: pick.title.slice(0, 80),
        status: "uploading",
        progress: 0,
        localUrl: pick.thumbUrl ?? undefined,
        libraryId: pick.id,
        ...(pick.kind === "image" ? { use: "style" as const } : {}),
      };
      current.current = [...cur, a];
      setList(current.current);
      void mentionLibraryAction(projectId, pick.id)
        .then((r) => {
          if (!r.ok) return patch(a.id, { status: "error", error: r.error });
          const att = r.attachment;
          patch(a.id, {
            status: "ready",
            progress: 100,
            clip: att.clip,
            duration: att.duration ?? undefined,
            ...(att.kind === "image" ? { image: att.refs[0] } : { sheets: att.refs }),
          });
        })
        .catch(() => patch(a.id, { status: "error", error: "No pudimos preparar esa pieza. Prueba de nuevo." }));
      return a.ref;
    },
    [projectId, patch],
  );

  const remove = useCallback((id: string) => setList((cur) => cur.filter((a) => a.id !== id)), []);
  const setUse = useCallback((id: string, use: RefImage["use"]) => patch(id, { use }), [patch]);
  const clear = useCallback(() => setList([]), []);
  const uploading = list.some((a) => a.status === "uploading");
  return { list, add, addLibrary, remove, setUse, clear, uploading };
}

export type AttachmentsApi = ReturnType<typeof useAttachments>;

/** Los videos que van DENTRO de la animación: los elegidos con uso «inside», por su id en la biblioteca. */
export function clipIdsOf(list: Attachment[], pick: { ref: string; use: string }[]): string[] {
  const out: string[] = [];
  for (const p of pick) {
    if (p.use !== "inside") continue;
    const a = list.find((x) => x.ref === p.ref && x.kind === "video" && x.status === "ready");
    const id = a?.libraryId ?? a?.clip?.id;
    if (id && /^[0-9a-f-]{36}$/i.test(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 2);
}

/** Las imágenes listas como referencias para un pedido (opcionalmente, solo algunas y con su uso). */
export function refsOf(list: Attachment[], pick?: { ref: string; use: RefImage["use"] }[]): RefImage[] {
  const out: RefImage[] = [];
  for (const a of list) {
    if (a.status !== "ready") continue;
    const chosen = pick ? pick.find((p) => p.ref === a.ref) : null;
    if (pick && !chosen) continue;
    // Un video de tu biblioteca como referencia: sus hojas de cuadros, solo de estilo. Uno «para usar dentro» no va
    // aquí: va como video de la animación (clipIdsOf).
    if (a.kind === "video") {
      if (chosen?.use === "inside") continue;
      if (!a.sheets?.length || (!pick && a.use !== "style")) continue;
      for (const sheet of a.sheets) out.push({ ...sheet, use: "style", note: `Cuadros del clip «${a.name}» de tu biblioteca` });
      continue;
    }
    if (!a.image) continue;
    out.push({
      ...a.image,
      use: chosen?.use ?? a.use ?? "style",
      note: a.name,
    });
  }
  return out.slice(0, MAX_IMAGES);
}

/** Botón para adjuntar (abre el selector de archivos; también acepta soltar archivos encima). */
export function AttachButton({ api, video, disabled, className }: { api: AttachmentsApi; video: boolean; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        accept={video ? `${VIDEO_ACCEPT},${IMAGE_ACCEPT}` : IMAGE_ACCEPT}
        onChange={(e) => {
          if (e.target.files?.length) api.add(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50", className)}
        title={video ? "Adjunta un video (b-roll) o imágenes de referencia" : "Adjunta imágenes de referencia"}
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> {video ? "Adjuntar video o imagen" : "Adjuntar imagen"}
      </button>
    </>
  );
}

/** Los adjuntos elegidos: miniatura, progreso, cómo se usa cada imagen y quitar. */
export function AttachList({ api, showUse = true }: { api: AttachmentsApi; showUse?: boolean }) {
  if (!api.list.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Adjuntos">
      {api.list.map((a) => (
        <li key={a.id} className={cn("flex items-center gap-2 rounded-xl border px-2 py-1.5", a.status === "error" ? "border-danger/40 bg-danger/[0.05]" : "border-white/10 bg-card")}>
          <span className="relative grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-lg bg-white/5">
            {(a.kind === "image" || a.libraryId) && a.localUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.localUrl} alt="" className="h-full w-full object-cover" />
            ) : a.kind === "video" && a.localUrl ? (
              <video src={a.localUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" aria-hidden />
            ) : a.kind === "video" ? (
              <Film className="h-4 w-4 text-muted" aria-hidden />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted" aria-hidden />
            )}
            <span className="absolute top-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[9px] font-semibold text-paper">{a.ref}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-white">{a.name}</span>
            <span className={cn("block text-[11px]", a.status === "error" ? "text-danger" : "text-muted")}>
              {a.status === "uploading" ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> Subiendo
                  {a.kind === "video" ? ` ${Math.round(a.progress)} %` : "…"}
                </span>
              ) : a.status === "error" ? (
                a.error
              ) : a.libraryId ? (
                `De tu biblioteca${a.kind === "video" && a.duration ? ` · video de ${a.duration.toFixed(1)} s` : " · imagen"}`
              ) : a.kind === "video" ? (
                `Video${a.duration ? ` de ${a.duration.toFixed(1)} s` : ""} · queda en tu biblioteca de b-roll`
              ) : (
                "Imagen lista"
              )}
            </span>
            {showUse && a.kind === "image" && a.status !== "error" && (
              <select
                aria-label={`Cómo usar ${a.name}`}
                value={a.use ?? "style"}
                onChange={(e) => api.setUse(a.id, e.target.value as RefImage["use"])}
                className="mt-1 h-7 w-full rounded-lg border border-white/10 bg-card px-1.5 text-[11px] text-text focus-visible:outline-2 focus-visible:outline-[#4da3ff]"
              >
                <option value="style">Estilo de referencia</option>
                <option value="inside">Usarla en la animación</option>
              </select>
            )}
          </span>
          <button
            type="button"
            onClick={() => api.remove(a.id)}
            className="grid h-7 w-7 flex-none place-items-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-white"
            aria-label={`Quitar ${a.name}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
